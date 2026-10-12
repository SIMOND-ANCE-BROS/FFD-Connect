import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";

/**
 * HelloAsso payment states that mean the money is actually collected — an
 * explicit allow-list: any other or unknown state never counts as paid.
 * `Authorized` is the card payment state; `Processed` is accepted as well
 * (HelloAsso uses it for processed items/payments).
 */
export const PAID_PAYMENT_STATES: ReadonlySet<string> = new Set([
  "Authorized",
  "Processed",
]);

export type OrderRejectionReason =
  | "booking_not_found"
  | "not_pending"
  | "competition_mismatch"
  | "checkout_intent_mismatch"
  | "no_expected_amount"
  | "invalid_payment"
  | "not_paid"
  | "amount_mismatch";

export interface BookingPaymentCheck {
  id: string;
  competitionId: string;
  status: string;
  paymentId: string | null;
  expectedAmountCents: number | null;
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
 */
export function checkOrderAgainstBooking(
  payload: WebhookPayloadDto,
  booking: BookingPaymentCheck,
): OrderRejectionReason | null {
  // Only a booking still awaiting payment can be confirmed (no revival of a
  // cancelled/expired booking, no double processing).
  if (booking.status !== "PENDING") return "not_pending";

  const metadata = getWebhookMetadata(payload);
  if (metadata?.competitionId !== booking.competitionId) {
    return "competition_mismatch";
  }

  const checkoutIntentId = payload.data.checkoutIntentId;
  if (
    checkoutIntentId === undefined ||
    booking.paymentId === null ||
    String(checkoutIntentId) !== booking.paymentId
  ) {
    return "checkout_intent_mismatch";
  }

  // Bookings created before #381 have no server-side amount: never confirm
  // them on trust (they expired 15 minutes after their creation anyway).
  if (!isValidCents(booking.expectedAmountCents)) return "no_expected_amount";

  const paid = paidAmountCents(payload);
  if (paid === null) return "invalid_payment";
  if (paid === 0) return "not_paid";
  if (paid !== booking.expectedAmountCents) return "amount_mismatch";

  return null;
}
