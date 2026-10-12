import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { handlePrismaError } from "../utils/prisma-errors.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionSeatPricingSelect,
  idOnlySelect,
  seatBookingPaymentCheckSelect,
} from "../utils/prisma-selects";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import { HelloAssoService } from "./hello-asso.service";
import { PaymentNotificationService } from "./payment-notification.service";
import {
  checkOrderAgainstBooking,
  getWebhookMetadata,
  isHoldExpired,
  REFUND_REQUIRED_REASONS,
  type OrderRejectionReason,
} from "./helloasso-order-check";
import { resolveSeatPriceCents } from "./seat-pricing";

/** How long a seat is held while its HelloAsso checkout is in progress. */
export const SEAT_HOLD_DURATION_MS = 15 * 60 * 1000;

/**
 * PENDING holds whose deadline is over (or missing) at `now` (#401). Holds
 * expire lazily: there is no scheduled purge (scale-to-zero, see CLAUDE.md),
 * they are switched to EXPIRED when the seat is checked out again or when
 * their late payment arrives.
 */
function lapsedHoldWhere(now: Date) {
  return {
    status: "PENDING" as const,
    OR: [{ expiresAt: null }, { expiresAt: { lte: now } }],
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly configService: ConfigService,
    private readonly paymentNotificationService: PaymentNotificationService,
  ) {}

  async createCheckout(userId: string, body: CreateCheckoutDto) {
    // 1. Vérifier que la compétition a un club organisateur avec HelloAsso connecté
    const credentials =
      await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(
        body.competitionId,
      );
    if (!credentials) {
      throw new BadRequestException(
        "Le club organisateur de cette compétition n'a pas connecté son compte HelloAsso. " +
          "L'organisateur doit configurer HelloAsso dans Paramètres du club.",
      );
    }

    // 2. Prix de la place, fixé côté serveur (#381) : `body.amount` est ignoré
    const competition = await this.prisma.competition.findUnique({
      where: { id: body.competitionId },
      select: competitionSeatPricingSelect,
    });
    const amountCents = competition
      ? resolveSeatPriceCents(competition.layout, body.itemId)
      : null;
    if (amountCents === null) {
      throw new BadRequestException(
        "Aucun tarif n'est défini pour cette place : le paiement en ligne est indisponible.",
      );
    }

    // 3. Charger l'utilisateur pour les infos paiement
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) {
      throw new BadRequestException("User not found");
    }

    // 4. Réserver la place (#401, #402). Une place n'a qu'une réservation
    // active (PENDING ou CONFIRMED) : garanti en base par l'index unique
    // partiel `SeatBooking_active_seat_key`, y compris sous concurrence. Les
    // réservations temporaires échues de cette place sont d'abord passées en
    // EXPIRED (expiration paresseuse, sans tâche planifiée) pour la libérer.
    const now = new Date();
    await this.prisma.seatBooking.updateMany({
      where: {
        competitionId: body.competitionId,
        itemId: body.itemId,
        ...lapsedHoldWhere(now),
      },
      data: { status: "EXPIRED" },
    });

    let booking;
    try {
      booking = await this.prisma.seatBooking.create({
        data: {
          competitionId: body.competitionId,
          userId: user.id,
          itemId: body.itemId,
          seatLabel: body.seatLabel,
          status: "PENDING",
          expectedAmountCents: amountCents,
          expiresAt: new Date(now.getTime() + SEAT_HOLD_DURATION_MS),
        },
        select: idOnlySelect,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Seat already held or sold: refuse before any HelloAsso intent.
        throw new ConflictException(
          "Cette place est déjà réservée. Choisissez une autre place.",
        );
      }
      handlePrismaError(err, "SeatBooking");
    }

    const appBaseUrl =
      this.configService.get<string>("APP_URL") ?? "https://app.example.com";

    try {
      const intent = await this.helloAssoService.createCheckoutIntent(
        credentials,
        appBaseUrl,
        {
          amount: amountCents,
          label: `Place Compétition - ${body.seatLabel ?? body.itemId}`,
          consumerEmail: user.email,
          consumerFirstName: user.firstName,
          consumerLastName: user.lastName,
          metadata: {
            bookingId: booking.id,
            competitionId: body.competitionId,
          },
        },
      );

      await this.prisma.seatBooking.update({
        where: { id: booking.id },
        // HelloAsso returns a numeric id; the column is a string.
        data: { paymentId: String(intent.id) },
      });

      return intent;
    } catch (error) {
      this.logger.error(
        `Payment initiation failed for booking ${booking.id}`,
        error instanceof Error ? error.stack : error,
      );
      await this.prisma.seatBooking
        .delete({ where: { id: booking.id } })
        .catch(() => {});
      throw new BadRequestException("Échec de l'initiation du paiement");
    }
  }

  /**
   * Signed HelloAsso `Order` notification (#381): confirms the booking only
   * when the order is paid, for the expected amount, on the booking's
   * competition and checkout intent (fail-closed, see
   * `checkOrderAgainstBooking`). A rejection never throws — HelloAsso gets a
   * 2xx and does not retry — but is logged and reported to Sentry
   * (identifiers only, no personal data).
   *
   * A legacy booking (created before #381, no stored expected amount) is
   * rejected rather than compared against today's layout price, which may
   * have changed since.
   *
   * A genuine payment that arrives after the hold's deadline (#401) never
   * confirms the seat — it may have been checked out by someone else since:
   * it is rejected as `booking_expired`, flagged `refund: required` in Sentry,
   * and the lapsed hold is switched to EXPIRED.
   *
   * The transition is a conditional update (PENDING + same expected amount +
   * deadline not reached) so a booking cancelled, re-priced or expired
   * between the read and the write is never confirmed. Exactly one delivery
   * wins that transition, even when HelloAsso replays the webhook
   * concurrently: only that one tells the organizer club (#39), and the
   * notification never rejects.
   */
  async handleOrderWebhook(payload: WebhookPayloadDto): Promise<void> {
    const bookingId = getWebhookMetadata(payload)?.bookingId;
    if (!bookingId) return; // Not a seat-booking checkout.

    const orderId = payload.data.id;
    const booking = await this.prisma.seatBooking.findUnique({
      where: { id: bookingId },
      select: seatBookingPaymentCheckSelect,
    });
    if (!booking) {
      this.rejectOrder(bookingId, orderId, "booking_not_found");
      return;
    }
    if (booking.status === "CONFIRMED") {
      // HelloAsso redelivery of an order already processed: nothing to do.
      this.logger.log(`Booking ${bookingId} already confirmed`);
      return;
    }

    const now = new Date();
    const reason = checkOrderAgainstBooking(payload, booking, now);
    if (reason === "booking_expired") {
      // Opportunistic cleanup: the lapsed hold no longer blocks the seat.
      if (booking.status === "PENDING") {
        await this.prisma.seatBooking.updateMany({
          where: { id: booking.id, ...lapsedHoldWhere(now) },
          data: { status: "EXPIRED" },
        });
      }
      this.rejectOrder(bookingId, orderId, reason);
      return;
    }
    if (reason) {
      this.rejectOrder(bookingId, orderId, reason);
      return;
    }

    const { count } = await this.prisma.seatBooking.updateMany({
      where: {
        id: booking.id,
        status: "PENDING",
        expectedAmountCents: booking.expectedAmountCents,
        expiresAt: { gt: now },
      },
      data: { status: "CONFIRMED" },
    });
    if (count === 0) {
      // Lost a race. A concurrent redelivery of this same order may have
      // confirmed it: that is not a late payment (no false refund flag).
      const current = await this.prisma.seatBooking.findUnique({
        where: { id: booking.id },
        select: seatBookingPaymentCheckSelect,
      });
      if (current?.status === "CONFIRMED") {
        this.logger.log(`Booking ${bookingId} already confirmed`);
        return;
      }
      // Otherwise the hold lapsed, or the booking changed, meanwhile.
      const lapsed =
        current?.status === "PENDING" && isHoldExpired(current, new Date());
      this.rejectOrder(
        bookingId,
        orderId,
        lapsed ? "booking_expired" : "not_pending",
      );
      return;
    }

    // Never rejects: a notification failure must not fail the webhook.
    await this.paymentNotificationService.notifyPaymentReceived(booking.id);
  }

  private rejectOrder(
    bookingId: string,
    orderId: number | undefined,
    reason: OrderRejectionReason,
  ): void {
    this.logger.error(
      `HelloAsso order ${orderId ?? "?"} rejected for booking ${bookingId}: ${reason}`,
    );
    Sentry.captureMessage("HelloAsso order rejected", {
      level: "error",
      tags: {
        payment: "helloasso-order-rejected",
        reason,
        // Money collected for a seat we do not grant: refund the payer (#403).
        ...(REFUND_REQUIRED_REASONS.has(reason) ? { refund: "required" } : {}),
      },
      extra: { bookingId, orderId },
    });
  }
}
