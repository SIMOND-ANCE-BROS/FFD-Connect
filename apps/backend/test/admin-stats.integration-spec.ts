import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import {
  TrackCorrectionReason,
  TrackCorrectionStatus,
  UserRole,
} from "@prisma/client";
import { AdminStatsQueryService } from "../src/admin/admin-stats.query-service";
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
  const clubIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.track.deleteMany({ where: { id: { in: trackIds } } }); // cascades corrections
    await prisma.license.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    clubIds.length = 0;
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

  it("per-club figures follow User.clubId and skip store-review members", async () => {
    const service = moduleRef.get(AdminStatsQueryService);
    const club = await prisma.club.create({
      data: { name: `Stat ${randomUUID()}` },
    });
    const other = await prisma.club.create({
      data: { name: `Stat ${randomUUID()}` },
    });
    clubIds.push(club.id, other.id);
    const today = new Date("2026-07-14T22:00:00Z");
    const licence = (userId: string, validUntil: Date) =>
      prisma.license.create({
        data: {
          number: randomUUID(),
          validUntil,
          category: "Latin",
          clubName: other.name, // free text points to the other club on purpose
          userId,
        },
      });
    const a = await user({ clubId: club.id });
    await licence(a.id, new Date("2027-01-01T00:00:00Z")); // valid
    const b = await user({
      clubId: club.id,
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
    });
    await licence(b.id, new Date("2026-01-01T00:00:00Z")); // expired
    await user({ clubId: club.id, isStoreReview: true, role: UserRole.CLUB });
    const figures = await service.clubFigures([club.id, other.id], today);
    expect(figures.get(club.id)).toEqual({
      members: 2,
      clubAccounts: 1,
      validLicences: 1,
    });
    expect(figures.get(other.id)).toEqual({
      members: 0,
      clubAccounts: 0,
      validLicences: 0,
    });
  });

  it("licence counts around today (deltas)", async () => {
    const service = moduleRef.get(AdminStatsQueryService);
    const now = new Date();
    const before = (await service.get("12w", now)).licences;
    const day = 86_400_000;
    const mk = async (validUntil: Date) => {
      const u = await user();
      await prisma.license.create({
        data: {
          number: randomUUID(),
          validUntil,
          category: "Latin",
          clubName: "X",
          userId: u.id,
        },
      });
    };
    await mk(new Date(now.getTime() + 10 * day)); // valid, within 30 and 60
    await mk(new Date(now.getTime() + 45 * day)); // valid, within 60 only
    await mk(new Date(now.getTime() - 2 * day)); // expired
    const after = (await service.get("12w", now)).licences;
    expect(after.valid - before.valid).toBe(2);
    expect(after.expiring30d - before.expiring30d).toBe(1);
    expect(after.expiring60d - before.expiring60d).toBe(2);
    expect(after.expired - before.expired).toBe(1);
  });
});
