import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { isUUID } from "class-validator";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";
import { seatBookingPaymentCheckSelect } from "../utils/prisma-selects";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import {
  HelloAssoService,
  type HelloAssoCredentials,
  type HelloAssoReadResult,
} from "./hello-asso.service";
import { getWebhookMetadata, isBookingIntent } from "./helloasso-order-check";

/**
 * HelloAsso payment states that release a confirmed seat (#403), with the
 * reason stored on the booking. Source: https://dev.helloasso.com/docs/etats-des-paiements
 * - `Refunded`: refund completed (`Refunding` is in progress and may still
 *   fail — "remboursement échoué" puts the payment back to `Authorized`).
 * - `Contested`: the payer disputed the payment with their bank. A dispute
 *   later won by the club does not give the seat back (it may have been
 *   resold): the organiser handles it by hand.
 */
export const SEAT_RELEASE_REASONS: ReadonlyMap<string, string> = new Map([
  ["Refunded", "HELLOASSO_REFUNDED"],
  ["Contested", "HELLOASSO_CONTESTED"],
]);

/**
 * Rejections a caller can provoke by naming another payment id in an
 * unsigned notification: logged only, never sent to Sentry (quota).
 */
const FORGEABLE_REJECTIONS: ReadonlySet<SeatReleaseRejection> = new Set([
  "payment_not_found",
  "checkout_intent_mismatch",
]);

