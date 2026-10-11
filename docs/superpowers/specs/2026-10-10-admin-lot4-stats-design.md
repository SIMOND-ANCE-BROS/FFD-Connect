# Admin back-office — lot 4: database stats — design

- **Date:** 2026-10-10
- **Status:** draft, pending review
- **Builds on:** lot 1 (`2026-10-07-admin-backoffice-design.md`), lots 1b, 1c, 2 and 3 (merged)
- **Next:** lot 5 (anonymous usage analytics)

## 1. Goal

Give the admin a read-only « Statistiques » page that summarises what is in the database: users, licences and clubs, competitions, content and moderation, with their evolution over time.

Success: the admin opens « Statistiques », picks a period, reads the key figures and the charts for the four blocks in one page load, and reloads them on demand. Nothing is stored, scheduled or polled.

## 2. Decisions (taken with the user)

| Topic        | Decision                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope        | Four blocks: Utilisateurs, Licences et clubs, Compétitions, Contenu et modération.                                                                |
| Charts       | `@mantine/charts` (recharts), the stats route lazy-loaded. One backend redeploy caused by the `apps/admin/package.json` CI filter; no other cost. |
| Computation  | Aggregates computed on demand from existing tables. No snapshot table, no cron, no cache.                                                         |
| Small counts | Not suppressed: admins already see the user list.                                                                                                 |
| History      | Accounts purged after 3 years of inactivity disappear from past counts; the page says so.                                                         |
| Request      | One `GET` for the whole page.                                                                                                                     |

## 3. Page `/stats`

- Menu entry « Statistiques ».
- Period selector, kept in the URL (`?period=`): « 12 semaines » (`12w`, weekly buckets, default), « 6 mois » (`6m`, monthly), « 12 mois » (`12m`, monthly).
- Header: « Calculé le <date heure> » and an « Actualiser » button (refetch).
- Each block: key figures as stat cards, then its charts. Every chart has a short text summary for screen readers (e.g. « 12 inscriptions sur la période »).
- Footer note: « Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés. »
- Query: no refetch on focus or reconnect, no retry, no polling. Error: shared « Serveur injoignable » alert. Loading: skeletons.

### 3.1 Utilisateurs

- Figures: accounts per role, counting extra roles (an account with `role = CLUB` and `extraRoles = [LICENSEE]` counts in both); invited and never logged in (`lastLoginAt` null); active over 7 days and over 30 days (`lastLoginAt` within the window); deactivated (`disabledAt` not null); total accounts.
- Chart: sign-ups per bucket (`User.createdAt`), split by main role (lines).

### 3.2 Licences et clubs

- Figures: valid licences (`validUntil` ≥ start of today, Paris); expiring within 30 days and within 60 days (valid and `validUntil` < start of today + N days; 60 includes 30); expired; renewal requests pending (`LicenseRenewalRequest.status = PENDING`).
- Chart: licences created per bucket (`License.createdAt`, bars).
- Clubs table, sorted by members descending, at most 50 rows: club name (link to `/clubs/:id`), members (`User.clubId`), Club accounts (members whose `role` or `extraRoles` includes `CLUB`), valid licences (licences of members, joined through `User.clubId`, never the free-text `License.clubName`).
- Figure: clubs without any Club account.

### 3.3 Compétitions

- Figures: competitions per status (UPCOMING, LIVE, PAST, CANCELLED).
- Chart: registrations per bucket (`Registration.createdAt`), stacked by status (PENDING, CONFIRMED, CANCELLED).
- Figures on CONFIRMED registrations of PAST competitions: check-in rate (`checkedIn`) and payment rate (`feePaid`), as a percentage with the denominator; « — » when there are none.

### 3.4 Contenu et modération

- Figures: tracks per status (READY, PENDING, ERROR), blacklisted, masked title; corrections pending; for corrections decided during the period: approved and rejected counts, median handling time (`reviewedAt − createdAt`, shown in hours below 48 h, else in days; « — » when none).
- Charts: corrections created per bucket stacked by reason; bug reports per bucket (`BugReport.createdAt`); admin actions per bucket (`AdminAuditLog.createdAt`).

## 4. API

`GET /admin/stats?period=12w|6m|12m` — ADMIN (class-level guard, like the other `/admin` controllers). `period` defaults to `12w`; any other value → 400.

Response (`AdminStatsDto`):

