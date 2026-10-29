/**
 * Club competition editor programme (#442): the events and schedule entered
 * by the organising club are saved and read back identically; an event with
 * registrations is never deleted silently; a programme saved by the club is
 * protected from the FFD épreuves deduction.
 */
import { INestApplication } from "@nestjs/common";
import { CompetitionType, EventsSource, UserRole } from "@prisma/client";
import request from "supertest";
import { CompetitionEventsDeductionService } from "../src/competitions/services/competition-events-deduction.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { competitionEventsDeductionSelect } from "../src/utils/prisma-selects";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

interface ProgramBody {
  syncedFromFfd: boolean;
  eventsSource: string | null;
  programEditedAt: string | null;
  events: {
    id: string;
    eventKind: string | null;
    eventType: string;
    category: string;
    ageGroup: string;
    ageGroups: string[];
    level: string | null;
    openLevels: string[];
    locked: boolean;
    resultCount: number;
  }[];
  schedule: {
    id: string;
    startTime: string;
    durationMinutes: number | null;
    type: string;
    title: string;
    eventId: string | null;
  }[];
}

describe("Competition programme (integration, real DB)", () => {
  const suffix = `comp-program-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let clubAToken: string;
  let clubBToken: string;
  let licenseeId: string;
  let competitionId: string;

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

  const put = (token: string, id: string, body: Record<string, unknown>) =>
    request(http())
      .put(`/api/v1/competitions/${id}/program`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const get = (token: string, id: string) =>
    request(http())
      .get(`/api/v1/competitions/${id}/program`)
      .set("Authorization", `Bearer ${token}`);

  const editorProgram = {
    events: [
      {
        eventKind: "CLASSIFICATRICE",
        eventType: "COUPLE",
        category: "Latine",
        ageGroup: "Adulte",
        level: "Intermédiaire",
      },
      {
        eventKind: "OPEN",
        eventType: "COUPLE",
        category: "Standard",
        ageGroup: "Youth",
        ageGroups: ["Youth", "Adulte"],
        openLevels: ["Débutant", "Intermédiaire"],
      },
      {
        eventKind: "SOLO_TEAM",
        eventType: "SOLO",
        category: "Solo Team",
        ageGroup: "Junior",
        level: "Débutant",
      },
    ],
    schedule: [
      {
        startTime: "10:00",
        durationMinutes: 15,
        type: "ROUND",
        title: "Latines Adulte — 1/4 de finale",
      },
      {
        startTime: "10:15",
        durationMinutes: 15,
        type: "BREAK",
        title: "Pause",
      },
    ],
  };

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);

    const clubA = await f.club({ name: `Club A ${suffix}` });
    const clubB = await f.club({ name: `Club B ${suffix}` });
    clubAToken = (
      await f.user(UserRole.CLUB, { clubId: clubA.id, clubName: clubA.name })
    ).token;
    clubBToken = (
      await f.user(UserRole.CLUB, { clubId: clubB.id, clubName: clubB.name })
    ).token;
    licenseeId = (await f.user(UserRole.LICENSEE)).user.id;
    competitionId = (
      await f.competition({
        organizer: clubA.name,
        competitionType: CompetitionType.PROXIMITE,
        date: new Date("2026-06-13T00:00:00.000Z"),
      })
    ).id;
  });

  afterAll(async () => {
    await f.cleanup();
    await app.close();
  });

  it("refuses another club, reading or writing (403)", async () => {
    await get(clubBToken, competitionId).expect(403);
    await put(clubBToken, competitionId, editorProgram).expect(403);
    expect(await prisma.event.count({ where: { competitionId } })).toBe(0);
  });

  it("saves the editor's programme and reads it back identically", async () => {
    const saved = await put(clubAToken, competitionId, editorProgram).expect(
      200,
    );
    const reread = await get(clubAToken, competitionId).expect(200);
    expect(reread.body).toEqual(saved.body);

    const body = reread.body as ProgramBody;
    expect(body.syncedFromFfd).toBe(false);
    expect(body.programEditedAt).not.toBeNull();
    expect(body.events.map(({ id: _id, ...event }) => event)).toEqual([
      {
        eventKind: "CLASSIFICATRICE",
        eventType: "COUPLE",
        category: "Latin",
        ageGroup: "Adulte",
        ageGroups: [],
        level: "Intermédiaire",
        openLevels: [],
        locked: false,
        resultCount: 0,
      },
      {
        eventKind: "OPEN",
        eventType: "COUPLE",
        category: "Standard",
        ageGroup: "Youth",
        ageGroups: ["Youth", "Adulte"],
        level: null,
        openLevels: ["Débutant", "Intermédiaire"],
        locked: false,
        resultCount: 0,
      },
      {
        eventKind: "SOLO_TEAM",
        eventType: "SOLO",
        category: "Solo Team",
        ageGroup: "Junior",
        ageGroups: [],
        level: "Débutant",
        openLevels: [],
        locked: false,
        resultCount: 0,
      },
    ]);
    expect(body.schedule.map(({ id: _id, ...item }) => item)).toEqual([
      {
        startTime: "10:00",
        durationMinutes: 15,
        type: "ROUND",
        title: "Latines Adulte — 1/4 de finale",
        eventId: null,
      },
      {
        startTime: "10:15",
        durationMinutes: 15,
        type: "BREAK",
        title: "Pause",
        eventId: null,
      },
    ]);

    // The instant is the competition day, French time (summer: UTC+2).
    const first = await prisma.scheduleItem.findUniqueOrThrow({
      where: { id: body.schedule[0].id },
      select: { startTime: true },
    });
    expect(first.startTime.toISOString()).toBe("2026-06-13T08:00:00.000Z");
  });

  it("rejects a rule violation (400) and leaves the programme untouched", async () => {
    const before = (await get(clubAToken, competitionId).expect(200))
      .body as ProgramBody;

    const res = await put(clubAToken, competitionId, {
      events: [
        {
          eventKind: "CLASSIFICATRICE",
          eventType: "COUPLE",
          category: "Latin",
          ageGroup: "Adulte",
          level: "Avancé", // proximity: Débutant / Intermédiaire only
        },
      ],
      schedule: [],
    }).expect(400);
    expect((res.body as { message: string }).message).toMatch(/proximité/);

    expect((await get(clubAToken, competitionId).expect(200)).body).toEqual(
      before,
    );
  });

  it("never deletes an event with registrations (409), and locks it", async () => {
    const before = (await get(clubAToken, competitionId).expect(200))
      .body as ProgramBody;
    const [registered, ...others] = before.events;
    await f.registration(licenseeId, registered.id);

    const locked = (await get(clubAToken, competitionId).expect(200))
      .body as ProgramBody;
    expect(locked.events[0].locked).toBe(true);

    const withoutRegistered = {
      events: others.map(
        ({ locked: _locked, resultCount: _resultCount, ...event }) => event,
      ),
      schedule: [],
    };
    const res = await put(clubAToken, competitionId, withoutRegistered).expect(
      409,
    );
    expect((res.body as { message: string }).message).toContain(
      "« Latines Adulte Intermédiaire »",
    );
    // Nothing was written: the schedule is still there too.
    const after = (await get(clubAToken, competitionId).expect(200))
      .body as ProgramBody;
    expect(after.events).toHaveLength(3);
    expect(after.schedule).toHaveLength(2);

    // Kept as is, it can still be reordered with the rest.
    const reordered = await put(clubAToken, competitionId, {
      events: [...others, registered].map(
        ({ locked: _locked, resultCount: _resultCount, ...event }) => event,
      ),
      schedule: [],
    }).expect(200);
    const reorderedBody = reordered.body as ProgramBody;
    expect(reorderedBody.events.map((e) => e.id)).toEqual([
      ...others.map((e) => e.id),
      registered.id,
    ]);
    expect(reorderedBody.schedule).toEqual([]);
  });

  it("protects a saved FFD programme from the épreuves deduction", async () => {
    const ffd = await f.competition({
      organizer: `Club A ${suffix}`,
      ffdId: `/api/competitions/${suffix}`,
      eventsSource: EventsSource.GENERIC,
    });
    await f.event(ffd.id, { category: "Latin", ageGroup: "Adult" });

    const before = (await get(clubAToken, ffd.id).expect(200))
      .body as ProgramBody;
    expect(before.syncedFromFfd).toBe(true);
    expect(before.eventsSource).toBe("GENERIC");

    const deduction = app.get(CompetitionEventsDeductionService);
    const candidate = async () =>
      prisma.competition.findUniqueOrThrow({
        where: { id: ffd.id },
        select: competitionEventsDeductionSelect,
      });
    expect(deduction.isReplaceable(await candidate())).toBe(true);

    const saved = (
      await put(clubAToken, ffd.id, {
        events: before.events.map(
          ({ locked: _locked, resultCount: _resultCount, ...event }) => event,
        ),
        schedule: [],
      }).expect(200)
    ).body as ProgramBody;
    expect(saved.eventsSource).toBeNull();
    expect(deduction.isReplaceable(await candidate())).toBe(false);
  });
});
