import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { TrackCorrectionStatus, TrackStatus } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import {
  HIDDEN_TRACK_CASES,
  TrackRow,
  useTrackTable,
} from "../../test/mocks/track-where.mock";
import { AdminAuditService } from "../admin/admin-audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { idOnlySelect, trackAuditSelect } from "../utils/prisma-selects";
import { BpmService } from "./bpm.service";
import { TrackFilesService } from "./track-files.service";
import {
  TRACK_HAS_PENDING_CORRECTIONS_MESSAGE,
  TracksService,
} from "./tracks.service";

describe("TracksService", () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let mockBpm: { calculateMpm: jest.Mock };
  let files: { remove: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    // Interactive transaction: the callback gets the same mocked client.
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    mockBpm = {
      calculateMpm: jest.fn((bpm: number) => Math.round(bpm)),
    };
    files = { remove: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: BpmService, useValue: mockBpm },
        { provide: TrackFilesService, useValue: files },
        { provide: AdminAuditService, useValue: audit },
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
        select: trackAuditSelect,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
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

    it("audits the fields really applied, read back in the same transaction", async () => {
      prisma.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 104,
        title: "Old",
        artist: "A",
        style: "Tango",
        bpm: 33,
        titleMasked: false,
        blacklisted: false,
        clashTimecodes: [],
        status: TrackStatus.READY,
      } as never);
      prisma.track.update.mockResolvedValue({
        title: "Old",
        artist: "A",
        style: "Rumba",
        bpm: 26,
        titleMasked: false,
        blacklisted: true,
        clashTimecodes: [],
        status: TrackStatus.READY,
      } as never);
      mockBpm.calculateMpm.mockReturnValue(26);

      await service.updateTrack("t1", "admin-1", true, {
        style: "Rumba",
        blacklisted: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.track.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { style: "Rumba", blacklisted: true, bpm: 26 },
        select: trackAuditSelect,
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "TRACK_UPDATE",
        targetType: "TRACK",
        targetId: "t1",
        before: { style: "Tango", bpm: 33, blacklisted: false },
        after: { style: "Rumba", bpm: 26, blacklisted: true },
      });
    });

    it("writes no audit row when nothing changed", async () => {
      const row = {
        title: "Same",
        artist: "A",
        style: null,
        bpm: 0,
        titleMasked: false,
        blacklisted: false,
        clashTimecodes: [],
        status: TrackStatus.READY,
      };
      prisma.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 0,
        ...row,
      } as never);
      prisma.track.update.mockResolvedValue(row as never);

      await service.updateTrack("t1", "admin-1", true, { title: "Same" });

      expect(prisma.track.update).toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("writes no audit row when the update fails", async () => {
      prisma.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 0,
      } as never);
      prisma.track.update.mockRejectedValue(new Error("db down"));

      await expect(
        service.updateTrack("t1", "admin-1", true, { title: "X" }),
      ).rejects.toThrow("db down");
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("audits through the caller's transaction when one is given", async () => {
      const tx = createMockPrismaService();
      tx.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 0,
        title: "Old",
      } as never);
      tx.track.update.mockResolvedValue({ title: "New" } as never);

      await service.updateTrack("t1", "admin-1", true, { title: "New" }, tx);

      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: "TRACK_UPDATE",
          before: { title: "Old" },
          after: { title: "New" },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("skips its own audit row when the caller audits (correction approval)", async () => {
      const tx = createMockPrismaService();
      tx.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 0,
        title: "Old",
      } as never);
      tx.track.update.mockResolvedValue({ title: "New" } as never);

      await service.updateTrack("t1", "admin-1", true, { title: "New" }, tx, {
        skipAudit: true,
      });

      expect(tx.track.update).toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("publishes an ERROR track once an admin sets its MPM", async () => {
      prisma.track.findUnique.mockResolvedValue({
        submittedById: null,
        rawBpm: 0,
        bpm: 0,
        status: TrackStatus.ERROR,
      } as never);
      prisma.track.update.mockResolvedValue({
        bpm: 52,
        status: TrackStatus.READY,
      } as never);

      await service.updateTrack("t1", "admin-1", true, { bpm: 52 });

      expect(prisma.track.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { bpm: 52, status: TrackStatus.READY },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          before: { bpm: 0, status: TrackStatus.ERROR },
          after: { bpm: 52, status: TrackStatus.READY },
        }),
      );
    });

    it("keeps an ERROR track out of the library without a tempo, and never promotes another status", async () => {
      prisma.track.update.mockResolvedValue({} as never);
      prisma.track.findUnique.mockResolvedValueOnce({
        submittedById: null,
        rawBpm: 0,
        status: TrackStatus.ERROR,
      } as never);
      await service.updateTrack("t1", "admin-1", true, { title: "X", bpm: 0 });
      expect(prisma.track.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { title: "X", bpm: 0 } }),
      );

      prisma.track.findUnique.mockResolvedValueOnce({
        submittedById: null,
        rawBpm: 0,
        status: TrackStatus.PENDING,
      } as never);
      await service.updateTrack("t1", "admin-1", true, { bpm: 52 });
      expect(prisma.track.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: { bpm: 52 } }),
      );
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
    const row = {
      title: "Rumba",
      artist: "Orchestre",
      sourceKey: "apple:1",
      filename: "a.mp3",
      artwork: "a.jpg",
    };

    it("throws NotFoundException when the track is missing", async () => {
      prisma.track.findUnique.mockResolvedValue(null);

      await expect(service.deleteTrack("missing", "admin-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.track.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("refuses (409) while correction proposals are pending, and keeps the files", async () => {
      prisma.track.findUnique.mockResolvedValue(row as never);
      prisma.trackCorrection.count.mockResolvedValue(2);

      const error = await service
        .deleteTrack("t1", "admin-1")
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        message: TRACK_HAS_PENDING_CORRECTIONS_MESSAGE,
        pendingCorrections: 2,
      });
      expect(prisma.trackCorrection.count).toHaveBeenCalledWith({
        where: { trackId: "t1", status: TrackCorrectionStatus.PENDING },
      });
      expect(prisma.track.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(files.remove).not.toHaveBeenCalled();
    });

    it("deletes the row with its audit row in one transaction, then both files", async () => {
      prisma.track.findUnique.mockResolvedValue(row as never);
      prisma.trackCorrection.count.mockResolvedValue(0);
      prisma.track.delete.mockResolvedValue({ id: "t1" } as never);

      await service.deleteTrack("t1", "admin-1");

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.track.delete).toHaveBeenCalledWith({
        where: { id: "t1" },
        select: idOnlySelect,
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "TRACK_DELETE",
        targetType: "TRACK",
        targetId: "t1",
        before: {
          title: "Rumba",
          artist: "Orchestre",
          sourceKey: "apple:1",
          filename: "a.mp3",
        },
      });
      expect(files.remove).toHaveBeenCalledWith(["a.mp3", "a.jpg"]);
    });

    it("removes only the audio file of a track without artwork", async () => {
      prisma.track.findUnique.mockResolvedValue({
        ...row,
        artwork: null,
      } as never);
      prisma.trackCorrection.count.mockResolvedValue(0);
      prisma.track.delete.mockResolvedValue({ id: "t1" } as never);

      await service.deleteTrack("t1", "admin-1");

      expect(files.remove).toHaveBeenCalledWith(["a.mp3"]);
    });

    it("leaves the files and writes no audit row when the deletion fails", async () => {
      prisma.track.findUnique.mockResolvedValue(row as never);
      prisma.trackCorrection.count.mockResolvedValue(0);
      prisma.track.delete.mockRejectedValue(new Error("db down"));

      await expect(service.deleteTrack("t1", "admin-1")).rejects.toThrow(
        "db down",
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(files.remove).not.toHaveBeenCalled();
    });
  });
});
