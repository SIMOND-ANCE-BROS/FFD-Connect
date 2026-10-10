# Admin back-office lot 4 — database stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only « Statistiques » page in the admin SPA, fed by one `GET /admin/stats?period=` endpoint that aggregates users, licences and clubs, competitions, content and moderation from existing tables.

**Architecture:** A pure Europe/Paris bucket helper computes the period window; a whitelisted `$queryRaw` series helper groups rows by `date_trunc` in Paris time; `AdminStatsQueryService` runs the four blocks in parallel with Prisma `count`/`groupBy`; a class-guarded `AdminStatsController` exposes them. The SPA loads `@mantine/charts` only on the lazy `/stats` route.

**Tech Stack:** NestJS 11, Prisma 7 / PostgreSQL 15, Jest; React 19, Mantine 8 (+ `@mantine/charts`, `recharts`), TanStack Query 5, React Router 7, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-admin-lot4-stats-design.md`

## Global Constraints

- Worktree `/Users/gabin/Development/FFD-Connect-lot4`, branch `feature/admin-lot4-stats`. Never commit to `develop`.
- Route `GET /admin/stats?period=12w|6m|12m`, ADMIN-only via class-level `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)`. `period` defaults to `12w`; any other value → 400.
- Buckets: Monday 00:00 Europe/Paris (`12w`, 12 weekly buckets) or 1st 00:00 Europe/Paris (`6m`/`12m`, 6/12 monthly). Current bucket included, last in the list. Bucket keys are `YYYY-MM-DD` Paris dates.
- Every series has exactly one entry per bucket, zero-filled.
- Store-review accounts (`isStoreReview = true`) excluded from every user count and from the per-club figures.
- Roles count extra roles (`withRole` from `src/auth/roles.ts`).
- Valid licence: `validUntil >= start of today (Paris)`. Expiring within N days: valid and `validUntil < 00:00 Paris of today + N days`. Expired: `validUntil < start of today`.
- No migration, no cron, no cache, no audit row. No `any`. No `process.env`. `take` on every `findMany` / limited `groupBy`.
- SQL identifiers only from a code whitelist (`Prisma.raw` on constants), values only as bound parameters.
- SPA query: `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: false`, no polling. Error copy = `UNAVAILABLE_MESSAGE` from `src/lib/apiError.ts`.
- SPA code style: single quotes; backend: double quotes (Prettier per app).
- Copy (French, verbatim): menu « Statistiques »; periods « 12 semaines », « 6 mois », « 12 mois »; « Calculé le … »; « Actualiser »; footer « Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés. »; empty rate/median « — ».
- Real-DB tests only on `ffd_connect_admin_test`: `source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh` before running integration specs. Never reset the shared `ffd_connect` DB.
- Commits: conventional, English, ending with
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv
  ```

## Review Focus

1. **DST weeks** — a week containing the last Sunday of March or October must still start Monday 00:00 Paris, and the window `start`/`end` must be exact instants (Task 1 tests both changes).
2. **Late Sunday evening UTC** — a row at Sunday 22:30 UTC in summer (= Monday 00:30 Paris) must land in the new week; the SQL and the TypeScript buckets must agree (Task 2 integration test).
3. **Empty database** — every series still has 12/6/12 zero entries, median and rates are `null`/« — », no division by zero, no crash (Task 3 unit, Task 6 SPA test).
4. **Bigint from Postgres** — `count(*)` comes back as `bigint`; JSON serialisation of a bigint throws. Every raw count must go through `Number()` (Task 2 unit test).
5. **Club with members but licences whose free-text club is another one; store-review member** — valid licences per club must follow `User.clubId`, and a store-review member must not count (Task 3 integration test).

---

### Task 1: Paris period window and zero-fill helpers

**Files:**
- Create: `apps/backend/src/admin/stats/stats-period.ts`
- Test: `apps/backend/src/admin/stats/stats-period.spec.ts`

**Interfaces:**
- Produces:
  - `STATS_PERIODS = ["12w", "6m", "12m"] as const`, `type StatsPeriod`, `type StatsBucket = "week" | "month"`
  - `interface StatsWindow { period; bucket; buckets: string[]; start: Date; end: Date; today: Date }`
  - `statsWindow(period: StatsPeriod, now: Date): StatsWindow`
  - `parisMidnightInDays(now: Date, days: number): Date`
  - `interface SeriesRow { start: string; key: string | null; count: number }`
  - `zeroFill<K extends string>(buckets: string[], rows: SeriesRow[], keys: readonly K[]): Array<{ start: string } & Record<K, number>>`
  - `zeroFillCount(buckets: string[], rows: SeriesRow[]): Array<{ start: string; count: number }>`

- [ ] **Step 0: Prepare the worktree** (a fresh worktree has no deps)

```bash
cd /Users/gabin/Development/FFD-Connect-lot4 && pnpm install --frozen-lockfile && pnpm --filter backend exec prisma generate
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/admin/stats/stats-period.spec.ts
import {
  parisMidnightInDays,
  statsWindow,
  zeroFill,
  zeroFillCount,
} from "./stats-period";

describe("statsWindow", () => {
  it("12w: 12 Monday buckets, current week last (Wednesday in summer)", () => {
    const w = statsWindow("12w", new Date("2026-07-15T10:00:00Z"));
    expect(w.bucket).toBe("week");
    expect(w.buckets).toHaveLength(12);
    expect(w.buckets[11]).toBe("2026-07-13");
    expect(w.buckets[0]).toBe("2026-04-27");
    expect(w.start.toISOString()).toBe("2026-04-26T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-07-19T22:00:00.000Z");
    expect(w.today.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("Sunday 22:30 UTC in summer is already Monday in Paris", () => {
    const w = statsWindow("12w", new Date("2026-07-19T22:30:00Z"));
    expect(w.buckets[11]).toBe("2026-07-20");
  });

  it("a Sunday counts in the week of the previous Monday", () => {
    const w = statsWindow("12w", new Date("2026-07-19T12:00:00Z"));
    expect(w.buckets[11]).toBe("2026-07-13");
  });

  it("week of the October DST change: start in summer time, end in winter time", () => {
    const w = statsWindow("12w", new Date("2026-10-21T10:00:00Z"));
    expect(w.buckets[11]).toBe("2026-10-19");
    expect(w.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("week of the March DST change", () => {
    const w = statsWindow("12w", new Date("2026-03-25T10:00:00Z"));
    expect(w.buckets[11]).toBe("2026-03-23");
    expect(w.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("6m: monthly buckets across a year boundary", () => {
    const w = statsWindow("6m", new Date("2026-02-10T10:00:00Z"));
    expect(w.bucket).toBe("month");
    expect(w.buckets).toEqual([
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(w.start.toISOString()).toBe("2025-08-31T22:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-02-28T23:00:00.000Z");
  });

  it("12m: 12 monthly buckets; 31 Dec 23:30 UTC is already January in Paris", () => {
    const w = statsWindow("12m", new Date("2026-12-31T23:30:00Z"));
    expect(w.buckets).toHaveLength(12);
    expect(w.buckets[11]).toBe("2027-01-01");
    expect(w.buckets[0]).toBe("2026-02-01");
  });
});

describe("parisMidnightInDays", () => {
  it("adds calendar days in Paris time across the DST change", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(parisMidnightInDays(now, 0).toISOString()).toBe(
      "2026-10-19T22:00:00.000Z",
    );
    expect(parisMidnightInDays(now, 30).toISOString()).toBe(
      "2026-11-18T23:00:00.000Z",
    );
  });
});

describe("zeroFill", () => {
  const buckets = ["2026-07-06", "2026-07-13"];

  it("fills every bucket and key, ignoring unknown buckets and keys", () => {
    const rows = [
      { start: "2026-07-13", key: "CLUB", count: 2 },
      { start: "2026-07-13", key: "NOPE", count: 9 },
      { start: "2020-01-06", key: "CLUB", count: 9 },
      { start: "2026-07-13", key: "CLUB", count: 1 },
    ];
    expect(zeroFill(buckets, rows, ["LICENSEE", "CLUB"] as const)).toEqual([
      { start: "2026-07-06", LICENSEE: 0, CLUB: 0 },
      { start: "2026-07-13", LICENSEE: 0, CLUB: 3 },
    ]);
  });

  it("zeroFillCount sums rows per bucket", () => {
    expect(
      zeroFillCount(buckets, [{ start: "2026-07-06", key: null, count: 4 }]),
    ).toEqual([
      { start: "2026-07-06", count: 4 },
      { start: "2026-07-13", count: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-period.spec.ts`
