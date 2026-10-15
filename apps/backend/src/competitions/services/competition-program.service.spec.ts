import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import type { PrismaService } from "../../prisma/prisma.service";
import type {
  CompetitionProgramDto,
  ProgramEventInputDto,
  ReplaceCompetitionProgramDto,
} from "../dto/competition-program.dto";
import type { CompetitionCacheService } from "./competition-cache.service";
import type { CompetitionProgramQueryService } from "./competition-program-query.service";
import { CompetitionProgramService } from "./competition-program.service";

const COMPETITION_ID = "comp-1";

const competition = {
  id: COMPETITION_ID,
  date: new Date("2026-06-13T00:00:00.000Z"),
  competitionType: "NATIONALE" as const,
  ffdId: null,
  eventsSource: null,
  programEditedAt: null,
};

type StoredEvent = {
  id: string;
  eventKind: "CLASSIFICATRICE" | "OPEN" | "MAJEURE" | null;
  eventType: "COUPLE" | "SOLO";
  category: string;
  ageGroup: string;
  ageGroups: string[];
  level: string | null;
  openLevels: string[];
  position: number | null;
  _count: { registrations: number; results: number };
};

const storedEvent = (overrides: Partial<StoredEvent> = {}): StoredEvent => ({
  id: "ev-1",
  eventKind: "CLASSIFICATRICE",
  eventType: "COUPLE",
  category: "Latin",
  ageGroup: "Adulte",
  ageGroups: [],
  level: "Avancé",
  openLevels: [],
  position: 0,
  _count: { registrations: 0, results: 0 },
  ...overrides,
});

/** The stored event sent back unchanged by the editor. */
const echo = (event: StoredEvent): ProgramEventInputDto => ({
  id: event.id,
  eventKind: event.eventKind,
  eventType: event.eventType,
  category: event.category,
  ageGroup: event.ageGroup,
  ageGroups: event.ageGroups,
  level: event.level,
  openLevels: event.openLevels,
});

const newClassificatrice: ProgramEventInputDto = {
  eventKind: "CLASSIFICATRICE",
  eventType: "COUPLE",
  category: "Standards",
  ageGroup: "Youth",
  level: "Débutant",
};

const program: CompetitionProgramDto = {
  competitionId: COMPETITION_ID,
  syncedFromFfd: false,
  eventsSource: null,
  programEditedAt: new Date(),
  events: [],
  schedule: [],
};

