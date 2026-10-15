// Side-effect: configures the generated OpenAPI client (baseUrl + auth + refresh).
import "../../api/client";
import {
  paymentControllerCreateCheckout,
  seatOccupancyControllerGetSeatOccupancy,
  type CheckoutResponseDto,
  type SeatElementOccupancyDto,
  type SeatOccupancyResponseDto,
} from "../../api/generated";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

export type {
  CheckoutResponseDto,
  SeatElementOccupancyDto,
  SeatOccupancyResponseDto,
};

/**
 * - `conflict` (409): the seat was taken meanwhile, the element is full, the
 *   pending-bookings cap is reached, or the re-hold cooldown applies (#455).
 *   The server message is in French and shown as is.
 * - `unavailable` (503): HelloAsso could not be reached — worth a retry.
 * - `other`: anything else (400 refused seat, network…).
 */
export type SeatBookingErrorKind = "conflict" | "unavailable" | "other";

export const SEAT_BOOKING_MESSAGES = {
  occupancy: "Impossible de charger le plan de salle.",
  conflict: "Cette place n'est plus disponible. Choisissez-en une autre.",
  unavailable:
    "Le service de paiement est momentanément indisponible. Réessayez dans un instant.",
  checkout: "Impossible de lancer le paiement. Réessayez plus tard.",
} as const;

/**
 * Error of a seat-booking call. `message` stays generic (it is what logs and
 * Sentry read); the text for the user is `userMessage`.
 */
export class SeatBookingError extends Error {
  constructor(
    public readonly kind: SeatBookingErrorKind,
    public readonly userMessage: string,
    public readonly status?: number,
  ) {
    super(`Seat booking failed (${status ?? "network"})`);
    this.name = "SeatBookingError";
  }
}

/** The server's French message (`{ message }` body), when it is a string. */
function serverMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : undefined;
}

export function toSeatBookingError(
  status: number | undefined,
  error: unknown,
): SeatBookingError {
  if (status === 409) {
    return new SeatBookingError(
      "conflict",
      serverMessage(error) ?? SEAT_BOOKING_MESSAGES.conflict,
      status,
    );
  }
  if (status === 503) {
    return new SeatBookingError(
      "unavailable",
      SEAT_BOOKING_MESSAGES.unavailable,
      status,
    );
  }
  if (status === undefined) {
    return new SeatBookingError("other", ERROR_MESSAGES.NETWORK_ERROR);
  }
  // 400: refused seat (locked, no price, club without HelloAsso) — the
  // server explains why in French. 5xx: no detail worth showing.
  const message = status === 400 ? serverMessage(error) : undefined;
  return new SeatBookingError(
    "other",
    message ?? SEAT_BOOKING_MESSAGES.checkout,
    status,
  );
}

interface SdkResult<T> {
  data?: T;
  error?: unknown;
  response?: { status: number };
}

/** The SDK call, a thrown network failure turned into a SeatBookingError. */
async function settle<T>(
  call: () => Promise<SdkResult<T>>,
): Promise<SdkResult<T>> {
  try {
    return await call();
  } catch {
    throw new SeatBookingError("other", ERROR_MESSAGES.NETWORK_ERROR);
  }
}

export interface CheckoutRequest {
  competitionId: string;
  itemId: string;
  /** Numbered element only; omitted for a free placement. */
  seatIndex?: number;
  /** Display only, never used to identify the seat. */
  seatLabel?: string;
}

/**
 * Seat booking (#453): seat-plan occupancy (#454) and HelloAsso checkout
 * (#428), through the generated OpenAPI client. No retry nor wake logic
 * here: waking the scale-to-zero backend is handled globally (backendWake).
 */
export const SeatBookingApi = {
  /** Taken / held / own seats of every bookable element of the plan. */
  async getOccupancy(competitionId: string): Promise<SeatOccupancyResponseDto> {
    const result = await settle<SeatOccupancyResponseDto>(() =>
      seatOccupancyControllerGetSeatOccupancy({ path: { id: competitionId } }),
    );
    if (result.error !== undefined || result.data === undefined) {
      throw new SeatBookingError(
        "other",
        SEAT_BOOKING_MESSAGES.occupancy,
        result.response?.status,
      );
    }
    return result.data;
  },

  /** Holds the seat and returns the HelloAsso page to pay it. */
  async checkout(request: CheckoutRequest): Promise<CheckoutResponseDto> {
    const body = {
      competitionId: request.competitionId,
      itemId: request.itemId,
      ...(request.seatIndex !== undefined
        ? { seatIndex: request.seatIndex }
        : {}),
      ...(request.seatLabel ? { seatLabel: request.seatLabel } : {}),
    };
    const result = await settle<CheckoutResponseDto>(() =>
      paymentControllerCreateCheckout({ body }),
    );
    if (result.error !== undefined || result.data === undefined) {
      throw toSeatBookingError(result.response?.status, result.error);
    }
    return result.data;
  },
};
