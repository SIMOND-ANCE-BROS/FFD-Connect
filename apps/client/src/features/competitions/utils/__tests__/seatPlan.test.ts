import type { SeatElementOccupancyDto } from "../../../../api/generated";
import {
  canBookFreeElement,
  findOwnHeldSeat,
  formatHoldTime,
  formatPrice,
  gradinSeatIndex,
  hasSeatsForSale,
  isSelectable,
  isSelectionStillValid,
  joinOccupancy,
  parseSeatPlan,
  rowName,
  seatAccessibilityLabel,
  seatLabel,
  seatStatus,
  type BookableElement,
} from "../seatPlan";

const occupancy = (
  itemId: string,
  overrides: Partial<SeatElementOccupancyDto> = {},
): SeatElementOccupancyDto => ({
  itemId,
  mode: "numbered",
  available: 4,
  taken: 0,
  held: 0,
  mine: 0,
  takenSeats: [],
  heldSeats: [],
  mySeats: [],
  wholeElementBooked: false,
  ...overrides,
});

const TABLE = {
  id: "t1",
  type: "TABLE",
  label: "Table 1",
  capacity: 6,
  lockedSeats: [5, 99, -1, 1.5, "2"],
  priceCents: 1500,
};
const GRADIN = {
  id: "g1",
  type: "GRADIN",
  label: "Gradin nord",
  capacity: 99,
  rows: 3,
  cols: 4,
  priceCents: 800,
};
const BAR = { id: "o1", type: "OTHER", label: "Bar", capacity: 20 };

describe("parseSeatPlan", () => {
  it("parses tables, gradins and free elements, dropping malformed entries", () => {
    const plan = parseSeatPlan([TABLE, GRADIN, BAR, null, { label: "x" }, 3]);
    expect(plan.map((e) => e.id)).toEqual(["t1", "g1", "o1"]);

    const [table, gradin, bar] = plan;
    expect(table.seatCount).toBe(6);
    expect([...table.locked]).toEqual([5]);
    expect(table.cols).toBeNull();
    expect(table.priceCents).toBe(1500);

    // Gradin: rows × cols wins over capacity (server contract).
    expect(gradin.seatCount).toBe(12);
    expect(gradin.rows).toBe(3);
    expect(gradin.cols).toBe(4);

    expect(bar.seatCount).toBe(20);
    expect(bar.priceCents).toBeNull();
  });

  it("falls back to capacity for a gradin without a valid grid", () => {
    const [gradin] = parseSeatPlan([{ ...GRADIN, rows: 0, capacity: 10 }]);
    expect(gradin.seatCount).toBe(10);
    expect(gradin.cols).toBeNull();
  });

  it("counts an element without capacity as one place", () => {
    const [legacy] = parseSeatPlan([{ id: "l", type: "TABLE", label: "L" }]);
    expect(legacy.seatCount).toBe(1);
  });

  it("rejects invalid prices and names unnamed elements", () => {
    const [a, b] = parseSeatPlan([
      { id: "a", type: "TABLE", capacity: 2, priceCents: 0 },
      { id: "b", type: "TABLE", capacity: 2, priceCents: 12.5, label: " " },
    ]);
    expect(a.priceCents).toBeNull();
    expect(b.priceCents).toBeNull();
    expect(b.label).toBe("Élément du plan");
  });

  it("returns nothing for a non-array layout", () => {
    expect(parseSeatPlan(undefined)).toEqual([]);
    expect(parseSeatPlan({ id: "x" })).toEqual([]);
  });
});

describe("hasSeatsForSale", () => {
  it("is true only when an element has a price", () => {
    expect(hasSeatsForSale([TABLE, BAR])).toBe(true);
    expect(hasSeatsForSale([BAR])).toBe(false);
    expect(hasSeatsForSale(null)).toBe(false);
  });
});

describe("gradinSeatIndex", () => {
  it.each([
    [0, 0, 4, 0],
    [0, 3, 4, 3],
    [1, 0, 4, 4],
    [2, 1, 4, 9],
    [4, 6, 10, 46],
  ])("row %i col %i of %i columns → %i", (row, col, cols, expected) => {
    expect(gradinSeatIndex(row, col, cols)).toBe(expected);
  });
});

describe("seat labels", () => {
  const [table, gradin] = parseSeatPlan([TABLE, GRADIN]);

  it("numbers table seats from 1", () => {
    expect(seatLabel(table, 0)).toBe("Place 1");
    expect(seatLabel(table, 5)).toBe("Place 6");
  });

  it("names gradin seats by row letter and column", () => {
    expect(seatLabel(gradin, 0)).toBe("Rang A, place 1");
    expect(seatLabel(gradin, gradinSeatIndex(2, 1, 4))).toBe("Rang C, place 2");
  });

  it("names rows past Z by number", () => {
    expect(rowName(25)).toBe("Z");
    expect(rowName(26)).toBe("27");
  });
});

