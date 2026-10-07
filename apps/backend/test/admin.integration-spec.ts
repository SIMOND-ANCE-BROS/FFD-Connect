import { randomUUID } from "crypto";
import { UserRole } from "@prisma/client";
import { TestingModule } from "@nestjs/testing";
import { AdminClubAccountsService } from "../src/admin/admin-club-accounts.service";
import { AdminUsersService } from "../src/admin/admin-users.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

const userData = (o: { role?: UserRole; lastName?: string }) => ({
  email: `${randomUUID()}@test.local`,
  password: "x",
  firstName: "Test",
  lastName: o.lastName ?? "User",
  role: o.role ?? UserRole.LICENSEE,
});

describe("Admin (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let service: AdminUsersService;
  let clubAccounts: AdminClubAccountsService;
  const createdUserIds: string[] = [];
  const createdClubIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    service = moduleRef.get(AdminUsersService);
    clubAccounts = moduleRef.get(AdminClubAccountsService);
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

  it("club account creation is atomic: a duplicate club name leaves no user behind", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
    });
    createdClubIds.push(club.id);
    const email = `${randomUUID()}@test.local`;

    await expect(
      clubAccounts.create(admin.id, {
        email,
        firstName: "J",
        lastName: "M",
        clubName: club.name,
      }),
    ).rejects.toThrow("Un club porte déjà ce nom");

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("creates club + user + audit row together", async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const email = `${randomUUID()}@test.local`;

    const res = await clubAccounts.create(admin.id, {
      email,
      firstName: "J",
      lastName: "M",
      clubName: `Club ${randomUUID()}`,
    });
    createdUserIds.push(res.userId);
    createdClubIds.push(res.clubId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: res.userId },
    });
    expect(user.role).toBe(UserRole.CLUB);
    expect(user.clubId).toBe(res.clubId);
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: res.userId } }),
    ).toBe(1);
  });
});
