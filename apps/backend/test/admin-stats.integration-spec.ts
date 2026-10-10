import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import {
  TrackCorrectionReason,
  TrackCorrectionStatus,
  UserRole,
} from "@prisma/client";
import { statsWindow } from "../src/admin/stats/stats-period";
import { medianReviewHours, timeSeries } from "../src/admin/stats/stats-series";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

// Wednesday 18 July 2001 (2001-07-16 is a Monday), summer time (UTC+2).
const NOW = new Date("2001-07-18T10:00:00Z");

describe("Admin stats (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const trackIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.track.deleteMany({ where: { id: { in: trackIds } } }); // cascades corrections
    await prisma.license.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    trackIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const user = async (
    o: {
      createdAt?: Date;
      role?: UserRole;
      extraRoles?: UserRole[];
      isStoreReview?: boolean;
      clubId?: string;
    } = {},
  ) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Stat",
        lastName: "User",
        role: o.role ?? UserRole.LICENSEE,
        extraRoles: o.extraRoles ?? [],
        isStoreReview: o.isStoreReview ?? false,
        ...(o.createdAt && { createdAt: o.createdAt }),
        ...(o.clubId && { clubId: o.clubId }),
      },
    });
    userIds.push(u.id);
    return u;
  };

  it("weekly signups: Paris Monday boundary, store-review excluded, out-of-window ignored", async () => {
    await user({ createdAt: new Date("2001-07-15T21:30:00Z") }); // Sun 23:30 Paris → week 07-09
    await user({
      createdAt: new Date("2001-07-15T22:30:00Z"), // Mon 00:30 Paris → week 07-16
      role: UserRole.CLUB,
    });
    await user({
      createdAt: new Date("2001-07-16T09:00:00Z"),
      isStoreReview: true,
    });
    await user({ createdAt: new Date("2001-07-23T09:00:00Z") }); // after the window
    const rows = await timeSeries(prisma, "signups", statsWindow("12w", NOW));
    expect(rows).toEqual(
      expect.arrayContaining([
        { start: "2001-07-09", key: "LICENSEE", count: 1 },
        { start: "2001-07-16", key: "CLUB", count: 1 },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("monthly signups: 31 March 22:30 UTC is April in Paris", async () => {
    await user({ createdAt: new Date("2001-03-31T22:30:00Z") });
    const rows = await timeSeries(prisma, "signups", statsWindow("6m", NOW));
    expect(rows).toEqual([{ start: "2001-04-01", key: "LICENSEE", count: 1 }]);
  });

  it("median handling time over corrections decided in the window", async () => {
    const t = await prisma.track.create({
      data: { title: "Stat", artist: "Stat", filename: `${randomUUID()}.mp3` },
    });
    trackIds.push(t.id);
    const createdAt = new Date("2001-07-10T08:00:00Z");
    const decided = (hours: number, status: TrackCorrectionStatus) =>
      prisma.trackCorrection.create({
        data: {
          trackId: t.id,
          reason: TrackCorrectionReason.MPM,
          status,
          createdAt,
          reviewedAt: new Date(createdAt.getTime() + hours * 3_600_000),
        },
      });
    await decided(1, TrackCorrectionStatus.APPROVED);
    await decided(3, TrackCorrectionStatus.REJECTED);
    await decided(10, TrackCorrectionStatus.APPROVED);
    await decided(20, TrackCorrectionStatus.APPROVED);
    await prisma.trackCorrection.create({
      data: { trackId: t.id, reason: TrackCorrectionReason.MPM, createdAt },
    }); // pending: ignored
    await expect(
      medianReviewHours(prisma, statsWindow("12w", NOW)),
    ).resolves.toBe(6.5);
  });
});
