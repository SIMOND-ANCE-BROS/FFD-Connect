import type { SeatElementOccupancyDto } from "../../../api/generated";

/**
 * Seat plan of a competition, as a participant books it (#453).
 *
 * The layout JSON is drawn by the organising club; the server sells it PER
 * SEAT (#428, see backend `payment/seat-layout.ts`):
 * - numbered elements — `TABLE` (seats `0..capacity-1`) and `GRADIN` (seat
 *   index `row * cols + col`, `capacity` when the grid is missing): the buyer
 *   picks a seat and sends its `seatIndex`;
 * - free placement — any other element: no seat number, the server takes a
 *   place among the capacity (no `seatIndex`).
 *
 * Which seats are taken or held comes from GET /competitions/:id/seat-occupancy
 * (#454); this module only joins both and never decides availability alone.
 */

/** Same guard as the server (`MAX_ELEMENT_SEATS`). */
export const MAX_ELEMENT_SEATS = 1000;

/** Same guard as the server (`MAX_SEAT_PRICE_CENTS`). */
const MAX_SEAT_PRICE_CENTS = 1_000_000;

export type SeatMode = "numbered" | "free";

/** One layout element, as far as booking is concerned. */
export interface SeatPlanElement {
  id: string;
  type: string;
  label: string;
  /** Price of one seat in cents, `null` when the element is not for sale. */
  priceCents: number | null;
  /** Grid of a `GRADIN` (both set only when valid). */
  rows: number | null;
  cols: number | null;
  /** Seats of a numbered element (`rows * cols` or `capacity`). */
  seatCount: number;
  locked: ReadonlySet<number>;
}

/** A plan element joined with its occupancy: what the picker shows. */
export interface BookableElement extends SeatPlanElement {
  mode: SeatMode;
  occupancy: SeatElementOccupancyDto;
}

export type SeatStatus =
  | "free"
  | "taken"
  | "held"
  | "locked"
  | "mineHeld"
  | "minePaid";

/** The seat the user is about to book. No `seatIndex`: free placement. */
export interface SeatSelection {
  itemId: string;
  seatIndex?: number;
}

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

function validPrice(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_SEAT_PRICE_CENTS
    ? value
    : null;
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

function parseElement(entry: unknown): SeatPlanElement | null {
  if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) {
    return null;
  }
  const type = typeof entry.type === "string" ? entry.type : "OTHER";
  const hasGrid =
    type === "GRADIN" && isSeatCount(entry.rows) && isSeatCount(entry.cols);
  const rows = hasGrid ? (entry.rows as number) : null;
  const cols = hasGrid ? (entry.cols as number) : null;
  // An element without capacity (drawn before #428) is a single place.
  const capacity = entry.capacity === undefined ? 1 : entry.capacity;
  const seats = rows !== null && cols !== null ? rows * cols : capacity;
  const seatCount = isSeatCount(seats) ? seats : 0;
  const label =
    typeof entry.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : "Élément du plan";
  return {
    id: entry.id,
    type,
    label,
    priceCents: validPrice(entry.priceCents),
    rows: seatCount > 0 ? rows : null,
    cols: seatCount > 0 ? cols : null,
    seatCount,
    locked: lockedIndexes(entry.lockedSeats, seatCount),
  };
}

/** The elements of a layout JSON, malformed entries dropped. */
export function parseSeatPlan(layout: unknown): SeatPlanElement[] {
  if (!Array.isArray(layout)) return [];
  return layout
    .map(parseElement)
    .filter((element): element is SeatPlanElement => element !== null);
}

/** True when the layout sells at least one seat (an element has a price). */
export function hasSeatsForSale(layout: unknown): boolean {
  return parseSeatPlan(layout).some(
    (element) => element.priceCents !== null && element.seatCount > 0,
  );
}

/**
 * Elements the user can book from: priced in the layout AND reported by the
 * occupancy endpoint (which lists exactly what the server sells), in layout
 * order.
 */
