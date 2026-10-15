import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Sentry from "@sentry/nestjs";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionSeatPricingSelect,
  seatBookingPaymentCheckSelect,
} from "../utils/prisma-selects";
import {
  CheckoutResponseDto,
  CreateCheckoutDto,
} from "./dto/create-checkout.dto";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import {
  HelloAssoService,
  type HelloAssoCheckoutIntent,
  type HelloAssoCredentials,
} from "./hello-asso.service";
import { PaymentNotificationService } from "./payment-notification.service";
import {
  checkOrderAgainstBooking,
  getWebhookMetadata,
  isHoldExpired,
  REFUND_REQUIRED_REASONS,
  type BookingPaymentCheck,
  type OrderRejectionReason,
} from "./helloasso-order-check";
import { RefundOwedAlertService } from "./refund-owed-alert.service";
import {
  lapsedHoldWhere,
  SeatHoldService,
  type HeldBooking,
} from "./seat-hold.service";
import { resolveBookableSeats } from "./seat-layout";
import { resolveSeatPriceCents } from "./seat-pricing";

/**
 * A HelloAsso checkout page stays valid 15 minutes after the intent is
 * created (sandbox, #404). A resumed checkout returns the stored page while
 * it has at least a minute left, otherwise it creates a fresh intent.
 */
export const CHECKOUT_REDIRECT_REUSE_MS = 14 * 60 * 1000;

/**
 * Checkout intents one booking may have (current + replaced ones): each is
 * re-readable by the notification path, so the list stays short. With the
 * hold lifetime (100 min) and a fresh intent at most every 14 min, a buyer
 * never needs more.
 */
export const MAX_INTENTS_PER_BOOKING = 8;

