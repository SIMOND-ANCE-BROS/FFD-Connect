import { randomUUID } from "crypto";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { STORE_REVIEW_READABLE_KEY } from "../src/auth/store-review/store-review.decorator";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Read allowlist of the store-review account, on a real database.
 *
 * Worst case on purpose: another person ("the victim") is a member of the
 * review account's own club, its partner in a couple, a member of its solo
 * team, registered to a competition and the submitter of a track. No
 * allowlisted GET may return the victim's email, last name or license number.
 */

/** Every GET the store-review account may read with real data. */
const EXPECTED_ALLOWLIST = [
  "GET admin/clubs/options",
  "GET admin/reference-data",
  "GET career/me",
  "GET career/user/:userId",
  "GET clubs/me/helloasso",
  "GET clubs/me/partnerships",
  "GET clubs/me/registration-mode",
  "GET clubs/me/solo-teams",
  "GET clubs/me/solo-teams/:id",
  "GET competitions",
  "GET competitions/:id/for-user",
  "GET competitions/sync/status",
  "GET competitions/user/registrations",
  "GET licenses/my",
  "GET licenses/renewal/my",
  "GET notifications",
  "GET notifications/preferences",
  "GET track-corrections/mine",
  "GET track-corrections/pending-count",
  "GET tracks",
  "GET tracks/:id",
  "GET tracks/ambiance",
  "GET users/me",
  "GET users/me/export",
];

const join = (...parts: (string | undefined)[]) =>
  parts
    .flatMap((p) => (p ?? "").split("/"))
    .filter(Boolean)
    .join("/");

