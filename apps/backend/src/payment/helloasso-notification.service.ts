import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { plainToInstance } from "class-transformer";
import { isUUID, validateSync } from "class-validator";
import { ClubsHelloAssoService } from "../clubs/clubs-helloasso.service";
import { PrismaService } from "../prisma/prisma.service";
import { seatBookingPaymentCheckSelect } from "../utils/prisma-selects";
import type { PaymentOrderNotificationVerifier } from "./connectors/payment-connector";
import { WebhookPayloadDto } from "./dto/webhook-payload.dto";
import {
  HelloAssoService,
  type HelloAssoCheckoutIntentDetail,
} from "./hello-asso.service";
import { getWebhookMetadata } from "./helloasso-order-check";

/**
 * Reasons any caller can provoke without a secret (the webhook is public):
 * logged as warnings only, never sent to Sentry, so that forged traffic
 * cannot burn the Sentry quota or drown real payment anomalies.
 */
const UNAUTHENTICATED_REASONS: ReadonlySet<NotificationIgnoredReason> = new Set(
  ["booking_not_found", "no_checkout_intent", "club_not_connected"],
);

/**
 * Only a booking still awaiting payment (or whose hold lapsed, #401: a late
 * payment must still be detected) is worth re-reading on HelloAsso. Any other
 * status is final: no outbound call (forged replays cannot amplify into
 * HelloAsso calls nor trip the shared circuit breaker).
 */
const REREAD_STATUSES: ReadonlySet<string> = new Set(["PENDING", "EXPIRED"]);

/**
 * Final statuses re-read only for one of the booking's EARLIER intents
 * (stored `supersededPaymentIds`): a payment there is money owed back.
 */
const EARLIER_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "CONFIRMED",
  "CANCELLED",
]);

export type NotificationIgnoredReason =
  | "booking_not_found"
  | "no_checkout_intent"
  | "club_not_connected"
  | "intent_not_found"
  | "intent_mismatch"
  | "invalid_intent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns an untrusted HelloAsso notification into the authoritative state of
 * the payment (#404).
 *
 * HelloAsso does not sign the notifications of an association account (only
 * partner accounts get a signature key), and anyone can POST to the webhook.
 * So the notification body is only a TRIGGER: it names a booking (checkout
 * metadata), and the payment itself is re-read from the HelloAsso API, on the
 * booking's own checkout intent, with the organising club's credentials. A
 * forged notification can at most make us re-read a real payment.
 *
 * Read-only: no database write here. Rejections are logged (and sent to
 * Sentry once the HelloAsso re-read disagrees, identifiers only); a HelloAsso outage throws 503 so that HelloAsso
 * redelivers the notification later (its retry policy spans ~27 h).
 */
@Injectable()
// Inbound side of the HelloAsso connector (#388, ADR-0023).
export class HelloAssoNotificationService implements PaymentOrderNotificationVerifier<WebhookPayloadDto> {
  private readonly logger = new Logger(HelloAssoNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
  ) {}

  /**
   * Returns the `Order` payload to process, rebuilt from HelloAsso's own
   * checkout intent — or `null` when the notification is not about one of
   * our bookings or cannot be verified (traced, never retried).
   */
  async resolveOrderNotification(
    payload: WebhookPayloadDto,
  ): Promise<WebhookPayloadDto | null> {
    const bookingId = getWebhookMetadata(payload)?.bookingId;
    // Not a seat-booking checkout (our booking ids are UUIDs): ignored
    // silently — this also keeps arbitrary strings out of logs.
    if (!bookingId || !isUUID(bookingId)) return null;

    const booking = await this.prisma.seatBooking.findUnique({
      where: { id: bookingId },
      select: seatBookingPaymentCheckSelect,
    });
    if (!booking) return this.ignore(bookingId, "booking_not_found");

    // The intent to re-read: the booking's current one, unless the
    // notification names one of the booking's EARLIER intents (payment
    // resumed, #428: the payer may complete a page opened before). Only ids
    // we stored are ever read — never an arbitrary id from the body.
    const claimedIntentId = payload.data.checkoutIntentId;
    const earlierIntent =
      claimedIntentId !== undefined &&
      booking.supersededPaymentIds.includes(String(claimedIntentId))
        ? String(claimedIntentId)
        : null;
    // A confirmed seat, or one released after a refund or dispute (#403), is
    // only worth a re-read for an earlier intent: it may have been paid as
    // well (duplicate payment #428, payment after the release #456: refund
    // owed).
    const worthReading =
      REREAD_STATUSES.has(booking.status) ||
      (EARLIER_INTENT_STATUSES.has(booking.status) && earlierIntent !== null);
    if (!worthReading) {
      this.logger.log(
        `HelloAsso notification for booking ${bookingId} in status ${booking.status}: nothing to do`,
      );
      return null;
    }
    if (!booking.paymentId) return this.ignore(bookingId, "no_checkout_intent");
    const intentId = earlierIntent ?? booking.paymentId;

    const credentials =
      await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(
        booking.competitionId,
      );
    if (!credentials) return this.ignore(bookingId, "club_not_connected");

    let read;
    try {
      read = await this.helloAssoService.getCheckoutIntent(
        credentials,
        intentId,
      );
    } catch {
      throw new ServiceUnavailableException(
        "HelloAsso unavailable, notification to be redelivered",
      );
    }
    if (!read.found) return this.ignore(bookingId, "intent_not_found");

    const intent = read.value;
    if (
      !isRecord(intent.metadata) ||
      intent.metadata.bookingId !== booking.id
    ) {
      return this.ignore(bookingId, "intent_mismatch");
    }
    if (!isRecord(intent.order)) {
      // HelloAsso exposes the order only once the payment is authorized: the
      // notification may be ahead of it. Let HelloAsso redeliver it.
      this.logger.warn(
        `HelloAsso checkout intent ${intentId} has no authorized order yet (booking ${bookingId})`,
      );
      throw new ServiceUnavailableException(
        "Payment not yet authorized, notification to be redelivered",
      );
    }

    const verified = this.toOrderPayload(intent, intent.order);
    if (!verified) return this.ignore(bookingId, "invalid_intent");
    return verified;
  }

  /**
   * Builds the `Order` payload from the API's checkout intent and validates
   * it against the same DTO as an incoming notification (whitelist: only the
   * fields we read are kept).
   */
  private toOrderPayload(
    intent: HelloAssoCheckoutIntentDetail,
    order: Record<string, unknown>,
  ): WebhookPayloadDto | null {
    const payments = Array.isArray(order.payments)
      ? order.payments.filter(isRecord).map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          state: payment.state,
        }))
      : [];
    const candidate = plainToInstance(WebhookPayloadDto, {
      eventType: "Order",
      data: {
        id: order.id,
        checkoutIntentId: order.checkoutIntentId ?? intent.id,
        payments,
      },
      metadata: intent.metadata,
    });
    const errors = validateSync(candidate, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    return errors.length === 0 ? candidate : null;
  }

  private ignore(bookingId: string, reason: NotificationIgnoredReason): null {
    const message = `HelloAsso notification ignored for booking ${bookingId}: ${reason}`;
    if (UNAUTHENTICATED_REASONS.has(reason)) {
      this.logger.warn(message);
      return null;
    }
    this.logger.error(message);
    Sentry.captureMessage("HelloAsso notification ignored", {
      level: "error",
      tags: { payment: "helloasso-notification-ignored", reason },
      extra: { bookingId },
    });
    return null;
  }
}
