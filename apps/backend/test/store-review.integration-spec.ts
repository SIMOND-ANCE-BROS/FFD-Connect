import { randomUUID } from "crypto";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Store-review account (App Store / Google Play validation), end to end on a
 * real database: the global interceptor sees the flag JwtStrategy read, writes
 * are simulated (2xx, nothing stored), and the back-office cannot delete or
 * disable the account or its club.
 */
describe("Store-review account (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const userIds: string[] = [];
  const clubIds: string[] = [];

  const createUser = async (o: {
    role: UserRole;
    extraRoles?: UserRole[];
    isStoreReview?: boolean;
    clubId?: string;
  }) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Avant",
        lastName: "Test",
        role: o.role,
        extraRoles: o.extraRoles ?? [],
        isStoreReview: o.isStoreReview ?? false,
        ...(o.clubId && { clubId: o.clubId }),
      },
      select: { id: true, email: true, role: true },
    });
    userIds.push(u.id);
    return u;
  };

  const bearer = (u: { id: string; email: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: u.id, email: u.email, role: u.role })}`;

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp());
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: [...userIds, ...clubIds] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    userIds.length = 0;
    clubIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it("simulates a profile update: 200, demo header, nothing stored", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      extraRoles: [UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF],
      isStoreReview: true,
    });

    const res = await request(app.getHttpServer())
      .patch("/api/v1/users/me")
      .set("Authorization", bearer(reviewer))
      .send({ wdsf: { min: "10117265" } })
      .expect(200);

    expect(res.headers["x-demo-mode"]).toBe("simulated");
    expect(res.body).toMatchObject({ success: true, simulated: true });
    const stored = await prisma.user.findUnique({
      where: { id: reviewer.id },
      select: { wdsfMin: true },
    });
    expect(stored?.wdsfMin).toBeNull();
  });

  it("simulates a password change: the password is unchanged", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/change-password")
      .set("Authorization", bearer(reviewer))
      .send({ currentPassword: "wrong", newPassword: "Nouveau-Mot2Passe!" })
      .expect(201);

    expect(res.headers["x-demo-mode"]).toBe("simulated");
    expect(res.body).not.toHaveProperty("newPassword");
    const stored = await prisma.user.findUnique({
      where: { id: reviewer.id },
      select: { password: true },
    });
    expect(stored?.password).toBe("x");
  });

  it("serves reads normally and exposes the flag on /users/me", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });
    const res = await request(app.getHttpServer())
      .get("/api/v1/users/me")
      .set("Authorization", bearer(reviewer))
      .expect(200);
    expect(res.headers["x-demo-mode"]).toBeUndefined();
    expect(res.body).toMatchObject({
      id: reviewer.id,
      email: reviewer.email,
      isStoreReview: true,
    });
  });

  it("masks other people's personal data in admin reads", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });
    const other = await createUser({ role: UserRole.LICENSEE });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${other.id}`)
      .set("Authorization", bearer(reviewer))
      .expect(200);
    expect(res.body).toMatchObject({
      id: other.id,
      email: "masque@exemple.invalid",
      lastName: "T.",
      birthDate: null,
    });
  });

  it("serves an empty page for the admin user list and audit log", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });
    await createUser({ role: UserRole.LICENSEE });
    for (const path of ["/api/v1/admin/users", "/api/v1/admin/audit-log"]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set("Authorization", bearer(reviewer))
        .expect(200);
      expect(res.headers["x-demo-mode"]).toBe("simulated");
      expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
    }
  });

  it("refuses to open an impersonation", async () => {
    const reviewer = await createUser({
      role: UserRole.ADMIN,
      isStoreReview: true,
    });
    const other = await createUser({ role: UserRole.LICENSEE });
    await request(app.getHttpServer())
      .post("/api/v1/auth/impersonate")
      .set("Authorization", bearer(reviewer))
      .send({ targetUserId: other.id })
      .expect(403);
    await expect(
      prisma.impersonationLog.count({ where: { actorId: reviewer.id } }),
    ).resolves.toBe(0);
  });

  describe("back-office protection", () => {
    it("refuses to delete or disable the account, but lets an admin edit it", async () => {
      const admin = await createUser({ role: UserRole.ADMIN });
      const reviewer = await createUser({
        role: UserRole.ADMIN,
        isStoreReview: true,
      });
      const target = await prisma.user.findUniqueOrThrow({
        where: { id: reviewer.id },
        select: { email: true },
      });
      const server = app.getHttpServer();

      const del = await request(server)
        .delete(`/api/v1/admin/users/${reviewer.id}`)
        .set("Authorization", bearer(admin))
        .send({ confirmEmail: target.email })
        .expect(403);
      expect(del.body.message).toBe(
        "Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.",
      );

      await request(server)
        .post(`/api/v1/admin/users/${reviewer.id}/status`)
        .set("Authorization", bearer(admin))
        .send({ active: false })
        .expect(403);

      const edit = await request(server)
        .patch(`/api/v1/admin/users/${reviewer.id}`)
        .set("Authorization", bearer(admin))
        .send({ firstName: "Relecteur" })
        .expect(200);
      expect(edit.body).toMatchObject({
        firstName: "Relecteur",
        isStoreReview: true,
        disabledAt: null,
      });
    });

    it("refuses to delete or disable the club", async () => {
      const admin = await createUser({ role: UserRole.ADMIN });
      const club = await prisma.club.create({
        data: { name: `Club ${randomUUID()}`, isStoreReview: true },
        select: { id: true },
      });
      clubIds.push(club.id);
      const server = app.getHttpServer();

      const del = await request(server)
        .delete(`/api/v1/admin/clubs/${club.id}`)
        .set("Authorization", bearer(admin))
        .expect(403);
      expect(del.body.message).toBe(
        "Ce club est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.",
      );
      await request(server)
        .post(`/api/v1/admin/clubs/${club.id}/status`)
        .set("Authorization", bearer(admin))
        .send({ active: false })
        .expect(403);
      const stored = await prisma.club.findUnique({
        where: { id: club.id },
        select: { disabledAt: true },
      });
      expect(stored?.disabledAt).toBeNull();
    });
  });
});
