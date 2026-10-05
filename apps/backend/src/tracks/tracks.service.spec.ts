import { HttpException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, TrackStatus } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { BpmService } from "./bpm.service";
import { ReportTrackReason } from "./dto/report-track.dto";
import { TracksService } from "./tracks.service";

describe("TracksService", () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let mockBpm: { calculateMpm: jest.Mock };
  let mockBlob: { isEnabled: jest.Mock; deleteFile: jest.Mock };
  let mockNotifications: { createForUser: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    mockBpm = {
      calculateMpm: jest.fn((bpm: number) => Math.round(bpm)),
    };
    mockBlob = {
      isEnabled: jest.fn().mockReturnValue(false),
      deleteFile: jest.fn().mockResolvedValue(true),
    };
    mockNotifications = {
      createForUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: BpmService, useValue: mockBpm },
        { provide: BlobStorageService, useValue: mockBlob },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<TracksService>(TracksService);
  });

  describe("findAll", () => {
    it("returns tracks from prisma (status: READY filter applied)", async () => {
      const mockResult = [{ id: "1", title: "Test", createdAt: new Date() }];
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue(mockResult);
      prisma.track.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.data).toEqual(mockResult);
      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ status: TrackStatus.READY }),
            ]),
          }),
        }),
      );
    });

    it("excludes blacklisted tracks via the library filter", async () => {
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue([]);
      prisma.track.count.mockResolvedValue(0);

      await service.findAll();

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ blacklisted: false }]),
          }),
        }),
      );
    });

    it("masks the title for non-admins when titleMasked is set", async () => {
      const masked = { id: "1", title: "Real Title", titleMasked: true };
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue([masked]);
      prisma.track.count.mockResolvedValue(1);

      const result = await service.findAll(undefined, false);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ title: "Titre masqué", titleMasked: true }),
      );
    });

    it("keeps the real title for admins even when titleMasked is set", async () => {
      const masked = { id: "1", title: "Real Title", titleMasked: true };
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue([masked]);
      prisma.track.count.mockResolvedValue(1);

      const result = await service.findAll(undefined, true);

      expect(result.data[0]).toEqual(
        expect.objectContaining({ title: "Real Title", titleMasked: true }),
      );
    });
  });

  describe("findOne", () => {
    it("returns track when found", async () => {
      const mockTrack = {
        id: "track-1",
        title: "Test",
        artist: "Artist",
        bpm: 120,
        filename: "test.mp3",
        artwork: null,
        style: null,
        createdAt: new Date(),
      };
      // @ts-expect-error - testing partial return
      prisma.track.findUnique.mockResolvedValue(mockTrack);

      const result = await service.findOne("track-1");

      expect(result).toBe(mockTrack);
      expect(prisma.track.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "track-1" } }),
      );
    });

    it("throws NotFoundException when not found", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(service.findOne("nonexistent")).rejects.toThrow(
        new NotFoundException("Track nonexistent not found"),
      );
    });
  });

  describe("updateTrack", () => {
    it("throws NotFoundException when the track is missing", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTrack("missing", "user-1", false, { title: "X" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("forbids a non-admin from editing someone else's track", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "owner", rawBpm: 0 },
      );

      await expect(
        service.updateTrack("t1", "intruder", false, { title: "X" }),
      ).rejects.toThrow(HttpException);
      expect(prisma.track.update).not.toHaveBeenCalled();
    });

    it("lets an admin edit a track owned by someone else", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "owner", rawBpm: 0 },
      );
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      await service.updateTrack("t1", "admin", true, { title: "New" });

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "t1" },
          data: { title: "New" },
        }),
      );
    });

    it("recomputes MPM from rawBpm when a dance is chosen without a manual tempo", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 104 },
      );
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});
      mockBpm.calculateMpm.mockReturnValue(26);

      await service.updateTrack("t1", "user-1", false, { style: "Rumba" });

      expect(mockBpm.calculateMpm).toHaveBeenCalledWith(104, "Rumba");
      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ style: "Rumba", bpm: 26 }),
        }),
      );
    });

    it("respects a manual bpm override and skips the MPM recompute", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 104 },
      );
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      await service.updateTrack("t1", "user-1", false, {
        style: "Rumba",
        bpm: 52,
      });

      expect(mockBpm.calculateMpm).not.toHaveBeenCalled();
      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bpm: 52 }),
        }),
      );
    });

    it("does nothing when the patch is empty", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 0 },
      );

      await service.updateTrack("t1", "user-1", false, {});

      expect(prisma.track.update).not.toHaveBeenCalled();
    });

    it("lets an admin set the moderation flags (titleMasked, blacklisted)", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "owner", rawBpm: 0 },
      );
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      await service.updateTrack("t1", "admin", true, {
        titleMasked: true,
        blacklisted: true,
      });

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { titleMasked: true, blacklisted: true },
        }),
      );
    });

    it("ignores moderation flags coming from a non-admin (defense in depth)", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 0 },
      );

      await service.updateTrack("t1", "user-1", false, {
        titleMasked: true,
        blacklisted: true,
      });

      // No editable field was provided → nothing to update.
      expect(prisma.track.update).not.toHaveBeenCalled();
    });

    it("admin sets paso clash timecodes, sorted + deduplicated", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 0 },
      );
      // @ts-expect-error - testing partial return
      prisma.track.update.mockResolvedValue({});

      await service.updateTrack("t1", "admin", true, {
        clashTimecodes: [40, 12.5, 40, 68.3],
      });

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { clashTimecodes: [12.5, 40, 68.3] },
        }),
      );
    });

    it("ignores clash timecodes from a non-admin", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 0 },
      );

      await service.updateTrack("t1", "user-1", false, {
        clashTimecodes: [10, 20],
      });

      expect(prisma.track.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteTrack", () => {
    it("throws NotFoundException when the track is missing", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(service.deleteTrack("missing")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.track.delete).not.toHaveBeenCalled();
    });

    it("deletes the DB row and the local file when blob storage is disabled", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { filename: "song.mp3" },
      );
      // @ts-expect-error - testing partial return
      prisma.track.delete.mockResolvedValue({});

      await service.deleteTrack("t1");

      expect(prisma.track.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
      expect(mockBlob.deleteFile).not.toHaveBeenCalled();
    });

    it("deletes the blob when blob storage is enabled", async () => {
      mockBlob.isEnabled.mockReturnValue(true);
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { filename: "song.mp3" },
      );
      // @ts-expect-error - testing partial return
      prisma.track.delete.mockResolvedValue({});

      await service.deleteTrack("t1");

      expect(prisma.track.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
      expect(mockBlob.deleteFile).toHaveBeenCalledWith("song.mp3");
    });
  });

  describe("reportTrack", () => {
    it("throws NotFoundException when the track does not exist", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(
        service.reportTrack(
          "missing",
          ReportTrackReason.TITLE,
          undefined,
          "u1",
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockNotifications.createForUser).not.toHaveBeenCalled();
    });

    it("notifies every admin with the FR reason label and data payload", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { title: "My Song" },
      );
      prisma.user.findMany.mockResolvedValue(
        // @ts-expect-error - testing partial return
        [{ id: "admin-1" }, { id: "admin-2" }],
      );

      await service.reportTrack(
        "track-1",
        ReportTrackReason.MPM,
        undefined,
        "reporter-9",
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: "ADMIN" } }),
      );
      expect(mockNotifications.createForUser).toHaveBeenCalledTimes(2);
      expect(mockNotifications.createForUser).toHaveBeenCalledWith(
        "admin-1",
        NotificationType.TRACK_REPORT,
        "Signalement musique",
        "«My Song» — MPM signalé",
        { trackId: "track-1", reason: "MPM", reporterId: "reporter-9" },
      );
      expect(mockNotifications.createForUser).toHaveBeenCalledWith(
        "admin-2",
        NotificationType.TRACK_REPORT,
        "Signalement musique",
        "«My Song» — MPM signalé",
        expect.objectContaining({ trackId: "track-1" }),
      );
    });

    it("appends the optional message to the notification body", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { title: "My Song" },
      );
      prisma.user.findMany.mockResolvedValue(
        // @ts-expect-error - testing partial return
        [{ id: "admin-1" }],
      );

      await service.reportTrack(
        "track-1",
        ReportTrackReason.PASO_CLASH,
        "  appel décalé  ",
        "reporter-9",
      );

      expect(mockNotifications.createForUser).toHaveBeenCalledWith(
        "admin-1",
        NotificationType.TRACK_REPORT,
        "Signalement musique",
        "«My Song» — Clash paso doble signalé : appel décalé",
        expect.any(Object),
      );
    });

    it("does not throw when there is no admin to notify", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { title: "My Song" },
      );
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.reportTrack(
          "track-1",
          ReportTrackReason.OTHER,
          undefined,
          "u1",
        ),
      ).resolves.toBeUndefined();
      expect(mockNotifications.createForUser).not.toHaveBeenCalled();
    });
  });
});
