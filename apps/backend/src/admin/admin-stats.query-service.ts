import { Injectable } from "@nestjs/common";
import {
  CompetitionStatus,
  LicenseRenewalStatus,
  Prisma,
  RegistrationStatus,
  TrackCorrectionReason,
  TrackCorrectionStatus,
  TrackStatus,
  UserRole,
} from "@prisma/client";
import { withRole } from "../auth/roles";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AdminStatsDto,
  CompetitionsStatsDto,
  ContentStatsDto,
  LicencesStatsDto,
  UsersStatsDto,
} from "./dto/admin-stats.dto";
import {
  parisMidnightInDays,
  statsWindow,
  type StatsPeriod,
  type StatsWindow,
  zeroFill,
  zeroFillCount,
} from "./stats/stats-period";
import { medianReviewHours, timeSeries } from "./stats/stats-series";

export const CLUB_TABLE_LIMIT = 50;
const DAY_MS = 86_400_000;

interface ClubFigures {
  members: number;
  clubAccounts: number;
  validLicences: number;
}

interface ClubGroup {
  clubId: string | null;
  _count: { _all: number };
}

const NOT_STORE_REVIEW = {
  isStoreReview: false,
} satisfies Prisma.UserWhereInput;

/** `{ A: n, B: m }` with every enum key, from a `groupBy` on that enum field. */
function countsByKey<K extends string>(
  keys: readonly K[],
  groups: Array<{ status: string; _count: { _all: number } }>,
): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const g of groups) {
    if (g.status in out) out[g.status as K] = g._count._all;
  }
  return out;
}