```ts
{
  generatedAt: string; // ISO
  period: '12w' | '6m' | '12m';
  bucket: 'week' | 'month';
  buckets: string[]; // bucket starts, YYYY-MM-DD in Europe/Paris, oldest first
  users: {
    total: number;
    byRole: Record<UserRole, number>;
    neverLoggedIn: number;
    active7d: number;
    active30d: number;
    disabled: number;
    signups: { start: string; LICENSEE: number; CLUB: number; STAFF: number; ADMIN: number }[];
  };
  licences: {
    valid: number;
    expiring30d: number;
    expiring60d: number;
    expired: number;
    renewalsPending: number;
    created: { start: string; count: number }[];
    clubs: { id: string; name: string; members: number; clubAccounts: number; validLicences: number }[];
    clubsWithoutClubAccount: number;
  };
  competitions: {
    byStatus: Record<CompetitionStatus, number>;
    registrations: { start: string; PENDING: number; CONFIRMED: number; CANCELLED: number }[];
    pastConfirmed: number;
    pastCheckedIn: number;
    pastPaid: number;
  };
  content: {
    tracksByStatus: Record<TrackStatus, number>;
    tracksBlacklisted: number;
    tracksMasked: number;
    correctionsPending: number;
    correctionsApproved: number; // decided during the period
    correctionsRejected: number; // decided during the period
    medianReviewHours: number | null;
    corrections: { start: string; TITLE: number; ARTIST: number; DANCE: number; MPM: number; PASO_CLASH: number; OTHER: number }[];
    bugReports: { start: string; count: number }[];
    adminActions: { start: string; count: number }[];
  };
}
```

- Every series has exactly one entry per bucket in `buckets`, zero-filled.
- Buckets: Monday 00:00 Europe/Paris (weekly) or the 1st 00:00 Europe/Paris (monthly). `12w` = the current week and the 11 before; `6m` / `12m` = the current month and the 5 / 11 before. The period start is the first bucket's start.
- Rates are returned as raw counts; the SPA computes the percentages.
- Store-review accounts (`isStoreReview = true`) are excluded from every user count and from the per-club figures.

## 5. Backend

- New `AdminStatsController` and `AdminStatsQueryService` in the admin module; read-only, no audit row.
- Counts: Prisma `count` / `groupBy`. The clubs table query uses `take: 50`.
- Time series: one parameterised `$queryRaw` per series, `date_trunc(<unit>, "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Paris')` grouped by bucket (and by the split column), bounded by `"createdAt" >= periodStart`. The unit comes from a whitelist (`'week' | 'month'`), never from raw input. Zero-fill in TypeScript against the computed `buckets`.
- Bucket boundaries computed in TypeScript in Europe/Paris (DST-safe) by a small pure helper, unit-tested on its own.
- Median: `percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from "reviewedAt" - "createdAt"))` on corrections with `"reviewedAt" >= periodStart`.
- The four blocks run in parallel (`Promise.all`). No migration, no cron, no cache.
- Swagger regenerated (`pnpm api:sync`).

## 6. Back-office

- `@mantine/charts` + `recharts` added to `apps/admin`; the stats page imported with `React.lazy`, so the chart code stays out of the main bundle.
- `useAdminStats(period)` (TanStack Query) with `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: false`.
- Charts: `LineChart` for sign-ups; stacked `BarChart` for registrations and corrections; `BarChart` for licences, bug reports and admin actions. Bucket labels in French (« 6 oct. » weekly, « oct. 2026 » monthly).

## 7. Testing

- Backend unit (mocked Prisma): each figure's query and where clause (roles counting extra roles, store-review exclusion, licence windows, past-competition rates), `period` validation and default, bucket helper (weekly and monthly starts, DST change weeks, year boundary), zero-fill, median with odd and even counts and with none.
- Real-DB integration (dedicated test DB `ffd_connect_admin_test`): weekly and monthly grouping; Paris boundary — a sign-up on a Sunday at 23:30 UTC in summer counts in the following Monday's week; licence counts around today; per-club members, Club accounts and valid licences joined through `clubId`.
- Mocked e2e: non-admin → 403; invalid `period` → 400.
- Admin SPA (Vitest, `ResizeObserver` mocked): figures and charts render from a mocked payload; period switch updates the URL and the request; « Actualiser » refetches; error alert; the route is lazy-loaded; « — » for empty rates and median.
- Coverage thresholds unchanged.

## 8. Security and RGPD

- ADMIN-only; aggregates only, except the clubs table (club names, which admins already see).
- Purpose: steering of the platform by the federation's administrators, from data already processed for the service; nothing new is collected. Add one line to `docs/legal/politique-confidentialite.md` §3 stating that aggregated statistics are produced for the administration of the platform.

## 9. Cost

No new service, no stored data, no job. One request per page view or « Actualiser ». One backend redeploy at merge because of the admin `package.json` change.

## 10. Out of scope

Usage analytics (lot 5), CSV exports, custom date ranges, per-competition drill-down, snapshots of past state (e.g. valid licences on a past date), alerts.