Expected: FAIL, cannot find module `./stats-period`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/admin/stats/stats-period.ts
/**
 * Stats periods (lot 4): bucket boundaries in Europe/Paris, computed in
 * TypeScript so they match the SQL `date_trunc(... AT TIME ZONE 'Europe/Paris')`
 * grouping exactly, DST included.
 */
export const STATS_PERIODS = ["12w", "6m", "12m"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export type StatsBucket = "week" | "month";

export interface StatsWindow {
  period: StatsPeriod;
  bucket: StatsBucket;
  /** Bucket starts as Paris calendar dates (YYYY-MM-DD), oldest first. */
  buckets: string[];
  /** First bucket's start (inclusive). */
  start: Date;
  /** End of the current bucket (exclusive). */
  end: Date;
  /** Today 00:00 in Paris. */
  today: Date;
}

export interface SeriesRow {
  start: string;
  key: string | null;
  count: number;
}

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

type WallClock = Record<
  "year" | "month" | "day" | "hour" | "minute" | "second",
  number
>;

const BUCKET_COUNT: Record<StatsPeriod, number> = { "12w": 12, "6m": 6, "12m": 12 };

const parisFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parisWallClock(instant: Date): WallClock {
  const p: Record<string, number> = {};
  for (const part of parisFormat.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return p as WallClock;
}

/** Paris offset from UTC (ms) at an instant. */
function parisOffset(instant: Date): number {
  const w = parisWallClock(instant);
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

/** 00:00 Paris on a calendar date. Paris never skips midnight (DST is at 02:00/03:00). */
function parisMidnight(c: CalendarDate): Date {
  const guess = Date.UTC(c.y, c.m - 1, c.d);
  const first = guess - parisOffset(new Date(guess));
  return new Date(guess - parisOffset(new Date(first)));
}

const fromUtc = (t: Date): CalendarDate => ({
  y: t.getUTCFullYear(),
  m: t.getUTCMonth() + 1,
  d: t.getUTCDate(),
});
const addDays = (c: CalendarDate, n: number) =>
  fromUtc(new Date(Date.UTC(c.y, c.m - 1, c.d + n)));
const addMonths = (c: CalendarDate, n: number) =>
  fromUtc(new Date(Date.UTC(c.y, c.m - 1 + n, 1)));
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (c: CalendarDate) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

function parisToday(now: Date): CalendarDate {
  const w = parisWallClock(now);
  return { y: w.year, m: w.month, d: w.day };
}

export function statsWindow(period: StatsPeriod, now: Date): StatsWindow {
  const today = parisToday(now);
  const bucket: StatsBucket = period === "12w" ? "week" : "month";
  let current: CalendarDate;
  let step: (c: CalendarDate, n: number) => CalendarDate;
  if (bucket === "week") {
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    current = addDays(today, -((dow + 6) % 7)); // back to Monday
    step = (c, n) => addDays(c, 7 * n);
  } else {
    current = { y: today.y, m: today.m, d: 1 };
    step = addMonths;
  }
  const count = BUCKET_COUNT[period];
  const starts = Array.from({ length: count }, (_, i) =>
    step(current, i - (count - 1)),
  );
  return {
    period,
    bucket,
    buckets: starts.map(isoDate),
    start: parisMidnight(starts[0]),
    end: parisMidnight(step(current, 1)),
    today: parisMidnight(today),
  };
}

/** 00:00 Paris, `days` calendar days after today (Paris). */
export function parisMidnightInDays(now: Date, days: number): Date {
  return parisMidnight(addDays(parisToday(now), days));
}

export function zeroFill<K extends string>(
  buckets: string[],
  rows: SeriesRow[],
  keys: readonly K[],
): Array<{ start: string } & Record<K, number>> {
  const byStart = new Map<string, Record<string, number | string>>(
    buckets.map((start) => [
      start,
      { start, ...Object.fromEntries(keys.map((k) => [k, 0])) },
    ]),
  );
  for (const r of rows) {
    const entry = byStart.get(r.start);
    if (entry && r.key !== null && (keys as readonly string[]).includes(r.key)) {
      entry[r.key] = (entry[r.key] as number) + r.count;
    }
  }
  return [...byStart.values()] as Array<{ start: string } & Record<K, number>>;
}

export function zeroFillCount(
  buckets: string[],
  rows: SeriesRow[],
): Array<{ start: string; count: number }> {
  const totals = new Map(buckets.map((b) => [b, 0]));
  for (const r of rows) {
    const t = totals.get(r.start);
    if (t !== undefined) totals.set(r.start, t + r.count);
  }
  return buckets.map((start) => ({ start, count: totals.get(start) ?? 0 }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-period.spec.ts`
Expected: PASS (10 tests). If an expected ISO instant is off by one hour, fix the helper, never the test: the expected values use the real Paris offsets (+2 summer, +1 winter).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin/stats/stats-period.ts apps/backend/src/admin/stats/stats-period.spec.ts
git commit -m "feat(admin): Paris period window for stats"
```

---

### Task 2: Time series and median SQL

**Files:**
- Create: `apps/backend/src/admin/stats/stats-series.ts`
- Test: `apps/backend/src/admin/stats/stats-series.spec.ts`
- Test (real DB): `apps/backend/test/admin-stats.integration-spec.ts` (created here, extended in Task 3)

**Interfaces:**
- Consumes: `StatsWindow`, `SeriesRow`, `statsWindow` (Task 1).
- Produces:
  - `type SeriesKey = "signups" | "licences" | "registrations" | "corrections" | "bugReports" | "adminActions"`
  - `timeSeries(prisma: PrismaService, key: SeriesKey, w: StatsWindow): Promise<SeriesRow[]>`
  - `medianReviewHours(prisma: PrismaService, w: StatsWindow): Promise<number | null>` (one decimal)

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/backend/src/admin/stats/stats-series.spec.ts
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import { statsWindow } from "./stats-period";
import { medianReviewHours, timeSeries } from "./stats-series";

const w = statsWindow("12w", new Date("2026-07-15T10:00:00Z"));

const prismaWith = (rows: unknown) => {
  const $queryRaw = jest.fn().mockResolvedValue(rows);
  return { prisma: { $queryRaw } as unknown as PrismaService, $queryRaw };
};
const sqlOf = (mock: jest.Mock) => mock.mock.calls[0][0] as Prisma.Sql;

describe("timeSeries", () => {
  it("converts bigint counts to numbers", async () => {
    const { prisma } = prismaWith([
      { start: "2026-07-13", key: "CLUB", count: BigInt(3) },
    ]);
    const rows = await timeSeries(prisma, "signups", w);
    expect(rows).toEqual([{ start: "2026-07-13", key: "CLUB", count: 3 }]);
    expect(() => JSON.stringify(rows)).not.toThrow();
  });

  it("signups: User table, split by role, store-review excluded, Paris week", async () => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(prisma, "signups", w);
    const sql = sqlOf($queryRaw);
    expect(sql.sql).toContain('FROM "User"');
    expect(sql.sql).toContain('"role"::text');
    expect(sql.sql).toContain('"isStoreReview" = false');
    expect(sql.sql).toContain("AT TIME ZONE 'Europe/Paris'");
    expect(sql.values).toEqual([
      "week",
      w.start.toISOString(),
      w.end.toISOString(),
    ]);
  });

  it("monthly unit is a bound value", async () => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(
      prisma,
      "bugReports",
      statsWindow("6m", new Date("2026-07-15T10:00:00Z")),
    );
    const sql = sqlOf($queryRaw);
    expect(sql.sql).toContain('FROM "BugReport"');
    expect(sql.sql).toContain("NULL::text");
    expect(sql.values[0]).toBe("month");
  });

  it.each([
    ["licences", '"License"', "NULL::text"],
    ["registrations", '"Registration"', '"status"::text'],
    ["corrections", '"TrackCorrection"', '"reason"::text'],
    ["adminActions", '"AdminAuditLog"', "NULL::text"],
  ] as const)("%s reads %s split by %s", async (key, table, split) => {
    const { prisma, $queryRaw } = prismaWith([]);
    await timeSeries(prisma, key, w);
    expect(sqlOf($queryRaw).sql).toContain(`FROM ${table}`);
    expect(sqlOf($queryRaw).sql).toContain(split);
  });
});

describe("medianReviewHours", () => {
  it("returns hours with one decimal", async () => {
    const { prisma } = prismaWith([{ median: 5400 }]); // seconds
    await expect(medianReviewHours(prisma, w)).resolves.toBe(1.5);
  });

  it("returns null without decided corrections", async () => {
    const { prisma } = prismaWith([{ median: null }]);
    await expect(medianReviewHours(prisma, w)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-series.spec.ts`
Expected: FAIL, cannot find module `./stats-series`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/admin/stats/stats-series.ts
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { SeriesRow, StatsWindow } from "./stats-period";

export type SeriesKey =
  | "signups"
  | "licences"
  | "registrations"
  | "corrections"
  | "bugReports"
  | "adminActions";

/**
 * Identifiers are code constants (never input): they go through Prisma.raw.
 * Values (unit, bounds) are bound parameters.
 */
const SERIES: Record<SeriesKey, { table: string; split: string; where: string }> = {
  signups: { table: '"User"', split: '"role"::text', where: 'AND "isStoreReview" = false' },
  licences: { table: '"License"', split: "NULL::text", where: "" },
  registrations: { table: '"Registration"', split: '"status"::text', where: "" },
  corrections: { table: '"TrackCorrection"', split: '"reason"::text', where: "" },
  bugReports: { table: '"BugReport"', split: "NULL::text", where: "" },
  adminActions: { table: '"AdminAuditLog"', split: "NULL::text", where: "" },
};

// Columns are `timestamp(3)` holding UTC: AT TIME ZONE 'UTC' makes them
// timestamptz, then AT TIME ZONE 'Europe/Paris' gives the Paris wall clock.
const PARIS = Prisma.sql`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris'`;
const utcBound = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export async function timeSeries(
  prisma: PrismaService,
  key: SeriesKey,
  w: StatsWindow,
): Promise<SeriesRow[]> {
  const s = SERIES[key];
  const rows = await prisma.$queryRaw<
    { start: string; key: string | null; count: bigint | number }[]
  >`
    SELECT to_char(date_trunc(${w.bucket}, "createdAt" ${PARIS}), 'YYYY-MM-DD') AS start,
           ${Prisma.raw(s.split)} AS key,
           count(*) AS count
    FROM ${Prisma.raw(s.table)}
    WHERE "createdAt" >= ${utcBound(w.start)} AND "createdAt" < ${utcBound(w.end)}
    ${Prisma.raw(s.where)}
    GROUP BY 1, 2`;
  return rows.map((r) => ({ start: r.start, key: r.key, count: Number(r.count) }));
}

/** Median handling time (hours, 1 decimal) of corrections decided in the window. */
export async function medianReviewHours(
  prisma: PrismaService,
  w: StatsWindow,
): Promise<number | null> {
  const [row] = await prisma.$queryRaw<{ median: number | null }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (
             ORDER BY extract(epoch FROM "reviewedAt" - "createdAt")
           )::float8 AS median
    FROM "TrackCorrection"
    WHERE "status" IN ('APPROVED', 'REJECTED')
      AND "reviewedAt" >= ${utcBound(w.start)} AND "reviewedAt" < ${utcBound(w.end)}`;
  if (row?.median === null || row?.median === undefined) return null;
  return Math.round((Number(row.median) / 3600) * 10) / 10;
}
```

The `sql.values` assertion expects exactly `["week", startIso, endIso]`: keep the bucket → start → end order in the query text. Do not loosen the test to `arrayContaining`.

- [ ] **Step 4: Run unit tests**

Run: `pnpm --filter backend exec jest src/admin/stats/stats-series.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the real-DB integration test**

Rows are placed in 2001, so no other suite's data falls in the window; `now` is injected.

```ts
// apps/backend/test/admin-stats.integration-spec.ts
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
```

- [ ] **Step 6: Run the integration test on the dedicated DB**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4/apps/backend
source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh
npx prisma migrate deploy
npx jest --config ./test/jest-integration.json --runInBand --forceExit test/admin-stats.integration-spec.ts
```
Expected: PASS (3 tests). If Postgres is down, run `docker compose --profile infra up -d` from the repo root first.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/admin/stats/stats-series.ts apps/backend/src/admin/stats/stats-series.spec.ts apps/backend/test/admin-stats.integration-spec.ts
git commit -m "feat(admin): stats time series grouped in Paris time"
```

---

### Task 3: Stats DTO and query service (the four blocks)

**Files:**
- Create: `apps/backend/src/admin/dto/admin-stats.dto.ts`
- Create: `apps/backend/src/admin/admin-stats.query-service.ts`
- Test: `apps/backend/src/admin/admin-stats.query-service.spec.ts`
- Modify: `apps/backend/src/admin/admin.module.ts` (register the provider)
- Modify: `apps/backend/test/admin-stats.integration-spec.ts` (figure tests)

**Interfaces:**
- Consumes: `statsWindow`, `parisMidnightInDays`, `zeroFill`, `zeroFillCount`, `StatsPeriod`, `StatsWindow`, `STATS_PERIODS` (Task 1); `timeSeries`, `medianReviewHours` (Task 2); `withRole` (`src/auth/roles.ts`).
- Produces:
  - `class AdminStatsQueryDto { period?: StatsPeriod }` (`@IsOptional() @IsIn(STATS_PERIODS)`)
  - `class AdminStatsDto` (shape of spec §4) and nested classes, all with `@ApiProperty`
  - `AdminStatsQueryService.get(period: StatsPeriod, now?: Date): Promise<AdminStatsDto>`
  - `AdminStatsQueryService.clubFigures(ids: string[], today: Date): Promise<Map<string, { members: number; clubAccounts: number; validLicences: number }>>` (public for the real-DB test)
  - `CLUB_TABLE_LIMIT = 50`

- [ ] **Step 1: Write the DTOs**

```ts
// apps/backend/src/admin/dto/admin-stats.dto.ts
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { STATS_PERIODS, type StatsPeriod } from "../stats/stats-period";

export class AdminStatsQueryDto {
  @ApiPropertyOptional({ enum: STATS_PERIODS, default: "12w" })
  @IsOptional()
  @IsIn(STATS_PERIODS)
  period?: StatsPeriod;
}

export class RoleCountsDto {
  @ApiProperty() LICENSEE!: number;
  @ApiProperty() CLUB!: number;
  @ApiProperty() STAFF!: number;
  @ApiProperty() ADMIN!: number;
}

export class SignupBucketDto extends RoleCountsDto {
  @ApiProperty({ description: "Bucket start, YYYY-MM-DD (Europe/Paris)" })
  start!: string;
}

export class CountBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() count!: number;
}

export class RegistrationBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() PENDING!: number;
  @ApiProperty() CONFIRMED!: number;
  @ApiProperty() CANCELLED!: number;
}

export class CorrectionBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() TITLE!: number;
  @ApiProperty() ARTIST!: number;
  @ApiProperty() DANCE!: number;
  @ApiProperty() MPM!: number;
  @ApiProperty() PASO_CLASH!: number;
  @ApiProperty() OTHER!: number;
}

export class CompetitionStatusCountsDto {
  @ApiProperty() UPCOMING!: number;
  @ApiProperty() LIVE!: number;
  @ApiProperty() PAST!: number;
  @ApiProperty() CANCELLED!: number;
}

export class TrackStatusCountsDto {
  @ApiProperty() READY!: number;
  @ApiProperty() PENDING!: number;
  @ApiProperty() ERROR!: number;
}

export class StatsClubRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() members!: number;
  @ApiProperty() clubAccounts!: number;
  @ApiProperty() validLicences!: number;
}

export class UsersStatsDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: RoleCountsDto }) byRole!: RoleCountsDto;
  @ApiProperty() neverLoggedIn!: number;
  @ApiProperty() active7d!: number;
  @ApiProperty() active30d!: number;
  @ApiProperty() disabled!: number;
  @ApiProperty({ type: [SignupBucketDto] }) signups!: SignupBucketDto[];
}

export class LicencesStatsDto {
  @ApiProperty() valid!: number;
  @ApiProperty() expiring30d!: number;
  @ApiProperty() expiring60d!: number;
  @ApiProperty() expired!: number;
  @ApiProperty() renewalsPending!: number;
  @ApiProperty({ type: [CountBucketDto] }) created!: CountBucketDto[];
  @ApiProperty({ type: [StatsClubRowDto] }) clubs!: StatsClubRowDto[];
  @ApiProperty() clubsWithoutClubAccount!: number;
}

export class CompetitionsStatsDto {
  @ApiProperty({ type: CompetitionStatusCountsDto })
  byStatus!: CompetitionStatusCountsDto;
  @ApiProperty({ type: [RegistrationBucketDto] })
  registrations!: RegistrationBucketDto[];
  @ApiProperty() pastConfirmed!: number;
  @ApiProperty() pastCheckedIn!: number;
  @ApiProperty() pastPaid!: number;
}

export class ContentStatsDto {
  @ApiProperty({ type: TrackStatusCountsDto })
  tracksByStatus!: TrackStatusCountsDto;
  @ApiProperty() tracksBlacklisted!: number;
  @ApiProperty() tracksMasked!: number;
  @ApiProperty() correctionsPending!: number;
  @ApiProperty({ description: "Decided during the period" })
  correctionsApproved!: number;
  @ApiProperty({ description: "Decided during the period" })
  correctionsRejected!: number;
  @ApiProperty({ type: Number, nullable: true })
  medianReviewHours!: number | null;
  @ApiProperty({ type: [CorrectionBucketDto] })
  corrections!: CorrectionBucketDto[];
  @ApiProperty({ type: [CountBucketDto] }) bugReports!: CountBucketDto[];
  @ApiProperty({ type: [CountBucketDto] }) adminActions!: CountBucketDto[];
}

export class AdminStatsDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ enum: STATS_PERIODS }) period!: StatsPeriod;
  @ApiProperty({ enum: ["week", "month"] }) bucket!: "week" | "month";
  @ApiProperty({ type: [String] }) buckets!: string[];
  @ApiProperty({ type: UsersStatsDto }) users!: UsersStatsDto;
  @ApiProperty({ type: LicencesStatsDto }) licences!: LicencesStatsDto;
  @ApiProperty({ type: CompetitionsStatsDto }) competitions!: CompetitionsStatsDto;
  @ApiProperty({ type: ContentStatsDto }) content!: ContentStatsDto;
}
```

- [ ] **Step 2: Write the failing unit tests**

The Prisma double records each call, so each figure's filter is asserted.

```ts
// apps/backend/src/admin/admin-stats.query-service.spec.ts
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
    expect(s.users.byRole).toEqual({ LICENSEE: 0, CLUB: 0, STAFF: 0, ADMIN: 0 });
    expect(s.competitions.byStatus).toEqual({
      UPCOMING: 0,
      LIVE: 0,
      PAST: 0,
      CANCELLED: 0,
    });
    expect(s.content.tracksByStatus).toEqual({ READY: 0, PENDING: 0, ERROR: 0 });
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
    expect(s.content.tracksByStatus).toEqual({ READY: 7, PENDING: 0, ERROR: 0 });
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
      { id: "c1", name: "Club Un", members: 5, clubAccounts: 1, validLicences: 3 },
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/admin/admin-stats.query-service.spec.ts`
Expected: FAIL, cannot find module `./admin-stats.query-service`.

- [ ] **Step 4: Implement the service**

```ts
// apps/backend/src/admin/admin-stats.query-service.ts
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

