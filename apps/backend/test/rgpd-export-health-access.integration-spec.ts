/**
 * GDPR export: the health-data access journal (#732) against a real Postgres.
 *
 * `GET /users/me/export` must hand back the accesses to the caller's health
 * data (rows where they are the data subject) with the actor's CAPACITY only:
 * never the actor's id, nor another person's rows. The unit suite asserts the
 * query; here the real HTTP pipeline, JWT strategy and serialisation run.
 */
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildHttpApp } from "./integration-app.builder";

const API = "/api/v1";

describe("GDPR export — health-data access journal (integration, real DB, #732)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let f: ReturnType<typeof createFactories>;
  const subjects: string[] = [];

  beforeAll(async () => {
    const built = await buildHttpApp({ redis: true });
    app = built.app;
    prisma = built.prisma;
    jwt = built.jwt;
    f = createFactories(prisma, `export-health-${Date.now()}`, jwt);
  });

  afterAll(async () => {
    // No foreign key on the journal: its rows outlive the accounts.
    await prisma.healthDataAccessLog.deleteMany({
      where: { subjectUserId: { in: subjects } },
    });
    await f.cleanup();
    await app.close();
  });

  it("returns the caller's accesses with the actor's capacity, never the actor's identity", async () => {
    const licensee = await f.user();
    const other = await f.user();
    const admin = await f.user(UserRole.ADMIN);
    subjects.push(licensee.user.id, other.user.id);

    await prisma.healthDataAccessLog.createMany({
      data: [
        {
          subjectUserId: licensee.user.id,
          actorUserId: admin.user.id,
          actorRole: "ADMIN",
          action: "DOWNLOAD",
          resourceType: "MEDICAL_CERTIFICATE",
          resourceId: "00000000-0000-4000-8000-000000000001",
          route: "GET /admin/license-renewals/:id/documents/:docId/file",
          createdAt: new Date("2026-09-01T10:00:00Z"),
        },
        {
          subjectUserId: licensee.user.id,
          actorUserId: admin.user.id,
          actorRole: "IMPERSONATOR",
          action: "READ",
          resourceType: "LICENSE_RENEWAL_REQUEST",
          resourceId: "00000000-0000-4000-8000-000000000002",
          route: "GET /licenses/renewal/my",
          createdAt: new Date("2026-09-02T10:00:00Z"),
        },
        // Someone else's journal: must not leak into this export.
        {
          subjectUserId: other.user.id,
          actorUserId: admin.user.id,
          actorRole: "ADMIN",
          action: "READ",
          resourceType: "LICENSE_RENEWAL_REQUEST",
          resourceId: "00000000-0000-4000-8000-000000000003",
          route: "GET /admin/license-renewals/:id",
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get(`${API}/users/me/export`)
      .set("Authorization", `Bearer ${licensee.token}`)
      .expect(200);

    expect(res.body.data.healthDataAccesses).toEqual([
      {
        actorRole: "IMPERSONATOR",
        action: "READ",
        resourceType: "LICENSE_RENEWAL_REQUEST",
        route: "GET /licenses/renewal/my",
        createdAt: "2026-09-02T10:00:00.000Z",
      },
      {
        actorRole: "ADMIN",
        action: "DOWNLOAD",
        resourceType: "MEDICAL_CERTIFICATE",
        route: "GET /admin/license-renewals/:id/documents/:docId/file",
        createdAt: "2026-09-01T10:00:00.000Z",
      },
    ]);
    // The administrator's id appears nowhere in the export.
    expect(JSON.stringify(res.body)).not.toContain(admin.user.id);
  });
});
