import {
  clubsControllerGetPaymentProvider,
  clubsControllerSetPaymentProvider,
  type ClubPaymentProviderStatusDto,
  type PaymentProvider,
} from "../../api/generated";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

export type { ClubPaymentProviderStatusDto, PaymentProvider };

/**
 * Club payment connector (#388, #665) ↔ GET / PUT /clubs/me/payment-provider.
 * The connector's credentials are never exposed: the API only says whether
 * they are filled in (`configured`).
 */

/** Name shown to the club for each connector. */
export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  HELLOASSO: "HelloAsso",
};

export function paymentProviderLabel(provider: string): string {
  // The server may know a connector this build does not (yet).
  const labels: Partial<Record<string, string>> = PAYMENT_PROVIDER_LABELS;
  return labels[provider] ?? provider;
}

/** Whether the app has a credentials form for this connector (HelloAsso). */
export function isHelloAssoProvider(provider: string): boolean {
  return provider === "HELLOASSO";
}

/** A choice is only offered once a second connector exists. */
export function canChoosePaymentProvider(
  status: Pick<ClubPaymentProviderStatusDto, "selectableProviders"> | null,
): boolean {
  return (status?.selectableProviders.length ?? 0) > 1;
}

/** Failure of a connector change; `message` is written for the club (French). */
export class PaymentProviderApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status: number | undefined) {
    super(message);
    this.name = "PaymentProviderApiError";
    this.status = status;
  }
}

function isStatus(data: unknown): data is ClubPaymentProviderStatusDto {
  const value = data as Partial<ClubPaymentProviderStatusDto> | null;
  return (
    typeof value?.paymentProvider === "string" &&
    typeof value.configured === "boolean" &&
    Array.isArray(value.selectableProviders)
  );
}

function serverMessage(error: unknown): string | undefined {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  if (Array.isArray(message)) return message.join("\n");
  return typeof message === "string" && message ? message : undefined;
}

export const PaymentProviderApi = {
  /**
   * The club's connector, or null when it cannot be shown (backend older than
   * #388, store-review account reading `{}`, network): the settings then fall
   * back to the HelloAsso status alone.
   */
  async getStatus(): Promise<ClubPaymentProviderStatusDto | null> {
    try {
      const result = await clubsControllerGetPaymentProvider();
      if (result.error !== undefined) return null;
      return isStatus(result.data) ? result.data : null;
    } catch {
      return null;
    }
  },

  /** Switches the club to another available connector. */
  async setProvider(
    paymentProvider: PaymentProvider,
  ): Promise<ClubPaymentProviderStatusDto> {
    let result: Awaited<ReturnType<typeof clubsControllerSetPaymentProvider>>;
    try {
      result = await clubsControllerSetPaymentProvider({
        body: { paymentProvider },
      });
    } catch {
      throw new PaymentProviderApiError(
        ERROR_MESSAGES.NETWORK_ERROR,
        undefined,
      );
    }
    const status = result.response?.status;
    if (result.error !== undefined || !isStatus(result.data)) {
      throw new PaymentProviderApiError(
        serverMessage(result.error) ?? ERROR_MESSAGES.OPERATION_FAILED,
        status,
      );
    }
    return result.data;
  },
};
