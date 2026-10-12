/**
 * Server-side seat pricing (#381).
 *
 * The price of a bookable layout element lives in the competition's layout
 * JSON, set by the organising club: `{ id, ..., priceCents }`, an integer
 * amount in cents (HelloAsso's unit). The checkout amount is always read from
 * here — never from the client request.
 */

/** Upper bound on a seat price (10 000 EUR): guards against garbage data. */
export const MAX_SEAT_PRICE_CENTS = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns the price in cents of the layout element `itemId`, or `null` when
 * the element does not exist or has no valid price (positive integer).
 */
export function resolveSeatPriceCents(
  layout: unknown,
  itemId: string,
): number | null {
  if (!Array.isArray(layout)) return null;
  const item: unknown = layout.find(
    (entry: unknown) => isRecord(entry) && entry.id === itemId,
  );
  if (!isRecord(item)) return null;
  const price = item.priceCents;
  if (
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    price <= 0 ||
    price > MAX_SEAT_PRICE_CENTS
  ) {
    return null;
  }
  return price;
}
