import * as fs from "fs";
import * as path from "path";
import { BpmService, normalizeStyle } from "./bpm.service";
import { TRACK_DANCE_LABELS } from "./dance-labels";

interface MpmCase {
  rawBpm: number;
  style: string | null;
  mpm: number;
}

interface DanceStyleCase {
  style: string | null;
  dance: string | null;
}

const readFixture = <T>(name: string): T =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../test/fixtures", name), "utf8"),
  ) as T;

/** Shared with apps/admin/src/lib/mpm.test.ts: the back-office mirrors this rule. */
const CASES = readFixture<MpmCase[]>("mpm-cases.json");

/**
 * Shared with the mobile app (features/player/utils/danceTempo.test.ts) and
 * the back-office (apps/admin/src/lib/mpm.test.ts): every label one of them
 * recognises maps to the same dance here (#338).
 */
const DANCE_CASES = readFixture<DanceStyleCase[]>("dance-style-cases.json");

describe("MPM rule shared with the back-office", () => {
  const bpm = new BpmService();

  it.each(CASES)("$rawBpm BPM, $style → $mpm MPM", ({ rawBpm, style, mpm }) => {
    expect(bpm.calculateMpm(rawBpm, style)).toBe(mpm);
  });

  it.each(TRACK_DANCE_LABELS)("recognises the canonical dance %s", (label) => {
    // An unknown style gets no MPM (0); every known dance converts 120 BPM.
    expect(bpm.calculateMpm(120, label)).toBeGreaterThan(0);
  });
});

describe("dance recognition shared with the mobile app and the back-office", () => {
  it.each(DANCE_CASES)("$style → $dance", ({ style, dance }) => {
    expect(normalizeStyle(style)).toBe(dance);
  });
});