export function joinOccupancy(
  plan: readonly SeatPlanElement[],
  occupancy: readonly SeatElementOccupancyDto[],
): BookableElement[] {
  const byId = new Map(occupancy.map((entry) => [entry.itemId, entry]));
  const joined: BookableElement[] = [];
  for (const element of plan) {
    const entry = byId.get(element.id);
    if (!entry || element.priceCents === null) continue;
    joined.push({ ...element, mode: entry.mode, occupancy: entry });
  }
  return joined;
}

/** Seat index of a gradin seat: `row * cols + col` (server contract, #428). */
export function gradinSeatIndex(
  row: number,
  col: number,
  cols: number,
): number {
  return row * cols + col;
}

/** Row name of a gradin: A, B, … Z, then 27, 28… */
export function rowName(row: number): string {
  return row < 26 ? String.fromCharCode(65 + row) : String(row + 1);
}

/** Human label of a seat, also sent as `seatLabel` (display only). */
export function seatLabel(element: SeatPlanElement, index: number): string {
  if (element.cols !== null) {
    const row = Math.floor(index / element.cols);
    const col = index % element.cols;
    return `Rang ${rowName(row)}, place ${col + 1}`;
  }
  return `Place ${index + 1}`;
}

/** State of one numbered seat, from the user's point of view. */
export function seatStatus(
  element: BookableElement,
  index: number,
): SeatStatus {
  const { occupancy } = element;
  const mine = occupancy.mySeats.includes(index);
  if (occupancy.takenSeats.includes(index)) return mine ? "minePaid" : "taken";
  if (occupancy.heldSeats.includes(index)) return mine ? "mineHeld" : "held";
  if (element.locked.has(index) || occupancy.wholeElementBooked) {
    return "locked";
  }
  return "free";
}

/**
 * A free seat can be booked; the user's own held seat too — booking it again
 * resumes the payment (`resumed: true`).
 */
export function isSelectable(status: SeatStatus): boolean {
  return status === "free" || status === "mineHeld";
}

const STATUS_LABELS: Record<SeatStatus, string> = {
  free: "libre",
  taken: "déjà réservée",
  held: "en cours de réservation",
  locked: "indisponible",
  mineHeld: "votre place, paiement en attente",
  minePaid: "votre place, payée",
};

/** VoiceOver / TalkBack label of a seat, in French. */
export function seatAccessibilityLabel(
  element: SeatPlanElement,
  index: number,
  status: SeatStatus,
): string {
  return `${element.label}, ${seatLabel(element, index)}, ${STATUS_LABELS[status]}`;
}

/** Whether the user can still book a free-placement element. */
export function canBookFreeElement(element: BookableElement): boolean {
  return (
    element.mode === "free" &&
    !element.occupancy.wholeElementBooked &&
    element.occupancy.available > 0
  );
}

/**
 * The user's own held seat, to preselect it: booking it again resumes the
 * payment rather than taking a second seat. Numbered elements only (a free
 * placement has no seat to point at).
 */
export function findOwnHeldSeat(
  elements: readonly BookableElement[],
): SeatSelection | null {
  for (const element of elements) {
    if (element.mode !== "numbered") continue;
    const index = element.occupancy.mySeats.find((seat) =>
      element.occupancy.heldSeats.includes(seat),
    );
    if (index !== undefined) return { itemId: element.id, seatIndex: index };
  }
  return null;
}

/**
 * Whether a selection still points at something bookable once the occupancy
 * changed (a refresh after a 409, a focus refresh…).
 */
export function isSelectionStillValid(
  selection: SeatSelection,
  elements: readonly BookableElement[],
): boolean {
  const element = elements.find((entry) => entry.id === selection.itemId);
  if (!element) return false;
  if (selection.seatIndex === undefined) return canBookFreeElement(element);
  if (element.mode !== "numbered" || selection.seatIndex >= element.seatCount) {
    return false;
  }
  return isSelectable(seatStatus(element, selection.seatIndex));
}

/** "15,00 €" — amounts are integer cents (HelloAsso's unit). */
export function formatPrice(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return `${euros},${rest} €`;
}

/** "14:35" — end of a seat hold, in the device's time zone. */
export function formatHoldTime(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}
