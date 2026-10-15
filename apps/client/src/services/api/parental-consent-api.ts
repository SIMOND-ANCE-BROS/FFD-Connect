import {
  parentalConsentControllerGetMine,
  parentalConsentControllerRequest,
  type ParentalConsentStateDto,
} from "../../api/generated";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

export type ParentalConsentState = ParentalConsentStateDto["state"];
export type { ParentalConsentStateDto };

/**
 * Failure of a parental consent call (#61). `message` is written for the user
 * (French); `status` lets the caller adapt (absent = network).
 */
export class ParentalConsentApiError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status: number | undefined) {
    super(message);
    this.name = "ParentalConsentApiError";
    this.status = status;
  }
}

/** Messages of the request, by HTTP status. */
const REQUEST_MESSAGES: Partial<Record<number, string>> = {
  400: "Vérifiez l'adresse : elle doit être celle d'un parent ou représentant légal, pas la vôtre.",
  409: "Un représentant légal a déjà donné son accord pour votre compte.",
  429: "Trop de demandes. Réessayez dans quelques minutes.",
  503: "L'e-mail n'a pas pu être envoyé pour le moment. Réessayez dans quelques minutes.",
};

export function toParentalConsentError(
  status: number | undefined,
  fallback: string,
): ParentalConsentApiError {
  const message =
    (status !== undefined ? REQUEST_MESSAGES[status] : undefined) ?? fallback;
  return new ParentalConsentApiError(message, status);
}

/**
 * The store-review account reads `{}` from routes outside its allowlist, and
 * an older backend has no such route: both mean "nothing to show".
 */
function normalise(data: unknown): ParentalConsentStateDto {
  const state = (data as Partial<ParentalConsentStateDto> | null | undefined)
    ?.state;
  return state === "REQUIRED" ||
    state === "PENDING" ||
    state === "GRANTED" ||
    state === "NOT_REQUIRED"
    ? (data as ParentalConsentStateDto)
    : { state: "NOT_REQUIRED" };
}

export const ParentalConsentApi = {
  /**
   * State of the signed-in account. A failure throws: it must never read as
   * NOT_REQUIRED, which would hide the banner from a minor.
   */
  async getMine(): Promise<ParentalConsentStateDto> {
    let result: Awaited<ReturnType<typeof parentalConsentControllerGetMine>>;
    try {
      result = await parentalConsentControllerGetMine();
    } catch {
      throw new ParentalConsentApiError(
        ERROR_MESSAGES.LOADING_FAILED,
        undefined,
      );
    }
    const status = result.response?.status;
    // 404: backend older than #61 — nothing to show.
    if (status === 404) return { state: "NOT_REQUIRED" };
    if (result.error !== undefined) {
      throw new ParentalConsentApiError(ERROR_MESSAGES.LOADING_FAILED, status);
    }
    return normalise(result.data);
  },

  /** Sends (or re-sends) the link to a parent's address. */
  async request(parentEmail: string): Promise<ParentalConsentStateDto> {
    let result: Awaited<ReturnType<typeof parentalConsentControllerRequest>>;
    try {
      result = await parentalConsentControllerRequest({
        body: { parentEmail },
      });
    } catch {
      throw toParentalConsentError(undefined, ERROR_MESSAGES.NETWORK_ERROR);
    }
    const status = result.response?.status;
    if (result.error !== undefined || result.data === undefined) {
      throw toParentalConsentError(status, ERROR_MESSAGES.OPERATION_FAILED);
    }
    return normalise(result.data);
  },
};