describe("seat status", () => {
  const [plan] = parseSeatPlan([TABLE]);
  const [element] = joinOccupancy(
    [plan],
    [
      occupancy("t1", {
        takenSeats: [0, 2],
        heldSeats: [1, 3],
        mySeats: [2, 3],
      }),
    ],
  );

  it.each([
    [0, "taken", false],
    [1, "held", false],
    [2, "minePaid", false],
    [3, "mineHeld", true],
    [4, "free", true],
    [5, "locked", false],
  ] as const)("seat %i is %s", (index, status, selectable) => {
    expect(seatStatus(element, index)).toBe(status);
    expect(isSelectable(seatStatus(element, index))).toBe(selectable);
  });

  it("locks every free seat of an element booked whole (pre-#428)", () => {
    const whole: BookableElement = {
      ...element,
      occupancy: { ...element.occupancy, wholeElementBooked: true },
    };
    expect(seatStatus(whole, 4)).toBe("locked");
  });

  it("says the status in French for screen readers", () => {
    expect(seatAccessibilityLabel(element, 4, "free")).toBe(
      "Table 1, Place 5, libre",
    );
    expect(seatAccessibilityLabel(element, 1, "held")).toBe(
      "Table 1, Place 2, en cours de réservation",
    );
  });
});

describe("joinOccupancy", () => {
  it("keeps priced elements reported by the server, in layout order", () => {
    const plan = parseSeatPlan([
      GRADIN,
      TABLE,
      BAR,
      { ...TABLE, id: "t2", priceCents: undefined },
    ]);
    const joined = joinOccupancy(plan, [
      occupancy("t1"),
      occupancy("o1", { mode: "free" }),
      occupancy("g1"),
      occupancy("t2"),
    ]);
    expect(joined.map((e) => [e.id, e.mode])).toEqual([
      ["g1", "numbered"],
      ["t1", "numbered"],
    ]);
  });
});

describe("free placement", () => {
  const [bar] = joinOccupancy(parseSeatPlan([{ ...BAR, priceCents: 500 }]), [
    occupancy("o1", { mode: "free", available: 3 }),
  ]);

  it("is bookable while places remain", () => {
    expect(canBookFreeElement(bar)).toBe(true);
    expect(
      canBookFreeElement({
        ...bar,
        occupancy: { ...bar.occupancy, available: 0 },
      }),
    ).toBe(false);
  });
});

describe("selection", () => {
  const elements = joinOccupancy(
    parseSeatPlan([TABLE, GRADIN, { ...BAR, priceCents: 500 }]),
    [
      occupancy("t1", { takenSeats: [0], mySeats: [0] }),
      occupancy("g1", { heldSeats: [6], mySeats: [6] }),
      occupancy("o1", { mode: "free", available: 0 }),
    ],
  );

  it("finds the user's own held seat, not a paid one", () => {
    expect(findOwnHeldSeat(elements)).toEqual({ itemId: "g1", seatIndex: 6 });
    expect(findOwnHeldSeat(elements.slice(0, 1))).toBeNull();
  });

  it("checks a selection against the current occupancy", () => {
    expect(
      isSelectionStillValid({ itemId: "t1", seatIndex: 1 }, elements),
    ).toBe(true);
    // Taken by the user (paid), locked, out of range, unknown element.
    expect(
      isSelectionStillValid({ itemId: "t1", seatIndex: 0 }, elements),
    ).toBe(false);
    expect(
      isSelectionStillValid({ itemId: "t1", seatIndex: 5 }, elements),
    ).toBe(false);
    expect(
      isSelectionStillValid({ itemId: "t1", seatIndex: 40 }, elements),
    ).toBe(false);
    expect(
      isSelectionStillValid({ itemId: "zz", seatIndex: 1 }, elements),
    ).toBe(false);
    // Own held seat: still selectable (resumes the payment).
    expect(
      isSelectionStillValid({ itemId: "g1", seatIndex: 6 }, elements),
    ).toBe(true);
    // Free placement: full; a seat index on it is never valid.
    expect(isSelectionStillValid({ itemId: "o1" }, elements)).toBe(false);
    expect(isSelectionStillValid({ itemId: "t1" }, elements)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats cents as euros", () => {
    expect(formatPrice(1500)).toBe("15,00 €");
    expect(formatPrice(805)).toBe("8,05 €");
    expect(formatPrice(99)).toBe("0,99 €");
  });

  it("formats the end of a hold as local HH:MM", () => {
    const date = new Date(2026, 9, 15, 9, 5);
    expect(formatHoldTime(date.toISOString())).toBe("09:05");
    expect(formatHoldTime("not a date")).toBeNull();
  });
});
