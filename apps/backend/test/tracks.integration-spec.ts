import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import {
  Prisma,
  TrackCorrectionReason,
  TrackCorrectionStatus,
  TrackStatus,
  UserRole,
} from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../src/prisma/prisma.service";
import { TrackCorrectionsService } from "../src/track-corrections/track-corrections.service";
import { AdminTracksQueryService } from "../src/tracks/admin-tracks.query-service";
import { ListAdminTracksQueryDto } from "../src/tracks/dto/admin-track.dto";
import { TrackFilesService } from "../src/tracks/track-files.service";
import { TrackImportService } from "../src/tracks/track-import.service";
import { TracksService } from "../src/tracks/tracks.service";
import { mp3Bytes } from "./fixtures/mp3.fixture";
import { buildServiceModule } from "./integration-app.builder";

describe("Tracks (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tracks: TracksService;
  let corrections: TrackCorrectionsService;
  // No blob, no disk: the file store is a double.
  const files = {
    save: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const trackIds: string[] = [];
  const userIds: string[] = [];
  const correctionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule({
      extra: (builder) =>
        builder.overrideProvider(TrackFilesService).useValue(files),
    });
    moduleRef = built.module;
    prisma = built.prisma;
    tracks = moduleRef.get(TracksService);
    corrections = moduleRef.get(TrackCorrectionsService);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: [...trackIds, ...correctionIds] } },
    });
    // Deleting the tracks cascades to their corrections.
    await prisma.track.deleteMany({ where: { id: { in: trackIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    trackIds.length = 0;
    userIds.length = 0;
    correctionIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const adminUser = async (): Promise<string> => {
    const row = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Admin",
        lastName: "Test",
        role: UserRole.ADMIN,
      },
      select: { id: true },
    });
    userIds.push(row.id);
    return row.id;
  };

  const track = async (
    title: string,
    extra: Partial<Prisma.TrackUncheckedCreateInput> = {},
  ): Promise<string> => {
    const row = await prisma.track.create({
      data: {
        title,
        artist: "Orchestre",
        filename: `${randomUUID()}.mp3`,
        ...extra,
      },
      select: { id: true },
    });
    trackIds.push(row.id);
    return row.id;
  };

  const correction = async (
    trackId: string,
    reason: TrackCorrectionReason,
    extra: Partial<Prisma.TrackCorrectionUncheckedCreateInput> = {},
  ): Promise<string> => {
    const row = await prisma.trackCorrection.create({
      data: { trackId, reason, ...extra },
      select: { id: true },
    });
    correctionIds.push(row.id);
    return row.id;
  };

  it("audits a PATCH (web or mobile) once, with the MPM recomputed for the new dance", async () => {
    const admin = await adminUser();
    const id = await track("Audit", {
      rawBpm: 100,
      bpm: 50,
      style: "Samba",
      status: TrackStatus.READY,
    });

    await tracks.updateTrack(id, admin, true, { style: "Rumba" });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "TRACK", targetId: id },
      select: { action: true, actorId: true, before: true, after: true },
      take: 10,
    });
    expect(rows).toEqual([
      {
        action: "TRACK_UPDATE",
        actorId: admin,
        before: { style: "Samba", bpm: 50 },
        after: { style: "Rumba", bpm: 25 },
      },
    ]);
  });

  it("an approval writes its own audit row only, never a TRACK_UPDATE", async () => {
    const admin = await adminUser();
    const id = await track("Approval", { bpm: 60 });
    const proposal = await correction(id, TrackCorrectionReason.MPM, {
      proposedBpm: 62,
    });

    await corrections.approve(proposal, admin, {});

    expect(
      await prisma.adminAuditLog.count({
        where: { targetType: "TRACK", targetId: id },
      }),
    ).toBe(0);
    expect(
      await prisma.adminAuditLog.findMany({
        where: { targetId: proposal },
        select: { action: true },
        take: 10,
      }),
    ).toEqual([{ action: "TRACK_CORRECTION_APPROVE" }]);
  });

  it("refuses to delete a track with a pending proposal, then deletes it once decided", async () => {
    const admin = await adminUser();
    const id = await track("Delete", {
      sourceKey: `test:${randomUUID()}`,
      artwork: `${randomUUID()}.jpg`,
    });
    const proposal = await correction(id, TrackCorrectionReason.OTHER, {
      message: "x",
    });

    const refused = await tracks
      .deleteTrack(id, admin)
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect(await prisma.track.count({ where: { id } })).toBe(1);

    await corrections.reject(proposal, admin, {});
    await tracks.deleteTrack(id, admin);

    expect(await prisma.track.count({ where: { id } })).toBe(0);
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { targetType: "TRACK", targetId: id },
        select: { action: true, before: true },
      }),
    ).toMatchObject({
      action: "TRACK_DELETE",
      before: { title: "Delete", artist: "Orchestre" },
    });
    expect(files.remove).toHaveBeenCalledWith([
      expect.stringMatching(/\.mp3$/),
      expect.stringMatching(/\.jpg$/),
    ]);
  });

  it("keeps an artwork another track still uses when deleting a track", async () => {
    const admin = await adminUser();
    const cover = `${randomUUID()}.jpg`;
    const deleted = await track("Shared cover A", { artwork: cover });
    await track("Shared cover B", { artwork: cover });

    await tracks.deleteTrack(deleted, admin);

    expect(files.remove).toHaveBeenCalledWith([
      expect.stringMatching(/\.mp3$/),
    ]);
  });

  it("lists every track for the admin and filters them; ambiance=false keeps a null style", async () => {
    const queries = moduleRef.get(AdminTracksQueryService);
    const token = `zt${randomUUID().slice(0, 6)}`;
    const a = await track(`Rumba ${token}`, {
      style: "Rumba",
      status: TrackStatus.READY,
    });
    const b = await track(`${token} pause`, {
      artist: "Ambiance",
      status: TrackStatus.READY,
    });
    const c = await track(`Nuit ${token}`, {
      blacklisted: true,
      status: TrackStatus.ERROR,
    });
    const d = await track(`Jour ${token}`, {
      style: "ambiance",
      titleMasked: true,
    });
    await correction(a, TrackCorrectionReason.MPM, { proposedBpm: 26 });
    await correction(a, TrackCorrectionReason.TITLE, {
      status: TrackCorrectionStatus.REJECTED,
    });

    const ids = async (filter: Partial<ListAdminTracksQueryDto>) =>
      (await queries.list({ q: token, skip: 0, take: 100, ...filter })).data
        .map((t) => t.id)
        .sort();

    expect(await ids({})).toEqual([a, b, c, d].sort());
    expect(await ids({ status: TrackStatus.ERROR })).toEqual([c]);
    expect(await ids({ blacklisted: true })).toEqual([c]);
    expect(await ids({ blacklisted: false })).toEqual([a, b, d].sort());
    expect(await ids({ titleMasked: true })).toEqual([d]);
    expect(await ids({ style: "RUMBA" })).toEqual([a]);
    expect(await ids({ ambiance: true })).toEqual([b, d].sort());
    // c has no style: a NOT (… OR …) filter would have dropped it.
    expect(await ids({ ambiance: false })).toEqual([a, c].sort());

    const page = await queries.list({ q: token, skip: 0, take: 100 });
    expect(page.meta.total).toBe(4);
    expect(page.data.find((t) => t.id === a)?.pendingCorrections).toBe(1);
    expect(page.data.find((t) => t.id === d)).toMatchObject({
      titleMasked: true,
      title: `Jour ${token}`,
    });
  });

  it("imports a track, then refuses the same file and the same source (409)", async () => {
    const importer = moduleRef.get(TrackImportService);
    const admin = await adminUser();
    const mp3 = () => mp3Bytes(randomUUID());
    const sha = (buffer: Buffer) =>
      createHash("sha256").update(buffer).digest("hex");
    const part = (buffer: Buffer) => ({ buffer, size: buffer.length });
    const existingOf = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (e: unknown) =>
          (e as { getResponse(): { existingTrackId?: string } }).getResponse()
            .existingTrackId,
      );
    const audio = mp3();
    const sourceKey = `test:${randomUUID()}`;

    const created = await importer.importTrack(
      admin,
      {
        title: "Import",
        artist: "Test",
        style: "Rumba",
        rawBpm: 100,
        sha256: sha(audio),
        sourceKey,
      },
      part(audio),
      undefined,
    );
    trackIds.push(created.id);
    expect(created).toMatchObject({
      bpm: 25,
      rawBpm: 100,
      status: "READY",
      sourceKey,
      pendingCorrections: 0,
    });
    expect(
      await prisma.track.findUniqueOrThrow({
        where: { id: created.id },
        select: { contentHash: true, jobId: true, submittedById: true },
      }),
    ).toEqual({
      contentHash: sha(audio),
      jobId: "admin-import",
      submittedById: admin,
    });

    // Same file, another source.
    await expect(
      existingOf(
        importer.importTrack(
          admin,
          {
            title: "X",
            artist: "Y",
            sha256: sha(audio),
            sourceKey: `test:${randomUUID()}`,
          },
          part(audio),
          undefined,
        ),
      ),
    ).resolves.toBe(created.id);
    // Another file, same source.
    const other = mp3();
    await expect(
      existingOf(
        importer.importTrack(
          admin,
          {
            title: "X",
            artist: "Y",
            rawBpm: 100,
            sha256: sha(other),
            sourceKey,
          },
          part(other),
          undefined,
        ),
      ),
    ).resolves.toBe(created.id);

    await expect(
      importer.check([
        { sha256: sha(audio) },
        { sha256: sha(other), sourceKey },
        { sha256: "0".repeat(64) },
      ]),
    ).resolves.toEqual({
      items: [
        { exists: true, trackId: created.id },
        { exists: true, trackId: created.id },
        { exists: false },
      ],
    });
    expect(
      await prisma.adminAuditLog.findMany({
        where: { targetType: "TRACK", targetId: created.id },
        select: { action: true, after: true },
        take: 10,
      }),
    ).toEqual([
      {
        action: "TRACK_CREATE",
        after: {
          title: "Import",
          artist: "Test",
          style: "Rumba",
          bpm: 25,
          sourceKey,
          status: "READY",
        },
      },
    ]);
    // Only the first import reached the file store.
    expect(files.save).toHaveBeenCalledTimes(1);
  });
});