describe("CompetitionProgramService (#442)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let cache: { invalidateCompetition: jest.Mock };
  let query: { getProgram: jest.Mock };
  let service: CompetitionProgramService;

  const given = (events: StoredEvent[], scheduleIds: string[] = []): void => {
    prisma.competition.findUnique.mockResolvedValue(competition as never);
    prisma.event.findMany.mockResolvedValue(events as never);
    prisma.scheduleItem.findMany.mockResolvedValue(
      scheduleIds.map((id) => ({ id })) as never,
    );
  };

  const save = (body: Partial<ReplaceCompetitionProgramDto>) =>
    service.replaceProgram(COMPETITION_ID, {
      events: [],
      schedule: [],
      ...body,
    });

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    cache = { invalidateCompetition: jest.fn().mockResolvedValue(undefined) };
    query = { getProgram: jest.fn().mockResolvedValue(program) };
    service = new CompetitionProgramService(
      prisma as unknown as PrismaService,
      cache as unknown as CompetitionCacheService,
      query as unknown as CompetitionProgramQueryService,
    );
  });

  it("creates new events in the entered order and returns the stored programme", async () => {
    given([]);

    await expect(
      save({
        events: [
          newClassificatrice,
          {
            eventKind: "OPEN",
            eventType: "COUPLE",
            category: "Latine",
            ageGroups: ["Youth", "Adulte"],
            openLevels: [],
          },
        ],
      }),
    ).resolves.toBe(program);

    expect(prisma.event.create).toHaveBeenNthCalledWith(1, {
      data: {
        eventKind: "CLASSIFICATRICE",
        eventType: "COUPLE",
        category: "Standard",
        ageGroup: "Youth",
        ageGroups: [],
        level: "Débutant",
        openLevels: [],
        competitionId: COMPETITION_ID,
        position: 0,
      },
      select: { id: true },
    });
    expect(prisma.event.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        eventKind: "OPEN",
        category: "Latin",
        ageGroup: "Youth",
        ageGroups: ["Youth", "Adulte"],
        position: 1,
      }) as unknown,
      select: { id: true },
    });
    expect(prisma.competition.update).toHaveBeenCalledWith({
      where: { id: COMPETITION_ID },
      data: {
        programEditedAt: expect.any(Date) as unknown,
        eventsSource: null,
      },
      select: { id: true },
    });
    expect(cache.invalidateCompetition).toHaveBeenCalledWith(COMPETITION_ID);
    expect(query.getProgram).toHaveBeenCalledWith(COMPETITION_ID);
  });

  it("does not rewrite an event sent back unchanged at the same place", async () => {
    const stored = storedEvent();
    given([stored]);

    await save({ events: [echo(stored)] });

    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.event.create).not.toHaveBeenCalled();
    expect(prisma.event.deleteMany).not.toHaveBeenCalled();
  });

  it("only moves an unchanged event, without validating it (FFD import)", async () => {
    // Imported from the FFD: no nature, legacy class — invalid as new input.
    const imported = storedEvent({
      id: "ev-ffd",
      eventKind: null,
      ageGroup: "Adult",
      level: null,
      position: null,
      _count: { registrations: 3, results: 0 },
    });
    given([imported]);

    await save({ events: [echo(imported)] });

    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: "ev-ffd" },
      data: { position: 0 },
      select: { id: true },
    });
  });

  it("updates a changed event without registrations", async () => {
    const stored = storedEvent();
    given([stored]);

    await save({ events: [{ ...echo(stored), level: "International" }] });

    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: "ev-1" },
      data: expect.objectContaining({
        level: "International",
        position: 0,
      }) as unknown,
      select: { id: true },
    });
  });

  it("refuses to change an event that has registrations (409, nothing written)", async () => {
    const stored = storedEvent({ _count: { registrations: 1, results: 0 } });
    given([stored]);

    await expect(
      save({ events: [{ ...echo(stored), level: "International" }] }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.event.update).not.toHaveBeenCalled();
    expect(prisma.competition.update).not.toHaveBeenCalled();
    expect(cache.invalidateCompetition).not.toHaveBeenCalled();
  });

  it("deletes the events left out and unlinks their schedule slots", async () => {
    const kept = storedEvent();
    const removed = storedEvent({ id: "ev-2", ageGroup: "Youth" });
    given([kept, removed]);

    await save({ events: [echo(kept)] });

    expect(prisma.scheduleItem.updateMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["ev-2"] } },
      data: { eventId: null },
    });
    expect(prisma.event.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ev-2"] } },
    });
  });

  it("never deletes an event with registrations or results: 409 naming it", async () => {
    const registered = storedEvent({
      id: "ev-2",
      ageGroup: "Youth",
      _count: { registrations: 0, results: 2 },
    });
    given([storedEvent(), registered]);

    const attempt = save({ events: [echo(storedEvent())] });

    await expect(attempt).rejects.toThrow(ConflictException);
    await expect(attempt).rejects.toThrow(/« Latines Youth Avancé »/);
    expect(prisma.event.deleteMany).not.toHaveBeenCalled();
    expect(prisma.competition.update).not.toHaveBeenCalled();
  });

  it("names every locked event in the refusal", async () => {
    given([
      storedEvent({ _count: { registrations: 1, results: 0 } }),
      storedEvent({
        id: "ev-2",
        ageGroup: "Youth",
        _count: { registrations: 1, results: 0 },
      }),
    ]);

    await expect(save({ events: [] })).rejects.toThrow(
      /ces épreuves « Latines Adulte Avancé », « Latines Youth Avancé »/,
    );
  });

  it("turns a registration racing the delete into a 409", async () => {
    given([storedEvent()]);
    prisma.event.deleteMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", {
        code: "P2003",
        clientVersion: "7",
      }),
    );

    await expect(save({ events: [] })).rejects.toThrow(
      /vient de recevoir une inscription/,
    );
  });

  it("lets other errors through", async () => {
    given([]);
    prisma.competition.update.mockRejectedValue(new Error("db down"));

    await expect(save({})).rejects.toThrow("db down");
  });

  it("refuses an event id of another competition", async () => {
    given([storedEvent()]);

    await expect(
      save({ events: [{ ...newClassificatrice, id: "ev-other" }] }),
    ).rejects.toThrow(/Épreuve n°1 : identifiant inconnu/);
  });

  it("refuses the same event twice", async () => {
    const stored = storedEvent();
    given([stored]);

    await expect(
      save({ events: [echo(stored), echo(stored)] }),
    ).rejects.toThrow(/Épreuve n°2 : envoyé deux fois/);
  });

  it("reports a broken rule with the event number", async () => {
    given([]);

    const attempt = save({
      events: [newClassificatrice, { ...newClassificatrice, level: "Expert" }],
    });

    await expect(attempt).rejects.toThrow(BadRequestException);
    await expect(attempt).rejects.toThrow(/^Épreuve n°2 : le niveau Expert/);
  });

  it("checks natures against the competition type", async () => {
    prisma.competition.findUnique.mockResolvedValue({
      ...competition,
      competitionType: "PROXIMITE",
    } as never);
    prisma.event.findMany.mockResolvedValue([]);
    prisma.scheduleItem.findMany.mockResolvedValue([]);

    await expect(
      save({
        events: [
          {
            eventKind: "MAJEURE",
            eventType: "COUPLE",
            category: "Latin",
            ageGroup: "Adulte",
          },
        ],
      }),
    ).rejects.toThrow(/compétition de proximité/);
  });

  it("returns 404 for an unknown competition", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);

    await expect(save({})).rejects.toThrow(NotFoundException);
  });

  it("replaces the schedule: keeps the HH:MM, computes the instant, deletes the rest", async () => {
    given([], ["slot-1", "slot-2"]);

    await save({
      schedule: [
        {
          id: "slot-2",
          startTime: "10:00",
          durationMinutes: 15,
          type: "ROUND",
          title: "  Latines Adulte — finale ",
        },
        {
          startTime: "10:15",
          durationMinutes: 10,
          type: "BREAK",
          title: "Pause",
        },
      ],
    });

    expect(prisma.scheduleItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["slot-1"] } },
    });
    expect(prisma.scheduleItem.update).toHaveBeenCalledWith({
      where: { id: "slot-2" },
      data: {
        startClock: "10:00",
        startTime: new Date("2026-06-13T08:00:00.000Z"),
        durationMinutes: 15,
        type: "ROUND",
        title: "Latines Adulte — finale",
        position: 0,
      },
      select: { id: true },
    });
    expect(prisma.scheduleItem.create).toHaveBeenCalledWith({
      data: {
        startClock: "10:15",
        startTime: new Date("2026-06-13T08:15:00.000Z"),
        durationMinutes: 10,
        type: "BREAK",
        title: "Pause",
        position: 1,
        competitionId: COMPETITION_ID,
      },
      select: { id: true },
    });
  });

  it("refuses a schedule slot id of another competition", async () => {
    given([], ["slot-1"]);

    await expect(
      save({
        schedule: [
          {
            id: "slot-x",
            startTime: "10:00",
            durationMinutes: 15,
            type: "ROUND",
            title: "Finale",
          },
        ],
      }),
    ).rejects.toThrow(/Créneau n°1 : identifiant inconnu/);
  });

  it("runs the writes in one transaction with a raised timeout", async () => {
    given([]);

    await save({});

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 20_000,
    });
  });
});
