import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClubRegistrationMode, UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubListSelect,
  adminClubMemberSelect,
  adminClubOptionSelect,
} from "../utils/prisma-selects";
import { AdminClubsQueryService } from "./admin-clubs.query-service";

const club = {
  id: "c1",
  name: "Club A",
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  disabledAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("AdminClubsQueryService", () => {
  let service: AdminClubsQueryService;
  let prisma: MockPrismaService;
  let groupBy: jest.Mock;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    groupBy = prisma.user.groupBy as unknown as jest.Mock;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminClubsQueryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AdminClubsQueryService);
  });

  describe("list", () => {
    it("filters, sorts by name and adds counts and the HelloAsso flag without reading secrets", async () => {
      prisma.club.count.mockResolvedValue(2);
      prisma.club.findMany
        .mockResolvedValueOnce([
          club,
          { ...club, id: "c2", name: "Club B" },
        ] as never)
        .mockResolvedValueOnce([{ id: "c2" }] as never);
      groupBy.mockResolvedValue([
        { clubId: "c1", role: UserRole.LICENSEE, _count: { _all: 3 } },
        { clubId: "c1", role: UserRole.STAFF, _count: { _all: 1 } },
        { clubId: "c1", role: UserRole.CLUB, _count: { _all: 1 } },
      ]);

      const page = await service.list({
        search: " club ",
        status: "active",
        skip: 0,
        take: 50,
      });

      expect(prisma.club.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          name: { contains: "club", mode: "insensitive" },
          disabledAt: null,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: 0,
        take: 50,
        select: adminClubListSelect,
      });
      expect(groupBy).toHaveBeenCalledWith({
        by: ["clubId", "role"],
        where: { clubId: { in: ["c1", "c2"] } },
        _count: { _all: true },
      });
      expect(prisma.club.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: { in: ["c1", "c2"] },
          helloAssoClientId: { not: "" },
          helloAssoClientSecret: { not: "" },
          helloAssoOrgSlug: { not: "" },
        },
        select: { id: true },
        take: 2,
      });
      expect(page.data).toEqual([
        {
          ...club,
          memberCount: 4,
          clubAccountCount: 1,
          helloAssoConfigured: false,
        },
        {
          ...club,
          id: "c2",
          name: "Club B",
          memberCount: 0,
          clubAccountCount: 0,
          helloAssoConfigured: true,
        },
      ]);
      expect(page.meta.total).toBe(2);
    });

    it("filters disabled clubs and skips the extra queries on an empty page", async () => {
      prisma.club.count.mockResolvedValue(0);
      prisma.club.findMany.mockResolvedValue([]);

      await service.list({ status: "disabled" });

      expect(prisma.club.findMany.mock.calls[0][0]?.where).toEqual({
        disabledAt: { not: null },
      });
      expect(prisma.club.findMany.mock.calls[0][0]?.take).toBe(50);
      expect(groupBy).not.toHaveBeenCalled();
      expect(prisma.club.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("options", () => {
    it("lists active clubs only", async () => {
      prisma.club.findMany.mockResolvedValue([]);
      await service.options();
      expect(prisma.club.findMany).toHaveBeenCalledWith({
        where: { disabledAt: null },
        orderBy: { name: "asc" },
        take: 1000,
        select: adminClubOptionSelect,
      });
    });

    it("keeps the currently selected club even when it is disabled", async () => {
      prisma.club.findMany.mockResolvedValue([]);
      await service.options("c9");
      expect(prisma.club.findMany.mock.calls[0][0]?.where).toEqual({
        OR: [{ disabledAt: null }, { id: "c9" }],
      });
    });
  });

  describe("detail", () => {
    it("adds every usage count, the HelloAsso flag and the first 200 members", async () => {
      prisma.club.findUnique.mockResolvedValue(club as never);
      prisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
      prisma.competition.count.mockResolvedValue(2);
      prisma.partnership.count.mockResolvedValue(0);
      prisma.soloTeam.count.mockResolvedValue(0);
      prisma.club.findMany.mockResolvedValue([{ id: "c1" }] as never);
      const member = {
        id: "u1",
        firstName: "Jeanne",
        lastName: "Martin",
        email: "j@x.fr",
        role: UserRole.LICENSEE,
        disabledAt: null,
      };
      prisma.user.findMany.mockResolvedValue([member] as never);

      await expect(service.detail("c1")).resolves.toEqual({
        ...club,
        memberCount: 3,
        clubAccountCount: 1,
        competitionCount: 2,
        partnershipCount: 0,
        soloTeamCount: 0,
        helloAssoConfigured: true,
        members: [member],
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { clubId: "c1" },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
        take: 200,
        select: adminClubMemberSelect,
      });
    });

    it("404s on an unknown club", async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(service.detail("nope")).rejects.toThrow(
        new NotFoundException("Club introuvable"),
      );
    });
  });
});