export type SeatReleaseRejection =
  | "payment_not_found"
  | "invalid_payment"
  | "order_not_found"
  | "checkout_intent_mismatch";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHelloAssoId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Releases the seat of a HelloAsso payment that was refunded or disputed
 * (#403): `CONFIRMED` → `CANCELLED` with a `cancelReason`.
 *
 * Same trust model as the order notification (ADR-0022): the `Payment`
 * notification is unsigned, so it only designates a booking and a payment;
 * the payment's state and its link to the booking's checkout intent are
 * re-read from the HelloAsso API with the organising club's credentials.
 *
 * Fail-closed and idempotent: anything unreadable, unrelated or already
 * released changes nothing; the transition is a conditional write on
 * `CONFIRMED`. Releases and HelloAsso-side anomalies are sent to Sentry
 * (identifiers only); what anyone can trigger without a secret (unknown
 * booking, another payment id) is only logged. A refund on a booking still
 * PENDING answers 503 (redelivery), in case its order is being confirmed. A HelloAsso outage answers 503 so that HelloAsso redelivers.
 */
@Injectable()
export class SeatReleaseService {
  private readonly logger = new Logger(SeatReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
  ) {}

  async handlePaymentNotification(payload: WebhookPayloadDto): Promise<void> {
    const bookingId = getWebhookMetadata(payload)?.bookingId;
    if (!bookingId || !isUUID(bookingId)) return; // Not a seat booking.

    // Cheap pre-filter on the CLAIMED state: only a refund or dispute can
    // release a seat. Untrusted, but it can only make us skip work — the
    // state acted upon is re-read below.
    const claimedState = payload.data.state;
    if (!claimedState || !SEAT_RELEASE_REASONS.has(claimedState)) return;

    const paymentId = payload.data.id;
    if (!isHelloAssoId(paymentId)) {
      this.logger.warn(
        `HelloAsso ${claimedState} notification for booking ${bookingId} without payment id: ignored`,
      );
      return;
    }

    const booking = await this.prisma.seatBooking.findUnique({
      where: { id: bookingId },
      select: seatBookingPaymentCheckSelect,
    });
    if (!booking) {
      this.logger.warn(
        `HelloAsso ${claimedState} notification for unknown booking ${bookingId}: ignored`,
      );
      return;
    }
    if (booking.status === "PENDING") {
      // The order may be confirmed in a moment from a re-read made just
      // before this refund: ask HelloAsso to redeliver later rather than drop
      // the refund (no outbound call, so no amplification).
      throw new ServiceUnavailableException(
        "Booking not confirmed yet, notification to be redelivered",
      );
    }
    const releasable = booking.status === "CONFIRMED";
    const refundOwed = booking.refundOwedAt !== null;
    if ((!releasable && !refundOwed) || !booking.paymentId) {
      // Nothing to release nor refund owed (expired, already released…): no
      // call to HelloAsso, so replays cannot amplify.
      this.logger.log(
        `HelloAsso ${claimedState} notification for booking ${bookingId} in status ${booking.status}: nothing to release`,
      );
      return;
    }

    const credentials =
      await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(
        booking.competitionId,
      );
    if (!credentials) {
      this.logger.warn(
        `HelloAsso ${claimedState} notification for booking ${bookingId}: organising club not connected`,
      );
      return;
    }

    const paymentRead = await this.read(() =>
      this.helloAssoService.getPayment(credentials, String(paymentId)),
    );
    if (!paymentRead.found) {
      return this.reject(bookingId, paymentId, "payment_not_found");
    }
    const payment = paymentRead.value;
    if (
      typeof payment.state !== "string" ||
      !isRecord(payment.order) ||
      !isHelloAssoId(payment.order.id)
    ) {
      return this.reject(bookingId, paymentId, "invalid_payment");
    }

    const checkoutIntentId = await this.checkoutIntentOf(
      credentials,
      payment.order,
    );
    if (checkoutIntentId === null) {
      return this.reject(bookingId, paymentId, "order_not_found");
    }
    if (!isBookingIntent(booking, String(checkoutIntentId))) {
      return this.reject(bookingId, paymentId, "checkout_intent_mismatch");
    }
    // The seat's own payment (current intent of a confirmed booking) releases
    // the seat; any other payment of the booking is one we owed back (#428).
    const seatPayment =
      releasable && String(checkoutIntentId) === booking.paymentId;

    const reason = SEAT_RELEASE_REASONS.get(payment.state);
    if (!reason) {
      this.logger.warn(
        `HelloAsso payment ${paymentId} of booking ${bookingId} is ${payment.state} on HelloAsso (notification said ${claimedState}): seat kept`,
      );
      return;
    }

    if (!seatPayment) {
      return this.settleRefundOwed(booking, paymentId, reason);
    }

    const { count } = await this.prisma.seatBooking.updateMany({
      where: { id: booking.id, status: "CONFIRMED" },
      data: { status: "CANCELLED", cancelReason: reason },
    });
    if (count === 0) {
      this.logger.log(`Booking ${bookingId} already released`);
      return;
    }
    this.logger.warn(
      `Seat booking ${bookingId} released: HelloAsso payment ${paymentId} ${payment.state}`,
    );
    Sentry.captureMessage("HelloAsso seat released", {
      level: "warning",
      tags: { payment: "helloasso-seat-released", reason },
      extra: { bookingId, paymentId },
    });
  }

  /**
   * A payment we owed back (late payment, or second payment of a confirmed
   * seat, #428) was refunded — by hand by the club, #438 — or disputed: the
   * refund is no longer owed. The seat itself is untouched (a confirmed seat
   * stays paid by its own payment); an expired booking records why.
   */
  private async settleRefundOwed(
    booking: { id: string; status: string; refundOwedAt: Date | null },
    paymentId: number,
    reason: string,
  ): Promise<void> {
    if (booking.refundOwedAt === null) {
      this.logger.warn(
        `HelloAsso payment ${paymentId} of booking ${booking.id} is not the seat's payment and no refund was owed: ignored`,
      );
      return;
    }
    const { count } = await this.prisma.seatBooking.updateMany({
      where: { id: booking.id, refundOwedAt: { not: null } },
      data: {
        refundOwedAt: null,
        ...(booking.status === "EXPIRED" ? { cancelReason: reason } : {}),
      },
    });
    if (count === 0) {
      this.logger.log(`Refund of booking ${booking.id} already settled`);
      return;
    }
    this.logger.warn(
      `Refund owed on booking ${booking.id} settled: HelloAsso payment ${paymentId} ${reason}`,
    );
    Sentry.captureMessage("HelloAsso refund owed settled", {
      level: "info",
      tags: { payment: "helloasso-refund-settled", reason },
      extra: { bookingId: booking.id, paymentId },
    });
  }

  /**
   * The checkout intent id of the payment's order: on the payment's order
   * summary when HelloAsso includes it, otherwise re-read from the order.
   * `null` when it cannot be established.
   */
  private async checkoutIntentOf(
    credentials: HelloAssoCredentials,
    order: Record<string, unknown>,
  ): Promise<number | null> {
    if (isHelloAssoId(order.checkoutIntentId)) return order.checkoutIntentId;
    const orderRead = await this.read(() =>
      this.helloAssoService.getOrder(credentials, String(order.id)),
    );
    if (!orderRead.found) return null;
    const id = orderRead.value.checkoutIntentId;
    return isHelloAssoId(id) ? id : null;
  }

  /** HelloAsso read; an outage becomes a 503 so the notification is redelivered. */
  private async read<T>(
    call: () => Promise<HelloAssoReadResult<T>>,
  ): Promise<HelloAssoReadResult<T>> {
    try {
      return await call();
    } catch {
      throw new ServiceUnavailableException(
        "HelloAsso unavailable, notification to be redelivered",
      );
    }
  }

  private reject(
    bookingId: string,
    paymentId: number,
    reason: SeatReleaseRejection,
  ): void {
    const message = `HelloAsso payment ${paymentId} not applied to booking ${bookingId}: ${reason}`;
    if (FORGEABLE_REJECTIONS.has(reason)) {
      this.logger.warn(message);
      return;
    }
    this.logger.error(message);
    Sentry.captureMessage("HelloAsso payment notification rejected", {
      level: "error",
      tags: { payment: "helloasso-payment-rejected", reason },
      extra: { bookingId, paymentId },
    });
  }
}
