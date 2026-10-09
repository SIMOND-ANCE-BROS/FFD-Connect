import {
  getAgeAtReferenceDate,
  getReferenceYear,
  computeSoloAgeGroup,
  computeCoupleAgeGroup,
  isCoupleEspoirEligible,
  getAllowedLevelsForAgeGroup,
  COMPETITION_LEVELS,
} from "./age-group.util";

describe("age-group.util", () => {
  const refYear = 2025;

  describe("getAgeAtReferenceDate", () => {
    it("calcule l’âge au 31 décembre de l’année de référence", () => {
      expect(getAgeAtReferenceDate(new Date(2010, 0, 1), refYear)).toBe(15);
      expect(getAgeAtReferenceDate(new Date(2010, 11, 31), refYear)).toBe(15);
      expect(getAgeAtReferenceDate(new Date(2011, 0, 1), refYear)).toBe(14);
      expect(getAgeAtReferenceDate(new Date(2005, 5, 15), refYear)).toBe(20);
    });

    it("retourne 0 si né après le 31/12", () => {
      expect(getAgeAtReferenceDate(new Date(2026, 0, 1), refYear)).toBe(0);
    });
  });

  describe("getReferenceYear", () => {
    it("retourne l’année en cours si pas de date", () => {
      const y = getReferenceYear();
      expect(y).toBe(new Date().getFullYear());
    });

    it("retourne l’année de la date fournie", () => {
      expect(getReferenceYear(new Date(2024, 5, 1))).toBe(2024);
      expect(getReferenceYear(new Date(2026, 0, 1))).toBe(2026);
    });
  });

  describe("computeSoloAgeGroup", () => {
    it("retourne null sans birthDate", () => {
      expect(computeSoloAgeGroup(null, refYear)).toBeNull();
      expect(computeSoloAgeGroup(undefined, refYear)).toBeNull();
    });

    it("applique les seuils Solo (Article 5 LES SOLOS)", () => {
      // Solo Juvénile : 11 ans ou moins
      expect(computeSoloAgeGroup(new Date(2014, 5, 1), refYear)).toBe(
        "Solo Juvénile",
      );
      // Solo Junior 1 : 13 ans ou moins
      expect(computeSoloAgeGroup(new Date(2012, 5, 1), refYear)).toBe(
        "Solo Junior 1",
      );
      // Solo Junior 2 : 15 ans ou moins
      expect(computeSoloAgeGroup(new Date(2010, 5, 1), refYear)).toBe(
        "Solo Junior 2",
      );
      // Solo Youth : 18 ans ou moins
      expect(computeSoloAgeGroup(new Date(2007, 5, 1), refYear)).toBe(
        "Solo Youth",
      );
      // Solo Adulte : 19–29
      expect(computeSoloAgeGroup(new Date(2000, 5, 1), refYear)).toBe(
        "Solo Adulte",
      );
      // Solo Senior : 30 ans ou plus
      expect(computeSoloAgeGroup(new Date(1990, 5, 1), refYear)).toBe(
        "Solo Senior",
      );
    });
  });

  describe("computeCoupleAgeGroup", () => {
    it("retourne null si une date manque", () => {
      expect(
        computeCoupleAgeGroup(null, new Date(2000, 0, 1), refYear),
      ).toBeNull();
      expect(
        computeCoupleAgeGroup(new Date(2000, 0, 1), null, refYear),
      ).toBeNull();
    });

    it("utilise le plus âgé des deux pour les classes avant Senior", () => {
      // Juvénile I : plus âgé <= 9
      expect(
        computeCoupleAgeGroup(
          new Date(2016, 0, 1),
          new Date(2018, 0, 1),
          refYear,
        ),
      ).toBe("Juvénile I");
      // Juvénile II : plus âgé <= 11
      expect(
        computeCoupleAgeGroup(
          new Date(2014, 0, 1),
          new Date(2016, 0, 1),
          refYear,
        ),
      ).toBe("Juvénile II");
      // Junior I : 12–13
      expect(
        computeCoupleAgeGroup(
          new Date(2012, 0, 1),
          new Date(2013, 0, 1),
          refYear,
        ),
      ).toBe("Junior I");
      // Junior II : 14–15
      expect(
        computeCoupleAgeGroup(
          new Date(2010, 0, 1),
          new Date(2011, 0, 1),
          refYear,
        ),
      ).toBe("Junior II");
      // Youth : 16–18
      expect(
        computeCoupleAgeGroup(
          new Date(2007, 0, 1),
          new Date(2009, 0, 1),
          refYear,
        ),
      ).toBe("Youth");
      // Adulte : 19+ (hors Senior)
      expect(
        computeCoupleAgeGroup(
          new Date(2000, 0, 1),
          new Date(2002, 0, 1),
          refYear,
        ),
      ).toBe("Adulte");
    });

    it("applique les conditions Senior (plus âgé et plus jeune)", () => {
      // Senior I : 35+ et 30+
      expect(
        computeCoupleAgeGroup(
          new Date(1988, 0, 1),
          new Date(1992, 0, 1),
          refYear,
        ),
      ).toBe("Senior I");
      // Senior II : 45+ et 40+
      expect(
        computeCoupleAgeGroup(
          new Date(1978, 0, 1),
          new Date(1982, 0, 1),
          refYear,
        ),
      ).toBe("Senior II");
      // Senior V : 70+ pour les deux
      expect(
        computeCoupleAgeGroup(
          new Date(1950, 0, 1),
          new Date(1952, 0, 1),
          refYear,
        ),
      ).toBe("Senior V");
    });

    it("inverse automatiquement si l’ordre des dates est inversé", () => {
      expect(
        computeCoupleAgeGroup(
          new Date(2018, 0, 1),
          new Date(2016, 0, 1),
          refYear,
        ),
      ).toBe("Juvénile I");
    });
  });

  describe("getAllowedLevelsForAgeGroup", () => {
    it("retourne un tableau vide pour une classe d’âge vide ou inconnue", () => {
      expect(getAllowedLevelsForAgeGroup("COUPLE", "")).toEqual([]);
      expect(getAllowedLevelsForAgeGroup("SOLO", "  ")).toEqual([]);
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Inconnu")).toEqual([]);
    });

    it("retourne les niveaux autorisés pour les couples (table Niveaux)", () => {
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Juvénile I")).toEqual([
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Junior I")).toEqual([
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Adulte")).toEqual([
        "International",
        "Avancé",
        "Intermédiaire",
      ]);
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Senior III")).toEqual([
        "International",
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Senior V")).toEqual([
        "International",
        "Avancé",
        "Intermédiaire",
      ]);
    });

    it("retourne les niveaux autorisés pour les solos (table Niveaux)", () => {
      expect(getAllowedLevelsForAgeGroup("SOLO", "Solo Juvénile")).toEqual([
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("SOLO", "Solo Junior 1")).toEqual([
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("SOLO", "Solo Adulte")).toEqual([
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
      expect(getAllowedLevelsForAgeGroup("SOLO", "Solo Senior")).toEqual([
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
    });
  });

  describe("COMPETITION_LEVELS", () => {
    it("contient les 4 niveaux du règlement", () => {
      expect(COMPETITION_LEVELS).toEqual([
        "International",
        "Avancé",
        "Intermédiaire",
        "Débutant",
      ]);
    });
  });

  describe("computeSoloAgeGroup — exact threshold boundaries", () => {
    const refYear = 2025;
    // birthForAge(n) produces a date that results in exactly n years old at 31 Dec 2025
    const birthForAge = (age: number) => new Date(refYear - age, 0, 1);

    it("age 11 → Solo Juvénile (upper boundary of Juvénile)", () => {
      expect(computeSoloAgeGroup(birthForAge(11), refYear)).toBe(
        "Solo Juvénile",
      );
    });

    it("age 12 → Solo Junior 1 (lower boundary of Junior 1)", () => {
      expect(computeSoloAgeGroup(birthForAge(12), refYear)).toBe(
        "Solo Junior 1",
      );
    });

    it("age 13 → Solo Junior 1 (upper boundary of Junior 1)", () => {
      expect(computeSoloAgeGroup(birthForAge(13), refYear)).toBe(
        "Solo Junior 1",
      );
    });

    it("age 14 → Solo Junior 2 (lower boundary of Junior 2)", () => {
      expect(computeSoloAgeGroup(birthForAge(14), refYear)).toBe(
        "Solo Junior 2",
      );
    });

    it("age 15 → Solo Junior 2 (upper boundary of Junior 2)", () => {
      expect(computeSoloAgeGroup(birthForAge(15), refYear)).toBe(
        "Solo Junior 2",
      );
    });

    it("age 16 → Solo Youth (lower boundary of Youth)", () => {
      expect(computeSoloAgeGroup(birthForAge(16), refYear)).toBe("Solo Youth");
    });

    it("age 18 → Solo Youth (upper boundary of Youth)", () => {
      expect(computeSoloAgeGroup(birthForAge(18), refYear)).toBe("Solo Youth");
    });

    it("age 19 → Solo Adulte (lower boundary of Adulte)", () => {
      expect(computeSoloAgeGroup(birthForAge(19), refYear)).toBe("Solo Adulte");
    });

    it("age 29 → Solo Adulte (upper boundary of Adulte)", () => {
      expect(computeSoloAgeGroup(birthForAge(29), refYear)).toBe("Solo Adulte");
    });

    it("age 30 → Solo Senior (lower boundary of Senior)", () => {
      expect(computeSoloAgeGroup(birthForAge(30), refYear)).toBe("Solo Senior");
    });
  });

  describe("computeCoupleAgeGroup — exact threshold boundaries", () => {
    const refYear = 2025;
    const birthForAge = (age: number) => new Date(refYear - age, 0, 1);

    it("older=9, younger=8 → Juvénile I (upper boundary of Juvénile I)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(9), birthForAge(8), refYear),
      ).toBe("Juvénile I");
    });

    it("older=10, younger=8 → Juvénile II (lower boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(10), birthForAge(8), refYear),
      ).toBe("Juvénile II");
    });

    it("older=11, younger=9 → Juvénile II (upper boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(11), birthForAge(9), refYear),
      ).toBe("Juvénile II");
    });

    it("older=12, younger=10 → Junior I (lower boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(12), birthForAge(10), refYear),
      ).toBe("Junior I");
    });

    it("older=14, younger=12 → Junior II (lower boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(14), birthForAge(12), refYear),
      ).toBe("Junior II");
    });

    it("older=16, younger=14 → Youth (lower boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(16), birthForAge(14), refYear),
      ).toBe("Youth");
    });

    it("older=19, younger=18 → Adulte (lower boundary)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(19), birthForAge(18), refYear),
      ).toBe("Adulte");
    });

    it("both partners same age (25) → Adulte", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(25), birthForAge(25), refYear),
      ).toBe("Adulte");
    });

    it("both partners same age (35) → Senior I (both 35 ≥ 35 and 35 ≥ 30)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(35), birthForAge(35), refYear),
      ).toBe("Senior I");
    });

    it("Senior I: older=35, younger=30 (both meet threshold)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(35), birthForAge(30), refYear),
      ).toBe("Senior I");
    });

    it("Senior I miss: older=34 → Adulte (older does not meet 35 threshold)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(34), birthForAge(30), refYear),
      ).toBe("Adulte");
    });

    it("Senior I miss: younger=29 → Adulte (younger does not meet 30 threshold)", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(35), birthForAge(29), refYear),
      ).toBe("Adulte");
    });

    it("Senior II: older=45, younger=40", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(45), birthForAge(40), refYear),
      ).toBe("Senior II");
    });

    it("Senior II miss: younger=39 → Senior I", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(45), birthForAge(39), refYear),
      ).toBe("Senior I");
    });

    it("Senior III: older=55, younger=50", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(55), birthForAge(50), refYear),
      ).toBe("Senior III");
    });

    it("Senior IV: older=65, younger=60", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(65), birthForAge(60), refYear),
      ).toBe("Senior IV");
    });

    it("Senior V: older=70, younger=70", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(70), birthForAge(70), refYear),
      ).toBe("Senior V");
    });

    it("Senior V miss: younger=69 → Senior IV", () => {
      expect(
        computeCoupleAgeGroup(birthForAge(70), birthForAge(69), refYear),
      ).toBe("Senior IV");
    });
  });

  describe("Espoir (under 21)", () => {
    it("accepts a couple whose older partner is 20 at most on Dec 31", () => {
      expect(
        isCoupleEspoirEligible(
          new Date(2006, 5, 1),
          new Date(2008, 0, 1),
          2026,
        ),
      ).toBe(true);
    });

    it("rejects a couple whose older partner turns 21", () => {
      expect(
        isCoupleEspoirEligible(
          new Date(2008, 0, 1),
          new Date(2005, 11, 31),
          2026,
        ),
      ).toBe(false);
    });

    it("allows the same levels as Adulte", () => {
      expect(getAllowedLevelsForAgeGroup("COUPLE", "Espoir")).toEqual(
        getAllowedLevelsForAgeGroup("COUPLE", "Adulte"),
      );
    });
  });
});
