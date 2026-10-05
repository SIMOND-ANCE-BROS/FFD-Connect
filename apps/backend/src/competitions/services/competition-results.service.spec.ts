import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { createMockPrismaService } from "../__mocks__/types";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionResultsService } from "./competition-results.service";

const mockPrismaService = createMockPrismaService();
const mockRedisService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(null),
};
const mockCacheService = {
  invalidateCompetition: jest.fn().mockResolvedValue(null),
  invalidateAll: jest.fn().mockResolvedValue(null),
  invalidateResults: jest.fn().mockResolvedValue(null),
};

describe("CompetitionResultsService", () => {
  let service: CompetitionResultsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionResultsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        { provide: RedisService, useValue: mockRedisService },
        { provide: CompetitionCacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<CompetitionResultsService>(CompetitionResultsService);
    jest.clearAllMocks();
  });

  describe("getResults", () => {
    it("should return results", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue({
        id: "c1",
        events: [
          {
            id: "e1",
            category: "Latin",
            ageGroup: "Adult",
            results: [{ id: "res1", ranking: 1 }],
          },
        ],
      });
      const result = await service.getResults("c1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("res1");
    });

    it("should throw NotFoundException if competition not found", async () => {
      mockPrismaService.competition.findUnique.mockResolvedValue(null);
      await expect(service.getResults("invalid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return cached results if available", async () => {
      const cachedData = [{ id: "res1", ranking: 1 }];
      mockRedisService.get.mockResolvedValueOnce(JSON.stringify(cachedData));

      const result = await service.getResults("c1");

      expect(mockRedisService.get).toHaveBeenCalled();
      expect(mockPrismaService.competition.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });
  });

  describe("getEventRegistrations", () => {
    it("should return registrations", async () => {
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "reg1", user: { firstName: "John" } },
      ]);
      const result = await service.getEventRegistrations("e1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("reg1");
    });
  });

  describe("getUserRegistrations", () => {
    it("should return user registrations", async () => {
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "reg1", event: { category: "Latin" } },
      ]);
      const result = await service.getUserRegistrations("u1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("reg1");
    });
  });

  describe("checkIn", () => {
    it("should throw NotFoundException if user not found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      await expect(service.checkIn("c1", "u1")).rejects.toThrow(
        "Utilisateur introuvable",
      );
    });

    it("should throw NotFoundException if no registrations found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([]);
      await expect(service.checkIn("c1", "u1")).rejects.toThrow(
        "Aucune inscription confirmée",
      );
    });

    it("should process check-in successfully", async () => {
      const mockUser = { id: "u1", firstName: "John", lastName: "Doe" };
      const mockReg = {
        id: "r1",
        feePaid: true,
        checkedIn: false,
        partnerName: "Partner",
        eventId: "e1",
        event: { category: "Latin" },
      };
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.registration.findMany.mockResolvedValue([mockReg]);
      mockPrismaService.registration.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkIn("c1", "u1");

      expect(result.registrations[0].status).toBe("SUCCESS");
      expect(mockPrismaService.registration.updateMany).toHaveBeenCalled();
      expect(mockCacheService.invalidateCompetition).toHaveBeenCalledWith(
        "c1",
        "u1",
      );
    });

    it("should handle JSON QR data with ID", async () => {
      const qrData = JSON.stringify({ id: "u1" });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: true, event: { category: "Latin" } },
      ]);

      await service.checkIn("c1", qrData);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: expect.anything(),
      });
    });

    it("résout l'utilisateur par numéro de licence quand l'id échoue (QR licence)", async () => {
      // Le QR licence encode le numéro de licence, pas l'id user.
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.license.findUnique.mockResolvedValue({
        user: { id: "u1", firstName: "A", lastName: "B" },
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: true, event: { category: "Latin" } },
      ]);

      const result = await service.checkIn(
        "c1",
        JSON.stringify({ id: "LIC-123" }),
      );
      expect(mockPrismaService.license.findUnique).toHaveBeenCalledWith({
        where: { number: "LIC-123" },
        select: expect.anything(),
      });
      expect(result.registrations[0].status).toBe("SUCCESS");
    });

    it("should handle unpaid registrations", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        { id: "r1", feePaid: false, event: { category: "Latin" } },
      ]);

      const result = await service.checkIn("c1", "u1");
      expect(result.registrations[0].status).toBe("ERROR");
      expect(result.registrations[0].message).toBe("Droits non payés");
    });

    it("should handle already checked-in registrations", async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: "u1",
      });
      mockPrismaService.registration.findMany.mockResolvedValue([
        {
          id: "r1",
          feePaid: true,
          checkedIn: true,
          event: { category: "Latin" },
        },
      ]);

      const result = await service.checkIn("c1", "u1");
      expect(result.registrations[0].status).toBe("ALREADY_CHECKED_IN");
    });
  });
});