/** Back-office stats (lot 4): read-only aggregates, computed on demand. */
@Injectable()
export class AdminStatsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    period: StatsPeriod,
    now: Date = new Date(),
  ): Promise<AdminStatsDto> {
    const w = statsWindow(period, now);
    const [users, licences, competitions, content] = await Promise.all([
      this.users(w, now),
      this.licences(w, now),
      this.competitions(w),
      this.content(w),
    ]);
    return {
      generatedAt: now.toISOString(),
      period: w.period,
      bucket: w.bucket,
      buckets: w.buckets,
      users,
      licences,
      competitions,
      content,
    };
  }

  private async users(w: StatsWindow, now: Date): Promise<UsersStatsDto> {
    const count = (where: Prisma.UserWhereInput = {}) =>
      this.prisma.user.count({ where: { ...NOT_STORE_REVIEW, ...where } });
    const roles = Object.values(UserRole);
    const [
      total,
      roleCounts,
      neverLoggedIn,
      active7d,
      active30d,
      disabled,
      rows,
    ] = await Promise.all([
      count(),
      Promise.all(roles.map((r) => count(withRole(r)))),
      count({ lastLoginAt: null }),
      count({ lastLoginAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } }),
      count({ lastLoginAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }),
      count({ disabledAt: { not: null } }),
      timeSeries(this.prisma, "signups", w),
    ]);
    return {
      total,
      byRole: Object.fromEntries(
        roles.map((r, i) => [r, roleCounts[i]]),
      ) as Record<UserRole, number>,
      neverLoggedIn,
      active7d,
      active30d,
      disabled,
      signups: zeroFill(w.buckets, rows, roles),
    };
  }

  private async licences(w: StatsWindow, now: Date): Promise<LicencesStatsDto> {
    const today = w.today;
    const validBefore = (days: number) =>
      this.prisma.license.count({
        where: {
          validUntil: { gte: today, lt: parisMidnightInDays(now, days) },
        },
      });
    const [
      valid,
      expiring30d,
      expiring60d,
      expired,
      renewalsPending,
      rows,
      clubs,
      clubsWithoutClubAccount,
    ] = await Promise.all([
      this.prisma.license.count({ where: { validUntil: { gte: today } } }),
      validBefore(30),
      validBefore(60),
      this.prisma.license.count({ where: { validUntil: { lt: today } } }),
      this.prisma.licenseRenewalRequest.count({
        where: { status: LicenseRenewalStatus.PENDING },
      }),
      timeSeries(this.prisma, "licences", w),
      this.clubsTable(today),
      this.prisma.club.count({
        where: {
          disabledAt: null,
          members: {
            none: { ...NOT_STORE_REVIEW, ...withRole(UserRole.CLUB) },
          },
        },
      }),
    ]);
    return {
      valid,
      expiring30d,
      expiring60d,
      expired,
      renewalsPending,
      created: zeroFillCount(w.buckets, rows),
      clubs,
      clubsWithoutClubAccount,
    };
  }

  private async clubsTable(today: Date): Promise<LicencesStatsDto["clubs"]> {
    const top = await this.prisma.user.groupBy({
      by: ["clubId"],
      where: { clubId: { not: null }, ...NOT_STORE_REVIEW },
      _count: { _all: true },
      orderBy: [{ _count: { clubId: "desc" } }, { clubId: "asc" }],
      take: CLUB_TABLE_LIMIT,
    });
    const ids = top.flatMap((g) => (g.clubId ? [g.clubId] : []));
    if (!ids.length) return [];
    const [figures, names] = await Promise.all([
      this.clubFigures(ids, today),
      this.prisma.club.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
        take: ids.length,
      }),
    ]);
    const nameOf = new Map(names.map((c) => [c.id, c.name]));
    return ids.map((id) => ({
      id,
      name: nameOf.get(id) ?? "",
      ...(figures.get(id) ?? { members: 0, clubAccounts: 0, validLicences: 0 }),
    }));
  }

  /** Members, Club accounts and valid licences per club, through `User.clubId`. */
  async clubFigures(
    ids: string[],
    today: Date,
  ): Promise<Map<string, ClubFigures>> {
    const out = new Map<string, ClubFigures>(
      ids.map((id) => [id, { members: 0, clubAccounts: 0, validLicences: 0 }]),
    );
    if (!ids.length) return out;
    const base = { clubId: { in: ids }, ...NOT_STORE_REVIEW };
    const [members, accounts, licences] = await Promise.all([
      this.prisma.user.groupBy({
        by: ["clubId"],
        where: base,
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ["clubId"],
        where: { ...base, ...withRole(UserRole.CLUB) },
        _count: { _all: true },
      }),
      this.prisma.user.groupBy({
        by: ["clubId"],
        where: { ...base, license: { is: { validUntil: { gte: today } } } },
        _count: { _all: true },
      }),
    ]);
    const add = (groups: ClubGroup[], field: keyof ClubFigures) => {
      for (const g of groups) {
        const f = g.clubId ? out.get(g.clubId) : undefined;
        if (f) f[field] = g._count._all;
      }
    };
    add(members, "members");
    add(accounts, "clubAccounts");
    add(licences, "validLicences");
    return out;
  }

  private async competitions(w: StatsWindow): Promise<CompetitionsStatsDto> {
    const past = {
      status: RegistrationStatus.CONFIRMED,
      event: { competition: { status: CompetitionStatus.PAST } },
    } satisfies Prisma.RegistrationWhereInput;
    const [groups, rows, pastConfirmed, pastCheckedIn, pastPaid] =
      await Promise.all([
        this.prisma.competition.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        timeSeries(this.prisma, "registrations", w),
        this.prisma.registration.count({ where: past }),
        this.prisma.registration.count({ where: { ...past, checkedIn: true } }),
        this.prisma.registration.count({ where: { ...past, feePaid: true } }),
      ]);
    return {
      byStatus: countsByKey(Object.values(CompetitionStatus), groups),
      registrations: zeroFill(
        w.buckets,
        rows,
        Object.values(RegistrationStatus),
      ),
      pastConfirmed,
      pastCheckedIn,
      pastPaid,
    };
  }

  private async content(w: StatsWindow): Promise<ContentStatsDto> {
    const decided = (status: TrackCorrectionStatus) =>
      this.prisma.trackCorrection.count({
        where: { status, reviewedAt: { gte: w.start, lt: w.end } },
      });
    const [
      trackGroups,
      tracksBlacklisted,
      tracksMasked,
      correctionsPending,
      correctionsApproved,
      correctionsRejected,
      median,
      corrections,
      bugReports,
      adminActions,
    ] = await Promise.all([
      this.prisma.track.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.track.count({ where: { blacklisted: true } }),
      this.prisma.track.count({ where: { titleMasked: true } }),
      this.prisma.trackCorrection.count({
        where: { status: TrackCorrectionStatus.PENDING },
      }),
      decided(TrackCorrectionStatus.APPROVED),
      decided(TrackCorrectionStatus.REJECTED),
      medianReviewHours(this.prisma, w),
      timeSeries(this.prisma, "corrections", w),
      timeSeries(this.prisma, "bugReports", w),
      timeSeries(this.prisma, "adminActions", w),
    ]);
    return {
      tracksByStatus: countsByKey(Object.values(TrackStatus), trackGroups),
      tracksBlacklisted,
      tracksMasked,
      correctionsPending,
      correctionsApproved,
      correctionsRejected,
      medianReviewHours: median,
      corrections: zeroFill(
        w.buckets,
        corrections,
        Object.values(TrackCorrectionReason),
      ),
      bugReports: zeroFillCount(w.buckets, bugReports),
      adminActions: zeroFillCount(w.buckets, adminActions),
    };
  }
}
