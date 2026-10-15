import { Injectable } from "@nestjs/common";
import { PaymentProvider } from "@prisma/client";
import { ClubsHelloAssoService } from "../../clubs/clubs-helloasso.service";
import {
  HelloAssoService,
  type HelloAssoCredentials,
} from "../hello-asso.service";
import type {
  PaymentAccount,
  PaymentCheckout,
  PaymentCheckoutRequest,
  PaymentConnector,
} from "./payment-connector";
import { PAYMENT_PROVIDER_NAMES } from "./payment-providers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * HelloAsso, first payment connector (#388, ADR-0013 / ADR-0022 / ADR-0023).
 *
 * Outbound side only: a thin adapter over `HelloAssoService` (OAuth, circuit
 * breaker `helloasso`, timeouts) and the club credentials of
 * `ClubsHelloAssoService` (secret encrypted at rest, #389). Its inbound side
 * is `POST /payment/webhook/helloasso` (and the historical
 * `POST /payment/webhook`): `WebhookSignatureGuard`,
 * `HelloAssoNotificationService` (order re-read) and `SeatReleaseService`
 * (refund / dispute re-read).
 */
@Injectable()
export class HelloAssoPaymentConnector implements PaymentConnector {
  readonly provider = PaymentProvider.HELLOASSO;
  readonly displayName = PAYMENT_PROVIDER_NAMES[PaymentProvider.HELLOASSO];

  constructor(
    private readonly helloAssoService: HelloAssoService,
    private readonly clubsHelloAssoService: ClubsHelloAssoService,
  ) {}

  async accountForCompetition(
    competitionId: string,
  ): Promise<PaymentAccount | null> {
    const credentials =
      await this.clubsHelloAssoService.getHelloAssoCredentialsForCompetition(
        competitionId,
      );
    return credentials ? this.account(credentials) : null;
  }

  private account(credentials: HelloAssoCredentials): PaymentAccount {
    return {
      provider: this.provider,
      createCheckout: (request) => this.createCheckout(credentials, request),
      hasPaymentOnCheckout: (checkoutId) =>
        this.hasPaymentOnCheckout(credentials, checkoutId),
    };
  }

  private async createCheckout(
    credentials: HelloAssoCredentials,
    request: PaymentCheckoutRequest,
  ): Promise<PaymentCheckout> {
    const intent = await this.helloAssoService.createCheckoutIntent(
      credentials,
      request.appBaseUrl,
      {
        amount: request.amountCents,
        label: request.label,
        consumerEmail: request.payer.email,
        consumerFirstName: request.payer.firstName,
        consumerLastName: request.payer.lastName,
        metadata: { ...request.metadata },
      },
    );
    return { id: String(intent.id), redirectUrl: intent.redirectUrl };
  }

  /** HelloAsso exposes the intent's `order` only once it is authorised. */
  private async hasPaymentOnCheckout(
    credentials: HelloAssoCredentials,
    checkoutId: string,
  ): Promise<boolean> {
    const read = await this.helloAssoService.getCheckoutIntent(
      credentials,
      checkoutId,
    );
    return read.found && isRecord(read.value.order);
  }
}
