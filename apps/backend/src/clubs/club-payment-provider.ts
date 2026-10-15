import type { Prisma, PaymentProvider } from "@prisma/client";
import { effectivePaymentProvider } from "../payment/connectors/payment-providers";
import type { clubPaymentProviderStatusSelect } from "../utils/prisma-selects";

type ClubPaymentRow = Prisma.ClubGetPayload<{
  select: typeof clubPaymentProviderStatusSelect;
}>;

/**
 * Whether `club` can take payments with `provider` (#388): the credentials
 * that connector needs are all set. Values are only tested, never returned.
 */
export function isPaymentProviderConfigured(
  club: ClubCredentials,
  provider: PaymentProvider,
): boolean {
  return CONFIGURED[provider](club);
}

type ClubCredentials = Omit<ClubPaymentRow, "id" | "name" | "paymentProvider">;

/** One check per provider: a new enum value fails to compile until added. */
const CONFIGURED: Readonly<
  Record<PaymentProvider, (club: ClubCredentials) => boolean>
> = {
  HELLOASSO: (club) =>
    !!(
      club.helloAssoClientId &&
      club.helloAssoClientSecret &&
      club.helloAssoOrgSlug
    ),
};

/** The club's connector (NULL = HelloAsso) and whether it is configured. */
export function clubPaymentProviderState(club: ClubPaymentRow): {
  paymentProvider: PaymentProvider;
  configured: boolean;
} {
  const paymentProvider = effectivePaymentProvider(club.paymentProvider);
  return {
    paymentProvider,
    configured: isPaymentProviderConfigured(club, paymentProvider),
  };
}
