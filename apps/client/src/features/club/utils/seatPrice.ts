/**
 * Seat price typed by the organiser in euros (#405), stored in cents on the
 * layout element (`priceCents`, read by the server at checkout, #381).
 */

/** Same bound as the server (`MAX_SEAT_PRICE_CENTS`): 10 000 EUR. */
export const MAX_SEAT_PRICE_CENTS = 1_000_000;

export type SeatPriceInput =
  | { ok: true; cents: number | undefined }
  | { ok: false; error: string };

/**
 * Parses « 15 », « 15,5 », « 15.50 », « 15 € »… into cents. Empty → no price
 * (the element is not payable online). Anything else → an error to show.
 */
export function parseSeatPrice(text: string): SeatPriceInput {
  const raw = text.replace(/€/g, "").replace(/\s/g, "").replace(",", ".");
  if (raw === "") return { ok: true, cents: undefined };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return {
      ok: false,
      error: "Saisissez un tarif en euros, par exemple 15 ou 15,50.",
    };
  }
  const cents = Math.round(Number(raw) * 100);
  if (cents <= 0 || cents > MAX_SEAT_PRICE_CENTS) {
    return {
      ok: false,
      error: "Le tarif doit être compris entre 0,01 € et 10 000 €.",
    };
  }
  return { ok: true, cents };
}

/** Cents → the editor's text field (« 15 » or « 15,50 »); none → "". */
export function seatPriceToInput(cents: number | undefined | null): string {
  if (typeof cents !== "number" || cents <= 0) return "";
  return cents % 100 === 0
    ? String(cents / 100)
    : (cents / 100).toFixed(2).replace(".", ",");
}
