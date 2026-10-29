import type { CompetitionProgramDto } from "../../../../api/generated/types.gen";
import {
  buildProgramPayload,
  eventsFromProgram,
  scheduleFromProgram,
} from "../competitionProgram";
import { levelsForAgeGroup } from "../useClubCompetitionEditorLogic.types";

const program: CompetitionProgramDto = {
  competitionId: "comp-1",
  syncedFromFfd: false,
  eventsSource: null,
  programEditedAt: null,
  events: [
    {
      id: "ev-solo",
      eventKind: "CLASSIFICATRICE",
      eventType: "SOLO",
      category: "Latin",
      ageGroup: "Solo Youth",
      ageGroups: [],
      level: "Avancé",
      openLevels: [],
      locked: false,
      resultCount: 0,
    },
  ],
  schedule: [
    {
      id: "legacy",
      startTime: "14:30",
      durationMinutes: null,
      type: "COMPETITION",
      title: "Créneau d'avant #442",
      eventId: null,
    },
  ],
};

describe("competitionProgram (#442)", () => {
  it("maps API events onto the editor and back unchanged", () => {
    const events = eventsFromProgram(program);
    expect(events).toEqual([
      {
        id: "ev-solo",
        type: "Solo",
        category: "Latin",
        ageGroup: "Solo Youth",
        kind: "CLASSIFICATRICE",
        level: "Avancé",
        persisted: true,
        locked: false,
      },
    ]);
    expect(buildProgramPayload(events, []).events).toEqual([
      {
        id: "ev-solo",
        eventKind: "CLASSIFICATRICE",
        eventType: "SOLO",
        category: "Latin",
        ageGroup: "Solo Youth",
        ageGroups: [],
        level: "Avancé",
        openLevels: [],
      },
    ]);
  });

  it("reads a slot saved before #442 (unknown type, no duration)", () => {
    expect(scheduleFromProgram(program)).toEqual([
      {
        id: "legacy",
        startTime: "14:30",
        type: "OTHER",
        title: "Créneau d'avant #442",
        duration: 0,
        persisted: true,
      },
    ]);
  });

  it("sends new slots without id and whole minutes", () => {
    expect(
      buildProgramPayload(
        [],
        [
          {
            id: "1700000000000",
            startTime: "10:00",
            type: "BREAK",
            title: "Pause",
            duration: 12.6,
          },
        ],
      ).schedule,
    ).toEqual([
      {
        startTime: "10:00",
        durationMinutes: 13,
        type: "BREAK",
        title: "Pause",
      },
    ]);
  });

  it("knows the levels of each age class (table Niveaux)", () => {
    expect(levelsForAgeGroup("Adulte")).not.toContain("Débutant");
    expect(levelsForAgeGroup("Senior III")).toContain("Débutant");
    expect(levelsForAgeGroup("Solo Juvénile")).toEqual([
      "Intermédiaire",
      "Débutant",
    ]);
    expect(levelsForAgeGroup("Inconnue")).toEqual([]);
  });
});
