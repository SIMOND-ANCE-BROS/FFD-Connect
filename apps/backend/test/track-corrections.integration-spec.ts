import { randomUUID } from "crypto";
import { ConflictException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import {
  TrackCorrectionReason,
  TrackCorrectionStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { TrackCorrectionsQueryService } from "../src/track-corrections/track-corrections.query-service";
import { TrackCorrectionsService } from "../src/track-corrections/track-corrections.service";
import { buildServiceModule } from "./integration-app.builder";

describe("Track corrections (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let queries: TrackCorrectionsQueryService;
  let service: TrackCorrectionsService;
  const trackIds: string[] = [];
  const userIds: string[] = [];
  const correctionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    queries = moduleRef.get(TrackCorrectionsQueryService);
    service = moduleRef.get(TrackCorrectionsService);
  });

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: correctionIds } },
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

  const track = async (
    title: string,
    artist: string,
    extra: { style?: string; bpm?: number; rawBpm?: number } = {},
  ): Promise<string> => {
    const row = await prisma.track.create({
      data: { title, artist, filename: `${randomUUID()}.mp3`, ...extra },
      select: { id: true },
    });
    trackIds.push(row.id);
    return row.id;
  };

  const correction = async (
    trackId: string,
    reason: TrackCorrectionReason,
    extra: {
      message?: string;
      proposedBpm?: number;
      proposesClashes?: boolean;
      proposedClashTimecodes?: number[];
    } = {},
  ): Promise<string> => {
    const row = await prisma.trackCorrection.create({
      data: { trackId, reason, ...extra },
      select: { id: true },
    });
    correctionIds.push(row.id);
    return row.id;
  };

  it("searches the title OR the artist case-insensitively, combined with the reason filter", async () => {
    const token = `zq${randomUUID().slice(0, 6)}`;
    const inTitle = await track(`Paso ${token} uno`, "Orchestre");
    const inArtist = await track("Rumba", `Band ${token.toUpperCase()}`);
    const unrelated = await track("Valse", "Autre");
    const a = await correction(inTitle, TrackCorrectionReason.MPM);
    const b = await correction(inArtist, TrackCorrectionReason.MPM);
    await correction(inArtist, TrackCorrectionReason.TITLE);
    await correction(unrelated, TrackCorrectionReason.MPM);

    const page = await queries.listForAdmin({
      status: TrackCorrectionStatus.PENDING,
      reason: [TrackCorrectionReason.MPM],
      q: token.toUpperCase(),
      skip: 0,
      take: 100,
    });

    expect(page.data.map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(page.meta.total).toBe(2);
    expect(page.data[0].track.filename).toMatch(/\.mp3$/);
  });

  const admin = async (): Promise<string> => {
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

  it("an approval writes one audit row with the change really applied and no free text", async () => {
    const adminId = await admin();
    const trackId = await track("España Cañí", "Orchestre", {
      style: "Paso Doble",
      bpm: 60,
      rawBpm: 120,
    });
    const id = await correction(trackId, TrackCorrectionReason.PASO_CLASH, {
      message: "secret-message-zq",
      proposesClashes: true,
      proposedClashTimecodes: [40, 80],
    });

    await service.approve(id, adminId, {
      bpm: 62,
      clashTimecodes: [83.5, 40],
      comment: "secret-comment-zq",
    });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: id },
      take: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: adminId,
      action: "TRACK_CORRECTION_APPROVE",
      targetType: "TRACK_CORRECTION",
      before: { trackId, bpm: 60, clashTimecodes: [] },
      after: { trackId, bpm: 62, clashTimecodes: [40, 83.5] },
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/secret-/);

    await expect(service.reject(id, adminId, {})).rejects.toThrow(
      ConflictException,
    );
    expect(await prisma.adminAuditLog.count({ where: { targetId: id } })).toBe(
      1,
    );
  });

  it("a rejection writes a trackId-only row", async () => {
    const adminId = await admin();
    const trackId = await track("Rumba", "Orchestre");
    const id = await correction(trackId, TrackCorrectionReason.TITLE, {
      message: "secret-message-zq",
    });

    await service.reject(id, adminId, { comment: "secret-comment-zq" });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: id },
      take: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "TRACK_CORRECTION_REJECT",
      before: null,
      after: { trackId },
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/secret-/);
  });
});
