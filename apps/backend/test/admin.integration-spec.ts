import { randomUUID } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AdminUserAccountsService } from "../src/admin/admin-user-accounts.service";
import { AdminUsersService } from "../src/admin/admin-users.service";
import { AuthService } from "../src/auth/auth.service";
import { AuthTokenService } from "../src/auth/auth-token.service";
import { JwtStrategy } from "../src/auth/jwt.strategy";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

const PASSWORD = "Secret-123!";

const userData = (o: {
  role?: UserRole;
  lastName?: string;
  password?: string;
  clubId?: string;
  clubName?: string;
}) => ({
  email: `${randomUUID()}@test.local`,
  password: o.password ?? "x",
  firstName: "Test",
  lastName: o.lastName ?? "User",
  role: o.role ?? UserRole.LICENSEE,
  ...(o.clubId && { clubId: o.clubId }),
  ...(o.clubName && { clubName: o.clubName }),
});

describe("Admin (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AdminUsersService;
  let userAccounts: AdminUserAccountsService;
  let auth: AuthService;
  let tokens: AuthTokenService;
  let strategy: JwtStrategy;
  const createdUserIds: string[] = [];
  const createdClubIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(AdminUsersService);
    userAccounts = moduleRef.get(AdminUserAccountsService);
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(AuthTokenService);
    strategy = moduleRef.get(JwtStrategy);
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
    await prisma.club.deleteMany({ where: { id: { in: createdClubIds } } });
    createdClubIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const create = async (o: Parameters<typeof userData>[0]) => {
    const u = await prisma.user.create({ data: userData(o) });
    createdUserIds.push(u.id);
    return u;
  };

  it("PATCH writes the user and exactly one audit row", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({ lastName: "Martin" });

    await service.update(admin.id, target.id, { lastName: "Durand" });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: target.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ lastName: "Martin" });
    expect(rows[0].after).toEqual({ lastName: "Durand" });
  });

  it("PATCH with an unknown club changes nothing", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({ lastName: "Martin" });

    await expect(
      service.update(admin.id, target.id, {
        lastName: "X",
        clubId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow("Club introuvable");

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.lastName).toBe("Martin");
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: target.id } }),
    ).toBe(0);
  });

  it("account creation is atomic: a duplicate club name leaves no user behind", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
    });
    createdClubIds.push(club.id);
    const email = `${randomUUID()}@test.local`;

    await expect(
      userAccounts.create(admin.id, {
        email,
        firstName: "J",
        lastName: "M",
        role: UserRole.CLUB,
        clubName: club.name,
      }),
    ).rejects.toThrow("Un club porte déjà ce nom");

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("creates club + CLUB account + audit row together", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const res = await userAccounts.create(admin.id, {
      email: `${randomUUID()}@test.local`,
      firstName: "J",
      lastName: "M",
      role: UserRole.CLUB,
      clubName: `Club ${randomUUID()}`,
    });
    createdUserIds.push(res.userId);
    if (res.clubId) createdClubIds.push(res.clubId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: res.userId },
    });
    expect(user.role).toBe(UserRole.CLUB);
    expect(user.clubId).toBe(res.clubId);
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: res.userId, action: "USER_CREATE" },
      }),
    ).toBe(1);
  });

  it("creates a licensee without club, with a pending invitation token", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const res = await userAccounts.create(admin.id, {
      email: `${randomUUID()}@test.local`,
      firstName: "L",
      lastName: "M",
      role: UserRole.LICENSEE,
      category: "Latin",
    });
    createdUserIds.push(res.userId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: res.userId },
    });
    expect(user).toMatchObject({
      role: UserRole.LICENSEE,
      clubId: null,
      category: "Latin",
    });
    expect(res.clubId).toBeNull();
    expect(
      await prisma.passwordResetToken.count({
        where: { userId: res.userId, used: false },
      }),
    ).toBe(1);
  });

  it("a deactivated user cannot log in, refresh or use a live token, until reactivated", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({
      password: await bcrypt.hash(PASSWORD, 12),
    });
    const refresh = await tokens.createRefreshToken(target.id);

    await service.setStatus(admin.id, target.id, false);

    await expect(auth.validateUser(target.email, PASSWORD)).rejects.toThrow(
      "Compte désactivé. Contactez la fédération.",
    );
    await expect(
      tokens.refreshAccessToken(refresh.token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      strategy.validate({
        sub: target.id,
        email: target.email,
        role: target.role,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: target.id, action: "USER_DISABLE" },
      }),
    ).toBe(1);

    await service.setStatus(admin.id, target.id, true);
    await expect(
      auth.validateUser(target.email, PASSWORD),
    ).resolves.toMatchObject({ id: target.id });
  });

  it("admin deletion goes through the shared core and keeps an anonymised trail and a role-only delete row", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({ lastName: "Martin" });
    // An earlier audit row about the target: the core must anonymise it.
    await service.update(admin.id, target.id, { lastName: "Durand" });
    await tokens.createRefreshToken(target.id);

    await service.delete(
      admin.id,
      target.id,
      ` ${target.email.toUpperCase()} `,
    );

    expect(
      await prisma.user.findUnique({ where: { id: target.id } }),
    ).toBeNull();
    expect(
      await prisma.refreshToken.count({ where: { userId: target.id } }),
    ).toBe(0);
    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: target.id },
    });
    expect(rows).toHaveLength(2);
    const update = rows.find((r) => r.action === "USER_UPDATE");
    expect(update).toMatchObject({ actorId: admin.id });
    expect(update?.before).toBeNull();
    expect(update?.after).toBeNull();
    const del = rows.find((r) => r.action === "USER_DELETE");
    expect(del).toMatchObject({
      actorId: admin.id,
      before: null,
      after: { role: "LICENSEE" },
    });
  });
});
