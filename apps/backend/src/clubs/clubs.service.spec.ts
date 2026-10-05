// apps/backend/src/clubs/clubs.service.spec.ts
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";

type MockPrisma = DeepMockProxy<PrismaClient>;

describe("ClubsService", () => {
  let service: ClubsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    const module = await Test.createTestingModule({
      providers: [ClubsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<ClubsService>(ClubsService);
    jest.clearAllMocks();
  });

  describe("getClubIdForOrganizer", () => {
    it("throws NotFoundException when user not found", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getClubIdForOrganizer("unknown")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws BadRequestException when user role is not CLUB", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.LICENSEE,
        clubId: null,
        clubName: null,
      } as any);
      await expect(service.getClubIdForOrganizer("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns clubId when user has a clubId and club exists", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: "club-1",
        clubName: null,
      } as any);
      prisma.club.findUnique.mockResolvedValue({
        id: "club-1",
        name: "Test Club",
      } as any);
      const result = await service.getClubIdForOrganizer("user-1");
      expect(result).toBe("club-1");
    });

    it("throws BadRequestException when user has neither clubId nor clubName", async () => {
      prisma.user.findUnique.mockResolvedValue({
        role: UserRole.CLUB,
        clubId: null,
        clubName: null,
      } as any);
      await expect(service.getClubIdForOrganizer("user-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("findOrCreateByName", () => {
    it("throws BadRequestException for empty name", async () => {
      await expect(service.findOrCreateByName("")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns existing club when found by name", async () => {
      prisma.club.findFirst.mockResolvedValue({
        id: "club-1",
        name: "Test Club",
      } as any);
      const result = await service.findOrCreateByName("Test Club");
      expect(result.id).toBe("club-1");
    });

    it("creates and returns a new club when not found", async () => {
      prisma.club.findFirst.mockResolvedValue(null);
      prisma.club.create.mockResolvedValue({
        id: "club-2",
        name: "New Club",
      } as any);
      const result = await service.findOrCreateByName("New Club");
      expect(result.id).toBe("club-2");
    });
  });
});
