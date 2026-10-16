import type { PaymentProvider } from "@prisma/client";
import type { WebhookPayloadDto } from "../dto/webhook-payload.dto";

/**
 * Payment connector of an organising club (#388, ADR-0023).
 *
 * Each connector (HelloAsso today; AssoConnect or another one later) adapts
 * one payment provider to the seat-booking flow. `PaymentService` only knows
 * this interface: it never names a provider, never sees credentials and
 * never builds a provider request itself.
 *
 * Two sides:
 * - OUTBOUND (this interface): the club's account for a competition, then
 *   creating a checkout and re-reading it, through that account.
 * - INBOUND (`PaymentOrderNotificationVerifier`): each connector owns ONE
 *   webhook route, its authenticity check and its payload DTO, and hands the
 *   shared confirmation (`PaymentService.handleOrderWebhook`) an order
 *   REBUILT FROM THE PROVIDER'S API, never the received body (ADR-0022).
 *
 * Rules every connector follows (ADR-0009, ADR-0022, ADR-0023):
 * - every outbound call goes through the circuit breaker + `withTimeout`;
 *   an outage THROWS (callers answer 503), a definitive "unknown id" is an
 *   answer, never a breaker failure;
 * - credentials are stored encrypted with `SecretCipherService` under a
 *   per-club, per-connector context, never returned by an API nor logged;
 * - checkout ids are opaque strings, stored in `SeatBooking.paymentId` /
 *   `supersededPaymentIds` with `SeatBooking.paymentProvider`.
 *
 * Not implemented yet, by design: refunds through the provider (refunds owed
 * are flagged and alerted, then made by hand by the club, #438).
 */
export interface PaymentConnector {
  readonly provider: PaymentProvider;
  /** Provider name shown to users ("HelloAsso"). */
  readonly displayName: string;
  /**
   * The organising club's account on this provider for `competitionId`, or
   * null when the club has not configured it (or its stored credentials are
   * unreadable: treated as not configured).
   */
  accountForCompetition(competitionId: string): Promise<PaymentAccount | null>;
}

/**
 * A club's account on one provider, credentials bound inside (they never
 * leave the connector).
 */
export interface PaymentAccount {
  readonly provider: PaymentProvider;
  /** Creates the provider's payment page. Throws on any failure. */
  createCheckout(request: PaymentCheckoutRequest): Promise<PaymentCheckout>;
  /**
   * Whether the provider already holds an authorised payment on checkout
   * `checkoutId` (an id this booking stored). Throws when the provider
   * cannot answer: never guessed.
   */
  hasPaymentOnCheckout(checkoutId: string): Promise<boolean>;
}

export interface PaymentCheckoutRequest {
  /** Server-side price, in cents (#381): never the client's amount. */
  amountCents: number;
  label: string;
  payer: { email: string; firstName: string; lastName: string };
  /** Echoed back by the provider and re-checked on the notification. */
  metadata: { bookingId: string; competitionId: string };
  /** Base of the return / back / error URLs of the payment page. */
  appBaseUrl: string;
}

export interface PaymentCheckout {
  /** Provider checkout id, opaque (HelloAsso: numeric intent id). */
  id: string;
  /** Payment page the payer is sent to. */
  redirectUrl: string;
}

/**
 * Order re-read from the provider's API, in the shape the shared
 * confirmation checks (`checkOrderAgainstBooking`): booking + competition
 * metadata, order id, checkout id, payments with amount (cents) and state
 * (`PAID_PAYMENT_STATES`). HelloAsso's `Order` shape, kept as the common
 * format so that #381 / #401 / #428 / #456 apply to every connector; a new
 * connector maps its API answer into it (its states into "Authorized").
 */
export type VerifiedOrder = WebhookPayloadDto;

/** Inbound side of a connector (see `PaymentConnector`). */
export interface PaymentOrderNotificationVerifier<Payload> {
  /**
   * The order to process, rebuilt from the provider's API, or null when the
   * notification is not about one of our bookings or cannot be verified.
   * Throws (503) when the provider is unreachable, so that it redelivers.
   */
  resolveOrderNotification(payload: Payload): Promise<VerifiedOrder | null>;
}
