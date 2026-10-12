import {
  MAX_ELEMENT_SEATS,
  checkRequestedSeat,
  firstFreeIndex,
  resolveBookableSeats,
} from "./seat-layout";

describe("resolveBookableSeats (#428)", () => {
  const layout = (item: Record<string, unknown>) => [
    { id: "other", type: "TABLE", capacity: 2 },
    { id: "el", ...item },
  ];

  it("numbers the seats of a table by its capacity", () => {
    expect(
      resolveBookableSeats(layout({ type: "TABLE", capacity: 8 }), "el"),
    ).toEqual({ mode: "numbered", seats: 8, locked: new Set() });
  });

  it("numbers the seats of a stand by rows x cols", () => {
    expect(
      resolveBookableSeats(
        layout({ type: "GRADIN", rows: 3, cols: 4, capacity: 99 }),
        "el",
      ),
    ).toEqual({ mode: "numbered", seats: 12, locked: new Set() });
  });

  it("falls back to the capacity of a stand without a valid grid", () => {
    expect(
      resolveBookableSeats(
        layout({ type: "GRADIN", rows: 0, cols: 4, capacity: 6 }),
        "el",
      ),
    ).toEqual({ mode: "numbered", seats: 6, locked: new Set() });
  });

  it("keeps only valid locked seat indexes", () => {
    const seats = resolveBookableSeats(
      layout({
        type: "TABLE",
        capacity: 4,
        lockedSeats: [1, 3, 3, 7, -1, 1.5, "2"],
      }),
      "el",
    );
    expect(seats).toEqual({
      mode: "numbered",
      seats: 4,
      locked: new Set([1, 3]),
    });
  });

  it("ignores a lockedSeats value that is not an array", () => {
    expect(
      resolveBookableSeats(
        layout({ type: "TABLE", capacity: 2, lockedSeats: "1" }),
        "el",
      ),
    ).toEqual({ mode: "numbered", seats: 2, locked: new Set() });
  });

  it("sells any other element as free placement, minus its locked places", () => {
    expect(
      resolveBookableSeats(
        layout({ type: "OTHER", capacity: 10, lockedSeats: [0, 4] }),
        "el",
      ),
    ).toEqual({ mode: "free", places: 8 });
  });

  it("counts an element without capacity (pre-#428 layout) as one place", () => {
    expect(resolveBookableSeats(layout({ label: "Table 1" }), "el")).toEqual({
      mode: "free",
      places: 1,
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -2],
    ["fractional", 2.5],
    ["a string", "8"],
    ["above the bound", MAX_ELEMENT_SEATS + 1],
  ])("refuses a %s capacity", (_label, capacity) => {
    expect(
      resolveBookableSeats(layout({ type: "TABLE", capacity }), "el"),
    ).toBeNull();
  });

  it("refuses a free-placement element whose places are all locked", () => {
    expect(
      resolveBookableSeats(
        layout({ type: "OTHER", capacity: 1, lockedSeats: [0] }),
        "el",
      ),
    ).toBeNull();
  });

  it("refuses an unknown element or a layout that is not an array", () => {
    expect(resolveBookableSeats(layout({}), "missing")).toBeNull();
    expect(resolveBookableSeats({ el: {} }, "el")).toBeNull();
    expect(resolveBookableSeats([null, "el"], "el")).toBeNull();
  });
});

describe("checkRequestedSeat (#428)", () => {
  const numbered = {
    mode: "numbered" as const,
    seats: 4,
    locked: new Set([2]),
  };

  it("accepts an existing, unlocked seat", () => {
    expect(checkRequestedSeat(numbered, 0)).toBeNull();
    expect(checkRequestedSeat(numbered, 3)).toBeNull();
  });

  it("accepts no seat index (the server picks one)", () => {
    expect(checkRequestedSeat(numbered, undefined)).toBeNull();
    expect(
      checkRequestedSeat({ mode: "free", places: 3 }, undefined),
    ).toBeNull();
  });

  it("refuses a seat outside the element", () => {
    expect(checkRequestedSeat(numbered, 4)).toBe("out_of_range");
  });

  it("refuses a locked seat", () => {
    expect(checkRequestedSeat(numbered, 2)).toBe("locked");
  });

  it("refuses a seat index on a free-placement element", () => {
    expect(checkRequestedSeat({ mode: "free", places: 3 }, 0)).toBe(
      "not_numbered",
    );
  });
});

describe("firstFreeIndex", () => {
  it("returns the lowest index neither taken nor locked", () => {
    expect(firstFreeIndex(5, new Set([0, 2]), new Set([1]))).toBe(3);
  });

  it("returns null when everything is taken", () => {
    expect(firstFreeIndex(2, new Set([0]), new Set([1]))).toBeNull();
    expect(firstFreeIndex(0, new Set(), new Set())).toBeNull();
  });
});
