import { randomUUID } from "crypto";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AdminUserIdentifiersService } from "../src/admin/admin-user-identifiers.service";
import { AuthPasswordService } from "../src/auth/auth-password.service";
import { AuthService } from "../src/auth/auth.service";
import { AuthTokenService } from "../src/auth/auth-token.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

const PASSWORD = "Secret-123!";

/** #448: back-office change of the login email and the licence number. */
describe("Admin identifiers change (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AdminUserIdentifiersService;
  let auth: AuthService;
  let tokens: AuthTokenService;
  let passwords: AuthPasswordService;
  const userIds: string[] = [];
  const licenseIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(AdminUserIdentifiersService);
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(AuthTokenService);
    passwords = moduleRef.get(AuthPasswordService);
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: userIds } },
    });
    await prisma.license.deleteMany({ where: { id: { in: licenseIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    licenseIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const createUser = async (role: UserRole = UserRole.LICENSEE) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: await bcrypt.hash(PASSWORD, 4),
        firstName: "Jeanne",
        lastName: "Martin",
        role,
      },
    });
    userIds.push(u.id);
    return u;
  };

  const createLicense = async (userId: string | null) => {
    const l = await prisma.license.create({
      data: {
        number: `IT-${randomUUID().slice(0, 12)}`,
        validUntil: new Date(Date.now() + 365 * 86_400_000),
        category: "Standard",
        clubName: "Club",
        userId,
      },
    });
    licenseIds.push(l.id);
    return l;
  };

  it("an email change revokes sessions and pending links; the new address logs in, the old one no longer does", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const target = await createUser();
    const refresh = await tokens.createRefreshToken(target.id);
    const pendingLink = await passwords.issuePasswordToken(target.id, 1);
    const newEmail = `${randomUUID()}@test.local`;

    const result = await service.update(admin.id, target.id, {
      email: newEmail,
    });

    expect(result.user.email).toBe(newEmail);
    expect(result.previousEmailNotified).toBe(true);
    await expect(
      tokens.refreshAccessToken(refresh.token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      passwords.resetPassword(pendingLink, "Another-456!"),
    ).rejects.toThrow();
    await expect(auth.validateUser(newEmail, PASSWORD)).resolves.toMatchObject({
      id: target.id,
    });
    await expect(auth.validateUser(target.email, PASSWORD)).resolves.toBeNull();

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: target.id, action: "USER_IDENTIFIERS_UPDATE" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(admin.id);
    expect(rows[0].before).toEqual({ email: target.email });
    expect(rows[0].after).toEqual({ email: newEmail });
  });

  it("refuses an email held by another account in another casing, and changes nothing", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const target = await createUser();
    const other = await createUser();
    const refresh = await tokens.createRefreshToken(target.id);

    await expect(
      service.update(admin.id, target.id, {
        email: other.email,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Stored in another casing (legacy row): still a duplicate.
    await prisma.user.update({
      where: { id: other.id },
      data: { email: other.email.toUpperCase() },
    });
    await expect(
      service.update(admin.id, target.id, { email: other.email }),
    ).rejects.toBeInstanceOf(ConflictException);

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(unchanged.email).toBe(target.email);
    await expect(
      tokens.refreshAccessToken(refresh.token),
    ).resolves.toMatchObject({ access_token: expect.any(String) });
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: target.id } }),
    ).toBe(0);
  });

  it("renames the attached licence in place, keeps the session, and refuses a taken number", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const target = await createUser();
    const license = await createLicense(target.id);
    const unclaimed = await createLicense(null);
    const refresh = await tokens.createRefreshToken(target.id);
    const newNumber = `IT-${randomUUID().slice(0, 12)}`;

    const result = await service.update(admin.id, target.id, {
      licenseNumber: newNumber,
    });

    expect(result.user.licenseNumber).toBe(newNumber);
    const renamed = await prisma.license.findUniqueOrThrow({
      where: { id: license.id },
    });
    expect(renamed).toMatchObject({
      number: newNumber,
      userId: target.id,
      validUntil: license.validUntil,
    });
    await expect(
      tokens.refreshAccessToken(refresh.token),
    ).resolves.toMatchObject({ access_token: expect.any(String) });

    await expect(
      service.update(admin.id, target.id, {
        licenseNumber: unclaimed.number,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await prisma.license.findUniqueOrThrow({ where: { id: license.id } }))
        .number,
    ).toBe(newNumber);
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: target.id, action: "USER_IDENTIFIERS_UPDATE" },
      }),
    ).toBe(1);
  });
});