const NOT_STORE_REVIEW = { isStoreReview: false } satisfies Prisma.UserWhereInput;

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

  async get(period: StatsPeriod, now: Date = new Date()): Promise<AdminStatsDto> {
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
    const [total, roleCounts, neverLoggedIn, active7d, active30d, disabled, rows] =
      await Promise.all([
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
        where: { validUntil: { gte: today, lt: parisMidnightInDays(now, days) } },
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
          members: { none: { ...NOT_STORE_REVIEW, ...withRole(UserRole.CLUB) } },
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
      registrations: zeroFill(w.buckets, rows, Object.values(RegistrationStatus)),
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
```

If Prisma's `groupBy` overloads demand a looser type for the `by: ["status"]` results passed to `countsByKey`, map them first (`groups.map((g) => ({ status: g.status, _count: g._count }))`); never use `any`.

Register the provider: in `apps/backend/src/admin/admin.module.ts`, import `AdminStatsQueryService` and add it to `providers` (alphabetical order, after `AdminReferenceService`). The real-DB test below resolves it from `AppModule`.

- [ ] **Step 5: Run unit tests**

Run: `pnpm --filter backend exec jest src/admin/admin-stats.query-service.spec.ts`
Expected: PASS (8 tests). In the clubs test, `user.groupBy` is called in this order: `clubsTable`'s top-50 query, then `clubFigures`' three queries (members, Club accounts, valid licences, in that array order).

- [ ] **Step 6: Add real-DB figure tests to `test/admin-stats.integration-spec.ts`**

Add `import { AdminStatsQueryService } from "../src/admin/admin-stats.query-service";`, a `const clubIds: string[] = [];` next to `userIds`, and in `afterEach` after deleting users: `await prisma.club.deleteMany({ where: { id: { in: clubIds } } }); clubIds.length = 0;`. Then add these tests inside the `describe`:

```ts
  it("per-club figures follow User.clubId and skip store-review members", async () => {
    const service = moduleRef.get(AdminStatsQueryService);
    const club = await prisma.club.create({ data: { name: `Stat ${randomUUID()}` } });
    const other = await prisma.club.create({ data: { name: `Stat ${randomUUID()}` } });
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
```

- [ ] **Step 7: Run the integration tests**

Same commands as Task 2 Step 6. Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin/dto/admin-stats.dto.ts apps/backend/src/admin/admin-stats.query-service.ts apps/backend/src/admin/admin-stats.query-service.spec.ts apps/backend/src/admin/admin.module.ts apps/backend/test/admin-stats.integration-spec.ts
git commit -m "feat(admin): stats query service for the four blocks"
```

---

### Task 4: Controller, route matrix, Swagger, privacy line

**Files:**
- Create: `apps/backend/src/admin/admin-stats.controller.ts`
- Test: `apps/backend/src/admin/admin-stats.controller.spec.ts`
- Modify: `apps/backend/src/admin/admin.module.ts` (add the controller)
- Modify: `apps/backend/test/admin.e2e-spec.ts` (route matrix + 400 + 200)
- Modify (if needed): `apps/backend/test/mocks/prisma.mock.ts`
- Modify: `apps/backend/swagger.json` (regenerated)
- Modify: `docs/legal/politique-confidentialite.md` §3 table

**Interfaces:**
- Consumes: `AdminStatsQueryService.get`, `AdminStatsQueryDto`, `AdminStatsDto` (Task 3).
- Produces: route `GET /api/v1/admin/stats`; after `pnpm api:sync`, the SPA's generated SDK function `adminStatsControllerGet` and type `AdminStatsDto` (Task 5).

- [ ] **Step 1: Write the failing controller unit test**

Read `src/auth/decorators/roles.decorator.ts` for the metadata key it exports (and how `admin.controller.spec.ts` asserts class-level roles, if it does); use the same key/assertion below.

```ts
// apps/backend/src/admin/admin-stats.controller.spec.ts
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AdminStatsController } from "./admin-stats.controller";
import type { AdminStatsQueryService } from "./admin-stats.query-service";

describe("AdminStatsController", () => {
  it("is ADMIN-only at class level", () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminStatsController)).toEqual([
      UserRole.ADMIN,
    ]);
  });

  it("defaults the period to 12w and passes a given one through", async () => {
    const get = jest.fn().mockResolvedValue({});
    const controller = new AdminStatsController({
      get,
    } as unknown as AdminStatsQueryService);
    await controller.get({});
    expect(get).toHaveBeenCalledWith("12w");
    await controller.get({ period: "6m" });
    expect(get).toHaveBeenLastCalledWith("6m");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter backend exec jest src/admin/admin-stats.controller.spec.ts`
Expected: FAIL, cannot find module `./admin-stats.controller`.

- [ ] **Step 3: Implement the controller and register it**

```ts
// apps/backend/src/admin/admin-stats.controller.ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { AdminStatsQueryService } from "./admin-stats.query-service";
import { AdminStatsDto, AdminStatsQueryDto } from "./dto/admin-stats.dto";

/** Back-office stats (lot 4). Guards on the CLASS, like AdminController. */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/stats")
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsQueryService) {}

  @Get()
  @ApiOperation({ summary: "Database statistics for the back-office (read-only)" })
  @ApiResponse({ status: 200, type: AdminStatsDto })
  get(@Query() q: AdminStatsQueryDto): Promise<AdminStatsDto> {
    return this.stats.get(q.period ?? "12w");
  }
}
```

In `admin.module.ts`: import `AdminStatsController` and set `controllers: [AdminController, AdminStatsController]`.

- [ ] **Step 4: Extend the e2e route matrix and add 400 / 200 cases** in `apps/backend/test/admin.e2e-spec.ts`

Add to `ADMIN_ROUTES`, after the lot 3 entries:

```ts
  // Database stats (lot 4): ADMIN-only at class level.
  ["get", "/api/v1/admin/stats"],
  ["get", "/api/v1/admin/stats?period=6m"],
```

Add these tests at the end of the `describe`:

```ts
  it("rejects an unknown stats period with 400", async () => {
    currentRole = UserRole.ADMIN;
    await request(server()).get("/api/v1/admin/stats?period=1y").expect(400);
  });

  it("serves stats with the 12w default", async () => {
    currentRole = UserRole.ADMIN;
    prisma.$queryRaw.mockResolvedValue([] as never);
    const res = await request(server()).get("/api/v1/admin/stats").expect(200);
    expect(res.body.period).toBe("12w");
    expect(res.body.buckets).toHaveLength(12);
  });
```

If the mock Prisma lacks `$queryRaw`, `groupBy` on `user`/`competition`/`track`, or the `licenseRenewalRequest` model, add them in `test/mocks/prisma.mock.ts` in the file's existing `jest.fn()` style, with defaults `count` → `0` and `groupBy`/`findMany`/`$queryRaw` → `[]`. Do not stub `AdminStatsQueryService` in this test: it proves the real wiring.

- [ ] **Step 5: Run unit + e2e**

```bash
pnpm --filter backend exec jest src/admin/admin-stats.controller.spec.ts
pnpm --filter backend test:e2e -- test/admin.e2e-spec.ts
```
Expected: PASS; the matrix adds 2 routes × (3 non-admin roles + unauthenticated).

- [ ] **Step 6: Regenerate Swagger**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4 && pnpm api:sync
```
Expected: `apps/backend/swagger.json` gains `/admin/stats` and `AdminStatsDto`. Commit every tracked file `api:sync` changes.

- [ ] **Step 7: Privacy policy line** — in `docs/legal/politique-confidentialite.md` §3, add this row just before « Assurer la sécurité et corriger les bugs », then run `npx prettier --write docs/legal/politique-confidentialite.md` to realign the table:

```md
| Produire des statistiques agrégées pour l'administration de la plateforme | Intérêt légitime de la fédération |
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin/admin-stats.controller.ts apps/backend/src/admin/admin-stats.controller.spec.ts apps/backend/src/admin/admin.module.ts apps/backend/test/admin.e2e-spec.ts apps/backend/swagger.json docs/legal/politique-confidentialite.md
git add apps/backend/test/mocks/prisma.mock.ts 2>/dev/null || true
git commit -m "feat(admin): GET /admin/stats endpoint"
```

---

### Task 5: SPA data layer — charts dependency, stats query, formatting helpers

**Files:**
- Modify: `apps/admin/package.json`, `pnpm-lock.yaml`
- Modify: `apps/admin/src/api/queries.ts`
- Create: `apps/admin/src/lib/stats.ts`
- Test: `apps/admin/src/lib/stats.test.ts`

**Interfaces:**
- Consumes: generated `adminStatsControllerGet` and type `AdminStatsDto` (from `pnpm api:sync`, Task 4).
- Produces:
  - `type StatsPeriod = '12w' | '6m' | '12m'`, `STATS_PERIOD_OPTIONS: { value: StatsPeriod; label: string }[]`, `parseStatsPeriod(raw: string | null): StatsPeriod`
  - `statsQuery(period: StatsPeriod)` (queryOptions) in `src/api/queries.ts`
  - `bucketLabel(start: string, bucket: 'week' | 'month'): string`
  - `rateLabel(part: number, total: number): string`
  - `durationLabel(hours: number | null): string`
  - `seriesTotal(rows: Array<Record<string, number | string>>): number`

- [ ] **Step 1: Add the chart packages**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4
npm view @mantine/charts@8.3 peerDependencies
pnpm --filter admin add @mantine/charts@^8.3.0 recharts@<the range of the recharts peer dependency printed above>
```
Keep `@mantine/charts` on the same range as `@mantine/core` (`^8.3.0`).

- [ ] **Step 2: Write the failing helper tests**

```ts
// apps/admin/src/lib/stats.test.ts
import { bucketLabel, durationLabel, parseStatsPeriod, rateLabel, seriesTotal } from './stats';

describe('stats helpers', () => {
  it('parses the period from the URL, defaulting to 12w', () => {
    expect(parseStatsPeriod('6m')).toBe('6m');
    expect(parseStatsPeriod('12m')).toBe('12m');
    expect(parseStatsPeriod(null)).toBe('12w');
    expect(parseStatsPeriod('1y')).toBe('12w');
  });

  it('labels buckets in French, whatever the viewer time zone', () => {
    expect(bucketLabel('2026-10-05', 'week')).toBe('5 oct.');
    expect(bucketLabel('2026-10-01', 'month')).toBe('oct. 2026');
  });

  it('formats rates with the denominator, dash when empty', () => {
    expect(rateLabel(3, 4)).toBe('75 % (3 / 4)');
    expect(rateLabel(1, 3)).toBe('33 % (1 / 3)');
    expect(rateLabel(0, 0)).toBe('—');
  });

  it('formats durations in hours below 48 h, else days', () => {
    expect(durationLabel(null)).toBe('—');
    expect(durationLabel(6.5)).toBe('6,5 h');
    expect(durationLabel(47.9)).toBe('47,9 h');
    expect(durationLabel(72)).toBe('3 j');
    expect(durationLabel(60)).toBe('2,5 j');
  });

  it('sums every numeric field of a series', () => {
    expect(
      seriesTotal([
        { start: '2026-10-05', LICENSEE: 2, CLUB: 1 },
        { start: '2026-10-12', LICENSEE: 0, CLUB: 4 },
      ]),
    ).toBe(7);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter admin exec vitest run src/lib/stats.test.ts`
Expected: FAIL, cannot resolve `./stats`.

- [ ] **Step 4: Implement the helpers and the query**

First check the runtime's French month abbreviation: `node -e "console.log(new Intl.DateTimeFormat('fr-FR',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date('2026-10-01')))"` must print `oct. 2026`.

```ts
// apps/admin/src/lib/stats.ts
export type StatsPeriod = '12w' | '6m' | '12m';

export const STATS_PERIOD_OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: '12w', label: '12 semaines' },
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
];

export function parseStatsPeriod(raw: string | null): StatsPeriod {
  const found = STATS_PERIOD_OPTIONS.find((o) => o.value === raw);
  return found ? found.value : '12w';
}

// Bucket keys are Paris calendar dates: format them as UTC dates so the
// viewer's own time zone never shifts the day.
const weekFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function bucketLabel(start: string, bucket: 'week' | 'month'): string {
  const date = new Date(`${start}T00:00:00Z`);
  return (bucket === 'week' ? weekFormat : monthFormat).format(date);
}

export function rateLabel(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)} % (${part} / ${total})`;
}

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function durationLabel(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 48) return `${decimal.format(hours)} h`;
  return `${decimal.format(Math.round((hours / 24) * 10) / 10)} j`;
}

export function seriesTotal(rows: Array<Record<string, number | string>>): number {
  let total = 0;
  for (const row of rows) {
    for (const v of Object.values(row)) if (typeof v === 'number') total += v;
  }
  return total;
}
```

In `apps/admin/src/api/queries.ts`: add `adminStatsControllerGet` to the `./generated/sdk.gen` import, add `import type { StatsPeriod } from '../lib/stats';`, and append:

```ts
/** Stats are computed on demand: no refetch on focus or reconnect, no retry (lot 4). */
export const statsQuery = (period: StatsPeriod) =>
  queryOptions({
    queryKey: ['admin', 'stats', period],
    queryFn: () => unwrap(adminStatsControllerGet({ query: { period } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter admin exec vitest run src/lib/stats.test.ts
pnpm --filter admin typecheck
```
Expected: PASS; typecheck clean (proves the generated SDK exposes `adminStatsControllerGet`).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/package.json pnpm-lock.yaml apps/admin/src/lib/stats.ts apps/admin/src/lib/stats.test.ts apps/admin/src/api/queries.ts
git commit -m "feat(admin-spa): stats query and formatting helpers"
```

---

### Task 6: Statistiques page, lazy route, menu entry

**Files:**
- Create: `apps/admin/src/pages/StatsPage.tsx`
- Test: `apps/admin/src/pages/StatsPage.test.tsx`
- Modify: `apps/admin/src/router.tsx`
- Modify: `apps/admin/src/components/AppLayout.tsx`, `apps/admin/src/components/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `statsQuery` (`src/api/queries.ts`), `STATS_PERIOD_OPTIONS`, `parseStatsPeriod`, `bucketLabel`, `rateLabel`, `durationLabel`, `seriesTotal` (`src/lib/stats.ts`, Task 5); `UNAVAILABLE_MESSAGE` (`src/lib/apiError.ts`); generated type `AdminStatsDto`.
- Produces: `export function StatsPage()` (named export, loaded by the lazy route).

- [ ] **Step 1: Write the failing page tests**

```tsx
// apps/admin/src/pages/StatsPage.test.tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { StatsPage } from './StatsPage';

const buckets = ['2026-09-28', '2026-10-05'];
const zeroRoles = { LICENSEE: 0, CLUB: 0, STAFF: 0, ADMIN: 0 };
const stats = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2026-10-10T08:30:00.000Z',
  period: '12w',
  bucket: 'week',
  buckets,
  users: {
    total: 42,
    byRole: { LICENSEE: 30, CLUB: 8, STAFF: 3, ADMIN: 2 },
    neverLoggedIn: 5,
    active7d: 11,
    active30d: 20,
    disabled: 1,
    signups: [
      { start: buckets[0], ...zeroRoles, LICENSEE: 4 },
      { start: buckets[1], ...zeroRoles, CLUB: 8 },
    ],
  },
  licences: {
    valid: 25,
    expiring30d: 2,
    expiring60d: 6,
    expired: 9,
    renewalsPending: 3,
    created: buckets.map((start) => ({ start, count: 1 })),
    clubs: [{ id: 'c1', name: 'Club Un', members: 12, clubAccounts: 1, validLicences: 10 }],
    clubsWithoutClubAccount: 4,
  },
  competitions: {
    byStatus: { UPCOMING: 2, LIVE: 0, PAST: 7, CANCELLED: 1 },
    registrations: buckets.map((start) => ({ start, PENDING: 1, CONFIRMED: 2, CANCELLED: 0 })),
    pastConfirmed: 4,
    pastCheckedIn: 3,
    pastPaid: 2,
  },
  content: {
    tracksByStatus: { READY: 100, PENDING: 2, ERROR: 1 },
    tracksBlacklisted: 3,
    tracksMasked: 5,
    correctionsPending: 6,
    correctionsApproved: 10,
    correctionsRejected: 2,
    medianReviewHours: 6.5,
    corrections: buckets.map((start) => ({
      start,
      TITLE: 1,
      ARTIST: 0,
      DANCE: 0,
      MPM: 1,
      PASO_CLASH: 0,
      OTHER: 0,
    })),
    bugReports: buckets.map((start) => ({ start, count: 0 })),
    adminActions: buckets.map((start) => ({ start, count: 3 })),
  },
  ...overrides,
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/stats') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/stats"
              element={
                <>
                  <StatsPage />
                  <Probe />
                </>
              }
            />
            <Route path="/clubs/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const ok = (data: object) => ({ data, error: undefined }) as never;

describe('StatsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the key figures of every block, the clubs table and the history note', async () => {
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Licences et clubs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Compétitions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contenu et modération' })).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('75 % (3 / 4)')).toBeInTheDocument();
    expect(screen.getByText('6,5 h')).toBeInTheDocument();
    expect(screen.getByText('12 inscriptions sur la période')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'Club Un' })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
    expect(
      screen.getByText(
        "Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Calculé le/)).toBeInTheDocument();
  });

  it('defaults to 12w and puts the chosen period in the URL and the request', async () => {
    const get = vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(get).toHaveBeenLastCalledWith({ query: { period: '12w' } });
    await userEvent.click(screen.getByRole('radio', { name: '6 mois' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith({ query: { period: '6m' } }));
    expect(screen.getByTestId('location')).toHaveTextContent('/stats?period=6m');
  });

  it('reads the period from the URL', async () => {
    const get = vi
      .spyOn(sdk, 'adminStatsControllerGet')
      .mockResolvedValue(ok(stats({ period: '12m', bucket: 'month' })));
    renderPage('/stats?period=12m');
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(get).toHaveBeenCalledWith({ query: { period: '12m' } });
  });

  it('« Actualiser » refetches', async () => {
    const get = vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(ok(stats()));
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('shows the shared error alert', async () => {
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue({
      data: undefined,
      error: { statusCode: 500 },
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });

  it('shows « — » for empty rates and median', async () => {
    const base = stats();
    vi.spyOn(sdk, 'adminStatsControllerGet').mockResolvedValue(
      ok({
        ...base,
        competitions: { ...base.competitions, pastConfirmed: 0, pastCheckedIn: 0, pastPaid: 0 },
        content: {
          ...base.content,
          medianReviewHours: null,
          correctionsApproved: 0,
          correctionsRejected: 0,
        },
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Utilisateurs' });
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});
```

The sign-up summary is 4 + 8 = 12 → « 12 inscriptions sur la période ». The four « — » are check-in rate, payment rate, approval share and median.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter admin exec vitest run src/pages/StatsPage.test.tsx`
Expected: FAIL, cannot resolve `./StatsPage`.

- [ ] **Step 3: Implement the page**

```tsx
// apps/admin/src/pages/StatsPage.tsx
import '@mantine/charts/styles.css';
import { BarChart, LineChart } from '@mantine/charts';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import type { AdminStatsDto } from '../api/generated/types.gen';
import { statsQuery } from '../api/queries';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import {
  bucketLabel,
  durationLabel,
  parseStatsPeriod,
  rateLabel,
  seriesTotal,
  STATS_PERIOD_OPTIONS,
} from '../lib/stats';

const HISTORY_NOTE =
  "Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés.";

const generatedFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const ROLE_SERIES = [
  { name: 'LICENSEE', label: 'Licenciés', color: 'blue.6' },
  { name: 'CLUB', label: 'Clubs', color: 'teal.6' },
  { name: 'STAFF', label: 'Staff', color: 'orange.6' },
  { name: 'ADMIN', label: 'Admins', color: 'grape.6' },
];
const REGISTRATION_SERIES = [
  { name: 'PENDING', label: 'En attente', color: 'yellow.6' },
  { name: 'CONFIRMED', label: 'Confirmées', color: 'teal.6' },
  { name: 'CANCELLED', label: 'Annulées', color: 'gray.6' },
];
const CORRECTION_SERIES = [
  { name: 'TITLE', label: 'Titre', color: 'blue.6' },
  { name: 'ARTIST', label: 'Artiste', color: 'cyan.6' },
  { name: 'DANCE', label: 'Danse', color: 'teal.6' },
  { name: 'MPM', label: 'MPM', color: 'orange.6' },
  { name: 'PASO_CLASH', label: 'Clashes paso', color: 'red.6' },
  { name: 'OTHER', label: 'Autre', color: 'gray.6' },
];

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
    </Card>
  );
}

/** Chart with a text summary; the SVG itself is hidden from screen readers. */
function Chart({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <Stack gap={4}>
      <Text fw={500}>{title}</Text>
      <Text size="sm" c="dimmed">
        {summary}
      </Text>
      <div aria-hidden="true">{children}</div>
    </Stack>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack component="section" gap="sm">
      <Title order={3}>{title}</Title>
      {children}
    </Stack>
  );
}

function StatsContent({ s }: { s: AdminStatsDto }) {
  const label = <T extends { start: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, label: bucketLabel(r.start, s.bucket) }));
  const sum = (rows: Array<Record<string, number | string>>, noun: string) =>
    `${seriesTotal(rows)} ${noun} sur la période`;
  const u = s.users;
  const l = s.licences;
  const c = s.competitions;
  const t = s.content;
  return (
    <Stack gap="xl">
      <Block title="Utilisateurs">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Comptes" value={u.total} />
          <Figure label="Licenciés" value={u.byRole.LICENSEE} />
          <Figure label="Clubs" value={u.byRole.CLUB} />
          <Figure label="Staff" value={u.byRole.STAFF} />
          <Figure label="Admins" value={u.byRole.ADMIN} />
          <Figure label="Jamais connectés" value={u.neverLoggedIn} />
          <Figure label="Actifs 7 jours" value={u.active7d} />
          <Figure label="Actifs 30 jours" value={u.active30d} />
          <Figure label="Désactivés" value={u.disabled} />
        </SimpleGrid>
        <Chart title="Inscriptions" summary={sum(u.signups, 'inscriptions')}>
          <LineChart h={220} data={label(u.signups)} dataKey="label" series={ROLE_SERIES} withLegend />
        </Chart>
      </Block>

      <Block title="Licences et clubs">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Licences valides" value={l.valid} />
          <Figure label="Expirent sous 30 jours" value={l.expiring30d} />
          <Figure label="Expirent sous 60 jours" value={l.expiring60d} />
          <Figure label="Expirées" value={l.expired} />
          <Figure label="Renouvellements en attente" value={l.renewalsPending} />
          <Figure label="Clubs sans compte Club" value={l.clubsWithoutClubAccount} />
        </SimpleGrid>
        <Chart title="Licences créées" summary={sum(l.created, 'licences')}>
          <BarChart
            h={200}
            data={label(l.created)}
            dataKey="label"
            series={[{ name: 'count', label: 'Licences', color: 'blue.6' }]}
          />
        </Chart>
        <Table.ScrollContainer minWidth={480}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th>
                <Table.Th>Membres</Table.Th>
                <Table.Th>Comptes Club</Table.Th>
                <Table.Th>Licences valides</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {l.clubs.map((club) => (
                <Table.Tr key={club.id}>
                  <Table.Td>
                    <Anchor component={RouterLink} to={`/clubs/${club.id}`}>
                      {club.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{club.members}</Table.Td>
                  <Table.Td>{club.clubAccounts}</Table.Td>
                  <Table.Td>{club.validLicences}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Block>

      <Block title="Compétitions">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="À venir" value={c.byStatus.UPCOMING} />
          <Figure label="En cours" value={c.byStatus.LIVE} />
          <Figure label="Passées" value={c.byStatus.PAST} />
          <Figure label="Annulées" value={c.byStatus.CANCELLED} />
          <Figure label="Taux de pointage" value={rateLabel(c.pastCheckedIn, c.pastConfirmed)} />
          <Figure label="Taux de paiement" value={rateLabel(c.pastPaid, c.pastConfirmed)} />
        </SimpleGrid>
        <Chart title="Inscriptions aux épreuves" summary={sum(c.registrations, 'inscriptions aux épreuves')}>
          <BarChart
            h={220}
            data={label(c.registrations)}
            dataKey="label"
            type="stacked"
            series={REGISTRATION_SERIES}
            withLegend
          />
        </Chart>
      </Block>

      <Block title="Contenu et modération">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Musiques prêtes" value={t.tracksByStatus.READY} />
          <Figure label="En attente" value={t.tracksByStatus.PENDING} />
          <Figure label="En erreur" value={t.tracksByStatus.ERROR} />
          <Figure label="Blacklistées" value={t.tracksBlacklisted} />
          <Figure label="Titre masqué" value={t.tracksMasked} />
          <Figure label="Propositions à traiter" value={t.correctionsPending} />
          <Figure
            label="Approuvées sur la période"
            value={rateLabel(t.correctionsApproved, t.correctionsApproved + t.correctionsRejected)}
          />
          <Figure label="Délai médian de traitement" value={durationLabel(t.medianReviewHours)} />
        </SimpleGrid>
        <Chart title="Propositions de correction" summary={sum(t.corrections, 'propositions')}>
          <BarChart
            h={220}
            data={label(t.corrections)}
            dataKey="label"
            type="stacked"
            series={CORRECTION_SERIES}
            withLegend
          />
        </Chart>
        <Chart title="Rapports de bug" summary={sum(t.bugReports, 'rapports')}>
          <BarChart
            h={180}
            data={label(t.bugReports)}
            dataKey="label"
            series={[{ name: 'count', label: 'Rapports', color: 'red.6' }]}
          />
        </Chart>
        <Chart title="Actions admin" summary={sum(t.adminActions, 'actions')}>
          <BarChart
            h={180}
            data={label(t.adminActions)}
            dataKey="label"
            series={[{ name: 'count', label: 'Actions', color: 'grape.6' }]}
          />
        </Chart>
      </Block>

      <Text size="sm" c="dimmed">
        {HISTORY_NOTE}
      </Text>
    </Stack>
  );
}

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const period = parseStatsPeriod(params.get('period'));
  const stats = useQuery(statsQuery(period));
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Statistiques</Title>
        <Group wrap="wrap">
          <SegmentedControl
            value={period}
            data={STATS_PERIOD_OPTIONS}
            onChange={(value) => setParams({ period: value })}
          />
          <Button variant="default" onClick={() => void stats.refetch()} loading={stats.isFetching}>
            Actualiser
          </Button>
        </Group>
      </Group>
      {stats.data ? (
        <Text size="sm" c="dimmed">
          Calculé le {generatedFormat.format(new Date(stats.data.generatedAt))}
        </Text>
      ) : null}
      {stats.isError ? (
        <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>
      ) : stats.data ? (
        <StatsContent s={stats.data} />
      ) : (
        <Stack>
          <Skeleton h={80} />
          <Skeleton h={220} />
        </Stack>
      )}
    </Stack>
  );
}
```

Notes for the implementer:
- Mantine's `SegmentedControl` renders radio inputs labelled by the option label; the test clicks the radio « 6 mois ». If the installed Mantine exposes it differently, query it the way Mantine does and keep the label text.
- If the generated `AdminStatsDto` types `bucket` as `string` rather than `'week' | 'month'`, narrow with `s.bucket === 'month' ? 'month' : 'week'` when calling `bucketLabel`.
- `Button loading` puts `data-loading` on the button; if it makes the button unreachable by role during a refetch, use `disabled={stats.isFetching}` instead.

- [ ] **Step 4: Run page tests**

Run: `pnpm --filter admin exec vitest run src/pages/StatsPage.test.tsx`
Expected: PASS (6 tests). Recharts' responsive container renders an empty box at 0×0 in jsdom; the tests assert text, not SVG. A recharts width/height console warning is acceptable.

- [ ] **Step 5: Lazy route and menu entry**

In `apps/admin/src/router.tsx`, add this child route after `audit-log` (no static import of `StatsPage`):

```tsx
      {
        path: 'stats',
        // Lazy: keeps @mantine/charts and recharts out of the main bundle.
        lazy: () => import('./pages/StatsPage').then((m) => ({ Component: m.StatsPage })),
      },
```

In `apps/admin/src/components/AppLayout.tsx`, add after the « Journal d'audit » link:

```tsx
        <NavLink component={RouterLink} to="/stats" label="Statistiques" />
```

In `apps/admin/src/components/AppLayout.test.tsx`, in the test that lists the menu links (around line 49), add:

```tsx
    expect(screen.getByRole('link', { name: 'Statistiques' })).toHaveAttribute('href', '/stats');
```

- [ ] **Step 6: Verify the split bundle and the whole SPA suite**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4
pnpm --filter admin test
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin build
ls apps/admin/dist/assets | grep -i stats
grep -l "recharts" apps/admin/dist/assets/index-*.js || echo "main bundle has no recharts"
```
Expected: all tests pass; a `StatsPage-*.js` chunk exists; the last command prints « main bundle has no recharts ».

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/StatsPage.tsx apps/admin/src/pages/StatsPage.test.tsx apps/admin/src/router.tsx apps/admin/src/components/AppLayout.tsx apps/admin/src/components/AppLayout.test.tsx
git commit -m "feat(admin-spa): Statistiques page with lazy-loaded charts"
```

---

### Task 7: Full verification

**Files:** none new (fixes only, if something fails).

- [ ] **Step 1: Preflight**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4 && pnpm preflight
```
Expected: typecheck, lint, format, tests and audit all green. If `format:check` fails, run `pnpm --filter backend format` and `npx prettier --write` on the touched admin files.

- [ ] **Step 2: Real-DB and e2e suites touched by this lot**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4/apps/backend
source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh
npx jest --config ./test/jest-integration.json --runInBand --forceExit test/admin-stats.integration-spec.ts test/admin.integration-spec.ts
pnpm test:e2e -- test/admin.e2e-spec.ts
```
Expected: PASS.

- [ ] **Step 3: Swagger freshness**

```bash
cd /Users/gabin/Development/FFD-Connect-lot4 && pnpm api:sync && git status --porcelain apps/backend/swagger.json
```
Expected: no output.

- [ ] **Step 4: Commit any fix** with a `fix:` or `chore:` message; nothing to commit if clean.
