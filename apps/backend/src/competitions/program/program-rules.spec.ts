import {
  ProgramRuleError,
  SOLO_TEAM_CATEGORY,
  ageGroupsForEvent,
  normalizeProgramEvent,
  programEventLabel,
  type ProgramEventInput,
} from "./program-rules";

const classificatrice = (
  overrides: Partial<ProgramEventInput> = {},
): ProgramEventInput => ({
  eventKind: "CLASSIFICATRICE",
  eventType: "COUPLE",
  category: "Latine",
  ageGroup: "Adulte",
  level: "Intermédiaire",
  ...overrides,
});

const expectRule = (
  input: ProgramEventInput,
  message: RegExp,
  competitionType: Parameters<typeof normalizeProgramEvent>[1] = null,
) => {
  expect(() => normalizeProgramEvent(input, competitionType)).toThrow(
    ProgramRuleError,
  );
  expect(() => normalizeProgramEvent(input, competitionType)).toThrow(message);
};

describe("program rules (#442)", () => {
  describe("ageGroupsForEvent", () => {
    it("offers the couple classes plus Espoir, without Senior V in Latin", () => {
      const latin = ageGroupsForEvent("COUPLE", "Latin");
      expect(latin).toContain("Espoir");
      expect(latin).toContain("Senior IV");
      expect(latin).not.toContain("Senior V");
      expect(ageGroupsForEvent("COUPLE", "Standard")).toContain("Senior V");
    });

    it("offers the solo classes (no Espoir) for a solo event", () => {
      const solo = ageGroupsForEvent("SOLO", "Latin");
      expect(solo).toContain("Solo Youth");
      expect(solo).not.toContain("Espoir");
      expect(solo).not.toContain("Adulte");
    });
  });

  describe("normalizeProgramEvent", () => {
    it("stores the canonical discipline of a classificatrice", () => {
      expect(normalizeProgramEvent(classificatrice(), "NATIONALE")).toEqual({
        eventKind: "CLASSIFICATRICE",
        eventType: "COUPLE",
        category: "Latin",
        ageGroup: "Adulte",
        ageGroups: [],
        level: "Intermédiaire",
        openLevels: [],
      });
    });

    it("requires a nature", () => {
      expectRule(classificatrice({ eventKind: null }), /nature/);
      expectRule(classificatrice({ eventKind: undefined }), /nature/);
    });

    it("refuses a nature the competition type does not allow", () => {
      expectRule(
        classificatrice({ eventKind: "MAJEURE", level: null }),
        /majeure n'est pas possible dans une compétition de proximité/,
        "PROXIMITE",
      );
    });

    it("refuses an unknown discipline", () => {
      expectRule(classificatrice({ category: "Salsa" }), /spécialité inconnue/);
    });

    it("keeps 10 danses for majeure events, without level", () => {
      expectRule(classificatrice({ category: "10 danses" }), /10 danses/);
      expect(
        normalizeProgramEvent(
          {
            eventKind: "MAJEURE",
            eventType: "COUPLE",
            category: "10 danses",
            ageGroup: "Adulte",
          },
          "MAJEURE",
        ),
      ).toMatchObject({ category: "Ten Dance", level: null });
      expectRule(
        {
          eventKind: "MAJEURE",
          eventType: "COUPLE",
          category: "Ten Dance",
          ageGroup: "Adulte",
          level: "Avancé",
        },
        /n'a pas de niveau/,
      );
    });

    it("accepts Espoir as a couple event and refuses it in solo", () => {
      expect(
        normalizeProgramEvent(
          classificatrice({ ageGroup: "Espoir", level: "Avancé" }),
          null,
        ),
      ).toMatchObject({ ageGroup: "Espoir" });
      expectRule(
        classificatrice({ eventType: "SOLO", ageGroup: "Espoir" }),
        /n'existe pas/,
      );
    });

    it("refuses Senior V in Latin, accepts it in Standard", () => {
      expectRule(
        classificatrice({ ageGroup: "Senior V", level: "Avancé" }),
        /Senior V/,
      );
      expect(
        normalizeProgramEvent(
          classificatrice({
            category: "Standard",
            ageGroup: "Senior V",
            level: "Avancé",
          }),
          null,
        ),
      ).toMatchObject({ category: "Standard", ageGroup: "Senior V" });
    });

    it("requires an age class", () => {
      expectRule(
        classificatrice({ ageGroup: " " }),
        /classe d'âge est requise/,
      );
    });

    it("requires a level on a classificatrice, from the Niveaux table", () => {
      expectRule(classificatrice({ level: null }), /a un niveau/);
      // Adulte: International, Avancé, Intermédiaire — no Débutant
      expectRule(
        classificatrice({ level: "Débutant" }),
        /niveau Débutant n'existe pas en Adulte/,
      );
      expect(
        normalizeProgramEvent(
          classificatrice({
            eventType: "SOLO",
            ageGroup: "Solo Juvénile",
            level: "Débutant",
          }),
          null,
        ),
      ).toMatchObject({ ageGroup: "Solo Juvénile", level: "Débutant" });
    });

    it("limits proximity classificatrices to Débutant / Intermédiaire", () => {
      expectRule(
        classificatrice({ level: "Avancé" }),
        /proximité/,
        "PROXIMITE",
      );
    });

    it("stores an Open's age classes and level restriction", () => {
      expect(
        normalizeProgramEvent(
          {
            eventKind: "OPEN",
            eventType: "COUPLE",
            category: "Standards",
            ageGroups: ["Youth", "Adulte", "Youth"],
            openLevels: ["Débutant", "Intermédiaire"],
          },
          "PROXIMITE",
        ),
      ).toEqual({
        eventKind: "OPEN",
        eventType: "COUPLE",
        category: "Standard",
        ageGroup: "Youth",
        ageGroups: ["Youth", "Adulte"],
        level: null,
        openLevels: ["Débutant", "Intermédiaire"],
      });
    });

    it("validates an Open's classes and levels", () => {
      const open: ProgramEventInput = {
        eventKind: "OPEN",
        eventType: "COUPLE",
        category: "Latin",
      };
      expectRule(open, /au moins une classe d'âge/);
      expectRule({ ...open, ageGroups: ["Solo Youth"] }, /n'existe pas/);
      expectRule(
        { ...open, ageGroups: ["Adulte"], openLevels: ["Expert"] },
        /niveau inconnu/,
      );
      expectRule(
        { ...open, ageGroups: ["Adulte"], level: "Avancé" },
        /Open n'a pas de niveau/,
      );
    });

    it("keeps Open-only fields off the other natures", () => {
      expectRule(
        classificatrice({ ageGroups: ["Adulte", "Youth"] }),
        /qu'aux épreuves Open/,
      );
      expectRule(
        classificatrice({ openLevels: ["Avancé"] }),
        /qu'aux épreuves Open/,
      );
    });

    it("stores a Solo Team event under its own category", () => {
      expect(
        normalizeProgramEvent(
          {
            eventKind: "SOLO_TEAM",
            eventType: "SOLO",
            category: "anything",
            ageGroup: "Junior",
            level: "Débutant",
          },
          "PROXIMITE",
        ),
      ).toEqual({
        eventKind: "SOLO_TEAM",
        eventType: "SOLO",
        category: SOLO_TEAM_CATEGORY,
        ageGroup: "Junior",
        ageGroups: [],
        level: "Débutant",
        openLevels: [],
      });
    });

    it("validates a Solo Team event", () => {
      const team: ProgramEventInput = {
        eventKind: "SOLO_TEAM",
        eventType: "SOLO",
        category: SOLO_TEAM_CATEGORY,
        ageGroup: "Adulte",
        level: "Intermédiaire",
      };
      expectRule({ ...team, eventType: "COUPLE" }, /épreuve solo/);
      expectRule({ ...team, level: "Avancé" }, /Débutant ou Intermédiaire/);
      expectRule({ ...team, ageGroup: "Youth" }, /n'existe pas/);
      expectRule({ ...team, ageGroups: ["Adulte"] }, /qu'aux épreuves Open/);
    });

    it("keeps Show danse a couple event without level", () => {
      const show: ProgramEventInput = {
        eventKind: "SHOW_DANSE",
        eventType: "COUPLE",
        category: "Latin",
        ageGroup: "Junior I",
      };
      expect(normalizeProgramEvent(show, null)).toMatchObject({
        eventKind: "SHOW_DANSE",
        level: null,
      });
      expectRule({ ...show, eventType: "SOLO" }, /épreuve couple/);
      expectRule({ ...show, level: "Avancé" }, /Show danse n'a pas de niveau/);
    });

    it("accepts an empty level on a nature without level", () => {
      expect(
        normalizeProgramEvent(
          {
            eventKind: "MAJEURE",
            eventType: "COUPLE",
            category: "Latin",
            ageGroup: "Adulte",
            level: " ",
          },
          null,
        ),
      ).toMatchObject({ level: null });
    });
  });

  describe("programEventLabel", () => {
    it("names an event in French", () => {
      expect(
        programEventLabel({
          category: "Latin",
          ageGroup: "Adulte",
          level: "Avancé",
        }),
      ).toBe("Latines Adulte Avancé");
      expect(
        programEventLabel({
          category: "Standard",
          ageGroup: "Youth",
          ageGroups: ["Youth", "Adulte"],
          level: null,
        }),
      ).toBe("Standards Youth, Adulte");
    });
  });
});
