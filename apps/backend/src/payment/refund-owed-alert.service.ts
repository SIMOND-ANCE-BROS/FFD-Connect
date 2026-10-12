import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, UserRole } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { withActiveRole } from "../auth/roles";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  clubIdNameSelect,
  idOnlySelect,
  seatBookingRefundAlertSelect,
} from "../utils/prisma-selects";

/** Same bound as the other club-manager notifications. */
const MAX_CLUB_RECIPIENTS = 50;

function formatEuros(cents: number | null): string {
  if (cents === null) return "";
  return ` de ${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/**
 * Alerts the organising club that a booking is owed a refund (#428): a
 * HelloAsso payment arrived for a seat that was not granted (hold expired,
 * or the seat was already paid). Refunds are made by hand by the club from
 * its HelloAsso back-office (#438); the resulting `Refunded` notification
 * removes that payment from the booking's `refundOwedPaymentIds` (`SeatReleaseService`).
 *
 * Recipients: the club's managers (active CLUB role), as for the other club
 * notifications. The message carries no personal data of the payer: the
 * club finds the payment in HelloAsso from the order number.
 *
 * Best-effort: never throws. The marker is already in the database and the
 * rejection is in Sentry; a lost alert must not make HelloAsso redeliver.
 */
@Injectable()
export class RefundOwedAlertService {
  private readonly logger = new Logger(RefundOwedAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async alertClub(bookingId: string, orderId: number | undefined) {
    try {
      const booking = await this.prisma.seatBooking.findUnique({
        where: { id: bookingId },
        select: seatBookingRefundAlertSelect,
      });
      const organizer = booking?.competition.organizer?.trim();
      if (!booking || !organizer) {
        this.unalerted(bookingId, "no_organizer");
        return;
      }

      const club = await this.prisma.club.findFirst({
        where: { name: { equals: organizer, mode: "insensitive" } },
        select: clubIdNameSelect,
      });
      if (!club) {
        this.unalerted(bookingId, "club_not_found");
        return;
      }

      const managers = await this.prisma.user.findMany({
        where: {
          AND: [
            withActiveRole(UserRole.CLUB),
            {
              OR: [
                { clubId: club.id },
                { clubName: { equals: club.name.trim(), mode: "insensitive" } },
              ],
            },
          ],
        },
        select: idOnlySelect,
        take: MAX_CLUB_RECIPIENTS,
      });
      if (managers.length === 0) {
        this.unalerted(bookingId, "no_club_manager");
        return;
      }

      const order = orderId === undefined ? "" : ` (commande n° ${orderId})`;
      const seat =
        booking.seatIndex === null ? "" : ` (place ${booking.seatIndex + 1})`;
      await this.notificationsService.sendToUsers(
        managers.map((manager) => manager.id),
        NotificationType.CLUB_PAYMENT_RECEIVED,
        "Remboursement à effectuer",
        `Un paiement HelloAsso${formatEuros(booking.expectedAmountCents)}${order} pour « ${booking.competition.title} »${seat} n'a pas pu être attribué à une place. ` +
          "Remboursez-le depuis votre espace HelloAsso.",
        {
          type: "club_payment_refund_owed",
          competitionId: booking.competition.id,
          bookingId: booking.id,
          ...(orderId === undefined ? {} : { orderId: String(orderId) }),
        },
      );
    } catch (error) {
      this.logger.error(
        `Refund-owed alert failed for booking ${bookingId}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.unalerted(bookingId, "send_failed");
    }
  }

  /** The club could not be told: Sentry, so that someone does it by hand. */
  private unalerted(bookingId: string, reason: string): void {
    this.logger.error(
      `Refund owed on booking ${bookingId} but the club was not alerted: ${reason}`,
    );
    Sentry.captureMessage("HelloAsso refund owed: club not alerted", {
      level: "error",
      tags: { payment: "helloasso-refund-owed-unalerted", reason },
      extra: { bookingId },
    });
  }
}
