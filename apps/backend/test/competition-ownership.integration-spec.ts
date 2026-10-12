/**
 * Competition ownership (#381): the seat layout carries the price charged by
 * the HelloAsso checkout, so only the organizing club (or STAFF/ADMIN) may
 * edit a competition, and `priceCents` is validated.
 */
import { INestApplication } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

describe("Competition ownership (integration, real DB)", () => {
  const suffix = `comp-owner-${Date.now()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let clubAToken: string;
  let clubBToken: string;
  let adminToken: string;
  let staffToken: string;
  let clubBCompetitionId: string;

  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

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
    adminToken = (await f.user(UserRole.ADMIN)).token;
    staffToken = (await f.user(UserRole.STAFF)).token;
    clubBCompetitionId = (await f.competition({ organizer: clubB.name })).id;
  });

  afterAll(async () => {
    await f.cleanup();
    await app.close();
  });

  const patch = (token: string, body: Record<string, unknown>) =>
    request(http())
      .patch(`/api/v1/competitions/${clubBCompetitionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  const storedLayout = async () =>
    (
      await prisma.competition.findUniqueOrThrow({
        where: { id: clubBCompetitionId },
        select: { layout: true },
      })
    ).layout;

  it("refuses club A editing club B's competition (403), layout untouched", async () => {
    const before = await storedLayout();

    await patch(clubAToken, {
      layout: [{ id: "t1", type: "TABLE", priceCents: 1 }],
    }).expect(403);

    expect(await storedLayout()).toEqual(before);
  });

  it("lets the organizing club set a seat price", async () => {
    const layout = [
      { id: "t1", type: "TABLE", label: "Table 1", x: 10, priceCents: 1500 },
    ];

    await patch(clubBToken, { layout }).expect(200);

    expect(await storedLayout()).toEqual(layout);
  });

  it("lets ADMIN and STAFF edit any competition", async () => {
    await patch(adminToken, { title: `Admin edit ${suffix}` }).expect(200);
    await patch(staffToken, { title: `Staff edit ${suffix}` }).expect(200);
  });

  it.each([
    ["zero", 0],
    ["decimal", 15.5],
    ["string", "1500"],
    ["too high", 1_000_001],
  ])("rejects an invalid priceCents (%s) with 400", async (_label, price) => {
    await patch(clubBToken, {
      layout: [{ id: "t1", type: "TABLE", priceCents: price }],
    }).expect(400);
  });

  it("returns 404 for an unknown competition", async () => {
    await request(http())
      .patch(`/api/v1/competitions/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${clubAToken}`)
      .send({ title: "x" })
      .expect(404);
  });

  it("stamps the club as organizer of a competition it creates", async () => {
    const res = await request(http())
      .post("/api/v1/competitions")
      .set("Authorization", `Bearer ${clubAToken}`)
      .send({
        title: `Created by A ${suffix}`,
        date: "2026-06-01T10:00:00Z",
        location: "Lyon",
      })
      .expect(201);

    const created = await prisma.competition.findUniqueOrThrow({
      where: { id: (res.body as { id: string }).id },
      select: { organizer: true },
    });
    expect(created.organizer).toBe(`Club A ${suffix}`);

    // …and can therefore edit it, while club B cannot.
    await request(http())
      .patch(`/api/v1/competitions/${(res.body as { id: string }).id}`)
      .set("Authorization", `Bearer ${clubBToken}`)
      .send({ title: `Hijack ${suffix}` })
      .expect(403);
    await request(http())
      .patch(`/api/v1/competitions/${(res.body as { id: string }).id}`)
      .set("Authorization", `Bearer ${clubAToken}`)
      .send({ title: `Edited by A ${suffix}` })
      .expect(200);
  });
});
