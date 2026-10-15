import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionSeatPricingSelect,
  seatBookingOccupancySelect,
} from "../utils/prisma-selects";
import type {
  SeatElementOccupancyDto,
  SeatOccupancyResponseDto,
} from "./dto/seat-occupancy.dto";
import {
  MAX_ELEMENT_SEATS,
  resolveBookableSeats,
  type BookableSeats,
} from "./seat-layout";

type OccupancyRow = Prisma.SeatBookingGetPayload<{
  select: typeof seatBookingOccupancySelect;
}>;

/**
 * Active bookings of a competition (#454): CONFIRMED seats, and PENDING holds
 * whose deadline is still ahead. Holds expire lazily (no scheduled purge,
 * see `lapsedHoldWhere`), so a lapsed hold may still read PENDING in the
 * database: the deadline is checked here, never the status alone.
 */
export function activeBookingWhere(now: Date) {
  return {
    OR: [
      { status: "CONFIRMED" as const },
      { status: "PENDING" as const, expiresAt: { gt: now } },
    ],
  };
}

/** Ids of the layout elements, in layout order, without duplicates. */
function layoutItemIds(layout: unknown): string[] {
  if (!Array.isArray(layout)) return [];
  const ids = new Set<string>();
  for (const entry of layout as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return [...ids];
}

function sortedIndexes(indexes: Iterable<number>): number[] {
  return [...indexes].sort((a, b) => a - b);
}

/**
 * Occupancy of one element from its active bookings. Numbered seats report
 * their indexes; free placement only counts (its slot indexes are internal).
 */
export function elementOccupancy(
  itemId: string,
  seats: BookableSeats,
  rows: readonly OccupancyRow[],
  userId: string | undefined,
): SeatElementOccupancyDto {
  const isMine = (row: OccupancyRow) =>
    userId !== undefined && row.userId === userId;
  const confirmed = rows.filter((row) => row.status === "CONFIRMED");
  const pending = rows.filter((row) => row.status === "PENDING");
  // A booking made before #428 (no seat index) holds the whole element.
  const wholeElementBooked = rows.some((row) => row.seatIndex === null);
  const mine = rows.filter(isMine).length;

  if (seats.mode === "free") {
    return {
      itemId,
      mode: "free",
      available: wholeElementBooked
        ? 0
        : Math.max(0, seats.places - rows.length),
      taken: confirmed.length,
      held: pending.length,
      mine,
      takenSeats: [],
      heldSeats: [],
      mySeats: [],
      wholeElementBooked,
    };
  }

  // Indexes beyond the element (layout shrunk after the booking) are ignored.
  const inRange = (
    row: OccupancyRow,
  ): row is OccupancyRow & {
    seatIndex: number;
  } =>
    row.seatIndex !== null && row.seatIndex >= 0 && row.seatIndex < seats.seats;
  const takenSeats = new Set(confirmed.filter(inRange).map((r) => r.seatIndex));
  const heldSeats = new Set(pending.filter(inRange).map((r) => r.seatIndex));
  const mySeats = new Set(
    rows
      .filter(inRange)
      .filter(isMine)
      .map((r) => r.seatIndex),
  );

  let available = 0;
  if (!wholeElementBooked) {
    for (let index = 0; index < seats.seats; index++) {
      if (
        !seats.locked.has(index) &&
        !takenSeats.has(index) &&
        !heldSeats.has(index)
      ) {
        available++;
      }
    }
  }

  return {
    itemId,
    mode: "numbered",
    available,
    taken: takenSeats.size,
    held: heldSeats.size,
    mine: mySeats.size,
    takenSeats: sortedIndexes(takenSeats),
    heldSeats: sortedIndexes(heldSeats),
    mySeats: sortedIndexes(mySeats),
    wholeElementBooked,
  };
}

/**
 * Seat-plan occupancy (#453/#454) — read only; the holds themselves are
 * written by `SeatHoldService`.
 *
 * Not cached: the payload changes on every hold, confirmation, release and
 * deadline, and a stale "free" seat sends the buyer into a 409 at checkout.
 * The query is one indexed, bounded read (`SeatBooking_competitionId_idx`,
 * and the partial active-seat index whose predicate matches the filter).
 */
@Injectable()
export class SeatOccupancyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getOccupancy(
    competitionId: string,
    userId?: string,
    now: Date = new Date(),
  ): Promise<SeatOccupancyResponseDto> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionSeatPricingSelect,
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const elements: Array<{ itemId: string; seats: BookableSeats }> = [];
    for (const itemId of layoutItemIds(competition.layout)) {
      const seats = resolveBookableSeats(competition.layout, itemId);
      if (seats) elements.push({ itemId, seats });
    }
    if (elements.length === 0) return { competitionId, elements: [] };

    const rows = await this.prisma.seatBooking.findMany({
      where: {
        competitionId,
        itemId: { in: elements.map((e) => e.itemId) },
        ...activeBookingWhere(now),
      },
      select: seatBookingOccupancySelect,
      // One active booking per seat slot (unique index) plus at most one
      // pre-#428 whole-element booking: never more per element than this.
      take: elements.length * (MAX_ELEMENT_SEATS + 1),
    });

    const rowsByItem = new Map<string, OccupancyRow[]>();
    for (const row of rows) {
      const list = rowsByItem.get(row.itemId) ?? [];
      list.push(row);
      rowsByItem.set(row.itemId, list);
    }

    return {
      competitionId,
      elements: elements.map(({ itemId, seats }) =>
        elementOccupancy(itemId, seats, rowsByItem.get(itemId) ?? [], userId),
      ),
    };
  }
}
