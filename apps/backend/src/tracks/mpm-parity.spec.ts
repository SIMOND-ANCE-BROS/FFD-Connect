import * as fs from "fs";
import * as path from "path";
import { BpmService } from "./bpm.service";
import { TRACK_DANCE_LABELS } from "./dance-labels";

interface MpmCase {
  rawBpm: number;
  style: string | null;
  mpm: number;
}

/** Shared with apps/admin/src/lib/mpm.test.ts: the back-office mirrors this rule. */
const CASES = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../../test/fixtures/mpm-cases.json"),
    "utf8",
  ),
) as MpmCase[];

describe("MPM rule shared with the back-office", () => {
  const bpm = new BpmService();

  it.each(CASES)("$rawBpm BPM, $style → $mpm MPM", ({ rawBpm, style, mpm }) => {
    expect(bpm.calculateMpm(rawBpm, style ?? undefined)).toBe(mpm);
  });

  it.each(TRACK_DANCE_LABELS)("recognises the canonical dance %s", (label) => {
    // An unknown style keeps the raw tempo; every known dance converts 120 BPM.
    expect(bpm.calculateMpm(120, label)).not.toBe(120);
  });
});
