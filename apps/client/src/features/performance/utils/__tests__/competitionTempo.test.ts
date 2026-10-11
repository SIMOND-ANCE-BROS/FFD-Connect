import { DANCES } from "../../../../stores/performance.store";
import {
  COMPETITION_TEMPO,
  isTempoCompliant,
  tempoRange,
} from "../competitionTempo";

const at = (baseBpm: number) => ({ baseBpm });

describe("competition tempo rules", () => {
  it("has a range for every competition dance", () => {
    for (const dance of [...DANCES.Standard, ...DANCES.Latin]) {
      expect(tempoRange(dance)).not.toBeNull();
    }
    expect(Object.keys(COMPETITION_TEMPO)).toHaveLength(10);
  });

  it("uses the official WDSF ranges", () => {
    expect(tempoRange("Jive")).toEqual({ min: 42, max: 44 });
    expect(tempoRange("Rumba")).toEqual({ min: 24, max: 26 });
    expect(tempoRange("Valse Viennoise")).toEqual({ min: 58, max: 60 });
    expect(tempoRange("Paso Doble")).toEqual({ min: 60, max: 62 });
  });

  it("includes both bounds", () => {
    expect(isTempoCompliant(at(42), "Jive")).toBe(true);
    expect(isTempoCompliant(at(44), "Jive")).toBe(true);
    expect(isTempoCompliant(at(41), "Jive")).toBe(false);
    expect(isTempoCompliant(at(45), "Jive")).toBe(false);
  });

  it("rounds the stored MPM", () => {
    expect(isTempoCompliant(at(44.4), "Jive")).toBe(true);
    expect(isTempoCompliant(at(44.6), "Jive")).toBe(false);
    expect(isTempoCompliant(at(41.5), "Jive")).toBe(true);
  });

  it("treats an unknown tempo as off-range", () => {
    expect(isTempoCompliant(at(0), "Jive")).toBe(false);
    expect(isTempoCompliant(at(-43), "Jive")).toBe(false);
    expect(isTempoCompliant(at(Number.NaN), "Jive")).toBe(false);
    expect(
      isTempoCompliant({ baseBpm: undefined as unknown as number }, "Jive"),
    ).toBe(false);
  });

  it("never blocks a dance without a range", () => {
    expect(tempoRange("Lindy Hop")).toBeNull();
    expect(isTempoCompliant(at(0), "Lindy Hop")).toBe(true);
  });
});
