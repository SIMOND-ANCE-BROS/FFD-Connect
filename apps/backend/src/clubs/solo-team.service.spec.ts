// apps/backend/src/clubs/solo-team.service.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import { SoloTeamService } from "./solo-team.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

describe("SoloTeamService", () => {
  let service: SoloTeamService;
  let prisma: MockPrisma;
  let clubsService: jest.Mocked<Pick<ClubsService, "getClubIdForOrganizer">>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    clubsService = {
      getClubIdForOrganizer: jest.fn().mockResolvedValue("club-1"),
    };

    const module = await Test.createTestingModule({
      providers: [
        SoloTeamService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClubsService, useValue: clubsService },
      ],
    }).compile();

    service = module.get<SoloTeamService>(SoloTeamService);
  });

  describe("getSoloTeams", () => {
    it("returns solo teams for the organizer's club", async () => {
      prisma.soloTeam.findMany.mockResolvedValue([
        {
          id: "team-1",
          name: "Équipe A",
          clubId: "club-1",
          level: "Débutant",
          members: [],
        } as any,
      ]);

      const result = await service.getSoloTeams("organizer-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("team-1");
    });
  });

  describe("createSoloTeam", () => {
    it("creates and returns a new solo team", async () => {
      prisma.soloTeam.create.mockResolvedValue({
        id: "team-1",
        name: "Équipe A",
        clubId: "club-1",
        level: "Débutant",
      } as any);

      const result = await service.createSoloTeam("organizer-1", {
        name: "Équipe A",
        level: "Débutant",
      } as any);
      expect((result as any).id).toBe("team-1");
    });
  });

  describe("addSoloTeamMember", () => {
    it("throws NotFoundException when solo team not found", async () => {
      prisma.soloTeam.findFirst.mockResolvedValue(null);
      await expect(
        service.addSoloTeamMember("organizer-1", "team-999", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException when user is not a member of the club", async () => {
      prisma.soloTeam.findFirst.mockResolvedValue({
        id: "team-1",
        clubId: "club-1",
      } as any);
      prisma.user.findUnique.mockResolvedValue({
        clubId: "other-club",
        clubName: null,
      } as any);
      prisma.club.findUnique.mockResolvedValue({ name: "Test Club" } as any);
      await expect(
        service.addSoloTeamMember("organizer-1", "team-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("removeSoloTeamMember", () => {
    it("throws NotFoundException when solo team not found", async () => {
      prisma.soloTeam.findFirst.mockResolvedValue(null);
      await expect(
        service.removeSoloTeamMember("organizer-1", "team-999", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("removes member and recalculates level", async () => {
      prisma.soloTeam.findFirst.mockResolvedValue({
        id: "team-1",
        clubId: "club-1",
      } as any);
      prisma.soloTeamMember.deleteMany.mockResolvedValue({ count: 1 });
      prisma.soloTeamMember.findMany.mockResolvedValue([]);
      prisma.soloTeam.update.mockResolvedValue({
        id: "team-1",
        level: "Débutant",
        members: [],
      } as any);

      const result = await service.removeSoloTeamMember(
        "organizer-1",
        "team-1",
        "user-1",
      );
      expect((result as any).level).toBe("Débutant");
    });
  });

  describe("recalculateSoloTeamLevel", () => {
    it("sets level to Débutant when all members are Débutant", async () => {
      prisma.soloTeamMember.findMany.mockResolvedValue([
        { user: { competitionLevel: "Débutant" } } as any,
      ]);
      prisma.soloTeam.update.mockResolvedValue({
        id: "team-1",
        level: "Débutant",
        members: [],
      } as any);

      await service.recalculateSoloTeamLevel("team-1");
      expect(prisma.soloTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { level: "Débutant" } }),
      );
    });

    it("sets level to Intermédiaire when at least one member is Intermédiaire", async () => {
      prisma.soloTeamMember.findMany.mockResolvedValue([
        { user: { competitionLevel: "Débutant" } } as any,
        { user: { competitionLevel: "Intermédiaire" } } as any,
      ]);
      prisma.soloTeam.update.mockResolvedValue({
        id: "team-1",
        level: "Intermédiaire",
        members: [],
      } as any);

      await service.recalculateSoloTeamLevel("team-1");
      expect(prisma.soloTeam.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { level: "Intermédiaire" } }),
      );
    });
  });
});
