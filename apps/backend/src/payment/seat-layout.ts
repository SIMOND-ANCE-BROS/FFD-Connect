/**
 * What a layout element sells (#428): everything is sold PER SEAT.
 *
 * - Numbered seats — `TABLE` (seats = `capacity`) and `GRADIN` (seats =
 *   `rows * cols`, index `row * cols + col` as drawn by the club editor;
 *   `capacity` when the grid is missing). The buyer picks a seat index,
 *   validated here — never the free-text `seatLabel`.
 * - Free placement — any other element (`OTHER`…): places without a number,
 *   up to `capacity` minus the locked places. The server assigns an internal
 *   slot index per place so that the database enforces the capacity.
 *
 * An element without `capacity` (layouts drawn before #428) counts as a
 * single place: the whole element, as it was sold before.
 */

/** Upper bound on the seats of one element: guards against garbage data. */
export const MAX_ELEMENT_SEATS = 1000;

const NUMBERED_TYPES: ReadonlySet<string> = new Set(["TABLE", "GRADIN"]);

export type BookableSeats =
  | { mode: "numbered"; seats: number; locked: ReadonlySet<number> }
  | { mode: "free"; places: number };

export type SeatRequestError = "out_of_range" | "locked" | "not_numbered";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeatCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_ELEMENT_SEATS
  );
}

function lockedIndexes(value: unknown, seats: number): Set<number> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.filter(
      (index): index is number =>
        typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < seats,
    ),
  );
}

/** The layout element `itemId`, or `null` when absent or malformed. */
export function findLayoutElement(
  layout: unknown,
  itemId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(layout)) return null;
  const item: unknown = layout.find(
    (entry: unknown) => isRecord(entry) && entry.id === itemId,
  );
  return isRecord(item) ? item : null;
}

/**
 * The seats the element `itemId` sells, or `null` when it does not exist or
 * sells nothing (invalid capacity, every free place locked).
 */
export function resolveBookableSeats(
  layout: unknown,
  itemId: string,
): BookableSeats | null {
  const item = findLayoutElement(layout, itemId);
  if (!item) return null;

  const capacity = item.capacity === undefined ? 1 : item.capacity;
  const type = typeof item.type === "string" ? item.type : "";

  if (NUMBERED_TYPES.has(type)) {
    const grid =
      type === "GRADIN" && isSeatCount(item.rows) && isSeatCount(item.cols)
        ? item.rows * item.cols
        : null;
    const seats = grid ?? capacity;
    if (!isSeatCount(seats)) return null;
    return {
      mode: "numbered",
      seats,
      locked: lockedIndexes(item.lockedSeats, seats),
    };
  }

  if (!isSeatCount(capacity)) return null;
  const places = capacity - lockedIndexes(item.lockedSeats, capacity).size;
  return places > 0 ? { mode: "free", places } : null;
}

/**
 * Why the requested seat cannot be sold, or `null` when it can. No seat
 * index means "any free seat": the server picks one.
 */
export function checkRequestedSeat(
  seats: BookableSeats,
  seatIndex: number | undefined,
): SeatRequestError | null {
  if (seatIndex === undefined) return null;
  if (seats.mode === "free") return "not_numbered";
  if (seatIndex >= seats.seats) return "out_of_range";
  if (seats.locked.has(seatIndex)) return "locked";
  return null;
}

/** Lowest index in `[0, count)` neither taken nor locked, or `null`. */
export function firstFreeIndex(
  count: number,
  taken: ReadonlySet<number>,
  locked: ReadonlySet<number>,
): number | null {
  for (let index = 0; index < count; index++) {
    if (!taken.has(index) && !locked.has(index)) return index;
  }
  return null;
}
