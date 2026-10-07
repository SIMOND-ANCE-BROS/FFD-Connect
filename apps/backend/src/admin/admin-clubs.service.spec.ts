import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClubRegistrationMode, Prisma, UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import { AdminClubsService } from "./admin-clubs.service";

const current = {
  id: "c1",
  name: "Club A",
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
};

describe("AdminClubsService", () => {
  let service: AdminClubsService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.club.update.mockResolvedValue({} as never);
    prisma.user.count.mockResolvedValue(0);
    prisma.competition.count.mockResolvedValue(0);
    prisma.partnership.count.mockResolvedValue(0);
    prisma.soloTeam.count.mockResolvedValue(0);
    audit = { record: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: "c1" }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminClubsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminClubsQueryService, useValue: query },
      ],
    }).compile();
    service = moduleRef.get(AdminClubsService);
  });

  describe("update", () => {
    beforeEach(() => {
      prisma.club.findUnique
        .mockResolvedValueOnce(current as never) // current values
        .mockResolvedValueOnce(null); // no other club with the new name
    });

    it("renames, rewrites every copy of the name, and audits the diff", async () => {
      await expect(
        service.update("admin-1", "c1", { name: " Club Z " }),
      ).resolves.toEqual({
        id: "c1",
      });

      expect(prisma.club.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { name: "Club Z" },
        select: { id: true },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ clubId: "c1" }, { clubId: null, clubName: "Club A" }],
        },
        data: { clubName: "Club Z" },
      });
      expect(prisma.license.updateMany).toHaveBeenCalledWith({
        where: { clubName: "Club A" },
        data: { clubName: "Club Z" },
      });
      expect(prisma.competition.updateMany).toHaveBeenCalledWith({
        where: { organizer: "Club A" },
        data: { organizer: "Club Z" },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "CLUB_UPDATE",
        targetType: "CLUB",
        targetId: "c1",
        before: { name: "Club A" },
        after: { name: "Club Z" },
      });
    });

    it("changes the registration mode without any cascade", async () => {
      await service.update("admin-1", "c1", {
        registrationMode: ClubRegistrationMode.CLUB_ONLY,
      });
      expect(prisma.club.update.mock.calls[0][0].data).toEqual({
        registrationMode: ClubRegistrationMode.CLUB_ONLY,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.license.updateMany).not.toHaveBeenCalled();
      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
    });

    it("writes and audits nothing when the values are unchanged", async () => {
      await service.update("admin-1", "c1", { name: "Club A" });
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(query.detail).toHaveBeenCalledWith("c1");
    });

    it("409s with the clashing club id when the new name is taken, changing nothing", async () => {
      prisma.club.findUnique
        .mockReset()
        .mockResolvedValueOnce(current as never)
        .mockResolvedValueOnce({ id: "c2", name: "Club B" } as never);

      await expect(
        service.update("admin-1", "c1", { name: "Club B" }),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          message: "Un club porte déjà ce nom",
          existingClubId: "c2",
        },
      });
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it("maps a concurrent rename (P2002) to the same 409", async () => {
      prisma.club.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "x",
          meta: { target: ["name"] },
        }),
      );
      await expect(
        service.update("admin-1", "c1", { name: "Club Z" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("404s on an unknown club", async () => {
      prisma.club.findUnique.mockReset().mockResolvedValue(null);
      await expect(
        service.update("admin-1", "nope", { name: "X Y" }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("setStatus", () => {
    it("deactivates, revokes the sessions of the club's CLUB accounts only, and audits", async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: "c1",
        disabledAt: null,
      } as never);

      await service.setStatus("admin-1", "c1", false);

      expect(prisma.club.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { disabledAt: expect.any(Date) as unknown },
        select: { id: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { revoked: false, user: { clubId: "c1", role: UserRole.CLUB } },
        data: { revoked: true, revokedAt: expect.any(Date) as unknown },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "CLUB_DISABLE",
        targetType: "CLUB",
        targetId: "c1",
      });
    });

    it("reactivates without touching sessions", async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: "c1",
        disabledAt: new Date(),
      } as never);
      await service.setStatus("admin-1", "c1", true);
      expect(prisma.club.update.mock.calls[0][0].data).toEqual({
        disabledAt: null,
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: "CLUB_ENABLE" }),
      );
    });

    it("is idempotent", async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: "c1",
        disabledAt: new Date(),
      } as never);
      await service.setStatus("admin-1", "c1", false);
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("404s on an unknown club", async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(
        service.setStatus("admin-1", "nope", false),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("delete", () => {
    beforeEach(() => {
      prisma.club.findUnique.mockResolvedValue({
        id: "c1",
        name: "Club A",
      } as never);
    });

    it("deletes an empty club and audits its name", async () => {
      await service.delete("admin-1", "c1");
      expect(prisma.club.delete).toHaveBeenCalledWith({
        where: { id: "c1" },
        select: { id: true },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "CLUB_DELETE",
        targetType: "CLUB",
        targetId: "c1",
        before: { name: "Club A" },
      });
    });

    it("409s with every count when something still points at the club", async () => {
      prisma.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      prisma.partnership.count.mockResolvedValue(3);

      await expect(service.delete("admin-1", "c1")).rejects.toMatchObject({
        status: 409,
        response: {
          message: "Ce club n'est pas vide : désactivez-le plutôt.",
          memberCount: 2,
          clubAccountCount: 1,
          competitionCount: 0,
          partnershipCount: 3,
          soloTeamCount: 0,
        },
      });
      expect(prisma.club.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("404s on an unknown club", async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(service.delete("admin-1", "nope")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
