import { BpmService } from "../src/tracks/bpm.service";
import {
  plannedMpm,
  recomputeTrackMpm,
  TrackTempoRow,
  TrackTempoStore,
} from "./recompute-track-mpm.utils";

const rules = new BpmService();

const row = (overrides: Partial<TrackTempoRow>): TrackTempoRow => ({
  id: "t1",
  style: "Rumba",
  bpm: 25,
  rawBpm: 100,
  ...overrides,
});

/** In-memory store with id-cursor pagination, like the Prisma query. */
function memoryStore(rows: TrackTempoRow[]): TrackTempoStore & {
  rows: TrackTempoRow[];
} {
  return {
    rows,
    findPage: (cursor, take) => {
      const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor ? sorted.findIndex((r) => r.id === cursor) + 1 : 0;
      return Promise.resolve(sorted.slice(start, start + take));
    },
    replaceMpm: (id, previous, next) => {
      const target = rows.find((r) => r.id === id);
      if (target?.bpm !== previous) return Promise.resolve(0);
      target.bpm = next;
      return Promise.resolve(1);
    },
  };
}

describe("plannedMpm", () => {
  it("converts the raw BPM stored for a dance variant the backend missed", () => {
    expect(
      plannedMpm(row({ style: "Valse anglaise", rawBpm: 87, bpm: 87 }), rules),
    ).toBe(29);
  });

  it("converts a BPM typed as an MPM", () => {
    expect(
      plannedMpm(row({ style: "Valse Lente", rawBpm: 0, bpm: 87 }), rules),
    ).toBe(29);
  });

  it("clears the raw BPM stored as MPM for an unknown dance", () => {
    expect(
      plannedMpm(row({ style: "LATIN", rawBpm: 120, bpm: 120 }), rules),
    ).toBe(0);
    expect(
      plannedMpm(row({ style: null, rawBpm: 123.6, bpm: 124 }), rules),
    ).toBe(0);
  });

  it("leaves correct or admin-set values alone", () => {
    // Correct conversion.
    expect(plannedMpm(row({}), rules)).toBeNull();
    // Samba detected at 50 BPM: 50 MPM is the right conversion.
    expect(
      plannedMpm(row({ style: "Samba", rawBpm: 50, bpm: 50 }), rules),
    ).toBeNull();
    // Admin MPM differing from the raw BPM, known or unknown dance.
    expect(plannedMpm(row({ bpm: 27 }), rules)).toBeNull();
    expect(
      plannedMpm(row({ style: null, rawBpm: 120, bpm: 30 }), rules),
    ).toBeNull();
    // Already cleared, or no tempo at all.
    expect(
      plannedMpm(row({ style: null, rawBpm: 120, bpm: 0 }), rules),
    ).toBeNull();
    expect(
      plannedMpm(row({ style: null, rawBpm: 0, bpm: 0 }), rules),
    ).toBeNull();
  });
});

describe("recomputeTrackMpm", () => {
  const rows = (): TrackTempoRow[] => [
    row({ id: "a", style: "Valse anglaise", rawBpm: 87, bpm: 87 }),
    row({ id: "b", style: "Rumba", rawBpm: 100, bpm: 25 }),
    row({ id: "c", style: null, rawBpm: 120, bpm: 120 }),
    row({ id: "d", style: "Jive", rawBpm: 0, bpm: 176 }),
  ];

  it("dry run: reports the corrections and writes nothing", async () => {
    const store = memoryStore(rows());
    const report = await recomputeTrackMpm(store, rules, {
      apply: false,
      pageSize: 2,
    });
    expect(report).toMatchObject({
      scanned: 4,
      corrected: 3,
      cleared: 1,
      skipped: 0,
    });
    expect(report.changes).toEqual([
      { id: "a", from: 87, to: 29 },
      { id: "c", from: 120, to: 0 },
      { id: "d", from: 176, to: 44 },
    ]);
    expect(store.rows.map((r) => r.bpm)).toEqual([87, 25, 120, 176]);
  });

  it("apply: writes the corrections, and a second run changes nothing", async () => {
    const store = memoryStore(rows());
    await recomputeTrackMpm(store, rules, { apply: true, pageSize: 2 });
    expect(store.rows.map((r) => r.bpm)).toEqual([29, 25, 0, 44]);

    const again = await recomputeTrackMpm(store, rules, { apply: true });
    expect(again).toMatchObject({ scanned: 4, corrected: 0, skipped: 0 });
  });

  it("skips a track edited between the read and the write", async () => {
    const store = memoryStore(rows());
    store.replaceMpm = jest.fn().mockResolvedValue(0);
    const report = await recomputeTrackMpm(store, rules, { apply: true });
    expect(report).toMatchObject({ corrected: 0, skipped: 3 });
  });
});
