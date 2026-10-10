# Admin back-office — lot 5: anonymous app usage — design

- **Date:** 2026-10-10
- **Status:** draft, pending review
- **Builds on:** lot 4 (`2026-10-10-admin-lot4-stats-design.md`, PR #243 — reuses its Paris bucket helper and chart setup)
- **Prerequisite:** PR #243 (lot 4) merged into `develop`; implementation starts from a `develop` that contains it.
- **Issue:** #18 (tableau de bord analytique, carte de chaleur, statistiques d'usage)
- **Next:** lot 6 (other admin actions)

## 1. Goal

Show the admin how the mobile app is used — when, which screens, by which audience, on which version — from anonymous, first-party events, without waking the scale-to-zero backend and without tying any event to an account.

Success: on « Usage de l'app », the admin sees the « jour × heure » grid, the screen ranking, key events, versions and most-viewed competitions over 7 days, 30 days or 12 months; a user who turns off « Mesure d'audience anonyme » sends nothing more.

## 2. Decisions (taken with the user)

| Topic                | Decision                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| « Carte de chaleur » | Days of the week × hours of the day grid (Paris time) + screen ranking. No location data.                                                                 |
| Anonymity            | Random installation ID generated on the device, renewed every calendar month, never linked to the account. Endpoint unauthenticated.                      |
| Approach             | First-party: local buffer in the app, batched sending only when the backend is already awake, Postgres storage, dashboard in the back-office.             |
| Dimensions           | Platform + app version, active space, competition (when the event has one), time on screen.                                                               |
| Legal basis          | CNIL audience-measurement exemption: first-party, anonymous, statistics only, opt-out in Réglages, bounded retention (raw 90 days, aggregates 25 months). |
| Scope                | Mobile app only. The back-office and the landing site are not measured (the landing keeps « aucune mesure d'audience »).                                  |

## 3. Existing behaviour kept

- `apps/client/src/services/analytics` (`AnalyticsService`, `types.ts`): typed `logEvent(name, params)` / `logScreenView(screen)`, today console in `__DEV__` and no-op in production. Call sites unchanged: `AppNavigator` (screen views), login (email, biometric, guest), register, `competition_view`, `license_scan`, `license_wallet_add`.
- `apps/client/src/services/api.ts`: the single axios instance with the wake-and-replay interceptor (`backendWake`). No new wake logic.
- Backend hourly `@Cron` + startup pass pattern (`SessionCleanupService`, `HealthDataRetentionService`): runs only while the app is awake.

## 4. Collection in the app

### 4.1 Events

- Each event carries:
  - `name` (`AnalyticsEventName`);
  - `screen?` (route name);
  - `occurredAt` (ISO, truncated to the minute);
  - `platform` (`ios` | `android`);
  - `appVersion` (native version string from `expo-application`, e.g. `1.4.2`);
  - `space` (`LICENSEE` | `CLUB` | `STAFF` | `ADMIN` | `GUEST` — the active space; `GUEST` when signed out or in guest mode);
  - `competitionId?` (UUID, only from params that already carry it);
  - `durationSec?` (screen views only).
- Time on screen: measured on the device between a screen view and the next one (or the app going to the background), capped at 1 800 s, attached to the screen view that ended.
- Only the fields above are sent; any other key in `AnalyticsEventParams` is dropped before buffering.

### 4.2 Installation ID

- A UUID v4 drawn on the device and stored with its month (`YYYY-MM`, device local time) in AsyncStorage.
- On the first event of a new calendar month, a new ID is drawn and the old one is discarded.
- Generated without a new native module (the app has no crypto module today; the ID is not a secret, only a pseudonymous counting key).
- Never sent with the account ID: the batch request carries no `Authorization` header.

### 4.3 Buffer and sending

- Buffer in AsyncStorage, at most 500 events; when full, the oldest are dropped.
- A batch (at most 200 events) is sent with `POST /analytics/events` only:
  - right after any successful API response of the axios instance, at most once every 2 minutes;
  - when the app goes to the background, if an API response succeeded within the last 2 minutes (below Azure Container Apps' 300 s scale-down cooldown).
- Never on a timer, never on app launch by itself, never through `backendWake`: if the backend is asleep, the events wait.
- On a failed send (network, 5xx, 429), the batch stays in the buffer; a 400 (invalid batch) drops it, to never loop on bad data.
- The send uses the raw `fetch` captured by `backendWake` (the global one is wrapped and would wake the backend), with a 10 s timeout.
- Events older than 6.5 days are dropped before sending: the server refuses a whole batch containing one older than 7 days.

### 4.4 Opt-out

- Réglages: switch « Mesure d'audience anonyme », on by default, with the line « Statistiques d'usage anonymes, sans lien avec votre compte. »
- Off: the buffer and the installation ID are deleted; `logEvent` / `logScreenView` stop recording. On again: a new ID is drawn.
- `__DEV__`: console logging as today, nothing buffered or sent.
- Store-review sessions: nothing recorded.

## 5. Backend

### 5.1 Intake

- `POST /analytics/events`, public (no auth guard), throttled per IP to 10 requests per minute.
- Body `{ events: UsageEventDto[] }`, 1–200 events, whitelist validation (unknown properties rejected):
  - `installId`: UUID v4;
  - `name`: one of the `AnalyticsEventName` values;
  - `screen?`: 1–64 characters, `[A-Za-z0-9_]`;
  - `occurredAt`: ISO date within the last 7 days and at most 5 minutes in the future;
  - `platform`: `ios` | `android`;
  - `appVersion`: 1–20 characters, `[0-9A-Za-z.-]`;
  - `space`: `LICENSEE` | `CLUB` | `STAFF` | `ADMIN` | `GUEST`;
  - `competitionId?`: UUID;
  - `durationSec?`: integer 0–1 800.
- One invalid event → 400 for the whole batch, nothing stored.
- Response 204. IP address and User-Agent never stored; the body is never logged.

### 5.2 Storage (additive migration)

- `UsageEvent`: `id`, `installId`, `name`, `screen?`, `occurredAt`, `platform`, `appVersion`, `space`, `competitionId?` (no foreign key), `durationSec?`, `receivedAt`. Indexes: `occurredAt`; `(installId, occurredAt)`.
- `UsageDaily`: `day` (Paris date), `hour` (0–23, Paris), `name`, `screen` (empty string when none), `platform`, `appVersion`, `space`, `count`, `durationSec` (sum). Unique on all key columns.
- `UsageDailyActive`: `day`, `platform`, `installs` (distinct installation IDs that day). Unique on `(day, platform)`. Not split by space: an installation that changes space during the day would be counted twice; an installation has one platform, so summing platforms is exact.
- `UsageRollupState`: last fully aggregated Paris day (single row).

### 5.3 Rollup and retention job

- `UsageRetentionService`: hourly `@Cron` + one pass at startup (existing pattern), guarded against overlapping runs.
- Rollup: every finished Paris day from the oldest of (the day after the last aggregated one, the last 7 closed days — late events are accepted for 7 days) up to yesterday is aggregated from `UsageEvent` into `UsageDaily` and `UsageDailyActive`, each day in one transaction that deletes then rewrites that day (idempotent).
- Purge: `UsageEvent` older than 90 days; `UsageDaily` / `UsageDailyActive` older than 25 months. Batched deletes, bounded per run.

### 5.4 Read API

- `GET /admin/usage?period=7d|30d|12m&space=` (ADMIN, class-level guard). `period` defaults to `30d`; other values → 400. `space` optional, one of the five spaces, filters `screens` only.
- `7d` / `30d` read `UsageEvent`; `12m` reads `UsageDaily` / `UsageDailyActive` up to the last aggregated day (`aggregatedUntil` in the response; the rollup runs at every boot and hourly, so it is yesterday whenever the backend has been awake today).
- Response:
  - `generatedAt`, `period`, `from`, `to`;
  - `activeInstallsPerDay` (average of daily distinct installs), `activeInstallsThisMonth` (distinct installs since the 1st, Paris; with the monthly ID this counts installations active this month);
  - `sessions`, `medianSessionMinutes` — a session is a run of events of one installation with gaps under 30 minutes; computed from `UsageEvent` only, `null` for `12m`;
  - `platforms`: `{ ios, android }` event counts;
  - `heatmap`: 7 × 24 counts (row 0 = Monday), Paris time;
  - `screens`: top 30 `{ screen, views, durationSec }`;
  - `events`: per day, counts of `login`, `login_biometric`, `login_guest`, `register`, `license_scan`, `license_wallet_add` (zero-filled, lot 4 helper; per month for `12m`);
  - `versions`: distinct installs per `appVersion` over the last 7 days (whatever the period), top 10;
  - `competitions`: top 10 `{ competitionId, title | null, views }` from `competition_view`; `title` joined from `Competition`, `null` when it no longer exists. Read from `UsageEvent`; for `12m` over the last 90 days (aggregates do not keep the competition).

## 6. Back-office page `/usage`

- Menu entry « Usage de l'app » next to « Statistiques ». Lazy route, like `/stats`.
- Period selector « 7 jours », « 30 jours » (default), « 12 mois » and space filter for the screen ranking (« Tous », « Licencié », « Club », « Staff », « Admin », « Invité ») in the URL; « Actualiser »; same query flags as lot 4 (no refetch on focus or reconnect, no retry, no polling); shared « Serveur injoignable » alert; skeletons.
- Figures: « Installations actives / jour », « Installations actives ce mois », « Sessions », « Durée médiane d'une session » (« — » when `null`), « iOS / Android » share.
- « Jour × heure » grid: CSS grid of 7 rows (« lun. » … « dim. ») × 24 columns, colour intensity proportional to the largest cell, `title` tooltip with the exact count; a visually hidden table with the same numbers for screen readers. No chart library.
- For « 12 mois »: « Données agrégées jusqu'au <date> » under the header, and « 90 derniers jours » on the competitions table.
- Tables: screens (écran, vues, temps total, part), versions (version, installations), competitions (title as plain text — the back-office has no competition page; « Compétition supprimée » when `title` is `null`).
- Key events: stacked bars (`@mantine/charts`).
- Footer: « Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas. »
- Empty state (no event in the period): « Aucune donnée d'usage sur la période. »

## 7. Testing

- App (jest-expo): buffer cap and drop-oldest; field whitelist; monthly ID rotation; send only after a successful response and at most every 2 minutes; background send only with a success in the last 5 minutes; nothing at launch; batch kept on network / 5xx / 429 failure, dropped on 400; no `Authorization` header; opt-out clears buffer and ID; nothing in `__DEV__`; nothing for store-review sessions; duration capped at 1 800 s; settings switch.
- Backend unit: DTO validation (each field, 0 and 201 events, out-of-range dates, unknown property); 204 with no auth; rollup idempotence and day boundaries; purge thresholds; session splitting at 30 minutes; median; heatmap indexing (Monday = 0, Paris hour); competition title join with a deleted competition.
- Real-DB integration (dedicated test DB): rollup of an event at 23:30 UTC into the next Paris day; distinct installs per day; `12m` read from the aggregates.
- Mocked e2e: `/analytics/events` accepted without a token (204), invalid batch → 400, throttle → 429; `/admin/usage` 403 for non-admins, 400 for an unknown period.
- Admin SPA (Vitest): grid intensities and hidden table, period and space filter in the URL, « — » for `null`, empty state, error alert, menu entry.
- Coverage thresholds unchanged.

## 8. Security and RGPD

- Unauthenticated intake: no account link possible; strict validation and throttling limit abuse; nothing derived from the request (IP, User-Agent) is stored or logged.
- Pseudonymous data (installation ID) kept 90 days, then only aggregates without identifier (25 months).
- Privacy policy (`docs/legal/politique-confidentialite.md`): §2 adds « données d'usage anonymes » (the fields of §4.1); §3 adds « Mesurer l'audience de l'application de façon anonyme » — intérêt légitime, exemption CNIL; §5 adds the 90 days / 25 months retention; §10 states the anonymous first-party measurement and the opt-out in Réglages. Date updated.
- The admin sees aggregates only; no per-installation view.

## 9. Cost

- No new service. No request wakes the backend: batches ride on calls already happening, and the job runs only while awake.
- Volume during the beta: a few thousand rows per day at most; negligible Postgres storage, bounded by retention.
- Deploys: one backend redeploy (additive migration), the app via OTA (no new native dependency, no native build).

## 10. Out of scope

Back-office and landing measurement, real-time view, exports, cohorts or retention per account, location data, per-installation drill-down, UI tap heatmaps.