describe("Store-review read allowlist (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const tag = randomUUID().slice(0, 8);
  const victimEmail = `victim-${tag}@leak.example`;
  const victimLastName = `Fuiteuse${tag}`;
  const victimLicense = `LEAK-${tag}`;
  const ids = {
    reviewer: "",
    victim: "",
    club: "",
    team: "",
    track: "",
    competition: "",
  };
  let auth = "";

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp());

    const club = await prisma.club.create({
      data: { name: `Club Revue ${tag}`, isStoreReview: true },
      select: { id: true, name: true },
    });
    ids.club = club.id;
    const reviewer = await prisma.user.create({
      data: {
        email: `review-${tag}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Relecteur",
        role: UserRole.ADMIN,
        extraRoles: [UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF],
        isStoreReview: true,
        clubId: club.id,
        clubName: club.name,
      },
      select: { id: true, email: true, role: true },
    });
    ids.reviewer = reviewer.id;
    auth = `Bearer ${jwt.sign({ sub: reviewer.id, email: reviewer.email, role: reviewer.role })}`;

    const victim = await prisma.user.create({
      data: {
        email: victimEmail,
        password: "x",
        firstName: "Victime",
        lastName: victimLastName,
        birthDate: new Date("1990-05-17"),
        role: UserRole.LICENSEE,
        clubId: club.id,
        clubName: club.name,
        license: {
          create: {
            number: victimLicense,
            validUntil: new Date("2030-01-01"),
            category: "Latin",
            clubName: club.name,
          },
        },
      },
      select: { id: true },
    });
    ids.victim = victim.id;

    await prisma.partnership.create({
      data: { clubId: club.id, user1Id: reviewer.id, user2Id: victim.id },
    });
    const team = await prisma.soloTeam.create({
      data: {
        clubId: club.id,
        name: `Team ${tag}`,
        level: "Débutant",
        members: { create: [{ userId: victim.id }, { userId: reviewer.id }] },
      },
      select: { id: true },
    });
    ids.team = team.id;
    const track = await prisma.track.create({
      data: {
        title: `Track ${tag}`,
        artist: "Artiste",
        filename: `t-${tag}.mp3`,
        submittedById: victim.id,
      },
      select: { id: true },
    });
    ids.track = track.id;
    const competition = await prisma.competition.create({
      data: {
        title: `Compet ${tag}`,
        date: new Date(Date.now() + 86_400_000),
        location: "Lyon",
        organizer: club.name,
        events: {
          create: {
            category: "Latin",
            ageGroup: "Adult",
            registrations: {
              create: {
                userId: victim.id,
                partnerUserId: reviewer.id,
                status: "CONFIRMED",
              },
            },
          },
        },
      },
      select: { id: true },
    });
    ids.competition = competition.id;
  });

  afterAll(async () => {
    await prisma.registration.deleteMany({
      where: { userId: { in: [ids.victim, ids.reviewer] } },
    });
    await prisma.event.deleteMany({
      where: { competitionId: ids.competition },
    });
    await prisma.competition.deleteMany({ where: { id: ids.competition } });
    await prisma.track.deleteMany({ where: { id: ids.track } });
    await prisma.license.deleteMany({ where: { number: victimLicense } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.victim, ids.reviewer] } },
    });
    await prisma.club.deleteMany({ where: { id: ids.club } });
    await app.close();
  });

  it("the allowlist is exactly the reviewed list (a new route is empty by default)", () => {
    const found: string[] = [];
    for (const mod of app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as unknown as {
          prototype: Record<string, unknown>;
        } | null;
        if (!ctrl?.prototype) continue;
        const base = Reflect.getMetadata(PATH_METADATA, ctrl) as
          | string
          | undefined;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = ctrl.prototype[name];
          if (typeof handler !== "function") continue;
          if (
            Reflect.getMetadata(METHOD_METADATA, handler) !==
              RequestMethod.GET ||
            !Reflect.getMetadata(STORE_REVIEW_READABLE_KEY, handler)
          ) {
            continue;
          }
          const path = Reflect.getMetadata(PATH_METADATA, handler) as
            | string
            | undefined;
          found.push(`GET ${join(base, path)}`);
        }
      }
    }
    expect(found.sort()).toEqual([...EXPECTED_ALLOWLIST].sort());
  });

  const paths = (): string[] => [
    "/admin/clubs/options",
    "/admin/reference-data",
    "/career/me",
    `/career/user/${ids.reviewer}`,
    "/clubs/me/helloasso",
    "/clubs/me/partnerships",
    "/clubs/me/registration-mode",
    "/clubs/me/solo-teams",
    `/clubs/me/solo-teams/${ids.team}`,
    "/competitions",
    `/competitions/${ids.competition}/for-user`,
    "/competitions/sync/status",
    "/competitions/user/registrations",
    "/licenses/my",
    "/licenses/renewal/my",
    "/notifications",
    "/notifications/preferences",
    "/track-corrections/mine",
    "/track-corrections/pending-count",
    "/tracks",
    `/tracks/${ids.track}`,
    "/tracks/ambiance",
    "/users/me",
    "/users/me/export",
  ];

  it("checks one request per allowlisted route", () => {
    expect(paths()).toHaveLength(EXPECTED_ALLOWLIST.length);
  });

  it.each(Array.from({ length: EXPECTED_ALLOWLIST.length }, (_, i) => i))(
    "allowlisted route #%i leaks no other user's personal data",
    async (i) => {
      const path = paths()[i];
      const res = await request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set("Authorization", auth);
      // NotificationsService is a test double in the integration app (no
      // read methods): its 500 carries no data, the leak checks still apply.
      if (!path.startsWith("/notifications")) {
        expect(res.status).toBeLessThan(500);
      }
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(victimEmail);
      expect(text).not.toContain(victimLastName);
      expect(text).not.toContain(victimLicense);
      expect(text).not.toContain("1990-05-17");
    },
  );

  it.each([
    "/users/members",
    "/users/search?q=Victime",
    "/career/search-members?q=Vic",
    "/clubs/me/partnerships/members",
    "/competitions/club/pending-registrations",
  ])("non-allowlisted list %s is empty", async (path) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("Authorization", auth)
      .expect(200);
    expect(res.headers["x-demo-mode"]).toBe("simulated");
    expect(res.body).toEqual([]);
  });

  it("someone else's career is empty", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/career/user/${ids.victim}`)
      .set("Authorization", auth)
      .expect(200);
    expect(res.body).toEqual({
      partnerships: [],
      registrations: [],
      results: [],
    });
  });
});
