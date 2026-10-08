import { randomUUID } from "crypto";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { ClubRegistrationMode, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AdminClubsQueryService } from "../src/admin/admin-clubs.query-service";
import { AdminClubsService } from "../src/admin/admin-clubs.service";
import { AdminUserAccountsService } from "../src/admin/admin-user-accounts.service";
import { AdminUsersQueryService } from "../src/admin/admin-users.query-service";
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
  let clubs: AdminClubsService;
  const createdUserIds: string[] = [];
  const createdClubIds: string[] = [];
  const createdLicenseIds: string[] = [];
  const createdCompetitionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(AdminUsersService);
    userAccounts = moduleRef.get(AdminUserAccountsService);
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(AuthTokenService);
    strategy = moduleRef.get(JwtStrategy);
    clubs = moduleRef.get(AdminClubsService);
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: [...createdUserIds, ...createdClubIds] } },
    });
    await prisma.competition.deleteMany({
      where: { id: { in: createdCompetitionIds } },
    });
    await prisma.license.deleteMany({
      where: { id: { in: createdLicenseIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.club.deleteMany({ where: { id: { in: createdClubIds } } });
    createdUserIds.length = 0;
    createdClubIds.length = 0;
    createdLicenseIds.length = 0;
    createdCompetitionIds.length = 0;
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

  it("only a back-office account is flagged createdByAdmin and can be re-invited", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const selfRegistered = await create({});
    const res = await userAccounts.create(admin.id, {
      email: `${randomUUID()}@test.local`,
      firstName: "L",
      lastName: "M",
      role: UserRole.LICENSEE,
    });
    createdUserIds.push(res.userId);
    const users = moduleRef.get(AdminUsersQueryService);

    expect((await users.detail(res.userId)).createdByAdmin).toBe(true);
    expect((await users.detail(selfRegistered.id)).createdByAdmin).toBe(false);
    await expect(
      userAccounts.resendInvitation(admin.id, selfRegistered.id),
    ).rejects.toThrow("Ce compte n'a pas été créé depuis le back-office.");
    await expect(
      userAccounts.resendInvitation(admin.id, res.userId),
    ).resolves.toHaveProperty("invitationSent");
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

  const newClub = async () => {
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
    });
    createdClubIds.push(club.id);
    return club;
  };

  it("renaming a club rewrites every copy of its name, and only those", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const other = await newClub();
    const newName = `Club ${randomUUID()}`;
    const member = await create({ clubId: club.id, clubName: club.name });
    const legacy = await create({ clubName: club.name });
    // Same text in another club's member: inconsistent data, left alone.
    const stranger = await create({ clubId: other.id, clubName: club.name });
    const license = await prisma.license.create({
      data: {
        number: `L-${randomUUID()}`,
        validUntil: new Date("2027-08-31"),
        category: "Latin",
        clubName: club.name,
      },
    });
    createdLicenseIds.push(license.id);
    const competition = await prisma.competition.create({
      data: {
        title: "Gala",
        date: new Date("2027-01-01"),
        location: "Paris",
        organizer: club.name,
      },
    });
    createdCompetitionIds.push(competition.id);

    await clubs.update(admin.id, club.id, { name: newName });

    const nameOf = async (id: string) =>
      (await prisma.user.findUniqueOrThrow({ where: { id } })).clubName;
    expect(await nameOf(member.id)).toBe(newName);
    expect(await nameOf(legacy.id)).toBe(newName);
    expect(await nameOf(stranger.id)).toBe(club.name);
    expect(
      (await prisma.license.findUniqueOrThrow({ where: { id: license.id } }))
        .clubName,
    ).toBe(newName);
    expect(
      (
        await prisma.competition.findUniqueOrThrow({
          where: { id: competition.id },
        })
      ).organizer,
    ).toBe(newName);
    expect(
      await prisma.adminAuditLog.count({
        where: { targetId: club.id, action: "CLUB_UPDATE" },
      }),
    ).toBe(1);
  });

  it("the rename cascade matches copies of the name in another casing", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const newName = `Club ${randomUUID()}`;
    const legacy = await create({ clubName: club.name.toUpperCase() });
    const license = await prisma.license.create({
      data: {
        number: `L-${randomUUID()}`,
        validUntil: new Date("2027-08-31"),
        category: "Latin",
        clubName: club.name.toLowerCase(),
      },
    });
    createdLicenseIds.push(license.id);
    const competition = await prisma.competition.create({
      data: {
        title: "Gala",
        date: new Date("2027-01-01"),
        location: "Paris",
        organizer: club.name.toUpperCase(),
      },
    });
    createdCompetitionIds.push(competition.id);

    await clubs.update(admin.id, club.id, { name: newName });

    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } }))
        .clubName,
    ).toBe(newName);
    expect(
      (await prisma.license.findUniqueOrThrow({ where: { id: license.id } }))
        .clubName,
    ).toBe(newName);
    expect(
      (
        await prisma.competition.findUniqueOrThrow({
          where: { id: competition.id },
        })
      ).organizer,
    ).toBe(newName);
  });

  it("a club organising an FFD-synced competition cannot be renamed, but its mode can change", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const competition = await prisma.competition.create({
      data: {
        title: "Gala FFD",
        date: new Date("2027-01-01"),
        location: "Paris",
        organizer: club.name.toLowerCase(),
        ffdId: `ffd-${randomUUID()}`,
      },
    });
    createdCompetitionIds.push(competition.id);

    await expect(
      clubs.update(admin.id, club.id, { name: `Club ${randomUUID()}` }),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        message: expect.stringContaining(
          "synchronisées avec la FFD",
        ) as unknown,
      },
    });
    expect(
      (await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).name,
    ).toBe(club.name);

    await clubs.update(admin.id, club.id, {
      registrationMode: ClubRegistrationMode.CLUB_ONLY,
    });
    expect(
      (await prisma.club.findUniqueOrThrow({ where: { id: club.id } }))
        .registrationMode,
    ).toBe(ClubRegistrationMode.CLUB_ONLY);
  });

  it("a rename onto an existing name in another casing is refused", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const taken = await newClub();

    await expect(
      clubs.update(admin.id, club.id, { name: taken.name.toUpperCase() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a rename onto an existing name changes nothing", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const taken = await newClub();
    const member = await create({ clubId: club.id, clubName: club.name });

    await expect(
      clubs.update(admin.id, club.id, { name: taken.name }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      (await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).name,
    ).toBe(club.name);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: member.id } }))
        .clubName,
    ).toBe(club.name);
  });

  it("deletes an empty club and refuses one that still has a member", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const empty = await newClub();
    const busy = await newClub();
    await create({ clubId: busy.id, clubName: busy.name });

    await clubs.delete(admin.id, empty.id);
    expect(
      await prisma.club.findUnique({ where: { id: empty.id } }),
    ).toBeNull();

    await expect(clubs.delete(admin.id, busy.id)).rejects.toMatchObject({
      status: 409,
      response: { memberCount: 1 },
    });
    expect(
      await prisma.club.findUnique({ where: { id: busy.id } }),
    ).not.toBeNull();
  });

  it("disabling a club blocks its CLUB accounts but not its licensees", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const hash = await bcrypt.hash(PASSWORD, 12);
    const clubAccount = await create({
      role: UserRole.CLUB,
      clubId: club.id,
      clubName: club.name,
      password: hash,
    });
    const licensee = await create({
      clubId: club.id,
      clubName: club.name,
      password: hash,
    });

    await clubs.setStatus(admin.id, club.id, false);

    await expect(
      auth.validateUser(clubAccount.email, PASSWORD),
    ).rejects.toThrow("Compte désactivé. Contactez la fédération.");
    await expect(
      auth.validateUser(licensee.email, PASSWORD),
    ).resolves.toMatchObject({ id: licensee.id });
  });

  it("an extra CLUB role is granted by the back-office, counted on the club and dropped while the club is disabled", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await newClub();
    const licensee = await create({ clubId: club.id, clubName: club.name });

    await service.update(admin.id, licensee.id, {
      extraRoles: [UserRole.CLUB],
    });

    const detail = await moduleRef
      .get(AdminUsersQueryService)
      .detail(licensee.id);
    expect(detail.extraRoles).toEqual([UserRole.CLUB]);
    expect(detail.roles).toEqual([UserRole.LICENSEE, UserRole.CLUB]);
    await expect(
      strategy.validate({
        sub: licensee.id,
        email: licensee.email,
        role: licensee.role,
      }),
    ).resolves.toMatchObject({ roles: [UserRole.LICENSEE, UserRole.CLUB] });
    await expect(
      moduleRef.get(AdminClubsQueryService).detail(club.id),
    ).resolves.toMatchObject({
      memberCount: 0,
      clubAccountCount: 1,
    });

    await clubs.setStatus(admin.id, club.id, false);

    await expect(
      strategy.validate({
        sub: licensee.id,
        email: licensee.email,
        role: licensee.role,
      }),
    ).resolves.toMatchObject({ roles: [UserRole.LICENSEE] });
    // The back-office keeps showing the stored role.
    await expect(
      moduleRef.get(AdminUsersQueryService).detail(licensee.id),
    ).resolves.toMatchObject({ roles: [UserRole.LICENSEE, UserRole.CLUB] });
  });
});
