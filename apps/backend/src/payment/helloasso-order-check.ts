import type { WebhookPayloadDto } from "./dto/webhook-payload.dto";

/**
 * HelloAsso payment states that mean the money is actually collected.
 * `Authorized` is the card payment state; `Processed` is accepted as well
 * (HelloAsso uses it for processed items/payments).
 */
export const PAID_PAYMENT_STATES: ReadonlySet<string> = new Set([
  "Authorized",
  "Processed",
]);

export type OrderRejectionReason =
  | "competition_mismatch"
  | "checkout_intent_mismatch"
  | "no_expected_amount"
  | "not_paid"
  | "amount_mismatch";

export interface BookingPaymentCheck {
  id: string;
  competitionId: string;
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

/** Sum, in cents, of the order's payments in a paid state. */
export function paidAmountCents(payload: WebhookPayloadDto): number {
  return (payload.data.payments ?? [])
    .filter((payment) => PAID_PAYMENT_STATES.has(payment.state))
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/**
 * Decides whether a signed HelloAsso `Order` notification may confirm the
 * booking. Returns `null` when everything matches, otherwise the reason of
 * the rejection (no personal data).
 */
export function checkOrderAgainstBooking(
  payload: WebhookPayloadDto,
  booking: BookingPaymentCheck,
): OrderRejectionReason | null {
  const metadata = getWebhookMetadata(payload);
  if (
    metadata?.competitionId !== undefined &&
    metadata.competitionId !== booking.competitionId
  ) {
    return "competition_mismatch";
  }

  const checkoutIntentId = payload.data.checkoutIntentId;
  if (
    checkoutIntentId !== undefined &&
    booking.paymentId !== null &&
    String(checkoutIntentId) !== booking.paymentId
  ) {
    return "checkout_intent_mismatch";
  }

  // Bookings created before #381 have no server-side amount: never confirm
  // them on trust (they expire after 15 minutes anyway).
  if (booking.expectedAmountCents === null) return "no_expected_amount";

  const paid = paidAmountCents(payload);
  if (paid === 0) return "not_paid";
  if (paid !== booking.expectedAmountCents) return "amount_mismatch";

  return null;
}
