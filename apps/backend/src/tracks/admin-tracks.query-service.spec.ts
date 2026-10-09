import { NotFoundException } from "@nestjs/common";
import { TrackStatus } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { adminTrackSelect } from "../utils/prisma-selects";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import {
  AMBIANCE_TRACK_WHERE,
  NOT_AMBIANCE_TRACK_WHERE,
} from "./track-visibility.util";

const row = {
  id: "t1",
  title: "España Cañí",
  artist: "Orchestre",
  style: "Paso Doble",
  bpm: 60,
  rawBpm: 120.4,
  clashTimecodes: [40, 80],
  titleMasked: true,
  blacklisted: false,
  status: TrackStatus.READY,
  sourceKey: "apple:1",
  filename: "3f2c.mp3",
  artwork: "3f2c.jpg",
  createdAt: new Date("2026-10-09T10:00:00Z"),
  _count: { corrections: 2 },
};

describe("AdminTracksQueryService", () => {
  let prisma: MockPrismaService;
  let service: AdminTracksQueryService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminTracksQueryService(prisma as unknown as PrismaService);
  });

  it("lists every track (no library filter), newest first, with the pending count", async () => {
    prisma.track.count.mockResolvedValue(1);
    prisma.track.findMany.mockResolvedValue([row] as never);

    const page = await service.list({ skip: 0, take: 20 });

    expect(prisma.track.count).toHaveBeenCalledWith({ where: {} });
    expect(prisma.track.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 20,
      select: adminTrackSelect,
    });
    const { _count, ...fields } = row;
    expect(page.data).toEqual([
      { ...fields, pendingCorrections: _count.corrections },
    ]);
    expect(page.meta).toEqual({ total: 1, skip: 0, take: 20, hasMore: false });
  });

  it("combines every filter", async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({
      q: "paso",
      status: TrackStatus.ERROR,
      blacklisted: false,
      titleMasked: true,
      style: "Paso Doble",
      ambiance: true,
      skip: 50,
      take: 50,
    });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { title: { contains: "paso", mode: "insensitive" } },
                { artist: { contains: "paso", mode: "insensitive" } },
              ],
            },
            { status: TrackStatus.ERROR },
            { blacklisted: false },
            { titleMasked: true },
            { style: { equals: "Paso Doble", mode: "insensitive" } },
            AMBIANCE_TRACK_WHERE,
          ],
        },
        skip: 50,
        take: 50,
      }),
    );
  });

  it("excludes the ambiance with the null-safe filter", async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({ ambiance: false, skip: 0, take: 10 });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [NOT_AMBIANCE_TRACK_WHERE] } }),
    );
  });

  it("defaults to the first 20 tracks", async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({ skip: undefined, take: undefined });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it("returns one track with the same shape", async () => {
    prisma.track.findUnique.mockResolvedValue(row as never);

    await expect(service.detail("t1")).resolves.toMatchObject({
      id: "t1",
      pendingCorrections: 2,
    });
    expect(prisma.track.findUnique).toHaveBeenCalledWith({
      where: { id: "t1" },
      select: adminTrackSelect,
    });
  });

  it("answers 404 for an unknown track", async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(service.detail("nope")).rejects.toThrow(NotFoundException);
  });
});
