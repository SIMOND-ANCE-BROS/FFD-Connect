import {
  DEFAULT_BASE_MPM,
  clampMpm,
  mpmRange,
  resolveBaseMpm,
  tempoStyleKey,
} from "../tempo";

describe("tempo helpers", () => {
  it("rounds the base MPM and falls back when missing", () => {
    expect(resolveBaseMpm(22.6)).toBe(23);
    expect(resolveBaseMpm(0)).toBe(DEFAULT_BASE_MPM);
    expect(resolveBaseMpm(undefined)).toBe(DEFAULT_BASE_MPM);
  });

  it("allows ±50% around the base MPM, with exact bounds", () => {
    expect(mpmRange(23)).toEqual({ min: 11.5, max: 34.5 });
    expect(clampMpm(40, 23)).toBe(34.5);
    expect(clampMpm(5, 23)).toBe(11.5);
    expect(clampMpm(18, 23)).toBe(18);
  });

  it("normalises the style key", () => {
    expect(tempoStyleKey(" Rumba ")).toBe("rumba");
    expect(tempoStyleKey(undefined)).toBe("");
  });
});
