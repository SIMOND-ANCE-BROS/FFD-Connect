import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";

const current = {
  id: "u1",
  firstName: "Jeanne",
  lastName: "Martin",
  clubId: "c1",
  clubName: "Club A",
  category: "Latine", // legacy value outside USER_CATEGORIES
  ageGroup: "Adulte",
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  nationalRanking: 12,
  role: UserRole.LICENSEE,
};

describe("AdminUsersService.update", () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(current as never);
    prisma.user.update.mockResolvedValue({} as never);
    audit = { record: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: "u1" }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it("updates only sent fields and audits the diff, keeping a legacy category", async () => {
    await service.update("admin-1", "u1", { lastName: "Durand" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastName: "Durand" },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: "admin-1",
      action: "USER_UPDATE",
      targetType: "USER",
      targetId: "u1",
      before: { lastName: "Martin" },
      after: { lastName: "Durand" },
    });
    expect(query.detail).toHaveBeenCalledWith("u1");
  });

  it("syncs clubName when clubId changes", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c2",
      name: "Club B",
    } as never);

    await service.update("admin-1", "u1", { clubId: "c2" });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: "c2",
      clubName: "Club B",
    });
  });

  it("clears club and clubName on clubId null, and clears a ranking on null", async () => {
    await service.update("admin-1", "u1", {
      clubId: null,
      nationalRanking: null,
    });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: null,
      clubName: null,
      nationalRanking: null,
    });
  });

  it("rejects an unknown club with 400", async () => {
    prisma.club.findUnique.mockResolvedValue(null);
    await expect(
      service.update("admin-1", "u1", { clubId: "c9" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses an admin changing their own role", async () => {
    await expect(
      service.update("u1", "u1", { role: UserRole.LICENSEE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows an admin to edit their own other fields", async () => {
    await service.update("u1", "u1", { firstName: "Gabin" });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("404s on unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.update("admin-1", "nope", { lastName: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("writes nothing and audits nothing when values are unchanged", async () => {
    await service.update("admin-1", "u1", { lastName: "Martin" });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(query.detail).toHaveBeenCalledWith("u1");
  });
});
