import * as fs from "fs";
import * as path from "path";
import { mpmFromBpm, normalizeDance } from "../danceTempo";
import { trackMatchesDance } from "../../../performance/utils/competitionProgram";

interface DanceStyleCase {
  style: string | null;
  dance: string | null;
}

interface MpmCase {
  rawBpm: number;
  style: string | null;
  mpm: number;
}

// Fixtures of the backend (source of truth), also used by the back-office:
// every label the app recognises maps to the same dance on the server (#338).
const FIXTURES = path.resolve(
  __dirname,
  "../../../../../../backend/test/fixtures",
);
const readFixture = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as T;

describe("normalizeDance (mirror of the backend normalizeStyle)", () => {
  it.each(readFixture<DanceStyleCase[]>("dance-style-cases.json"))(
    "$style → $dance",
    ({ style, dance }) => {
      expect(normalizeDance(style)).toBe(dance);
    },
  );
});

describe("mpmFromBpm (mirror of BpmService.calculateMpm)", () => {
  it.each(readFixture<MpmCase[]>("mpm-cases.json"))(
    "$rawBpm BPM, $style → $mpm MPM",
    ({ rawBpm, style, mpm }) => {
      expect(mpmFromBpm(rawBpm, style)).toBe(mpm);
    },
  );

  it("never shows the raw BPM as an MPM for an unknown dance (#338)", () => {
    expect(mpmFromBpm(87, "Autre")).toBe(0);
    expect(mpmFromBpm(87, undefined)).toBe(0);
  });
});

describe("competition mode uses the same recognition", () => {
  it("matches « valse anglaise » and spelling variants to their dance", () => {
    expect(trackMatchesDance("Valse anglaise", "Valse Lente")).toBe(true);
    expect(trackMatchesDance("Slow-fox", "Slow Fox")).toBe(true);
    expect(trackMatchesDance("Quick-step", "Quickstep")).toBe(true);
    expect(trackMatchesDance("Cha-Cha-Cha", "Cha-Cha-Cha")).toBe(true);
  });

  it("maps a style to one dance only", () => {
    expect(trackMatchesDance("Valse Viennoise", "Valse Lente")).toBe(false);
    expect(trackMatchesDance("Valse Viennoise", "Valse Viennoise")).toBe(true);
    expect(trackMatchesDance("LATIN", "Rumba")).toBe(false);
  });
});
