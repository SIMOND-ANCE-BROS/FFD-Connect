import { UserRole } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { AdminStatsQueryService } from "./admin-stats.query-service";

const NOW = new Date("2026-07-15T10:00:00Z");
const TODAY = new Date("2026-07-14T22:00:00Z");
const CLUB_ROLE = {
  OR: [{ role: UserRole.CLUB }, { extraRoles: { has: UserRole.CLUB } }],
};

function makePrisma() {
  const model = () => ({
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  });
  return {
    user: model(),
    license: model(),
    licenseRenewalRequest: model(),
    club: model(),
    competition: model(),
    registration: model(),
    track: model(),
    trackCorrection: model(),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

const whereOf = (mock: jest.Mock) =>
  mock.mock.calls.map((c) => (c[0] as { where?: unknown }).where);

describe("AdminStatsQueryService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AdminStatsQueryService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AdminStatsQueryService(prisma as unknown as PrismaService);
  });

  it("empty database: zero-filled series, null median, zero counts", async () => {
    const s = await service.get("12w", NOW);
    expect(s.period).toBe("12w");
    expect(s.bucket).toBe("week");
    expect(s.buckets).toHaveLength(12);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.users.signups).toHaveLength(12);
    expect(s.users.signups[0]).toEqual({
      start: s.buckets[0],
      LICENSEE: 0,
      CLUB: 0,
      STAFF: 0,
      ADMIN: 0,
    });
    expect(s.competitions.registrations[11]).toEqual({
      start: s.buckets[11],
      PENDING: 0,
      CONFIRMED: 0,
      CANCELLED: 0,
    });
    expect(s.content.corrections).toHaveLength(12);
    expect(s.content.bugReports.every((b) => b.count === 0)).toBe(true);
    expect(s.content.medianReviewHours).toBeNull();
    expect(s.users.byRole).toEqual({
      LICENSEE: 0,
      CLUB: 0,
      STAFF: 0,
      ADMIN: 0,
    });
    expect(s.competitions.byStatus).toEqual({
      UPCOMING: 0,
      LIVE: 0,
      PAST: 0,
      CANCELLED: 0,
    });
    expect(s.content.tracksByStatus).toEqual({
      READY: 0,
      PENDING: 0,
      ERROR: 0,
    });
    expect(s.licences.clubs).toEqual([]);
  });

  it("user counts exclude store-review accounts and count extra roles", async () => {
    await service.get("12w", NOW);
    const wheres = whereOf(prisma.user.count);
    for (const w of wheres) expect(w).toMatchObject({ isStoreReview: false });
    expect(wheres).toContainEqual({ isStoreReview: false, ...CLUB_ROLE });
    expect(wheres).toContainEqual({ isStoreReview: false, lastLoginAt: null });
    expect(wheres).toContainEqual({
      isStoreReview: false,
      disabledAt: { not: null },
    });
    expect(wheres).toContainEqual({
      isStoreReview: false,
      lastLoginAt: { gte: new Date(NOW.getTime() - 7 * 86_400_000) },
    });
    expect(wheres).toContainEqual({
      isStoreReview: false,
      lastLoginAt: { gte: new Date(NOW.getTime() - 30 * 86_400_000) },
    });
  });

  it("licence windows are anchored on today 00:00 Paris", async () => {
    await service.get("12w", NOW);
    const wheres = whereOf(prisma.license.count);
    expect(wheres).toContainEqual({ validUntil: { gte: TODAY } });
    expect(wheres).toContainEqual({ validUntil: { lt: TODAY } });
    expect(wheres).toContainEqual({
      validUntil: { gte: TODAY, lt: new Date("2026-08-13T22:00:00Z") },
    });
    expect(wheres).toContainEqual({
      validUntil: { gte: TODAY, lt: new Date("2026-09-12T22:00:00Z") },
    });
    expect(prisma.licenseRenewalRequest.count).toHaveBeenCalledWith({
      where: { status: "PENDING" },
    });
  });

  it("past-competition rates count CONFIRMED registrations only", async () => {
    await service.get("12w", NOW);
    const wheres = whereOf(prisma.registration.count);
    const past = {
      status: "CONFIRMED",
      event: { competition: { status: "PAST" } },
    };
    expect(wheres).toContainEqual(past);
    expect(wheres).toContainEqual({ ...past, checkedIn: true });
    expect(wheres).toContainEqual({ ...past, feePaid: true });
  });

  it("maps groupBy results onto every enum key", async () => {
    prisma.competition.groupBy.mockResolvedValue([
      { status: "PAST", _count: { _all: 4 } },
    ]);
    prisma.track.groupBy.mockResolvedValue([
      { status: "READY", _count: { _all: 7 } },
    ]);
    const s = await service.get("12w", NOW);
    expect(s.competitions.byStatus).toEqual({
      UPCOMING: 0,
      LIVE: 0,
      PAST: 4,
      CANCELLED: 0,
    });
    expect(s.content.tracksByStatus).toEqual({
      READY: 7,
      PENDING: 0,
      ERROR: 0,
    });
  });

  it("clubs table: top 50 by members, names joined, figures merged", async () => {
    prisma.user.groupBy
      .mockResolvedValueOnce([{ clubId: "c1", _count: { _all: 5 } }]) // top 50
      .mockResolvedValueOnce([{ clubId: "c1", _count: { _all: 5 } }]) // clubFigures: members
      .mockResolvedValueOnce([{ clubId: "c1", _count: { _all: 1 } }]) // clubFigures: Club accounts
      .mockResolvedValueOnce([{ clubId: "c1", _count: { _all: 3 } }]); // clubFigures: valid licences
    prisma.club.findMany.mockResolvedValue([{ id: "c1", name: "Club Un" }]);
    const s = await service.get("12w", NOW);
    expect(prisma.user.groupBy.mock.calls[0][0]).toMatchObject({
      by: ["clubId"],
      where: { clubId: { not: null }, isStoreReview: false },
      take: 50,
    });
    expect(prisma.user.groupBy.mock.calls[3][0]).toMatchObject({
      where: {
        clubId: { in: ["c1"] },
        isStoreReview: false,
        license: { is: { validUntil: { gte: TODAY } } },
      },
    });
    expect(s.licences.clubs).toEqual([
      {
        id: "c1",
        name: "Club Un",
        members: 5,
        clubAccounts: 1,
        validLicences: 3,
      },
    ]);
  });

  it("clubs without a Club account: active clubs, store-review members ignored", async () => {
    await service.get("12w", NOW);
    expect(prisma.club.count).toHaveBeenCalledWith({
      where: {
        disabledAt: null,
        members: { none: { isStoreReview: false, ...CLUB_ROLE } },
      },
    });
  });

  it("decided corrections are counted within the window", async () => {
    await service.get("12w", NOW);
    expect(prisma.trackCorrection.count).toHaveBeenCalledWith({
      where: {
        status: "APPROVED",
        reviewedAt: {
          gte: new Date("2026-04-26T22:00:00Z"),
          lt: new Date("2026-07-19T22:00:00Z"),
        },
      },
    });
  });
});
