import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { withRole } from "../auth/roles";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminUserDetailSelect,
  adminUserListSelect,
} from "../utils/prisma-selects";
import {
  AdminUsersQueryService,
  licenseStatus,
} from "./admin-users.query-service";

const row = {
  id: "u1",
  email: "a@b.fr",
  firstName: "Jeanne",
  lastName: "Martin",
  role: UserRole.LICENSEE,
  extraRoles: [] as UserRole[],
  clubId: "c1",
  clubName: "Club A",
  category: "Latin",
  ageGroup: "Adulte",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  disabledAt: null,
  license: { number: "L1", validUntil: new Date("2999-08-31T00:00:00Z") },
};

describe("AdminUsersQueryService", () => {
  let service: AdminUsersQueryService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersQueryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersQueryService);
  });

  it("builds the where clause from every filter", async () => {
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await service.list({
      skip: 50,
      take: 50,
      search: "  mar ",
      role: UserRole.CLUB,
      clubId: "c1",
      category: "Latin",
      createdFrom: "2026-09-01",
      createdTo: "2026-09-30",
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { contains: "mar", mode: "insensitive" } },
          { firstName: { contains: "mar", mode: "insensitive" } },
          { lastName: { contains: "mar", mode: "insensitive" } },
        ],
        AND: [withRole(UserRole.CLUB)],
        clubId: "c1",
        category: "Latin",
        createdAt: {
          gte: new Date("2026-09-01T00:00:00.000Z"),
          lt: new Date("2026-10-01T00:00:00.000Z"),
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 50,
      take: 50,
      select: adminUserListSelect,
    });
  });

  it("ignores a blank search, defaults to 50 and maps license status", async () => {
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([row] as never);

    const page = await service.list({ search: "   " });

    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args?.where).toEqual({});
    expect(args?.take).toBe(50);
    expect(page.data[0]).toMatchObject({ id: "u1", licenseStatus: "ACTIVE" });
    expect(page.data[0]).not.toHaveProperty("license");
  });

  it("filters on main and extra roles without touching the search OR", async () => {
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    await service.list({ role: UserRole.CLUB });
    expect(prisma.user.findMany.mock.calls[0][0]?.where).toEqual({
      AND: [withRole(UserRole.CLUB)],
    });
  });

  it("returns extraRoles and roles on each item", async () => {
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([
      { ...row, role: UserRole.LICENSEE, extraRoles: [UserRole.CLUB] },
    ] as never);
    const page = await service.list({});
    expect(page.data[0]).toMatchObject({
      extraRoles: [UserRole.CLUB],
      roles: [UserRole.LICENSEE, UserRole.CLUB],
    });
  });

  it("detail lists the stored roles even when the club is disabled", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...row,
      extraRoles: [UserRole.CLUB],
      club: { disabledAt: new Date("2026-10-07T10:00:00Z") },
      license: null,
    } as never);
    const d = await service.detail("u1");
    expect(d.roles).toEqual([UserRole.LICENSEE, UserRole.CLUB]);
    expect(d.extraRoles).toEqual([UserRole.CLUB]);
  });

  it("detail flattens the license", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...row,
      birthDate: null,
      nationalRanking: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      wdsfMin: null,
      wdsfExpiresOn: null,
      lastLoginAt: null,
      updatedAt: new Date(),
    } as never);
    const d = await service.detail("u1");
    expect(d).toMatchObject({
      licenseNumber: "L1",
      licenseStatus: "ACTIVE",
      lastLoginAt: null,
    });
    expect(d).not.toHaveProperty("license");
  });

  it("detail throws 404 for an unknown id", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.detail("nope")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "nope" },
      select: adminUserDetailSelect,
    });
  });

  it.each([
    ["active", { disabledAt: null }],
    ["disabled", { disabledAt: { not: null } }],
  ] as const)("filters on status %s", async (status, where) => {
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    await service.list({ status });
    expect(prisma.user.findMany.mock.calls[0][0]?.where).toEqual(where);
  });

  it("detail exposes the club deactivation and hides the relation", async () => {
    const at = new Date("2026-10-07T10:00:00Z");
    prisma.user.findUnique.mockResolvedValue({
      ...row,
      club: { disabledAt: at },
      license: null,
    } as never);
    const d = await service.detail("u1");
    expect(d.clubDisabledAt).toEqual(at);
    expect(d).not.toHaveProperty("club");
  });

  it.each([
    ["with", { id: "a1" }, true],
    ["without", null, false],
  ] as const)(
    "detail exposes createdByAdmin %s a creation audit row",
    async (_l, auditRow, expected) => {
      prisma.user.findUnique.mockResolvedValue({
        ...row,
        club: null,
      } as never);
      prisma.adminAuditLog.findFirst.mockResolvedValue(auditRow as never);
      const d = await service.detail("u1");
      expect(d.createdByAdmin).toBe(expected);
      expect(prisma.adminAuditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetId: "u1" }) as unknown,
        }),
      );
    },
  );
});

describe("licenseStatus", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("is null without license", () =>
    expect(licenseStatus(null, now)).toBeNull());
  it("is EXPIRED before now", () =>
    expect(
      licenseStatus({ validUntil: new Date("2026-10-06T00:00:00Z") }, now),
    ).toBe("EXPIRED"));
  it("is ACTIVE on or after now", () =>
    expect(licenseStatus({ validUntil: now }, now)).toBe("ACTIVE"));
});
