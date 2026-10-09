import {
  BadRequestException,
  ConflictException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { Prisma, TrackStatus } from "@prisma/client";
import { createHash } from "crypto";
import { promises as fsp } from "fs";
import * as path from "path";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { mp3Bytes } from "../../test/fixtures/mp3.fixture";
import { AdminAuditService } from "../admin/admin-audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { idOnlySelect, trackDuplicateSelect } from "../utils/prisma-selects";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import { BpmService } from "./bpm.service";
import { ImportTrackDto } from "./dto/track-import.dto";
import { TrackFilesService } from "./track-files.service";
import {
  TRACK_DUPLICATE_MESSAGE,
  TRACK_IMPORT_MAX_ARTWORK_BYTES,
  TRACK_IMPORT_MAX_AUDIO_BYTES,
  TRACK_TEMPO_ANALYSIS_TIMEOUT_MS,
  TrackImportService,
} from "./track-import.service";
import { TracksService } from "./tracks.service";

const MP3 = mp3Bytes(Buffer.alloc(64, 1));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sha = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const file = (buffer: Buffer, size = buffer.length) => ({ buffer, size });
const UUID_NAME =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const dto = (extra: Partial<ImportTrackDto> = {}): ImportTrackDto => ({
  title: "In the Mood",
  artist: "Empress Orchestra",
  style: "Jive",
  rawBpm: 169.64,
  mpm: 42,
  sourceKey: "apple:1",
  sha256: sha(MP3),
  ...extra,
});

describe("TrackImportService", () => {
  let prisma: MockPrismaService;
  let files: { save: jest.Mock; remove: jest.Mock };
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };
  let analyze: jest.SpyInstance;
  let service: TrackImportService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.track.findFirst.mockResolvedValue(null);
    prisma.track.create.mockResolvedValue({ id: "t-new" } as never);
    files = {
      save: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    query = { detail: jest.fn().mockResolvedValue({ id: "t-new" }) };
    // Real tempo rules (calculateMpm, bpmForPatch); only the ffmpeg analysis is faked.
    const bpm = new BpmService();
    analyze = jest.spyOn(bpm, "analyzeBpm");
    const tracks = new TracksService(
      prisma as unknown as PrismaService,
      bpm,
      files as unknown as TrackFilesService,
      audit as unknown as AdminAuditService,
    );
    service = new TrackImportService(
      prisma as unknown as PrismaService,
      tracks,
      bpm,
      files as unknown as TrackFilesService,
      audit as unknown as AdminAuditService,
      query as unknown as AdminTracksQueryService,
    );
  });

  const createData = () =>
    (prisma.track.create.mock.calls[0][0] as { data: Record<string, unknown> })
      .data;
  const savedName = (index: number) =>
    files.save.mock.calls[index][0] as string;
  const conflictOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => {
        expect(e).toBeInstanceOf(ConflictException);
        return (e as ConflictException).getResponse();
      },
    );

  describe("importTrack", () => {
    it("stores both files under server-generated names, then the row and its audit row", async () => {
      await expect(
        service.importTrack("admin-1", dto(), file(MP3), file(JPEG)),
      ).resolves.toEqual({
        id: "t-new",
      });

      expect(files.save).toHaveBeenCalledTimes(2);
      expect(savedName(0)).toMatch(new RegExp(`^${UUID_NAME}\\.mp3$`));
      expect(files.save.mock.calls[0][1]).toBe(MP3);
      expect(savedName(1)).toMatch(new RegExp(`^${UUID_NAME}\\.jpg$`));
      expect(files.save.mock.calls[1][1]).toBe(JPEG);
      expect(prisma.track.create).toHaveBeenCalledWith({
        data: {
          title: "In the Mood",
          artist: "Empress Orchestra",
          style: "Jive",
          filename: savedName(0),
          artwork: savedName(1),
          bpm: 42,
          rawBpm: 169.64,
          status: TrackStatus.READY,
          sourceKey: "apple:1",
          contentHash: sha(MP3),
          jobId: "admin-import",
          submittedById: "admin-1",
        },
        select: idOnlySelect,
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "TRACK_CREATE",
        targetType: "TRACK",
        targetId: "t-new",
        after: {
          title: "In the Mood",
          artist: "Empress Orchestra",
          style: "Jive",
          bpm: 42,
          sourceKey: "apple:1",
          status: TrackStatus.READY,
        },
      });
      expect(query.detail).toHaveBeenCalledWith("t-new");
      expect(analyze).not.toHaveBeenCalled();
      expect(files.remove).not.toHaveBeenCalled();
    });

    it("names a PNG artwork .png, and stores no artwork when none is sent", async () => {
      await service.importTrack("admin-1", dto(), file(MP3), file(PNG));
      expect(savedName(1)).toMatch(/\.png$/);

      files.save.mockClear();
      prisma.track.create.mockClear();
      await service.importTrack("admin-1", dto(), file(MP3), undefined);
      expect(files.save).toHaveBeenCalledTimes(1);
      expect(createData()).toMatchObject({ artwork: null });
    });

    it("refuses a missing audio part (400)", async () => {
      await expect(
        service.importTrack("admin-1", dto(), undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses a file that is not an MP3 by its content, before anything else", async () => {
      const wav = Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ");
      await expect(
        service.importTrack(
          "admin-1",
          dto({ sha256: sha(wav) }),
          file(wav),
          undefined,
        ),
      ).rejects.toThrow("Le fichier audio n'est pas un MP3.");
      expect(prisma.track.findFirst).not.toHaveBeenCalled();
      expect(files.save).not.toHaveBeenCalled();
    });

    it("refuses an artwork that is neither JPEG nor PNG (400)", async () => {
      await expect(
        service.importTrack(
          "admin-1",
          dto(),
          file(MP3),
          file(Buffer.from("GIF89a")),
        ),
      ).rejects.toThrow("La pochette doit être une image JPEG ou PNG.");
      expect(files.save).not.toHaveBeenCalled();
    });

    it("refuses an oversized audio file or artwork (413)", async () => {
      await expect(
        service.importTrack(
          "admin-1",
          dto(),
          file(MP3, TRACK_IMPORT_MAX_AUDIO_BYTES + 1),
          undefined,
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      await expect(
        service.importTrack(
          "admin-1",
          dto(),
          file(MP3),
          file(JPEG, TRACK_IMPORT_MAX_ARTWORK_BYTES + 1),
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(files.save).not.toHaveBeenCalled();
    });

    it("refuses a hash that does not match the received file (400)", async () => {
      await expect(
        service.importTrack(
          "admin-1",
          dto({ sha256: "0".repeat(64) }),
          file(MP3),
          undefined,
        ),
      ).rejects.toThrow(
        "L'empreinte SHA-256 ne correspond pas au fichier reçu.",
      );
      expect(files.save).not.toHaveBeenCalled();
    });

    it("refuses a duplicate source or file (409) with the existing track, before storing anything", async () => {
      prisma.track.findFirst.mockResolvedValue({ id: "t-old" } as never);

      await expect(
        conflictOf(service.importTrack("admin-1", dto(), file(MP3), undefined)),
      ).resolves.toEqual({
        message: TRACK_DUPLICATE_MESSAGE,
        existingTrackId: "t-old",
      });
      expect(prisma.track.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: sha(MP3) }, { sourceKey: "apple:1" }] },
        select: idOnlySelect,
      });
      expect(files.save).not.toHaveBeenCalled();
    });

    it("looks for the content hash only when there is no source key", async () => {
      await service.importTrack(
        "admin-1",
        dto({ sourceKey: undefined }),
        file(MP3),
        undefined,
      );
      expect(prisma.track.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: sha(MP3) }] },
        select: idOnlySelect,
      });
      expect(createData()).toMatchObject({ sourceKey: null });
    });

    it("deletes the stored files when the row cannot be written, and audits nothing", async () => {
      prisma.track.create.mockRejectedValue(new Error("db down"));

      await expect(
        service.importTrack("admin-1", dto(), file(MP3), file(JPEG)),
      ).rejects.toThrow("db down");
      expect(files.remove).toHaveBeenCalledWith([savedName(0), savedName(1)]);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("deletes the audio file when the artwork upload fails", async () => {
      files.save
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("blob down"));

      await expect(
        service.importTrack("admin-1", dto(), file(MP3), file(JPEG)),
      ).rejects.toThrow("blob down");
      expect(files.remove).toHaveBeenCalledWith([savedName(0)]);
      expect(prisma.track.create).not.toHaveBeenCalled();
    });

    it("turns a unique-constraint race into a 409 and cleans up", async () => {
      prisma.track.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "t-race" } as never);
      prisma.track.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.10.0",
        }),
      );

      await expect(
        conflictOf(service.importTrack("admin-1", dto(), file(MP3), undefined)),
      ).resolves.toEqual({
        message: TRACK_DUPLICATE_MESSAGE,
        existingTrackId: "t-race",
      });
      expect(files.remove).toHaveBeenCalledWith([savedName(0)]);
    });

    it("analyses the tempo when rawBpm is missing, converts it for the dance, and cleans the temp copy", async () => {
      analyze.mockResolvedValue(100);

      await service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined, mpm: undefined, style: "Samba" }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({
        rawBpm: 100,
        bpm: 50,
        status: TrackStatus.READY,
      });
      const analysed = analyze.mock.calls[0][0] as string;
      expect(path.basename(analysed)).toBe("audio.mp3");
      await expect(fsp.stat(path.dirname(analysed))).rejects.toThrow();
    });

    it("keeps the rounded raw tempo as MPM without a dance", async () => {
      await service.importTrack(
        "admin-1",
        dto({ style: undefined, rawBpm: 123.6, mpm: undefined }),
        file(MP3),
        undefined,
      );
      expect(createData()).toMatchObject({
        rawBpm: 123.6,
        bpm: 124,
        style: null,
      });
    });

    it("creates the track in ERROR when the analysis fails and no MPM is given", async () => {
      analyze.mockRejectedValue(new Error("ffmpeg exited with code 1"));

      await service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined, mpm: undefined }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({
        rawBpm: 0,
        bpm: 0,
        status: TrackStatus.ERROR,
      });
      expect(audit.record.mock.calls[0][1]).toMatchObject({
        after: { bpm: 0, status: TrackStatus.ERROR },
      });
    });

    it("keeps the admin's MPM when the analysis fails", async () => {
      analyze.mockRejectedValue(new Error("ffmpeg exited with code 1"));

      await service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined, mpm: 52 }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({
        rawBpm: 0,
        bpm: 52,
        status: TrackStatus.READY,
      });
    });
  });

  describe("tempo analysis", () => {
    /** Resolves once `predicate` holds, polling the event loop (real fs I/O runs meanwhile). */
    const until = async (predicate: () => boolean): Promise<void> => {
      for (let i = 0; i < 500 && !predicate(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(predicate()).toBe(true);
    };

    it("asks BpmService to kill ffmpeg at the tempo timeout", async () => {
      analyze.mockResolvedValue(100);
      await service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined }),
        file(MP3),
        undefined,
      );
      expect(analyze).toHaveBeenCalledWith(expect.any(String), {
        timeoutMs: TRACK_TEMPO_ANALYSIS_TIMEOUT_MS,
      });
    });

    it("runs the analyses of concurrent imports one at a time", async () => {
      const pending: Array<(bpm: number) => void> = [];
      analyze.mockImplementation(
        () => new Promise<number>((resolve) => pending.push(resolve)),
      );
      const other = mp3Bytes("another file");
      const first = service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined, sourceKey: "apple:1" }),
        file(MP3),
        undefined,
      );
      const second = service.importTrack(
        "admin-1",
        dto({ rawBpm: undefined, sourceKey: "apple:2", sha256: sha(other) }),
        file(other),
        undefined,
      );

      await until(() => analyze.mock.calls.length === 1);
      // The second import waits, however long the first analysis takes.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(analyze).toHaveBeenCalledTimes(1);

      pending[0](100);
      await until(() => analyze.mock.calls.length === 2);
      pending[1](120);
      await Promise.all([first, second]);
      expect(prisma.track.create).toHaveBeenCalledTimes(2);
    });

    it("lets the next analysis run after one fails", async () => {
      analyze
        .mockRejectedValueOnce(new Error("ffmpeg tempo analysis timed out"))
        .mockResolvedValueOnce(100);
      const other = mp3Bytes("another file");

      await Promise.all([
        service.importTrack(
          "admin-1",
          dto({ rawBpm: undefined, mpm: undefined }),
          file(MP3),
          undefined,
        ),
        service.importTrack(
          "admin-1",
          dto({
            rawBpm: undefined,
            mpm: undefined,
            sourceKey: "apple:2",
            sha256: sha(other),
          }),
          file(other),
          undefined,
        ),
      ]);

      expect(analyze).toHaveBeenCalledTimes(2);
      const statuses = prisma.track.create.mock.calls.map(
        (call) => (call[0] as { data: { status: TrackStatus } }).data.status,
      );
      expect(statuses.sort()).toEqual([TrackStatus.ERROR, TrackStatus.READY]);
    });
  });

  describe("check", () => {
    it("answers per item, in order, by hash or by source", async () => {
      const [h1, h2, h3] = ["1", "2", "3"].map((c) => c.repeat(64));
      prisma.track.findMany.mockResolvedValue([
        { id: "t1", contentHash: h1, sourceKey: null },
        { id: "t2", contentHash: null, sourceKey: "apple:2" },
      ] as never);

      await expect(
        service.check([
          { sourceKey: "apple:9", sha256: h1 },
          { sourceKey: "apple:2", sha256: h2 },
          { sha256: h3 },
        ]),
      ).resolves.toEqual({
        items: [
          { exists: true, trackId: "t1" },
          { exists: true, trackId: "t2" },
          { exists: false },
        ],
      });
      expect(prisma.track.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { contentHash: { in: [h1, h2, h3] } },
            { sourceKey: { in: ["apple:9", "apple:2"] } },
          ],
        },
        select: trackDuplicateSelect,
        take: 5,
      });
    });

    it("looks up hashes only when no item has a source", async () => {
      prisma.track.findMany.mockResolvedValue([]);
      await service.check([
        { sha256: "a".repeat(64) },
        { sha256: "a".repeat(64) },
      ]);
      expect(prisma.track.findMany).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: { in: ["a".repeat(64)] } }] },
        select: trackDuplicateSelect,
        take: 1,
      });
    });
  });
});
