import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";

/**
 * HelloAsso payment states that mean the money is actually collected — an
 * explicit allow-list: any other or unknown state never counts as paid.
 * `Authorized` is the HelloAsso PaymentState of a collected payment
 * (`Processed` is an ItemState, not a PaymentState, so it is not accepted).
 */
export const PAID_PAYMENT_STATES: ReadonlySet<string> = new Set(["Authorized"]);

export type OrderRejectionReason =
  | "booking_not_found"
  | "not_pending"
  | "competition_mismatch"
  | "checkout_intent_mismatch"
  | "no_expected_amount"
  | "invalid_payment"
  | "not_paid"
  | "amount_mismatch"
  | "booking_expired"
  | "duplicate_payment"
  | "booking_cancelled";

/**
 * Rejections where a genuine, fully paid order could not be honoured: the
 * money is collected but no seat is granted (late payment, #401), the seat
 * was already paid through another checkout intent of the same booking
 * (resumed payment paid twice, #428), or the booking was released after a
 * refund or dispute and an earlier intent of it is paid (#456). The intent is
 * recorded in `refundOwedPaymentIds` (and `refundOwedAt` set), the organising
 * club is alerted (`RefundOwedAlertService`) and refunds the payer by hand
 * from its HelloAsso back-office (#438; club-side list of refunds due: #516).
 * Nothing is refunded automatically: #403 only releases a seat once
 * HelloAsso reports its payment refunded or disputed.
 */
export const REFUND_REQUIRED_REASONS: ReadonlySet<OrderRejectionReason> =
  new Set(["booking_expired", "duplicate_payment", "booking_cancelled"]);

export interface BookingPaymentCheck {
  id: string;
  competitionId: string;
  status: string;
  paymentId: string | null;
  expectedAmountCents: number | null;
  expiresAt: Date | null;
  /** Earlier checkout intents of a resumed payment (#428). */
  supersededPaymentIds: string[];
  /** Checkout intents whose payment is owed back (#428). */
  refundOwedPaymentIds: string[];
}

/**
 * Whether `checkoutIntentId` is one of the booking's own checkout intents:
 * the current one or one replaced when the payment was resumed (#428) — the
 * payer may still complete a page opened before the resume.
 */
export function isBookingIntent(
  booking: Pick<BookingPaymentCheck, "paymentId" | "supersededPaymentIds">,
  checkoutIntentId: string,
): boolean {
  return (
    checkoutIntentId === booking.paymentId ||
    booking.supersededPaymentIds.includes(checkoutIntentId)
  );
}

/**
 * Whether a booking's temporary hold is over (#401). A PENDING booking
 * without a deadline is treated as expired (fail-closed): checkout always
 * sets one.
 */
export function isHoldExpired(
  booking: Pick<BookingPaymentCheck, "expiresAt">,
  now: Date,
): boolean {
  return booking.expiresAt === null || booking.expiresAt <= now;
}

/**
 * Checkout metadata (`bookingId`, `competitionId`) we set when creating the
 * checkout intent. HelloAsso echoes it at the payload root; older payloads
 * (and our own tests) carried it under `data.metadata`.
 */
export function getWebhookMetadata(payload: WebhookPayloadDto) {
  return payload.metadata ?? payload.data.metadata;
}

function isValidCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Sum, in cents, of the order's payments in an allow-listed paid state, or
 * `null` when a payment is malformed (amount missing, not an integer number of
 * cents, or state missing): a payload we cannot read never confirms.
 */
export function paidAmountCents(payload: WebhookPayloadDto): number | null {
  let paid = 0;
  for (const payment of payload.data.payments ?? []) {
    if (!isValidCents(payment.amount) || typeof payment.state !== "string") {
      return null;
    }
    if (PAID_PAYMENT_STATES.has(payment.state)) paid += payment.amount;
  }
  return paid;
}

/**
 * Decides whether a signed HelloAsso `Order` notification may confirm the
 * booking. FAIL-CLOSED: every check must positively pass — a missing field
 * (competitionId, checkoutIntentId, expected amount, payments) is a rejection,
 * never a default "ok". Returns `null` only when everything matches,
 * otherwise the rejection reason (no personal data).
 *
 * Amounts on both sides are integer cents: the checkout intent is created
 * with `expectedAmountCents` and HelloAsso reports amounts in cents.
 *
 * Only a PENDING hold still within its deadline can be confirmed (#401). The
 * expiry (and the duplicate payment of a confirmed seat, #428) is checked LAST, once the order is proven to be the genuine, fully
 * paid order of this booking: `booking_expired` therefore always means "money
 * collected for a seat we no longer hold" (refund required), never a forged
 * or partial order.
 */
export function checkOrderAgainstBooking(
  payload: WebhookPayloadDto,
  booking: BookingPaymentCheck,
  now: Date,
): OrderRejectionReason | null {
  // A hold awaiting payment (still running or lapsed), a confirmed seat paid
  // again through another of its intents (#428), or a released booking paid
  // through one of its EARLIER intents (#456: refund owed, never a revival).
  // The current intent of a released booking is the refunded or disputed
  // seat payment itself: nothing new to act on.
  if (
    booking.status !== "PENDING" &&
    booking.status !== "EXPIRED" &&
    booking.status !== "CONFIRMED" &&
    booking.status !== "CANCELLED"
  ) {
    return "not_pending";
  }
  if (
    booking.status === "CANCELLED" &&
    (payload.data.checkoutIntentId === undefined ||
      String(payload.data.checkoutIntentId) === booking.paymentId)
  ) {
    return "not_pending";
  }

  const metadata = getWebhookMetadata(payload);
  if (metadata?.competitionId !== booking.competitionId) {
    return "competition_mismatch";
  }

  const checkoutIntentId = payload.data.checkoutIntentId;
  if (
    checkoutIntentId === undefined ||
    booking.paymentId === null ||
    !isBookingIntent(booking, String(checkoutIntentId))
  ) {
    return "checkout_intent_mismatch";
  }

  // Bookings created before #381 have no server-side amount: never confirm
  // them on trust.
  if (!isValidCents(booking.expectedAmountCents)) return "no_expected_amount";

  const paid = paidAmountCents(payload);
  if (paid === null) return "invalid_payment";
  if (paid === 0) return "not_paid";
  if (paid !== booking.expectedAmountCents) return "amount_mismatch";

  if (booking.status === "CONFIRMED") {
    // Proven genuine and fully paid, but the seat is already paid through
    // the booking's current intent: the caller only gets here for another
    // intent of the booking (resumed payment paid twice).
    return "duplicate_payment";
  }
  if (booking.status === "CANCELLED") {
    // Proven genuine and fully paid on an earlier intent of a booking whose
    // seat was released (refund or dispute, #403): money owed back (#456).
    return "booking_cancelled";
  }
  if (booking.status === "EXPIRED" || isHoldExpired(booking, now)) {
    return "booking_expired";
  }

  return null;
}
