import { NotFoundException } from "@nestjs/common";
import { MAX_ELEMENT_SEATS } from "./seat-layout";
import {
  activeBookingWhere,
  elementOccupancy,
  SeatOccupancyQueryService,
} from "./seat-occupancy-query.service";
import {
  competitionSeatPricingSelect,
  seatBookingOccupancySelect,
} from "../utils/prisma-selects";
import type { PrismaService } from "../prisma/prisma.service";

type Row = {
  itemId: string;
  seatIndex: number | null;
  status: "PENDING" | "CONFIRMED";
  userId: string;
};

const row = (
  itemId: string,
  seatIndex: number | null,
  status: Row["status"],
  userId = "other",
): Row => ({ itemId, seatIndex, status, userId });

const LAYOUT = [
  { id: "table-8", type: "TABLE", capacity: 8, lockedSeats: [7] },
  { id: "stand", type: "GRADIN", rows: 2, cols: 3, capacity: 6 },
  { id: "chairs", type: "OTHER", capacity: 4, lockedSeats: [0] },
  { id: "broken", type: "TABLE", capacity: 0 },
  { id: "table-8", type: "TABLE", capacity: 2 }, // duplicate id: ignored
  "garbage",
  { type: "TABLE", capacity: 2 }, // no id
];

describe("SeatOccupancyQueryService", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  let prisma: {
    competition: { findUnique: jest.Mock };
    seatBooking: { findMany: jest.Mock };
  };
  let service: SeatOccupancyQueryService;

  beforeEach(() => {
    prisma = {
      competition: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "comp-1", layout: LAYOUT }),
      },
      seatBooking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new SeatOccupancyQueryService(prisma as unknown as PrismaService);
  });

  it("404s on an unknown competition", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);
    await expect(service.getOccupancy("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
  });

  it("reads the layout with the shared select", async () => {
    await service.getOccupancy("comp-1", undefined, now);
    expect(prisma.competition.findUnique).toHaveBeenCalledWith({
      where: { id: "comp-1" },
      select: competitionSeatPricingSelect,
    });
  });

  it("queries only active, non-expired bookings of the layout elements, bounded", async () => {
    await service.getOccupancy("comp-1", "me", now);
    expect(prisma.seatBooking.findMany).toHaveBeenCalledWith({
      where: {
        competitionId: "comp-1",
        itemId: { in: ["table-8", "stand", "chairs"] },
        OR: [
          { status: "CONFIRMED" },
          { status: "PENDING", expiresAt: { gt: now } },
        ],
      },
      select: seatBookingOccupancySelect,
      take: 3 * (MAX_ELEMENT_SEATS + 1),
    });
  });

  it("skips the booking query when the layout sells nothing", async () => {
    prisma.competition.findUnique.mockResolvedValue({
      id: "comp-1",
      layout: null,
    });
    await expect(service.getOccupancy("comp-1")).resolves.toEqual({
      competitionId: "comp-1",
      elements: [],
    });
    expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
  });

  it("reports every bookable element in layout order, free when nothing is booked", async () => {
    const result = await service.getOccupancy("comp-1", undefined, now);
    expect(result.elements.map((e) => [e.itemId, e.mode, e.available])).toEqual(
      [
        ["table-8", "numbered", 7],
        ["stand", "numbered", 6],
        ["chairs", "free", 3],
      ],
    );
  });

  it("splits taken and held seats per element and flags the caller's own", async () => {
    prisma.seatBooking.findMany.mockResolvedValue([
      row("table-8", 0, "CONFIRMED"),
      row("table-8", 3, "CONFIRMED", "me"),
      row("table-8", 4, "PENDING", "me"),
      row("table-8", 5, "PENDING"),
      row("stand", 2, "PENDING"),
      row("chairs", 0, "CONFIRMED"),
      row("chairs", 1, "PENDING", "me"),
    ]);
    const result = await service.getOccupancy("comp-1", "me", now);
    expect(result).toEqual({
      competitionId: "comp-1",
      elements: [
        {
          itemId: "table-8",
          mode: "numbered",
          available: 3,
          taken: 2,
          held: 2,
          mine: 2,
          takenSeats: [0, 3],
          heldSeats: [4, 5],
          mySeats: [3, 4],
          wholeElementBooked: false,
        },
        {
          itemId: "stand",
          mode: "numbered",
          available: 5,
          taken: 0,
          held: 1,
          mine: 0,
          takenSeats: [],
          heldSeats: [2],
          mySeats: [],
          wholeElementBooked: false,
        },
        {
          itemId: "chairs",
          mode: "free",
          available: 1,
          taken: 1,
          held: 1,
          mine: 1,
          takenSeats: [],
          heldSeats: [],
          mySeats: [],
          wholeElementBooked: false,
        },
      ],
    });
  });

  it("flags nothing as mine without a caller", async () => {
    prisma.seatBooking.findMany.mockResolvedValue([
      row("table-8", 3, "CONFIRMED", "me"),
    ]);
    const [table] = (await service.getOccupancy("comp-1", undefined, now))
      .elements;
    expect(table.mine).toBe(0);
    expect(table.mySeats).toEqual([]);
  });

  it("never returns who booked a seat", async () => {
    prisma.seatBooking.findMany.mockResolvedValue([
      row("table-8", 3, "CONFIRMED", "victim-user-id"),
      row("chairs", 0, "PENDING", "victim-user-id"),
    ]);
    const result = await service.getOccupancy("comp-1", "me", now);
    const text = JSON.stringify(result);
    expect(text).not.toContain("victim-user-id");
    expect(text).not.toMatch(/userId|bookingId|paymentId|seatLabel/);
  });
});

