// apps/backend/src/competitions/services/competition-management.service.spec.ts
import { BadRequestException, ConflictException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionManagementService } from "./competition-management.service";
import { createMockPrismaService } from "../__mocks__/types";

const mockPrisma = createMockPrismaService();

const mockCache = {
  invalidateCompetition: jest.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
};

const mockQueue = {
  getJobs: jest.fn(),
  add: jest.fn(),
  getJob: jest.fn(),
};

describe("CompetitionManagementService", () => {
  let service: CompetitionManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionManagementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CompetitionCacheService, useValue: mockCache },
        { provide: RedisService, useValue: mockRedis },
        { provide: getQueueToken("ffd-sync"), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<CompetitionManagementService>(
      CompetitionManagementService,
    );
    jest.clearAllMocks();
  });

  describe("getRegulationConstants", () => {
    it("returns competitionTypes, eventKinds, competitionLevels, and levelsForProximiteClassificatrice", () => {
      const result = service.getRegulationConstants();
      expect(result.competitionTypes).toBeDefined();
      expect(result.eventKinds).toBeDefined();
      expect(result.competitionLevels).toBeDefined();
      expect(result.allowedEventKindsByCompetitionType).toBeDefined();
      expect(result.levelsForProximiteClassificatrice).toBeDefined();
    });
  });

  describe("enqueueSyncFFD", () => {
    it("returns jobId when no active sync", async () => {
      mockQueue.getJobs.mockResolvedValue([]);
      mockQueue.add.mockResolvedValue({ id: "job-1" });

      const result = await service.enqueueSyncFFD();

      expect(result.jobId).toBe("job-1");
      expect(mockRedis.set).toHaveBeenCalledWith(
        "ffd-sync:latest-job-id",
        "job-1",
      );
    });

    it("throws ConflictException when a sync is already running", async () => {
      mockQueue.getJobs.mockResolvedValue([{ id: "job-0" }]);

      await expect(service.enqueueSyncFFD()).rejects.toThrow(ConflictException);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("getSyncStatus", () => {
    it("returns idle when no jobId in Redis", async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.getSyncStatus();

      expect(result).toEqual({ status: "idle" });
    });

    it("returns idle when jobId exists but job not found in queue", async () => {
      mockRedis.get.mockResolvedValue("job-1");
      mockQueue.getJob.mockResolvedValue(null);

      const result = await service.getSyncStatus();

      expect(result).toEqual({ status: "idle" });
    });

    it("returns completed status with stats", async () => {
      mockRedis.get.mockResolvedValue("job-1");
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue("completed"),
        returnvalue: { competitionsAdded: 2, competitionsUpdated: 5 },
        failedReason: undefined,
      });

      const result = await service.getSyncStatus();

      expect(result.status).toBe("completed");
      expect(result.stats).toEqual({
        competitionsAdded: 2,
        competitionsUpdated: 5,
      });
    });

    it("returns failed status with error", async () => {
      mockRedis.get.mockResolvedValue("job-1");
      mockQueue.getJob.mockResolvedValue({
        getState: jest.fn().mockResolvedValue("failed"),
        returnvalue: undefined,
        failedReason: "Network timeout",
      });

      const result = await service.getSyncStatus();

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Network timeout");
    });
  });

  describe("create", () => {
    it("creates a competition with date converted to Date object", async () => {
      const mockComp = {
        id: "comp-1",
        title: "Test",
        date: new Date("2026-06-01"),
      };
      mockPrisma.competition.create.mockResolvedValue(mockComp);

      const result = await service.create({
        title: "Test",
        date: "2026-06-01",
      } as any);

      expect(mockPrisma.competition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ date: new Date("2026-06-01") }),
        }),
      );
      expect(result).toEqual(mockComp);
    });
  });

  // #821: the deadline check in CompetitionRegistrationService is only
  // reachable once this write path exists — without it every competition
  // created through the API keeps registrationDeadline = NULL and the check
  // always falls through its fail-open branch.
  describe("registrationDeadline", () => {
    const DATE = "2026-06-01T10:00:00Z";

    beforeEach(() => {
      mockPrisma.competition.create.mockResolvedValue({ id: "comp-1" });
      mockPrisma.competition.update.mockResolvedValue({ id: "comp-1" });
    });

    it("stores the deadline as a Date on create", async () => {
      await service.create({
        title: "T",
        date: DATE,
        registrationDeadline: "2026-05-20T23:59:00Z",
      } as never);

      expect(mockPrisma.competition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            registrationDeadline: new Date("2026-05-20T23:59:00Z"),
          }),
        }),
      );
    });

    it("leaves the column untouched when no deadline is given", async () => {
      await service.create({ title: "T", date: DATE } as never);

      const { data } = mockPrisma.competition.create.mock.calls[0][0];
      expect(data).not.toHaveProperty("registrationDeadline");
    });

    it("accepts a deadline exactly on the competition instant", async () => {
      await expect(
        service.create({
          title: "T",
          date: DATE,
          registrationDeadline: DATE,
        } as never),
      ).resolves.toBeDefined();
    });

    it("rejects a deadline after the competition on create", async () => {
      await expect(
        service.create({
          title: "T",
          date: DATE,
          registrationDeadline: "2026-06-02T00:00:00Z",
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.competition.create).not.toHaveBeenCalled();
    });

    it("clears the deadline when update receives null", async () => {
      await service.update("comp-1", { registrationDeadline: null });

      expect(mockPrisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ registrationDeadline: null }),
        }),
      );
      expect(mockPrisma.competition.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("validates a deadline-only update against the stored date", async () => {
      mockPrisma.competition.findUniqueOrThrow.mockResolvedValue({
        date: new Date(DATE),
      });

      await expect(
        service.update("comp-1", {
          registrationDeadline: "2026-06-05T00:00:00Z",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.competition.update).not.toHaveBeenCalled();
    });

    it("uses the payload date rather than the stored one when both move", async () => {
      await service.update("comp-1", {
        date: "2026-07-01T10:00:00Z",
        registrationDeadline: "2026-06-20T00:00:00Z",
      });

      // The new date makes the deadline valid; no need to read the old one.
      expect(mockPrisma.competition.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(mockPrisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            registrationDeadline: new Date("2026-06-20T00:00:00Z"),
          }),
        }),
      );
    });

    it("does not touch the column when the field is absent from the payload", async () => {
      await service.update("comp-1", { title: "Updated" });

      const { data } = mockPrisma.competition.update.mock.calls[0][0];
      expect(data).not.toHaveProperty("registrationDeadline");
    });
  });

  describe("update", () => {
    it("updates competition and invalidates cache", async () => {
      const mockComp = { id: "comp-1", title: "Updated" };
      mockPrisma.competition.update.mockResolvedValue(mockComp);

      const result = await service.update("comp-1", {
        title: "Updated",
      });

      expect(mockPrisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "comp-1" } }),
      );
      expect(mockCache.invalidateCompetition).toHaveBeenCalledWith("comp-1");
      expect(result).toEqual(mockComp);
    });
  });
});
