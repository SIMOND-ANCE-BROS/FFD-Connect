import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { TrackStatus } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import {
  HIDDEN_TRACK_CASES,
  TrackRow,
  useTrackTable,
} from "../../test/mocks/track-where.mock";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { BpmService } from "./bpm.service";
import { TracksService } from "./tracks.service";

describe("TracksService", () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let mockBpm: { calculateMpm: jest.Mock };
  let mockBlob: { isEnabled: jest.Mock; deleteFile: jest.Mock };

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: BpmService, useValue: mockBpm },
        { provide: BlobStorageService, useValue: mockBlob },
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

  describe("findAmbiance", () => {
    it("queries READY, non-blacklisted tracks whose style OR artist is Ambiance (case-insensitive), bounded by take", async () => {
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue([]);

      await service.findAmbiance();

      expect(prisma.track.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                OR: [
                  { style: { equals: "Ambiance", mode: "insensitive" } },
                  { artist: { equals: "Ambiance", mode: "insensitive" } },
                ],
              },
              { status: TrackStatus.READY },
              { blacklisted: false },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: expect.objectContaining({
            id: true,
            title: true,
            artist: true,
            filename: true,
            style: true,
            bpm: true,
            titleMasked: true,
          }),
        }),
      );
      expect(TracksService.AMBIANCE_TAKE).toBe(50);
    });

    it("does not select internal fields (status/jobId)", async () => {
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue([]);

      await service.findAmbiance();

      const { select } = prisma.track.findMany.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(select.status).toBeUndefined();
      expect(select.jobId).toBeUndefined();
    });

    it("returns the tracks and masks titles for non-admins", async () => {
      const tracks = [
        { id: "a1", title: "Lounge", artist: "Ambiance", titleMasked: false },
        { id: "a2", title: "Secret", style: "ambiance", titleMasked: true },
      ];
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue(tracks);

      const result = await service.findAmbiance(false);

      expect(result).toEqual([
        expect.objectContaining({ id: "a1", title: "Lounge" }),
        expect.objectContaining({ id: "a2", title: "Titre masqué" }),
      ]);
    });

    it("keeps real titles for admins", async () => {
      const tracks = [{ id: "a2", title: "Secret", titleMasked: true }];
      // @ts-expect-error - testing partial return
      prisma.track.findMany.mockResolvedValue(tracks);

      const result = await service.findAmbiance(true);

      expect(result[0]).toEqual(
        expect.objectContaining({ title: "Secret", titleMasked: true }),
      );
    });
  });

  describe("findOne", () => {
    const visibleTrack: TrackRow = {
      id: "track-1",
      title: "Test",
      artist: "Artist",
      style: "Rumba",
      status: TrackStatus.READY,
      blacklisted: false,
      titleMasked: false,
    };

    it("returns a library track to a non-admin", async () => {
      useTrackTable(prisma, [visibleTrack]);

      await expect(service.findOne("track-1", false)).resolves.toEqual(
        visibleTrack,
      );
    });

    it("returns a library track whose style is null", async () => {
      const noStyle = { ...visibleTrack, style: null };
      useTrackTable(prisma, [noStyle]);

      await expect(service.findOne("track-1", false)).resolves.toEqual(noStyle);
    });

    it("throws NotFoundException when not found", async () => {
      useTrackTable(prisma, []);

      await expect(service.findOne("nonexistent")).rejects.toThrow(
        new NotFoundException("Track nonexistent not found"),
      );
    });

    it.each(HIDDEN_TRACK_CASES)(
      "gives a non-admin the missing-track 404 for a %s track",
      async (_label, override) => {
        useTrackTable(prisma, [{ ...visibleTrack, ...override }]);

        await expect(service.findOne("track-1", false)).rejects.toThrow(
          new NotFoundException("Track track-1 not found"),
        );
      },
    );

    it("defaults to the non-admin rules when the role is not given", async () => {
      useTrackTable(prisma, [{ ...visibleTrack, blacklisted: true }]);

      await expect(service.findOne("track-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each(HIDDEN_TRACK_CASES)(
      "still returns a %s track to an admin",
      async (_label, override) => {
        const track = { ...visibleTrack, ...override };
        useTrackTable(prisma, [track]);

        await expect(service.findOne("track-1", true)).resolves.toEqual(track);
      },
    );

    it("queries by id only for an admin", async () => {
      useTrackTable(prisma, [visibleTrack]);

      await service.findOne("track-1", true);

      expect(prisma.track.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "track-1" } }),
      );
    });

    it("masks the title of a visible masked track for a non-admin", async () => {
      useTrackTable(prisma, [{ ...visibleTrack, titleMasked: true }]);

      await expect(service.findOne("track-1", false)).resolves.toEqual(
        expect.objectContaining({ title: "Titre masqué", titleMasked: true }),
      );
    });

    it("keeps the real title of a masked track for an admin", async () => {
      useTrackTable(prisma, [{ ...visibleTrack, titleMasked: true }]);

      await expect(service.findOne("track-1", true)).resolves.toEqual(
        expect.objectContaining({ title: "Test", titleMasked: true }),
      );
    });
  });

  describe("updateTrack", () => {
    it("reads and writes through the given transaction client", async () => {
      const tx = createMockPrismaService();
      tx.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: null, rawBpm: 0 },
      );
      // @ts-expect-error - testing partial return
      tx.track.update.mockResolvedValue({});

      await service.updateTrack("t1", "admin", true, { title: "New" }, tx);

      expect(tx.track.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { title: "New" },
      });
      expect(prisma.track.findUnique).not.toHaveBeenCalled();
      expect(prisma.track.update).not.toHaveBeenCalled();
    });

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

    it("rejects more than 3 paso clashes (after dedup), without writing", async () => {
      prisma.track.findUnique.mockResolvedValue(
        // @ts-expect-error - testing partial return
        { submittedById: "user-1", rawBpm: 0 },
      );

      await expect(
        service.updateTrack("t1", "admin", true, {
          clashTimecodes: [12.5, 40, 68.3, 100],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.track.update).not.toHaveBeenCalled();
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

  describe("bpmForPatch", () => {
    it("returns an explicit tempo as-is", () => {
      expect(service.bpmForPatch(120, { bpm: 30, style: "Rumba" })).toBe(30);
      expect(mockBpm.calculateMpm).not.toHaveBeenCalled();
    });

    it("recomputes the MPM from the raw BPM when only the dance changes", () => {
      mockBpm.calculateMpm.mockReturnValueOnce(25);
      expect(service.bpmForPatch(100, { style: "Rumba" })).toBe(25);
      expect(mockBpm.calculateMpm).toHaveBeenCalledWith(100, "Rumba");
    });

    it("leaves the tempo untouched without raw BPM, dance, or a usable MPM", () => {
      expect(service.bpmForPatch(0, { style: "Rumba" })).toBeUndefined();
      expect(service.bpmForPatch(100, {})).toBeUndefined();
      mockBpm.calculateMpm.mockReturnValueOnce(0);
      expect(service.bpmForPatch(100, { style: "Rumba" })).toBeUndefined();
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
});
