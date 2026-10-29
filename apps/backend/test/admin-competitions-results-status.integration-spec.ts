/**
 * #846: whether the results of a competition are already imported, for the
 * back-office list (`GET /admin/competitions/results-status`) and per event
 * (`GET /competitions/:id/program`), through the real guards and database.
 */
import { INestApplication } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { randomUUID } from "crypto";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

interface StatusRow {
  competitionId: string;
  eventCount: number;
  eventsWithResults: number;
  resultsStatus: string;
}

describe("Admin competitions results status (integration, real DB)", () => {
  const suffix = `results-status-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let staffToken: string;
  let licenseeToken: string;
  let complete: string;
  let partial: string;
  let none: string;
  let empty: string;
  let partialEvents: string[];

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  const statuses = (token: string, query: string) =>
    request(http())
      .get(`/api/v1/admin/competitions/results-status?${query}`)
      .set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const built = await buildHttpApp();
    app = built.app;
    prisma = built.prisma;
    f = createFactories(prisma, suffix, built.jwt);

    staffToken = (await f.user(UserRole.STAFF)).token;
    const licensee = await f.user(UserRole.LICENSEE);
    licenseeToken = licensee.token;
    const dancer = licensee.user.id;

    complete = (await f.competition()).id;
    const c1 = await f.event(complete);
    await f.result(c1.id, dancer);
    await f.result(c1.id, dancer, { ranking: 2 });

    partial = (await f.competition()).id;
    partialEvents = [];
    for (const category of ["Latin", "Standard", "Latin"]) {
      partialEvents.push((await f.event(partial, { category })).id);
    }
    await f.result(partialEvents[0], dancer);

    none = (await f.competition()).id;
    await f.event(none);
    await f.event(none, { category: "Standard" });

    empty = (await f.competition()).id;
  });

  afterAll(async () => {
    await f.cleanup();
    await app.close();
  });

  it("is STAFF / ADMIN only", async () => {
    await statuses(licenseeToken, `ids=${complete}`).expect(403);
    await request(http())
      .get(`/api/v1/admin/competitions/results-status?ids=${complete}`)
      .expect(401);
  });

  it("validates the ids (400)", async () => {
    await statuses(staffToken, "").expect(400);
    await statuses(staffToken, "ids=not-a-uuid").expect(400);
    const tooMany = Array.from({ length: 101 }, () => randomUUID()).join(",");
    await statuses(staffToken, `ids=${tooMany}`).expect(400);
  });

  it("aggregates each competition, in the order asked", async () => {
    const unknown = randomUUID();
    const res = await statuses(
      staffToken,
      `ids=${partial}&ids=${complete},${none}&ids=${empty}&ids=${unknown}`,
    ).expect(200);
    expect(res.body as StatusRow[]).toEqual([
      {
        competitionId: partial,
        eventCount: 3,
        eventsWithResults: 1,
        resultsStatus: "PARTIAL",
      },
      {
        competitionId: complete,
        eventCount: 1,
        eventsWithResults: 1,
        resultsStatus: "COMPLETE",
      },
      {
        competitionId: none,
        eventCount: 2,
        eventsWithResults: 0,
        resultsStatus: "NONE",
      },
      {
        competitionId: empty,
        eventCount: 0,
        eventsWithResults: 0,
        resultsStatus: "NONE",
      },
      {
        competitionId: unknown,
        eventCount: 0,
        eventsWithResults: 0,
        resultsStatus: "NONE",
      },
    ]);
  });

  it("counts the results of each event in the programme", async () => {
    const res = await request(http())
      .get(`/api/v1/competitions/${partial}/program`)
      .set("Authorization", `Bearer ${staffToken}`)
      .expect(200);
    const events = (
      res.body as { events: { id: string; resultCount: number }[] }
    ).events;
    expect(
      Object.fromEntries(events.map((e) => [e.id, e.resultCount])),
    ).toEqual({
      [partialEvents[0]]: 1,
      [partialEvents[1]]: 0,
      [partialEvents[2]]: 0,
    });
  });
});
