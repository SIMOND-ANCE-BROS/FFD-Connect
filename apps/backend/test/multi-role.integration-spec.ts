import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { withActiveRole, withRole } from "../src/auth/roles";
import { PartnershipQueryService } from "../src/clubs/partnership-query.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

describe("Multi-role (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let partnerships: PartnershipQueryService;
  const userIds: string[] = [];
  const clubIds: string[] = [];

  const user = async (o: {
    role: UserRole;
    extraRoles?: UserRole[];
    clubId?: string;
  }) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "User",
        role: o.role,
        extraRoles: o.extraRoles ?? [],
        ...(o.clubId && { clubId: o.clubId }),
      },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    partnerships = moduleRef.get(PartnershipQueryService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    userIds.length = 0;
    clubIds.length = 0;
  });

  afterAll(() => moduleRef.close());

  it("withRole matches main and extra roles in Postgres", async () => {
    const main = await user({ role: UserRole.CLUB });
    const extra = await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
    });
    const neither = await user({ role: UserRole.LICENSEE });
    const found = await prisma.user.findMany({
      where: {
        AND: [withRole(UserRole.CLUB), { id: { in: [main, extra, neither] } }],
      },
      select: { id: true },
      take: 10,
    });
    expect(found.map((u) => u.id).sort()).toEqual([main, extra].sort());
  });

  it("withActiveRole ignores an extra CLUB role while its club is disabled", async () => {
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const main = await user({ role: UserRole.CLUB, clubId: club.id });
    const extra = await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
      clubId: club.id,
    });
    await prisma.club.update({
      where: { id: club.id },
      data: { disabledAt: new Date() },
    });
    const ids = { id: { in: [main, extra] } };
    const active = await prisma.user.findMany({
      where: { AND: [withActiveRole(UserRole.CLUB), ids] },
      select: { id: true },
      take: 10,
    });
    const stored = await prisma.user.findMany({
      where: { AND: [withRole(UserRole.CLUB), ids] },
      select: { id: true },
      take: 10,
    });
    expect(active.map((u) => u.id)).toEqual([main]);
    expect(stored.map((u) => u.id).sort()).toEqual([main, extra].sort());
  });

  it("a licensee with an extra CLUB role lists their club's dancers, themselves included", async () => {
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const other = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
      select: { id: true },
    });
    clubIds.push(other.id);
    const rep = await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
      clubId: club.id,
    });
    const dancer = await user({ role: UserRole.LICENSEE, clubId: club.id });
    const clubMainWithDancer = await user({
      role: UserRole.CLUB,
      extraRoles: [UserRole.LICENSEE],
      clubId: club.id,
    });
    const elsewhere = await user({ role: UserRole.LICENSEE, clubId: other.id });

    const members = await partnerships.getMembersForPartnership(rep);
    const ids = members.map((m: { id: string }) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([rep, dancer, clubMainWithDancer]),
    );
    expect(ids).not.toContain(elsewhere);
  });
});
