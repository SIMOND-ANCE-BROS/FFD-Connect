import { Injectable, Logger } from "@nestjs/common";
import { NotificationType, UserRole } from "@prisma/client";
import { withActiveRole } from "../auth/roles";
import { resolveOrganizerClubId } from "../competitions/competition-organizer";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { sameClubName } from "../utils/club-name-filter";
import { getErrorMessage } from "../utils/error.utils";
import {
  clubRecipientSelect,
  idOnlySelect,
  seatBookingPaymentNotificationSelect,
} from "../utils/prisma-selects";

/** Upper bound of the club managers told about a payment. */
export const MAX_CLUB_MANAGERS_NOTIFIED = 50;

/** `data.type` of the payload. */
export const CLUB_PAYMENT_RECEIVED_DATA_TYPE = "CLUB_PAYMENT_RECEIVED";

/**
 * Copy of the in-app notification (#39). No payer name and no amount: the
 * feed is a summary, the details live in HelloAsso's back-office.
 */
export const CLUB_PAYMENT_RECEIVED_COPY = {
  title: "Paiement HelloAsso reçu",
  body: (competitionTitle: string, seatLabel: string | null): string =>
    seatLabel
      ? `Un paiement a été reçu pour « ${competitionTitle} » (${seatLabel}).`
      : `Un paiement a été reçu pour « ${competitionTitle} ».`,
} as const;

/**
 * Tells the managers of the club organising a competition that a HelloAsso
 * payment was received for one of its bookings (#39).
 *
 * The concerned club is the one whose HelloAsso account was charged: the
 * competition's organising club, resolved exactly like
 * `ClubsHelloAssoService.getHelloAssoCredentialsForCompetition`
 * (`organizerClubId`, unambiguous label fallback — #408). Only that
 * club's managers (active CLUB role) are addressed — never a broadcast.
 *
 * IN-APP FEED ONLY: no push, push arbitration is decided elsewhere.
 *
 * NEVER REJECTS by contract: every failure (lookup, feed write) is logged and
 * swallowed, so a notification can never fail the webhook — HelloAsso would
 * otherwise retry a payment that is already confirmed.
 */
@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async notifyPaymentReceived(bookingId: string): Promise<void> {
    try {
      const booking = await this.prisma.seatBooking.findUnique({
        where: { id: bookingId },
        select: seatBookingPaymentNotificationSelect,
      });
      if (!booking) return;
      const clubId = await resolveOrganizerClubId(
        this.prisma,
        booking.competition,
      );
      if (!clubId) return;

      const club = await this.prisma.club.findUnique({
        where: { id: clubId },
        select: clubRecipientSelect,
      });
      // A disabled club's CLUB accounts cannot log in to read it.
      if (!club || club.disabledAt) return;

      const managers = await this.prisma.user.findMany({
        where: {
          AND: [
            withActiveRole(UserRole.CLUB),
            { disabledAt: null },
            {
              OR: [
                { clubId: club.id },
                // Legacy accounts without clubId only: a manager of a homonym
                // club (same name up to case) is never addressed (#408).
                {
                  clubId: null,
                  clubName: sameClubName(club.name.trim()),
                },
              ],
            },
          ],
        },
        select: idOnlySelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_CLUB_MANAGERS_NOTIFIED,
      });

      await this.notifications.createManyForUsers(
        managers.map((manager) => manager.id),
        NotificationType.CLUB_PAYMENT_RECEIVED,
        CLUB_PAYMENT_RECEIVED_COPY.title,
        CLUB_PAYMENT_RECEIVED_COPY.body(
          booking.competition.title,
          booking.seatLabel,
        ),
        {
          type: CLUB_PAYMENT_RECEIVED_DATA_TYPE,
          competitionId: booking.competition.id,
          bookingId: booking.id,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Booking ${bookingId}: club payment notification failed: ${getErrorMessage(error)}`,
      );
    }
  }
}
