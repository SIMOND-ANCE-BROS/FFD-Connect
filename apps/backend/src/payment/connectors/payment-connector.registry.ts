import { Injectable } from "@nestjs/common";
import type { PaymentProvider } from "@prisma/client";
import { resolveOrganizerClubId } from "../../competitions/competition-organizer";
import { PrismaService } from "../../prisma/prisma.service";
import {
  clubPaymentProviderSelect,
  competitionOrganizerSelect,
} from "../../utils/prisma-selects";
import { HelloAssoPaymentConnector } from "./helloasso-payment.connector";
import type { PaymentConnector } from "./payment-connector";
import {
  DEFAULT_PAYMENT_PROVIDER,
  effectivePaymentProvider,
} from "./payment-providers";

/**
 * Picks the payment connector of a competition's organising club (#388,
 * ADR-0023). A new connector is injected here and added to
 * `SELECTABLE_PAYMENT_PROVIDERS` in the same change.
 */
@Injectable()
export class PaymentConnectorRegistry {
  private readonly connectors: ReadonlyMap<PaymentProvider, PaymentConnector>;

  constructor(
    private readonly prisma: PrismaService,
    helloAsso: HelloAssoPaymentConnector,
  ) {
    this.connectors = new Map([[helloAsso.provider, helloAsso]]);
  }

  /** The connector of `provider`, or null when none is registered. */
  get(provider: PaymentProvider): PaymentConnector | null {
    return this.connectors.get(provider) ?? null;
  }

  /**
   * Connector chosen by the organising club of `competitionId`
   * (`Club.paymentProvider`, NULL = HelloAsso). Unknown competition or no
   * resolvable organising club: HelloAsso, whose own credential lookup then
   * answers "not configured" — the behaviour from before the choice existed.
   * Null when the club chose a provider without a registered connector (a
   * newer release rolled back): the club has no usable connector.
   */
  async forCompetition(
    competitionId: string,
  ): Promise<PaymentConnector | null> {
    return this.get(await this.providerForCompetition(competitionId));
  }

  private async providerForCompetition(
    competitionId: string,
  ): Promise<PaymentProvider> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionOrganizerSelect,
    });
    if (!competition) return DEFAULT_PAYMENT_PROVIDER;
    const clubId = await resolveOrganizerClubId(this.prisma, competition);
    if (!clubId) return DEFAULT_PAYMENT_PROVIDER;
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: clubPaymentProviderSelect,
    });
    return effectivePaymentProvider(club?.paymentProvider);
  }
}
