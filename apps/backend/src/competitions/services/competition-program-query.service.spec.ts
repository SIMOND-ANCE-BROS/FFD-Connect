import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import type { PrismaService } from "../../prisma/prisma.service";
import { CompetitionProgramQueryService } from "./competition-program-query.service";

describe("CompetitionProgramQueryService (#442)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: CompetitionProgramQueryService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new CompetitionProgramQueryService(
      prisma as unknown as PrismaService,
    );
  });

  it("returns 404 for an unknown competition", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);

    await expect(service.getProgram("nope")).rejects.toThrow(NotFoundException);
    expect(prisma.event.findMany).not.toHaveBeenCalled();
  });

  it("returns the programme in the editor's shape, bounded and in entry order", async () => {
    const editedAt = new Date("2026-10-15T08:00:00.000Z");
    prisma.competition.findUnique.mockResolvedValue({
      id: "comp-1",
      date: new Date("2026-06-13T00:00:00.000Z"),
      competitionType: "NATIONALE",
      ffdId: "/api/competitions/9",
      eventsSource: null,
      programEditedAt: editedAt,
    } as never);
    prisma.event.findMany.mockResolvedValue([
      {
        id: "ev-1",
        eventKind: "OPEN",
        eventType: "COUPLE",
        category: "Latin",
        ageGroup: "Youth",
        ageGroups: ["Youth", "Adulte"],
        level: null,
        openLevels: ["Débutant"],
        position: 0,
        _count: { registrations: 0, results: 0 },
      },
      {
        id: "ev-2",
        eventKind: null,
        eventType: "COUPLE",
        category: "Standard",
        ageGroup: "Adult",
        ageGroups: [],
        level: null,
        openLevels: [],
        position: null,
        _count: { registrations: 0, results: 4 },
      },
    ] as never);
    prisma.scheduleItem.findMany.mockResolvedValue([
      {
        id: "slot-1",
        startTime: new Date("2026-06-13T08:00:00.000Z"),
        startClock: "10:00",
        durationMinutes: 15,
        type: "ROUND",
        title: "Finale",
        eventId: null,
      },
      {
        // saved before #442: no clock, no duration
        id: "slot-0",
        startTime: new Date("2026-06-13T12:30:00.000Z"),
        startClock: null,
        durationMinutes: null,
        type: "OTHER",
        title: "Remise des prix",
        eventId: "ev-2",
      },
    ] as never);

    await expect(service.getProgram("comp-1")).resolves.toEqual({
      competitionId: "comp-1",
      syncedFromFfd: true,
      eventsSource: null,
      programEditedAt: editedAt,
      events: [
        {
          id: "ev-1",
          eventKind: "OPEN",
          eventType: "COUPLE",
          category: "Latin",
          ageGroup: "Youth",
          ageGroups: ["Youth", "Adulte"],
          level: null,
          openLevels: ["Débutant"],
          locked: false,
          resultCount: 0,
        },
        {
          id: "ev-2",
          eventKind: null,
          eventType: "COUPLE",
          category: "Standard",
          ageGroup: "Adult",
          ageGroups: [],
          level: null,
          openLevels: [],
          locked: true,
          resultCount: 4,
        },
      ],
      schedule: [
        {
          id: "slot-1",
          startTime: "10:00",
          durationMinutes: 15,
          type: "ROUND",
          title: "Finale",
          eventId: null,
        },
        {
          id: "slot-0",
          startTime: "14:30",
          durationMinutes: null,
          type: "OTHER",
          title: "Remise des prix",
          eventId: "ev-2",
        },
      ],
    });

    const eventsQuery = prisma.event.findMany.mock.calls[0][0];
    expect(eventsQuery?.where).toEqual({ competitionId: "comp-1" });
    expect(eventsQuery?.take).toBe(1000);
    expect(eventsQuery?.orderBy).toEqual(
      expect.arrayContaining([{ position: { sort: "asc", nulls: "last" } }]),
    );
    expect(prisma.scheduleItem.findMany.mock.calls[0][0]?.take).toBe(1000);
  });
});