const PAYMENT_IN_PROGRESS =
  "Un paiement est déjà en cours pour cette place. Réessayez dans quelques instants.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CheckoutContext {
  credentials: HelloAssoCredentials;
  label: string;
  user: { email: string; firstName: string; lastName: string };
  competitionId: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
    private readonly configService: ConfigService,
    private readonly seatHoldService: SeatHoldService,
    private readonly refundOwedAlertService: RefundOwedAlertService,
    private readonly paymentNotificationService: PaymentNotificationService,
  ) {}

  /**
   * Holds one seat and returns the HelloAsso page to pay it (#381, #401,
   * #402, #428). Everything is sold per seat; the price is the element's
   * `priceCents`, never the request's `amount`. A checkout by the same user
   * on their own pending seat resumes its payment instead of a 409.
   */
  async createCheckout(
    userId: string,
    body: CreateCheckoutDto,
  ): Promise<CheckoutResponseDto> {
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

    // 2. Prix et places de l'élément, fixés côté serveur (#381, #428)
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
    const seats = resolveBookableSeats(competition?.layout, body.itemId);
    if (!seats) {
      throw new BadRequestException(
        "Cet élément du plan n'a pas de place réservable.",
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

    // 4. Réserver la place, ou reprendre sa propre réservation en attente
    const { resumed, booking } = await this.seatHoldService.hold({
      userId: user.id,
      competitionId: body.competitionId,
      itemId: body.itemId,
      seats,
      seatIndex: body.seatIndex,
      seatLabel: body.seatLabel,
      amountCents,
    });
    const respond = (
      intent: { id: number; redirectUrl: string },
      expiresAt: Date,
    ): CheckoutResponseDto => ({
      id: intent.id,
      redirectUrl: intent.redirectUrl,
      bookingId: booking.id,
      // A free-placement slot is internal: no seat number to show.
      seatIndex: seats.mode === "numbered" ? booking.seatIndex : null,
      expiresAt,
      resumed,
    });

    const now = new Date();
    const checkout = {
      credentials,
      label: `Place Compétition - ${body.seatLabel ?? body.itemId}`,
      user,
      competitionId: body.competitionId,
    };

    if (resumed) {
      return this.resumeCheckout(booking, checkout, now, respond);
    }

    let intent: HelloAssoCheckoutIntent;
    try {
      intent = await this.createIntent(booking, checkout);
      await this.seatHoldService.recordIntent(
        booking.id,
        { id: String(intent.id), redirectUrl: intent.redirectUrl },
        now,
      );
    } catch (error) {
      this.logger.error(
        `Payment initiation failed for booking ${booking.id}`,
        error instanceof Error ? error.stack : error,
      );
      await this.seatHoldService.release(booking.id);
      throw new BadRequestException("Échec de l'initiation du paiement");
    }
    return respond(intent, booking.expiresAt ?? now);
  }

  /**
   * Resumes the payment of the user's own PENDING booking (#428): the stored
   * HelloAsso page while it is still valid, otherwise a fresh intent for the
   * same booking. An earlier intent that already carries a payment is never
   * replaced (its order is about to confirm the seat).
   */
  private async resumeCheckout(
    booking: HeldBooking,
    checkout: CheckoutContext,
    now: Date,
    respond: (
      intent: { id: number; redirectUrl: string },
      expiresAt: Date,
    ) => CheckoutResponseDto,
  ): Promise<CheckoutResponseDto> {
    const expiresAt = booking.expiresAt ?? now;
    if (
      booking.paymentId &&
      booking.checkoutRedirectUrl &&
      booking.checkoutCreatedAt &&
      now.getTime() - booking.checkoutCreatedAt.getTime() <
        CHECKOUT_REDIRECT_REUSE_MS
    ) {
      return respond(
        {
          id: Number(booking.paymentId),
          redirectUrl: booking.checkoutRedirectUrl,
        },
        expiresAt,
      );
    }
    // No intent yet: a concurrent checkout of this booking is creating it.
    // No stored price: a booking from before #381, never paid on trust.
    if (!booking.paymentId || booking.expectedAmountCents === null) {
      throw new ConflictException(PAYMENT_IN_PROGRESS);
    }
    if (booking.supersededPaymentIds.length + 1 >= MAX_INTENTS_PER_BOOKING) {
      throw new ConflictException(
        "Trop de tentatives de paiement pour cette place. Attendez l'expiration de la réservation.",
      );
    }
    if (await this.intentHasOrder(checkout.credentials, booking.paymentId)) {
      throw new ConflictException(PAYMENT_IN_PROGRESS);
    }

    let intent: HelloAssoCheckoutIntent;
    try {
      intent = await this.createIntent(booking, checkout);
    } catch (error) {
      this.logger.error(
        `Payment resume failed for booking ${booking.id}`,
        error instanceof Error ? error.stack : error,
      );
      // The hold and its previous intent stay as they are.
      throw new BadRequestException("Échec de l'initiation du paiement");
    }
    const { replaced, expiresAt: newDeadline } =
      await this.seatHoldService.replaceIntent(
        booking,
        { id: String(intent.id), redirectUrl: intent.redirectUrl },
        now,
      );
    if (!replaced) {
      // Another checkout or a notification changed the booking meanwhile:
      // the intent just created is never handed out, so it is never paid.
      throw new ConflictException(PAYMENT_IN_PROGRESS);
    }
    return respond(intent, newDeadline);
  }

  /** HelloAsso intent for the booking, at the price fixed at checkout. */
  private createIntent(
    booking: Pick<HeldBooking, "id" | "expectedAmountCents">,
    checkout: CheckoutContext,
  ): Promise<HelloAssoCheckoutIntent> {
    const appBaseUrl =
      this.configService.get<string>("APP_URL") ?? "https://app.example.com";
    return this.helloAssoService.createCheckoutIntent(
      checkout.credentials,
      appBaseUrl,
      {
        // Fixed at the first checkout: a resumed payment keeps its price.
        amount: booking.expectedAmountCents ?? 0,
        label: checkout.label,
        consumerEmail: checkout.user.email,
        consumerFirstName: checkout.user.firstName,
        consumerLastName: checkout.user.lastName,
        metadata: {
          bookingId: booking.id,
          competitionId: checkout.competitionId,
        },
      },
    );
  }

  /**
   * Whether HelloAsso already has an (authorised) order on the intent. An
   * unreadable intent is not replaced: 503, the buyer tries again.
   */
  private async intentHasOrder(
    credentials: HelloAssoCredentials,
    intentId: string,
  ): Promise<boolean> {
    try {
      const read = await this.helloAssoService.getCheckoutIntent(
        credentials,
        intentId,
      );
      return read.found && isRecord(read.value.order);
    } catch {
      throw new ServiceUnavailableException(
        "HelloAsso est momentanément indisponible. Réessayez dans quelques instants.",
      );
    }
  }

  /**
   * HelloAsso `Order` notification, as re-read from the HelloAsso API
   * (#381, ADR-0022): confirms the booking only when the order is paid, for
   * the expected amount, on the booking's competition and on one of the
   * booking's own checkout intents (fail-closed, see
   * `checkOrderAgainstBooking`). A rejection never throws — HelloAsso gets a
   * 2xx and does not retry — but is logged and reported to Sentry
   * (identifiers only, no personal data).
   *
   * A legacy booking (created before #381, no stored expected amount) is
   * rejected rather than compared against today's layout price, which may
   * have changed since.
   *
   * Money collected without a seat granted — a payment after the hold's
   * deadline (#401), a second payment of an already confirmed seat through
   * an earlier intent of a resumed checkout (#428), or a payment on an
   * earlier intent of a booking released after a refund or dispute (#456) —
   * never confirms anything:
   * the booking is flagged `refundOwedAt` and the organising club is alerted
   * to refund it by hand (#438).
   *
   * The transition is a conditional update (PENDING + same expected amount +
   * same current intent + deadline not reached) so a booking cancelled,
   * re-priced, resumed or expired between the read and the write is never
   * confirmed. Exactly one delivery wins that transition, even when HelloAsso
   * replays the webhook concurrently: only that one tells the organizer club
   * (#39), and the notification never rejects.
   */
  async handleOrderWebhook(payload: WebhookPayloadDto): Promise<void> {
    const bookingId = getWebhookMetadata(payload)?.bookingId;
    if (!bookingId) return; // Not a seat-booking checkout.

    const orderId = payload.data.id;
    const paidIntent =
      payload.data.checkoutIntentId === undefined
        ? undefined
        : String(payload.data.checkoutIntentId);
    const booking = await this.prisma.seatBooking.findUnique({
      where: { id: bookingId },
      select: seatBookingPaymentCheckSelect,
    });
    if (!booking) {
      this.rejectOrder(bookingId, orderId, "booking_not_found");
      return;
    }
    if (booking.status === "CONFIRMED" && paidIntent === booking.paymentId) {
      // HelloAsso redelivery of an order already processed: nothing to do.
      this.logger.log(`Booking ${bookingId} already confirmed`);
      return;
    }

    const now = new Date();
    const reason = checkOrderAgainstBooking(payload, booking, now);
    if (reason && REFUND_REQUIRED_REASONS.has(reason)) {
      // Only reached once the order is proven to be on one of the booking's
      // intents (`checkOrderAgainstBooking`): `paidIntent` is defined.
      await this.flagRefundOwed(
        booking,
        now,
        paidIntent as string,
        orderId,
        reason,
      );
      return;
    }
    if (
      reason &&
      (booking.status === "CONFIRMED" || booking.status === "CANCELLED")
    ) {
      // An earlier intent of a confirmed or released seat that is not (or no
      // longer) paid: anyone can name it in a forged notification — logged
      // only, never sent to Sentry (quota).
      this.logger.warn(
        `HelloAsso order ${orderId ?? "?"} on an earlier intent of ${booking.status.toLowerCase()} booking ${bookingId}: ${reason}`,
      );
      return;
    }
    if (reason) {
      this.rejectOrder(bookingId, orderId, reason);
      return;
    }

    // `paidIntent` is one of the booking's intents (checked above): it
    // becomes the booking's payment, the others stay re-readable.
    const confirmedIntent = paidIntent as string;
    const { count } = await this.prisma.seatBooking.updateMany({
      where: {
        id: booking.id,
        status: "PENDING",
        paymentId: booking.paymentId,
        expectedAmountCents: booking.expectedAmountCents,
        expiresAt: { gt: now },
      },
      data: {
        status: "CONFIRMED",
        paymentId: confirmedIntent,
        supersededPaymentIds: [
          ...booking.supersededPaymentIds.filter(
            (id) => id !== confirmedIntent,
          ),
          ...(booking.paymentId && booking.paymentId !== confirmedIntent
            ? [booking.paymentId]
            : []),
        ],
      },
    });
    if (count === 0) {
      // Lost a race. A concurrent redelivery of this same order may have
      // confirmed it: that is not a late payment (no false refund flag).
      const current = await this.prisma.seatBooking.findUnique({
        where: { id: booking.id },
        select: seatBookingPaymentCheckSelect,
      });
      if (
        current?.status === "CONFIRMED" &&
        current.paymentId === confirmedIntent
      ) {
        this.logger.log(`Booking ${bookingId} already confirmed`);
        return;
      }
      // Otherwise the hold lapsed, or the booking changed, meanwhile.
      if (current?.status === "PENDING" && isHoldExpired(current, new Date())) {
        await this.flagRefundOwed(
          current,
          new Date(),
          confirmedIntent,
          orderId,
          "booking_expired",
        );
        return;
      }
      if (current?.status === "PENDING") {
        // Resumed meanwhile (its intent changed): the paid intent is now one
        // of its earlier ones. Let HelloAsso redeliver: the next pass
        // confirms it instead of dropping a collected payment.
        throw new ServiceUnavailableException(
          "Booking changed while confirming, notification to be redelivered",
        );
      }
      this.rejectOrder(bookingId, orderId, "not_pending");
      return;
    }

    // Never rejects: a notification failure must not fail the webhook.
    await this.paymentNotificationService.notifyPaymentReceived(booking.id);
  }

  /**
   * Money collected for a seat not granted (#428): the lapsed hold switches
   * to EXPIRED, the paid intent is recorded in `refundOwedPaymentIds` (once
   * per intent: the alert and the Sentry event are sent only by the write
   * that adds it, so redeliveries do not repeat them, while each further
   * payment is alerted)
   * and the organising club is told to refund the payer.
   *
   * Refunds are manual for now (#438): the club refunds from its HelloAsso
   * back-office, and the `Refunded` notification of that payment removes
   * its entry (`SeatReleaseService`).
   */
  private async flagRefundOwed(
    booking: BookingPaymentCheck,
    now: Date,
    paidIntent: string,
    orderId: number | undefined,
    reason: OrderRejectionReason,
  ): Promise<void> {
    if (booking.status === "PENDING") {
      // The lapsed hold no longer blocks the seat.
      await this.prisma.seatBooking.updateMany({
        where: { id: booking.id, ...lapsedHoldWhere(now) },
        data: { status: "EXPIRED" },
      });
    }
    const { count } = await this.prisma.seatBooking.updateMany({
      where: {
        id: booking.id,
        // Never changes the status: a released (CANCELLED) seat is not
        // given back by this path (#456).
        status: { in: ["EXPIRED", "CONFIRMED", "CANCELLED"] },
        NOT: { refundOwedPaymentIds: { has: paidIntent } },
      },
      data: {
        refundOwedPaymentIds: { push: paidIntent },
        refundOwedAt: now,
      },
    });
    if (count === 1) {
      this.rejectOrder(booking.id, orderId, reason);
      await this.refundOwedAlertService.alertClub(booking.id, orderId);
      return;
    }
    // Not written: a redelivery of a payment already recorded is logged only
    // (no repeated Sentry event); anything else means money owed that could
    // not be recorded, so it still goes to Sentry.
    const current = await this.prisma.seatBooking.findUnique({
      where: { id: booking.id },
      select: seatBookingPaymentCheckSelect,
    });
    if (current?.refundOwedPaymentIds.includes(paidIntent)) {
      this.logger.warn(
        `HelloAsso order ${orderId ?? "?"} for booking ${booking.id}: refund already owed for intent ${paidIntent} (${reason}), redelivery ignored`,
      );
      return;
    }
    this.rejectOrder(booking.id, orderId, reason);
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
        // Money collected for a seat we do not grant: the club refunds the
        // payer by hand (#428, #438).
        ...(REFUND_REQUIRED_REASONS.has(reason) ? { refund: "required" } : {}),
      },
      extra: { bookingId, orderId },
    });
  }
}
