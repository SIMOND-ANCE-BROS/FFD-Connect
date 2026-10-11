import {
  addIsoDays,
  addIsoMonths,
  parisDateOf,
  parisMidnightInDays,
  parisMidnightOf,
  statsWindow,
  zeroFill,
  zeroFillCount,
} from "./stats-period";

describe("statsWindow", () => {
  it("12w: 12 Monday buckets, current week last (Wednesday in summer)", () => {
    const w = statsWindow("12w", new Date("2026-07-15T10:00:00Z"));
    expect(w.bucket).toBe("week");
    expect(w.buckets).toHaveLength(12);
    expect(w.buckets[11]).toBe("2026-07-13");
    expect(w.buckets[0]).toBe("2026-04-27");
    expect(w.start.toISOString()).toBe("2026-04-26T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-19T22:00:00.000Z");
    expect(w.today.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("Sunday 22:30 UTC in summer is already Monday in Paris", () => {
    const w = statsWindow("12w", new Date("2026-07-19T22:30:00Z"));
    expect(w.buckets[11]).toBe("2026-07-20");
  });

  it("a Sunday counts in the week of the previous Monday", () => {
    const w = statsWindow("12w", new Date("2026-07-19T12:00:00Z"));
    expect(w.buckets[11]).toBe("2026-07-13");
  });

  it("week of the October DST change: start in summer time, end in winter time", () => {
    const w = statsWindow("12w", new Date("2026-10-21T10:00:00Z"));
    expect(w.buckets[11]).toBe("2026-10-19");
    expect(w.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("week of the March DST change", () => {
    const w = statsWindow("12w", new Date("2026-03-25T10:00:00Z"));
    expect(w.buckets[11]).toBe("2026-03-23");
    expect(w.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("6m: monthly buckets across a year boundary", () => {
    const w = statsWindow("6m", new Date("2026-02-10T10:00:00Z"));
    expect(w.bucket).toBe("month");
    expect(w.buckets).toEqual([
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(w.start.toISOString()).toBe("2025-08-31T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-02-28T23:00:00.000Z");
  });

  it("12m: 12 monthly buckets; 31 Dec 23:30 UTC is already January in Paris", () => {
    const w = statsWindow("12m", new Date("2026-12-31T23:30:00Z"));
    expect(w.buckets).toHaveLength(12);
    expect(w.buckets[11]).toBe("2027-01-01");
    expect(w.buckets[0]).toBe("2026-02-01");
  });
});

describe("parisMidnightInDays", () => {
  it("adds calendar days in Paris time across the DST change", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(parisMidnightInDays(now, 0).toISOString()).toBe(
      "2026-10-19T22:00:00.000Z",
    );
    expect(parisMidnightInDays(now, 30).toISOString()).toBe(
      "2026-11-18T23:00:00.000Z",
    );
  });
});

describe("zeroFill", () => {
  const buckets = ["2026-07-06", "2026-07-13"];

  it("fills every bucket and key, ignoring unknown buckets and keys", () => {
    const rows = [
      { start: "2026-07-13", key: "CLUB", count: 2 },
      { start: "2026-07-13", key: "NOPE", count: 9 },
      { start: "2020-01-06", key: "CLUB", count: 9 },
      { start: "2026-07-13", key: "CLUB", count: 1 },
    ];
    expect(zeroFill(buckets, rows, ["LICENSEE", "CLUB"] as const)).toEqual([
      { start: "2026-07-06", LICENSEE: 0, CLUB: 0 },
      { start: "2026-07-13", LICENSEE: 0, CLUB: 3 },
    ]);
  });

  it("zeroFillCount sums rows per bucket", () => {
    expect(
      zeroFillCount(buckets, [{ start: "2026-07-06", key: null, count: 4 }]),
    ).toEqual([
      { start: "2026-07-06", count: 4 },
      { start: "2026-07-13", count: 0 },
    ]);
  });
});

describe("Paris day helpers", () => {
  it("parisDateOf: late UTC evening is the next Paris day", () => {
    expect(parisDateOf(new Date("2026-07-15T21:59:00Z"))).toBe("2026-07-15");
    expect(parisDateOf(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
    expect(parisDateOf(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
  });

  it("parisMidnightOf follows DST", () => {
    expect(parisMidnightOf("2026-07-16").toISOString()).toBe(
      "2026-07-15T22:00:00.000Z",
    );
    expect(parisMidnightOf("2026-10-26").toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });

  it("adds days and months on ISO dates", () => {
    expect(addIsoDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addIsoDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addIsoMonths("2026-10-01", -25)).toBe("2024-09-01");
  });
});