describe("activeBookingWhere", () => {
  it("keeps CONFIRMED and PENDING holds whose deadline is ahead", () => {
    const now = new Date("2026-10-15T10:00:00Z");
    expect(activeBookingWhere(now)).toEqual({
      OR: [
        { status: "CONFIRMED" },
        { status: "PENDING", expiresAt: { gt: now } },
      ],
    });
  });
});

describe("elementOccupancy", () => {
  const numbered = {
    mode: "numbered" as const,
    seats: 4,
    locked: new Set([1]),
  };

  it("a pre-#428 whole-element booking leaves no seat", () => {
    const result = elementOccupancy(
      "t",
      numbered,
      [row("t", null, "CONFIRMED", "me")],
      "me",
    );
    expect(result).toMatchObject({
      available: 0,
      wholeElementBooked: true,
      taken: 0,
      takenSeats: [],
    });
    const free = elementOccupancy(
      "c",
      { mode: "free", places: 3 },
      [row("c", null, "PENDING", "me")],
      "me",
    );
    expect(free).toMatchObject({
      available: 0,
      wholeElementBooked: true,
      held: 1,
      mine: 1,
    });
  });

  it("ignores seat indexes outside the element (layout shrunk)", () => {
    const result = elementOccupancy(
      "t",
      numbered,
      [row("t", 9, "CONFIRMED"), row("t", -1, "PENDING")],
      undefined,
    );
    expect(result).toMatchObject({
      available: 3,
      taken: 0,
      held: 0,
      takenSeats: [],
      heldSeats: [],
    });
  });

  it("does not count a locked seat as available, even when booked", () => {
    const result = elementOccupancy(
      "t",
      numbered,
      [row("t", 1, "CONFIRMED"), row("t", 0, "PENDING")],
      undefined,
    );
    expect(result).toMatchObject({
      available: 2,
      takenSeats: [1],
      heldSeats: [0],
    });
  });

  it("free placement never goes below zero after a capacity cut", () => {
    const result = elementOccupancy(
      "c",
      { mode: "free", places: 1 },
      [row("c", 0, "CONFIRMED"), row("c", 5, "CONFIRMED")],
      undefined,
    );
    expect(result).toMatchObject({ available: 0, taken: 2 });
  });
});
