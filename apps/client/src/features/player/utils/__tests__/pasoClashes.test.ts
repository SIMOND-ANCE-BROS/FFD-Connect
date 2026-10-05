import {
  computeDefaultPasoClashes,
  getEffectiveClashes,
  isPasoDoble,
  nextClash,
} from "../pasoClashes";

describe("isPasoDoble", () => {
  it("détecte le paso doble (insensible à la casse)", () => {
    expect(isPasoDoble("Paso Doble")).toBe(true);
    expect(isPasoDoble("paso")).toBe(true);
    expect(isPasoDoble("Rumba")).toBe(false);
    expect(isPasoDoble(null)).toBe(false);
    expect(isPasoDoble(undefined)).toBe(false);
  });
});

describe("computeDefaultPasoClashes", () => {
  it("répartit N appels régulièrement, le dernier sur la fin", () => {
    expect(computeDefaultPasoClashes(120, 3)).toEqual([40, 80, 120]);
    expect(computeDefaultPasoClashes(80, 2)).toEqual([40, 80]);
  });

  it("défaut = 3 appels", () => {
    expect(computeDefaultPasoClashes(90)).toHaveLength(3);
  });

  it("durée invalide → liste vide", () => {
    expect(computeDefaultPasoClashes(0)).toEqual([]);
    expect(computeDefaultPasoClashes(-5)).toEqual([]);
    expect(computeDefaultPasoClashes(NaN)).toEqual([]);
  });
});

describe("getEffectiveClashes", () => {
  it("non-paso → aucun appel même si des valeurs existent", () => {
    expect(getEffectiveClashes("Rumba", [10, 20], 120)).toEqual([]);
  });

  it("paso avec valeurs admin → utilise ces valeurs, triées", () => {
    expect(getEffectiveClashes("Paso Doble", [50, 10, 30], 120)).toEqual([
      10, 30, 50,
    ]);
  });

  it("paso sans valeurs → estimation par défaut", () => {
    expect(getEffectiveClashes("Paso Doble", [], 120)).toEqual([40, 80, 120]);
    expect(getEffectiveClashes("Paso Doble", undefined, 120)).toEqual([
      40, 80, 120,
    ]);
  });
});

describe("nextClash", () => {
  const clashes = [40, 80, 120];

  it("retourne le prochain appel + son index 1-based", () => {
    expect(nextClash(0, clashes)).toEqual({ time: 40, index: 1, total: 3 });
    expect(nextClash(50, clashes)).toEqual({ time: 80, index: 2, total: 3 });
  });

  it("null quand tous les appels sont passés", () => {
    expect(nextClash(120, clashes)).toBeNull();
    expect(nextClash(200, clashes)).toBeNull();
  });
});
