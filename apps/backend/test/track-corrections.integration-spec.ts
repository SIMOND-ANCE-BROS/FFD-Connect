import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { TrackCorrectionReason, TrackCorrectionStatus } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { TrackCorrectionsQueryService } from "../src/track-corrections/track-corrections.query-service";
import { buildServiceModule } from "./integration-app.builder";

describe("Track corrections (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let queries: TrackCorrectionsQueryService;
  const trackIds: string[] = [];
  const userIds: string[] = [];
  const correctionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    queries = moduleRef.get(TrackCorrectionsQueryService);
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
});
