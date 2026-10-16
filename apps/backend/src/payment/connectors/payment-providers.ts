import { PaymentProvider } from "@prisma/client";

/**
 * Connector of a club or booking whose column is NULL (#388): HelloAsso, the
 * only connector before the choice existed.
 */
export const DEFAULT_PAYMENT_PROVIDER: PaymentProvider =
  PaymentProvider.HELLOASSO;

/**
 * Connectors a club may choose (#388, ADR-0023): those with an adapter
 * registered in `PaymentConnectorRegistry`. A provider is added here in the
 * same change that delivers its connector, never before.
 */
export const SELECTABLE_PAYMENT_PROVIDERS: readonly PaymentProvider[] = [
  PaymentProvider.HELLOASSO,
];

/** Display name of each provider (API messages, back-office). */
export const PAYMENT_PROVIDER_NAMES: Readonly<Record<PaymentProvider, string>> =
  {
    [PaymentProvider.HELLOASSO]: "HelloAsso",
  };

/** The stored provider, NULL read as the default (HelloAsso). */
export function effectivePaymentProvider(
  stored: PaymentProvider | null | undefined,
): PaymentProvider {
  return stored ?? DEFAULT_PAYMENT_PROVIDER;
}
