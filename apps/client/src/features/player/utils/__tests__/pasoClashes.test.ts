import {
  computeDefaultPasoClashes,
  getEffectiveClashes,
  isPasoDoble,
  nextClash,
  normalizePasoMpm,
  PASO_MAX_CLASHES,
  storedPasoClashCount,
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

describe("normalizePasoMpm", () => {
  it("garde un MPM plausible", () => {
    expect(normalizePasoMpm(62)).toBe(62);
  });

  it("ramène un BPM brut (2 temps par mesure) en MPM", () => {
    expect(normalizePasoMpm(124)).toBe(62);
  });

  it("valeur absente ou aberrante → 60 MPM", () => {
    expect(normalizePasoMpm(undefined)).toBe(60);
    expect(normalizePasoMpm(null)).toBe(60);
    expect(normalizePasoMpm(0)).toBe(60);
    expect(normalizePasoMpm(NaN)).toBe(60);
    expect(normalizePasoMpm(30)).toBe(60);
    expect(normalizePasoMpm(400)).toBe(60);
  });
});

describe("computeDefaultPasoClashes", () => {
  it("place les clashs en fin de phrase (5 × 8 mesures) depuis le tempo", () => {
    // 60 MPM : 1 mesure = 1 s, phrase = 8 s → 40 s, 80 s, 120 s.
    expect(computeDefaultPasoClashes(150, 60)).toEqual([40, 80, 120]);
    // 62 MPM : phrase = 7,74 s.
    expect(computeDefaultPasoClashes(150, 62)).toEqual([38.7, 77.4, 116.1]);
  });

  it("défaut = 3 appels ; le contexte peut en demander 2", () => {
    expect(computeDefaultPasoClashes(150, 60)).toHaveLength(3);
    expect(computeDefaultPasoClashes(150, 60, 2)).toEqual([40, 80]);
  });

  it("ne dépend pas de la durée (plus de durée / 3, plus de clash en fin de piste)", () => {
    expect(computeDefaultPasoClashes(180, 60)).toEqual([40, 80, 120]);
    // L'ancienne estimation donnait [60, 120, 180].
    expect(computeDefaultPasoClashes(180, 60)).not.toContain(180);
  });

  it("coupe courte : n'estime que les clashs qui tiennent dans la piste", () => {
    // 80-95 s à 60 MPM = coupe au 2e clash.
    expect(computeDefaultPasoClashes(80, 60)).toEqual([40, 80]);
    expect(computeDefaultPasoClashes(95, 60)).toEqual([40, 80]);
    expect(computeDefaultPasoClashes(60, 60)).toEqual([40]);
  });

  it("piste très courte : resserre en phrases entières", () => {
    // 30 s à 60 MPM = 3 phrases → une phrase par clash.
    expect(computeDefaultPasoClashes(30, 60)).toEqual([8, 16, 24]);
  });

  it("tempo inconnu → 60 MPM de référence", () => {
    expect(computeDefaultPasoClashes(150)).toEqual([40, 80, 120]);
    expect(computeDefaultPasoClashes(150, 0)).toEqual([40, 80, 120]);
  });

  it("jamais plus de 3 clashs", () => {
    expect(computeDefaultPasoClashes(300, 60, 5)).toHaveLength(
      PASO_MAX_CLASHES,
    );
  });

  it("durée invalide ou trop courte → liste vide", () => {
    expect(computeDefaultPasoClashes(0)).toEqual([]);
    expect(computeDefaultPasoClashes(-5)).toEqual([]);
    expect(computeDefaultPasoClashes(NaN)).toEqual([]);
    expect(computeDefaultPasoClashes(10, 60)).toEqual([]);
  });

  it("aucun appel demandé → liste vide", () => {
    expect(computeDefaultPasoClashes(120, 60, 0)).toEqual([]);
  });
});

describe("getEffectiveClashes", () => {
  it("non-paso → aucun appel même si des valeurs existent", () => {
    expect(getEffectiveClashes("Rumba", [10, 20], 120)).toEqual([]);
  });

  it("paso avec valeurs admin → toutes ces valeurs, triées (2 ou 3)", () => {
    expect(getEffectiveClashes("Paso Doble", [50, 10], 120)).toEqual([10, 50]);
    expect(getEffectiveClashes("Paso Doble", [50, 10, 30], 120)).toEqual([
      10, 30, 50,
    ]);
  });

  it("paso sans valeurs → estimation depuis le tempo", () => {
    expect(getEffectiveClashes("Paso Doble", [], 150, 60)).toEqual([
      40, 80, 120,
    ]);
    expect(getEffectiveClashes("Paso Doble", undefined, 150, 60, 2)).toEqual([
      40, 80,
    ]);
  });
});

describe("storedPasoClashCount", () => {
  it("compte les clashs renseignés d'un paso", () => {
    expect(storedPasoClashCount("Paso Doble", [40, 80, 120])).toBe(3);
    expect(storedPasoClashCount("Paso Doble", [40, 80])).toBe(2);
    expect(storedPasoClashCount("Paso Doble", [40])).toBe(1);
  });

  it("0 pour un paso sans clash saisi", () => {
    expect(storedPasoClashCount("Paso Doble", [])).toBe(0);
    expect(storedPasoClashCount("Paso Doble", undefined)).toBe(0);
  });

  it("null pour une autre danse", () => {
    expect(storedPasoClashCount("Rumba", [40])).toBeNull();
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
