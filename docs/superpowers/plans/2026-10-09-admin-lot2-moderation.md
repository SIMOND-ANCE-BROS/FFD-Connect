# Admin back-office — Lot 2 (moderation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moderate track correction proposals from the web back-office: a « Modération » menu entry with a pending badge, a filterable queue (status, reason, track search) kept in the URL, and a detail page with the track's audio, editable proposed values, a paso clash editor driven by the player, reply templates, approve / reject with a before → after confirmation and « Proposition suivante »; every decision, web or mobile, is written to the audit log.

**Architecture:** The existing `track-corrections` endpoints, shared with the mobile app, gain the `reason` / `q` list filters, `GET /track-corrections/:id` and a `filename` in the admin track snapshot; the audit row is written by `TrackCorrectionsService` inside the decision transaction (reject gets its own interactive transaction), through a new `AdminAuditModule` that exports `AdminAuditService` without pulling `AdminModule`'s auth/users imports. The admin SPA gets a client regenerated from `swagger.json`, a moderation list page, a detail page with a plain `<audio>` element whose `currentTime` feeds a `ClashEditor` component, and pure helpers in `src/lib/moderation.ts`.

**Tech Stack:** NestJS 11, Prisma 7.10 / PostgreSQL 15, Jest 29 + supertest; React 19, Vite 8, Mantine 8, TanStack Query 5, React Router 7, Vitest 4 + Testing Library; `@hey-api/openapi-ts` 0.99.

**Spec:** `docs/superpowers/specs/2026-10-09-admin-lot2-moderation-design.md` (binding). Lot 1b plan, for conventions: `docs/superpowers/plans/2026-10-07-admin-lot1b-accounts-clubs.md`.

**Worktree:** `/Users/gabin/Development/FFD-Connect-lot2`, branch `feature/admin-lot2-moderation` (develop `d6ce888` + spec commit `fb0f6ec`). All paths below are relative to it unless absolute.

## Global Constraints

- Every new or changed endpoint stays `ADMIN`-only: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` on each admin method of `TrackCorrectionsController` (the controller also serves non-admin routes, so the guards stay per method, as today).
- No duplicate `/admin/moderation` controller: the SPA calls `/track-corrections/*`, the same routes as the mobile app.
- `GET /track-corrections` gains `reason`: one or more `TrackCorrectionReason` values (`TITLE`, `ARTIST`, `DANCE`, `MPM`, `PASO_CLASH`, `OTHER`), repeatable (`reason=A&reason=B`) or comma-separated (`reason=A,B`), validated against the enum.
- `GET /track-corrections` gains `q`: trimmed, **2–100 characters**, case-insensitive `contains` on the track's `title` OR `artist`.
- Without `reason` / `q`, the response is identical to today (same `where`, same order: pending oldest first, decided newest first). `take` stays bounded by `PaginationParamsDto` (max **100**, default 10).
- `GET /track-corrections/:id` (ADMIN): the same `TrackCorrectionAdminDto` as a list item, **404** if absent; declared **after** `GET mine` and `GET pending-count`.
- The admin track snapshot gains `filename` (additive). The mobile response shape is otherwise unchanged; the mobile app needs no code change (two test fixtures gain the field).
- Audit actions `TRACK_CORRECTION_APPROVE` and `TRACK_CORRECTION_REJECT`, target type `TRACK_CORRECTION`, `targetId` = the correction id, written by the service **inside the decision transaction** (web and mobile decisions alike).
- Audit `before` / `after`: the track fields actually changed by an approval among `title`, `artist`, `style`, `bpm`, `clashTimecodes`, plus `trackId`; a rejection logs `after: { trackId }` only. **Never** the proposer's message nor the review comment. **No audit row** when the decision fails (409, 404, or an `updateTrack` error).
- `AdminAuditLog.targetType` is a `String` column: **no migration**.
- `GET /admin/audit-log` accepts `targetType=TRACK_CORRECTION`.
- Value rules unchanged: at most **3** clash timecodes, each **0–3600 s**; MPM **1–400**; an empty clash list is a valid proposal ("no clash").
- The proposer still gets `TRACK_CORRECTION_DECISION` (best effort), unchanged.
- Admin SPA CSP: add exactly `media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr`. Audio URL: `${API_ORIGIN}/uploads/${encodeURIComponent(track.filename)}` (outside `/api/v1`), loaded with `crossOrigin="anonymous"`.
- Badge refresh: on page load, on navigation and after each decision. **No polling** (no `refetchInterval`): the backend scales to zero.
- Reply templates: a constant list in the SPA, inserted in the comment, still editable. Reject: « Déjà corrigé », « Valeur incorrecte », « Doublon d'une autre proposition »; approve: « Merci, c'est corrigé ».
- Clash editor: up to **3** chips in `m:ss`; « Marquer ici » adds the player's current time rounded to **0.1 s**; a chip can be edited, removed or played (seek **3 s** before it); a 4th is refused; an empty list is allowed and sent as "no clash".
- 409 on a decision: message « Déjà traitée » and reload of the proposal. « Proposition suivante »: one `GET` with `take=1` for the oldest **pending** proposal matching the current reason / search filters, else back to the list.
- UI copy verbatim from the spec: « Modération », « À traiter », « Approuvées », « Refusées »; reasons « Titre », « Artiste », « Danse », « MPM », « Clashes paso », « Autre »; « Marquer ici », « Approuver », « Refuser », « Déjà traitée », « Proposition suivante »; error state = alert only, shared message « Serveur injoignable, réessayez dans un instant. » (`UNAVAILABLE_MESSAGE`).
- Prisma: `select` constants from `src/utils/prisma-selects.ts`, `take` on every `findMany`. No `any` (eslint error), no `process.env` in backend code (use `ConfigService`), no new React Context.
- Code, comments and commits in English; user-facing copy (admin UI, API messages) in French; `docs/exploitation/` in French.
- Formatting follows each app: backend double quotes, admin SPA single quotes. The code blocks of this plan went through the root Prettier config (single quotes everywhere, as in the lot 1b plan); the pre-commit hook reformats each file to its app's style, so copy the code as is. Inline code in prose keeps the app's style. Prettier also normalised the leading indentation of fragments and may have joined short statements onto one line: re-indent each fragment to its surrounding code (e.g. the audit bullets of the runbook sit two spaces deep), and match the "replace …" blocks on content, not on whitespace.
- Coverage: thresholds unchanged (`src/admin` 94 / 75 / 88 / 94, global floor). Never lower a threshold: add tests.
- Cost: none (no infra, no job, no polling).
- Conventional commits; never `--no-verify`. Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv
  ```
- No push and no PR without the user's explicit go.

### How to run tests (applies to every task)

- **Fresh worktree.** It has no `node_modules` and no generated clients. Once, from the repo root: `pnpm install --frozen-lockfile` (postinstall generates the Prisma client and both OpenAPI clients from the committed `swagger.json`).
- **Backend env file.** Anything that boots `AppModule` (mocked e2e, integration, swagger export) reads `apps/backend/.env`, gitignored and absent from a fresh worktree. If missing: `cp apps/backend/.env.example apps/backend/.env`. Never commit it. Mocked e2e also needs Redis for BullMQ: `docker compose --profile infra up -d`.
- **Backend unit tests:** `pnpm --filter backend exec jest <path>`.
- **Mocked-Prisma e2e (no database).** `test/jest-e2e.json` has a `globalSetup` that runs `prisma db push --accept-data-loss`; it must not run here. Build a copy without it and run the mocked specs with it (there is no track-corrections e2e spec today; the moderation routes are added to `admin.e2e-spec`):
  ```bash
  cd apps/backend
  E2E_NODB="${TMPDIR:-/tmp}/jest-e2e-nodb.json"
  node -e 'const p=require("path");const c=require("./test/jest-e2e.json");delete c.globalSetup;delete c.globalTeardown;c.rootDir=p.resolve("test");require("fs").writeFileSync(process.argv[1],JSON.stringify(c))' "$E2E_NODB"
  pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec
  ```
- **Real-database tests run only on the dedicated test database**, through bash, sourcing the controller-provided file that exports `DATABASE_URL` for the test DB:
  ```bash
  bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit track-corrections.integration-spec'
  ```
  Never run `prisma db push`, `prisma migrate dev`, `migrate reset` or the full `test:e2e` / `test:integration` scripts against any other database. This lot has no migration.
- **Admin SPA:** `pnpm --filter admin exec vitest run <path> --testTimeout=60000`. The machine is often heavily loaded; the `pnpm test -- --flag` form drops the flag, so always use `exec vitest run`.
- **Mobile client:** `pnpm --filter client exec jest <path>`.
- **Swagger.** `pnpm docs:export` fails from the repo root. Run the steps by hand (Task 3): `cd apps/backend && pnpm run build && node scripts/export-swagger.js`, copy to `apps/docs/public/swagger.json`, run Prettier on both, then regenerate both clients (`pnpm --filter admin exec openapi-ts`, `pnpm --filter client exec openapi-ts`; the generated folders are gitignored).
- **Final step:** `pnpm preflight`.

## Review Focus

1. **Route shadowing by `GET :id`** — declared before `mine` / `pending-count`, Nest would match those paths to `:id` and `ParseUUIDPipe` would answer 400: the mobile « Mes propositions » screen and both badges would break while every unit test stays green. Pinned in Task 1 by the mocked e2e test "serves /pending-count and /mine before /:id".
2. **Query-string shape of `reason` and `q`** — the generated clients send `reason=A&reason=B`, a single value arrives as a string, a hand-typed URL uses `reason=A,B`; `q` must be trimmed _before_ its 2-character minimum, and the SPA must never send a 1-character search (the 400 would turn the list into an error alert). Pinned in Task 1 (DTO tests on `plainToInstance` + e2e through the real `ValidationPipe` and query parser) and Task 4 (list test "does not send a one-letter search").
3. **The audit row records what the approval really did** — read back from the track inside the transaction, so the silent MPM recalculation of a dance-only change and the clash sorting of `updateTrack` are logged, not the request body; written for mobile decisions too; never free text; absent when the claim (409), the lookup (404) or `updateTrack` fails; reject, which had no transaction, now writes claim + audit atomically. Pinned in Task 2 (unit: recalculation case, no-change case, failure cases, comment absent; real-DB: one row with sorted clashes, none after a second decision).
4. **Cross-origin audio** — the URL must use `API_ORIGIN` (not `API_URL`, which ends in `/api/v1`), encode the filename (accents, spaces), and load with `crossOrigin="anonymous"`: helmet sends `Cross-Origin-Resource-Policy: same-origin` on every backend response, which blocks a no-cors media load from `admin.ffd.gabin-simond.fr`, while a CORS load is allowed by `CORS_ORIGINS`. The CSP must also allow `media-src`. Pinned in Task 5 (detail test on the `src` and `crossorigin` attributes) and Task 6 (CSP test on `staticwebapp.config.json`).
5. **Approve body semantics** — a field the admin did not touch must be omitted (the server then applies the proposal), an emptied clash editor must send `clashTimecodes: []` (omitting it would apply the proposed clashes the admin just removed), and a blanked text field must not be sent (the server would ignore it anyway, but the confirmation would lie). Pinned in Task 5 (`approveOverrides` unit tests + detail tests "sends an emptied clash list as « no clash »" and "leaves untouched values to the proposal").

---

## File Structure

**Backend (`apps/backend`)**

| File                                                                                 | Responsibility                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `src/track-corrections/dto/track-correction.dto.ts` (modify)                         | `reason` / `q` on `ListTrackCorrectionsQueryDto`                   |
| `src/track-corrections/dto/track-correction-response.dto.ts` (modify)                | `filename` in `TrackCorrectionTrackSnapshotDto`                    |
| `src/track-corrections/track-corrections.query-service.ts` (modify)                  | filtered `where`                                                   |
| `src/track-corrections/track-corrections.controller.ts` (modify)                     | `GET :id`                                                          |
| `src/track-corrections/track-correction.mapper.ts` (modify)                          | `filename` in the admin view                                       |
| `src/track-corrections/track-corrections.service.ts` (modify)                        | audit in approve / reject                                          |
| `src/track-corrections/track-corrections.module.ts` (modify)                         | imports `AdminAuditModule`                                         |
| `src/admin/admin-audit.module.ts` (create)                                           | exports `AdminAuditService`                                        |
| `src/admin/admin.module.ts` (modify)                                                 | imports `AdminAuditModule` instead of providing the service itself |
| `src/admin/dto/admin-audit.dto.ts` (modify), `src/admin/dto/admin-audit.dto.spec.ts` | new actions and target type                                        |
| `src/utils/prisma-selects.ts` (modify)                                               | `filename` in the snapshot, `trackCorrectionAuditTrackSelect`      |
| `src/track-corrections/*.spec.ts` (modify)                                           | unit tests                                                         |
| `test/admin.e2e-spec.ts` (modify)                                                    | role matrix, routing, query parsing, audit-log filter              |
| `test/track-corrections.integration-spec.ts` (create)                                | real-DB search and audit                                           |
| `swagger.json` + `apps/docs/public/swagger.json` (regenerated)                       | API contract                                                       |

**Mobile client (`apps/client`)**: two test fixtures gain `filename` (Task 3).

**Admin SPA (`apps/admin`)**

| File                                          | Responsibility                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `src/api/queries.ts` (modify)                 | `moderationListQuery`, `pendingCountQuery`, `correctionQuery`          |
| `src/lib/moderation.ts` (create)              | labels, URL state, timecodes, summary, templates, overrides, audio URL |
| `src/lib/apiError.ts` (modify)                | `isConflict`                                                           |
| `src/lib/auditLabels.ts` (modify)             | two new action labels                                                  |
| `src/components/AppLayout.tsx` (modify)       | « Modération » entry with badge                                        |
| `src/components/ClashEditor.tsx` (create)     | clash chips driven by the player                                       |
| `src/components/ChangeSummary.tsx` (modify)   | track field labels, clash formatting                                   |
| `src/pages/ModerationPage.tsx` (create)       | queue                                                                  |
| `src/pages/ModerationDetailPage.tsx` (create) | detail, player, decision                                               |
| `src/pages/AuditLogPage.tsx` (modify)         | link to a proposal                                                     |
| `src/router.tsx` (modify)                     | `/moderation`, `/moderation/:id`                                       |
| `src/csp.test.ts` (create)                    | pins the CSP                                                           |
| `public/staticwebapp.config.json` (modify)    | `media-src`                                                            |
| `**/*.test.ts(x)`                             | Vitest tests next to each file                                         |

**Docs:** `docs/exploitation/backoffice-admin.md` (French).

---

### Task 1: Queue filters `reason` / `q`, `GET /track-corrections/:id` and the track filename

**Files:**

- Modify: `apps/backend/src/track-corrections/dto/track-correction.dto.ts` (imports l. 1-15, `ListTrackCorrectionsQueryDto` l. 141-155)
- Modify: `apps/backend/src/track-corrections/dto/track-correction-response.dto.ts` (`TrackCorrectionTrackSnapshotDto`, l. 29-54)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`trackCorrectionTrackSnapshotSelect`, l. 274-286)
- Modify: `apps/backend/src/track-corrections/track-correction.mapper.ts` (`toAdminDto`, l. 84-111)
- Modify: `apps/backend/src/track-corrections/track-corrections.query-service.ts` (`listForAdmin`, l. 50-84)
- Modify: `apps/backend/src/track-corrections/track-corrections.controller.ts` (list description l. 95-112, new method after `pendingCount` l. 129-145)
- Modify: `apps/backend/src/track-corrections/track-corrections.query-service.spec.ts` (`adminRow` l. 34-49, first test l. 77-132, new tests in `describe("listForAdmin")`)
- Modify: `apps/backend/src/track-corrections/track-corrections.controller.spec.ts` (`queryService` mock l. 34-38, role test l. 94-100, `describe("DTO de proposition")` l. 178-229)
- Modify: `apps/backend/test/admin.e2e-spec.ts` (`ADMIN_ROUTES` l. 14-36, new tests at the end of the `describe`)
- Create: `apps/backend/test/track-corrections.integration-spec.ts`

**Interfaces:**

- Consumes: `PaginationParamsDto`, `createPaginatedResponse`, `trackCorrectionAdminSelect`, `TrackCorrectionsQueryService.findOneForAdmin(id: string): Promise<TrackCorrectionAdminDto>` (exists).
- Produces:
  - `ListTrackCorrectionsQueryDto.reason?: TrackCorrectionReason[]`, `ListTrackCorrectionsQueryDto.q?: string`.
  - `TrackCorrectionTrackSnapshotDto.filename: string`; `trackCorrectionTrackSnapshotSelect.filename: true`.
  - `TrackCorrectionsController.findOne(id: string): Promise<TrackCorrectionAdminDto>` → swagger operation `TrackCorrectionsController_findOne` → SDK `trackCorrectionsControllerFindOne` (Task 3).

- [ ] **Step 1: Write the failing query-service tests**

In `apps/backend/src/track-corrections/track-corrections.query-service.spec.ts`, in `adminRow.track`, add after `blacklisted: false,`:

```ts
    filename: "espana-cani.mp3",
```

In the first test ("filtre par statut, sert la file en attente…"), in the expected `track` object of `page.data[0]`, add after `blacklisted: false,`:

```ts
          filename: "espana-cani.mp3",
```

Append inside `describe("listForAdmin", ...)`:

```ts
it('filters on one or more reasons and searches the track title OR artist, case-insensitively', async () => {
  prisma.trackCorrection.count.mockResolvedValue(0);
  prisma.trackCorrection.findMany.mockResolvedValue([]);

  await service.listForAdmin({
    status: TrackCorrectionStatus.PENDING,
    reason: [TrackCorrectionReason.MPM, TrackCorrectionReason.TITLE],
    q: 'paso',
    skip: 0,
    take: 20,
  });

  const where = {
    status: TrackCorrectionStatus.PENDING,
    reason: {
      in: [TrackCorrectionReason.MPM, TrackCorrectionReason.TITLE],
    },
    track: {
      OR: [
        { title: { contains: 'paso', mode: 'insensitive' } },
        { artist: { contains: 'paso', mode: 'insensitive' } },
      ],
    },
  };
  expect(prisma.trackCorrection.count).toHaveBeenCalledWith({ where });
  expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith({
    where,
    orderBy: { createdAt: 'asc' },
    skip: 0,
    take: 20,
    select: trackCorrectionAdminSelect,
  });
});

it('an empty reason list does not filter', async () => {
  prisma.trackCorrection.count.mockResolvedValue(0);
  prisma.trackCorrection.findMany.mockResolvedValue([]);

  await service.listForAdmin({ reason: [], skip: 0, take: 10 });

  expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: {} }),
  );
});
```

Run: `pnpm --filter backend exec jest src/track-corrections/track-corrections.query-service.spec.ts`
Expected: FAIL — `filename` missing from the mapped track, `where` without `reason` / `track` (and a TypeScript error on `reason` / `q` not existing on the query DTO).

- [ ] **Step 2: Write the failing controller and DTO tests**

In `apps/backend/src/track-corrections/track-corrections.controller.spec.ts`:

Add `findOneForAdmin: jest.fn(),` to the `queryService` mock (after `countPending: jest.fn(),`).

After the test "pendingCount renvoie un objet typé", add:

```ts
it('findOne returns the admin view of one proposal', async () => {
  queryService.findOneForAdmin.mockResolvedValue({ id: 'c1' });
  await expect(controller.findOne('c1')).resolves.toEqual({ id: 'c1' });
  expect(queryService.findOneForAdmin).toHaveBeenCalledWith('c1');
});
```

Replace `it.each(["list", "pendingCount", "approve", "reject"] as const)(` with:

```ts
  it.each(["list", "findOne", "pendingCount", "approve", "reject"] as const)(
```

Append inside `describe("DTO de proposition", ...)`:

```ts
const reasonCases: Array<[string, Record<string, unknown>, string[]]> = [
  ['single', { reason: 'MPM' }, ['MPM']],
  ['repeated', { reason: ['MPM', 'TITLE'] }, ['MPM', 'TITLE']],
  ['comma-separated', { reason: 'MPM, TITLE' }, ['MPM', 'TITLE']],
  ['mixed', { reason: ['MPM,DANCE', 'OTHER'] }, ['MPM', 'DANCE', 'OTHER']],
];

it.each(reasonCases)('accepts a %s reason filter', async (_label, plain, expected) => {
  expect(plainToInstance(ListTrackCorrectionsQueryDto, plain).reason).toEqual(expected);
  await expect(errorsOf(ListTrackCorrectionsQueryDto, plain)).resolves.toEqual([]);
});

it('refuses an unknown reason', async () => {
  await expect(errorsOf(ListTrackCorrectionsQueryDto, { reason: 'MPM,NOPE' })).resolves.toContain(
    'reason',
  );
});

it('trims the search, then requires 2 to 100 characters', async () => {
  expect(plainToInstance(ListTrackCorrectionsQueryDto, { q: '  pa  ' }).q).toBe('pa');
  await expect(errorsOf(ListTrackCorrectionsQueryDto, { q: '  pa  ' })).resolves.toEqual([]);
  await expect(errorsOf(ListTrackCorrectionsQueryDto, { q: ' p ' })).resolves.toContain('q');
  await expect(errorsOf(ListTrackCorrectionsQueryDto, { q: 'x'.repeat(101) })).resolves.toContain(
    'q',
  );
});
```

Run: `pnpm --filter backend exec jest src/track-corrections/track-corrections.controller.spec.ts`
Expected: FAIL — `controller.findOne` is not a function, no roles metadata on `findOne`, `reason` / `q` stripped or unvalidated.

- [ ] **Step 3: Implement the DTO changes**

In `apps/backend/src/track-corrections/dto/track-correction.dto.ts`:

Add `import { Transform } from "class-transformer";` after the `@nestjs/swagger` import, and add `MinLength` to the `class-validator` import list (after `MaxLength`).

After the `TRACK_CORRECTION_MAX_CLASH_SECONDS` constant, add:

```ts
/** Bounds of the moderation queue search (track title or artist). */
export const TRACK_CORRECTION_SEARCH_MIN_LENGTH = 2;
export const TRACK_CORRECTION_SEARCH_MAX_LENGTH = 100;

/**
 * `reason` arrives as a string for a single value and as an array when
 * repeated (`reason=A&reason=B`, what the generated clients send); each item
 * may itself be comma-separated (`reason=A,B`). Normalised to a flat list.
 */
const toReasonList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return value;
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
};
```

Append inside `ListTrackCorrectionsQueryDto`, after `status`:

```ts

  @ApiPropertyOptional({
    enum: TrackCorrectionReason,
    enumName: "TrackCorrectionReason",
    isArray: true,
    description:
      "Motif(s) à afficher : paramètre répété ou valeurs séparées par des virgules",
  })
  @IsOptional()
  @Transform(toReasonList)
  @IsArray()
  @IsEnum(TrackCorrectionReason, { each: true })
  reason?: TrackCorrectionReason[];

  @ApiPropertyOptional({
    description:
      "Recherche dans le titre ou l'artiste de la musique, sans tenir compte de la casse",
    minLength: TRACK_CORRECTION_SEARCH_MIN_LENGTH,
    maxLength: TRACK_CORRECTION_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MinLength(TRACK_CORRECTION_SEARCH_MIN_LENGTH)
  @MaxLength(TRACK_CORRECTION_SEARCH_MAX_LENGTH)
  q?: string;
```

Update the class doc comment to:

```ts
/**
 * Filtre + pagination de la file de modération. Sans statut : toutes les
 * propositions ; sans `reason` ni `q` : tous les motifs, toutes les pistes.
 * Hérite de la pagination plutôt que de la combiner en second `@Query()` :
 * `forbidNonWhitelisted` rejetterait alors les champs de l'autre.
 */
```

- [ ] **Step 4: Implement the filtered `where`**

In `apps/backend/src/track-corrections/track-corrections.query-service.ts`, after the `DEFAULT_TAKE` constant, add:

```ts
/** Case-insensitive search on the track title OR artist (admin view: real title). */
const trackSearchWhere = (q: string): Prisma.TrackWhereInput => ({
  OR: [
    { title: { contains: q, mode: 'insensitive' } },
    { artist: { contains: q, mode: 'insensitive' } },
  ],
});
```

In `listForAdmin`, replace

```ts
const where: Prisma.TrackCorrectionWhereInput = query.status ? { status: query.status } : {};
```

with

```ts
// Without reason/q the where is exactly the one of lot 1 (mobile contract).
const where: Prisma.TrackCorrectionWhereInput = {
  ...(query.status && { status: query.status }),
  ...(query.reason && query.reason.length > 0 && { reason: { in: query.reason } }),
  ...(query.q && { track: trackSearchWhere(query.q) }),
};
```

- [ ] **Step 5: Expose the filename**

In `apps/backend/src/utils/prisma-selects.ts`, in `trackCorrectionTrackSnapshotSelect`, add after `blacklisted: true,`:

```ts
  // Audio file, for the back-office player (`/uploads/<filename>`).
  filename: true,
```

In `apps/backend/src/track-corrections/dto/track-correction-response.dto.ts`, append inside `TrackCorrectionTrackSnapshotDto`, after `blacklisted`:

```ts

  @ApiProperty({
    description:
      "Fichier audio, servi par GET /uploads/{filename} (hors préfixe /api/v1)",
  })
  filename!: string;
```

In `apps/backend/src/track-corrections/track-correction.mapper.ts`, in `toAdminDto`, add after `blacklisted: row.track.blacklisted,`:

```ts
    filename: row.track.filename,
```

Run: `pnpm --filter backend exec jest src/track-corrections/track-corrections.query-service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Add `GET /track-corrections/:id`**

In `apps/backend/src/track-corrections/track-corrections.controller.ts`, in the `list` `@ApiOperation` description, append to the existing sentence: ` Filtres optionnels : \`reason\` (un ou plusieurs motifs, répétés ou séparés par des virgules) et \`q\` (titre ou artiste, 2 à 100 caractères, sans tenir compte de la casse).` The full description becomes:

```ts
    description:
      "Réservé aux administrateurs. Chaque proposition est accompagnée des valeurs ACTUELLES de la musique (diff), du nom de son auteur et du relecteur. En attente : de la plus ancienne à la plus récente ; sinon de la plus récente à la plus ancienne. Filtres optionnels : `reason` (un ou plusieurs motifs, répétés ou séparés par des virgules) et `q` (titre ou artiste, 2 à 100 caractères, sans tenir compte de la casse).",
```

Insert after the `pendingCount` method and before `@Post(":id/approve")`:

```ts
  /**
   * Declared after `mine` and `pending-count`: Nest matches routes in
   * declaration order, and ParseUUIDPipe would answer 400 to those paths.
   */
  @Get(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Une proposition de correction (vue administrateur)",
    description:
      "Réservé aux administrateurs. Même contenu qu'un élément de la file de modération.",
  })
  @ApiParam({ name: "id", description: "UUID de la proposition" })
  @ApiResponse({
    status: 200,
    description: "Proposition",
    type: TrackCorrectionAdminDto,
  })
  @ApiResponse({ status: 404, description: "Proposition non trouvée" })
  async findOne(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TrackCorrectionAdminDto> {
    return this.queryService.findOneForAdmin(id);
  }
```

Run: `pnpm --filter backend exec jest src/track-corrections`
Expected: PASS (all track-corrections specs).

- [ ] **Step 7: Mocked e2e — role matrix, route order, query parsing**

In `apps/backend/test/admin.e2e-spec.ts`, append to `ADMIN_ROUTES` (before the closing `];`):

```ts
  // Moderation queue: ADMIN-only per method on the shared track-corrections controller.
  ["get", "/api/v1/track-corrections?status=PENDING&reason=MPM&q=paso"],
  ["get", "/api/v1/track-corrections/00000000-0000-4000-8000-000000000000"],
```

Append at the end of `describe("Admin routes (e2e) — role matrix", ...)`:

```ts
it('serves /pending-count and /mine before /:id', async () => {
  currentRole = UserRole.ADMIN;
  prisma.trackCorrection.count.mockResolvedValue(4);
  prisma.trackCorrection.findMany.mockResolvedValue([]);
  const count = await request(server()).get('/api/v1/track-corrections/pending-count');
  expect(count.status).toBe(200);
  expect(count.body).toEqual({ count: 4 });

  currentRole = UserRole.LICENSEE;
  await request(server()).get('/api/v1/track-corrections/mine').expect(200);
});

it('parses repeated and comma-separated reasons and trims the search', async () => {
  currentRole = UserRole.ADMIN;
  prisma.trackCorrection.count.mockResolvedValue(0);
  prisma.trackCorrection.findMany.mockResolvedValue([]);
  await request(server())
    .get('/api/v1/track-corrections?status=PENDING&reason=MPM&reason=TITLE,DANCE&q=%20paso%20')
    .expect(200);
  expect(prisma.trackCorrection.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: {
        status: 'PENDING',
        reason: { in: ['MPM', 'TITLE', 'DANCE'] },
        track: {
          OR: [
            { title: { contains: 'paso', mode: 'insensitive' } },
            { artist: { contains: 'paso', mode: 'insensitive' } },
          ],
        },
      },
    }),
  );
});

it.each(['reason=NOPE', 'q=p', 'q=%20%20p%20'])(
  'refuses the moderation filter %s (400)',
  async (qs) => {
    currentRole = UserRole.ADMIN;
    await request(server()).get(`/api/v1/track-corrections?${qs}`).expect(400);
  },
);

it('GET /track-corrections/:id answers 404 for an unknown proposal', async () => {
  currentRole = UserRole.ADMIN;
  prisma.trackCorrection.findUnique.mockResolvedValue(null);
  await request(server())
    .get('/api/v1/track-corrections/00000000-0000-4000-8000-000000000000')
    .expect(404);
});
```

Run the mocked e2e (see "How to run tests"): `pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec`
Expected: PASS (with Steps 3-6 in place; run it once with the `findOne` method temporarily moved above `listMine` to see "serves /pending-count…" fail with 400, then move it back).

- [ ] **Step 8: Real-DB integration — search combined with the reason filter**

Create `apps/backend/test/track-corrections.integration-spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { TrackCorrectionReason, TrackCorrectionStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrackCorrectionsQueryService } from '../src/track-corrections/track-corrections.query-service';
import { buildServiceModule } from './integration-app.builder';

describe('Track corrections (integration, real DB)', () => {
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

  it('searches the title OR the artist case-insensitively, combined with the reason filter', async () => {
    const token = `zq${randomUUID().slice(0, 6)}`;
    const inTitle = await track(`Paso ${token} uno`, 'Orchestre');
    const inArtist = await track('Rumba', `Band ${token.toUpperCase()}`);
    const unrelated = await track('Valse', 'Autre');
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
```

(`userIds`, `message`, `proposedBpm`, `proposesClashes`, `proposedClashTimecodes` and the `track` extras are used by Task 2's tests in the same file.)

Run (test DB only):

```bash
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit track-corrections.integration-spec'
```

Expected: PASS (1 test).

- [ ] **Step 9: Lint, typecheck, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
git add apps/backend/src/track-corrections apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/track-corrections.integration-spec.ts
git commit -m "feat(track-corrections): filter the moderation queue by reason and track, add GET /track-corrections/:id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 2: Audit approvals and rejections, `TRACK_CORRECTION` audit target

**Files:**

- Create: `apps/backend/src/admin/admin-audit.module.ts`
- Modify: `apps/backend/src/admin/admin.module.ts` (l. 1-26)
- Modify: `apps/backend/src/admin/dto/admin-audit.dto.ts` (`AUDIT_ACTIONS` / `AUDIT_TARGET_TYPES`, l. 5-21)
- Create: `apps/backend/src/admin/dto/admin-audit.dto.spec.ts`
- Modify: `apps/backend/src/utils/prisma-selects.ts` (append after `trackCorrectionDecisionSelect`, l. ~367)
- Modify: `apps/backend/src/track-corrections/track-corrections.module.ts` (l. 1-18)
- Modify: `apps/backend/src/track-corrections/track-corrections.service.ts` (imports l. 1-47, types l. 76-82, constructor l. 120-125, `approve` l. 235-269, `reject` l. 271-296, statics after `alreadyDecided` l. 497-499)
- Modify: `apps/backend/src/track-corrections/track-corrections.service.spec.ts` (imports l. 26-37, setup l. 100-147, `describe("approve")` l. 633-857, `describe("reject")` l. 859-928, `describe("approve (TracksService réel)")` l. 936-958)
- Modify: `apps/backend/test/admin.e2e-spec.ts` (one test)
- Modify: `apps/backend/test/track-corrections.integration-spec.ts` (two tests)

**Interfaces:**

- Consumes: `AdminAuditService.record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>`, `diffFields(before, after)` from `src/admin/admin-audit.util.ts`, `TracksService.updateTrack(id, userId, isAdmin, patch, client)`.
- Produces:
  - `AdminAuditModule` (providers + exports `AdminAuditService`).
  - `AUDIT_ACTIONS` += `"TRACK_CORRECTION_APPROVE"`, `"TRACK_CORRECTION_REJECT"`; `AUDIT_TARGET_TYPES` = `["USER", "CLUB", "TRACK_CORRECTION"]`.
  - `trackCorrectionAuditTrackSelect = { title, artist, style, bpm, clashTimecodes }`.
  - `TrackCorrectionsService` constructor `(prisma, tracksService, notificationsService, queryService, audit: AdminAuditService)`.

**Module wiring decision.** `AdminAuditService` depends only on the global `PrismaService`, but it is provided (not exported) by `AdminModule`, which imports `AuthModule` and `UsersModule`. Importing `AdminModule` from `TrackCorrectionsModule` would drag the whole back-office graph into a domain module and invite a cycle later. A two-line `AdminAuditModule` that provides and exports the service is imported by both `AdminModule` and `TrackCorrectionsModule`; `AdminModule` stops providing the service itself, so there is a single instance. No cycle: `src/admin/admin-audit.*` imports nothing from `track-corrections`.

- [ ] **Step 1: Write the failing audit-DTO test**

Create `apps/backend/src/admin/dto/admin-audit.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, ListAuditLogQueryDto } from './admin-audit.dto';

describe('ListAuditLogQueryDto', () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(ListAuditLogQueryDto, plain)).map((e) => e.property);

  it('accepts track corrections as a target type', () => {
    expect(errors({ targetType: 'TRACK_CORRECTION' })).toEqual([]);
  });

  it('refuses an unknown target type', () => {
    expect(errors({ targetType: 'TRACK' })).toEqual(['targetType']);
  });

  it('knows the moderation decisions', () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(['TRACK_CORRECTION_APPROVE', 'TRACK_CORRECTION_REJECT']),
    );
    expect(AUDIT_TARGET_TYPES).toEqual(['USER', 'CLUB', 'TRACK_CORRECTION']);
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/dto/admin-audit.dto.spec.ts`
Expected: FAIL (`targetType` refused, actions missing).

- [ ] **Step 2: Extend the audit constants**

In `apps/backend/src/admin/dto/admin-audit.dto.ts`, replace the end of `AUDIT_ACTIONS` and `AUDIT_TARGET_TYPES`:

```ts
  "CLUB_DELETE",
  // Moderation decisions (lot 2), taken from the back-office or the mobile app.
  "TRACK_CORRECTION_APPROVE",
  "TRACK_CORRECTION_REJECT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = ["USER", "CLUB", "TRACK_CORRECTION"] as const;
```

Run: `pnpm --filter backend exec jest src/admin/dto/admin-audit.dto.spec.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing service tests**

In `apps/backend/src/track-corrections/track-corrections.service.spec.ts`:

Imports — add:

```ts
import { AdminAuditService } from '../admin/admin-audit.service';
import { trackCorrectionAuditTrackSelect } from '../utils/prisma-selects';
```

In the top-level `describe`, after `let queryService: { findOneForAdmin: jest.Mock };`, add:

```ts
let audit: { record: jest.Mock };
```

In `beforeEach`, after the `queryService = {...};` assignment, add:

```ts
audit = { record: jest.fn().mockResolvedValue(undefined) };
```

and in the providers list, after `{ provide: TrackCorrectionsQueryService, useValue: queryService },`, add:

```ts
        { provide: AdminAuditService, useValue: audit },
```

In `describe("approve")`, in the test "piste blacklistée entre-temps : ni titre ni artiste dans la notification", replace `prisma.trackCorrection.updateMany.mockResolvedValue({ count: 1 });` with `tx.trackCorrection.updateMany.mockResolvedValue({ count: 1 });`.

Append at the end of `describe("approve")`:

```ts
const trackFields = (overrides: Record<string, unknown> = {}) => ({
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Paso Doble',
  bpm: 60,
  clashTimecodes: [12.5, 40],
  ...overrides,
});

it('audits the applied change inside the decision transaction', async () => {
  tx.track.findUnique
    .mockResolvedValueOnce(trackFields() as never)
    .mockResolvedValueOnce(trackFields({ title: 'Espana Cani', bpm: 62 }) as never);

  await service.approve('c1', 'admin-1', { comment: 'merci' });

  expect(tx.track.findUnique).toHaveBeenCalledTimes(2);
  expect(tx.track.findUnique).toHaveBeenCalledWith({
    where: { id: 't1' },
    select: trackCorrectionAuditTrackSelect,
  });
  expect(prisma.track.findUnique).not.toHaveBeenCalled();
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(audit.record).toHaveBeenCalledWith(tx, {
    actorId: 'admin-1',
    action: 'TRACK_CORRECTION_APPROVE',
    targetType: 'TRACK_CORRECTION',
    targetId: 'c1',
    before: { trackId: 't1', title: 'España Cañí', bpm: 60 },
    after: { trackId: 't1', title: 'Espana Cani', bpm: 62 },
  });
});

it('audits the MPM silently recalculated by a dance-only change', async () => {
  prisma.trackCorrection.findUnique.mockResolvedValue(
    decisionRow({
      proposedTitle: null,
      proposedBpm: null,
      proposedStyle: 'Rumba',
    }) as never,
  );
  tx.track.findUnique
    .mockResolvedValueOnce(trackFields() as never)
    .mockResolvedValueOnce(trackFields({ style: 'Rumba', bpm: 25 }) as never);

  await service.approve('c1', 'admin-1', {});

  expect(audit.record.mock.calls[0][1]).toMatchObject({
    before: { trackId: 't1', style: 'Paso Doble', bpm: 60 },
    after: { trackId: 't1', style: 'Rumba', bpm: 25 },
  });
});

it('logs the trackId alone when the approval changes nothing on the track', async () => {
  tx.track.findUnique.mockResolvedValue(trackFields() as never);

  await service.approve('c1', 'admin-1', {});

  expect(audit.record.mock.calls[0][1]).toMatchObject({
    before: { trackId: 't1' },
    after: { trackId: 't1' },
  });
});

it('never copies the review comment into the audit row', async () => {
  tx.track.findUnique.mockResolvedValue(trackFields() as never);

  await service.approve('c1', 'admin-1', {
    comment: 'écrire à jeanne@x.fr',
  });

  expect(JSON.stringify(audit.record.mock.calls[0][1])).not.toContain('jeanne');
});

it('writes no audit row when the decision fails', async () => {
  tx.trackCorrection.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(service.approve('c1', 'admin-1', {})).rejects.toThrow(ConflictException);

  tracks.updateTrack.mockRejectedValueOnce(new BadRequestException());
  await expect(service.approve('c1', 'admin-1', {})).rejects.toThrow(BadRequestException);

  prisma.trackCorrection.findUnique.mockResolvedValue(null);
  await expect(service.approve('c1', 'admin-1', {})).rejects.toThrow(NotFoundException);

  expect(audit.record).not.toHaveBeenCalled();
});
```

Replace the whole `describe("reject", ...)` block with:

```ts
describe('reject', () => {
  beforeEach(() => {
    prisma.trackCorrection.findUnique.mockResolvedValue(decisionRow() as never);
    tx.trackCorrection.updateMany.mockResolvedValue({ count: 1 });
  });

  it("marque REJECTED sans toucher à la piste et notifie l'auteur", async () => {
    await service.reject('c1', 'admin-1', { comment: 'déjà correct' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.trackCorrection.updateMany).not.toHaveBeenCalled();
    expect(tx.trackCorrection.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: TrackCorrectionStatus.PENDING },
      data: {
        status: TrackCorrectionStatus.REJECTED,
        reviewedById: 'admin-1',
        reviewComment: 'déjà correct',
        reviewedAt: expect.any(Date),
      },
    });
    expect(tracks.updateTrack).not.toHaveBeenCalled();
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'u1',
      NotificationType.TRACK_CORRECTION_DECISION,
      'Proposition refusée',
      '«España Cañí» : votre proposition de correction a été refusée. Commentaire : déjà correct',
      {
        type: 'TRACK_CORRECTION_DECISION',
        correctionId: 'c1',
        trackId: 't1',
        status: TrackCorrectionStatus.REJECTED,
      },
    );
  });

  it('sans commentaire : reviewComment null et corps sans commentaire', async () => {
    await service.reject('c1', 'admin-1', {});
    expect(tx.trackCorrection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewComment: null }),
      }),
    );
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      'u1',
      NotificationType.TRACK_CORRECTION_DECISION,
      'Proposition refusée',
      '«España Cañí» : votre proposition de correction a été refusée.',
      expect.any(Object),
    );
  });

  it('audits the rejection in the same transaction, with the trackId only', async () => {
    await service.reject('c1', 'admin-1', { comment: 'voir jeanne@x.fr' });

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorId: 'admin-1',
      action: 'TRACK_CORRECTION_REJECT',
      targetType: 'TRACK_CORRECTION',
      targetId: 'c1',
      after: { trackId: 't1' },
    });
    expect(JSON.stringify(audit.record.mock.calls[0][1])).not.toContain('jeanne');
  });

  it('409 en cas de double décision concurrente', async () => {
    tx.trackCorrection.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.reject('c1', 'admin-1', {})).rejects.toThrow(ConflictException);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('409 si déjà validée', async () => {
    prisma.trackCorrection.findUnique.mockResolvedValue(
      decisionRow({ status: TrackCorrectionStatus.APPROVED }) as never,
    );
    await expect(service.reject('c1', 'admin-1', {})).rejects.toThrow(ConflictException);
    expect(tx.trackCorrection.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
```

In `describe("approve (TracksService réel)")`, in the `new TrackCorrectionsService(` call, add a fifth argument after `queryService as unknown as TrackCorrectionsQueryService,`:

```ts
        audit as unknown as AdminAuditService,
```

Run: `pnpm --filter backend exec jest src/track-corrections/track-corrections.service.spec.ts`
Expected: FAIL — no `AdminAuditService` injected (the audit tests fail: `record` never called; reject still writes through `prisma`, not `tx`), and a TypeScript error on `trackCorrectionAuditTrackSelect` not exported.

- [ ] **Step 4: Add the select constant**

Append to `apps/backend/src/utils/prisma-selects.ts`, right after `trackCorrectionDecisionSelect`:

```ts
/**
 * Track fields an approved correction may change, read just before and just
 * after the update inside the decision transaction: the audit row then holds
 * what was really applied (MPM recalculated on a dance change, sorted clashes).
 */
export const trackCorrectionAuditTrackSelect = {
  title: true,
  artist: true,
  style: true,
  bpm: true,
  clashTimecodes: true,
} as const;
```

- [ ] **Step 5: Wire the audit module**

Create `apps/backend/src/admin/admin-audit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';

/**
 * The audit trail on its own, so that domain modules outside the back-office
 * (track-corrections, whose decisions also come from the mobile app) can write
 * to it without importing AdminModule and its auth/users dependencies.
 * PrismaModule is global.
 */
@Module({
  providers: [AdminAuditService],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
```

Replace `apps/backend/src/admin/admin.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminAuditModule } from './admin-audit.module';
import { AdminClubsQueryService } from './admin-clubs.query-service';
import { AdminClubsService } from './admin-clubs.service';
import { AdminUsersQueryService } from './admin-users.query-service';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';
import { AdminReferenceService } from './admin-reference.service';
import { AdminUserAccountsService } from './admin-user-accounts.service';

@Module({
  imports: [AdminAuditModule, AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [
    AdminClubsQueryService,
    AdminClubsService,
    AdminReferenceService,
    AdminUserAccountsService,
    AdminUsersQueryService,
    AdminUsersService,
  ],
})
export class AdminModule {}
```

Replace `apps/backend/src/track-corrections/track-corrections.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin/admin-audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TracksModule } from '../tracks/tracks.module';
import { TrackCorrectionsController } from './track-corrections.controller';
import { TrackCorrectionsQueryService } from './track-corrections.query-service';
import { TrackCorrectionsService } from './track-corrections.service';
import { TrackReportController } from './track-report.controller';

/**
 * Propositions de correction des métadonnées des musiques (file de
 * modération admin). NotificationsModule est global ; les décisions sont
 * tracées dans le journal d'audit du back-office (AdminAuditModule).
 */
@Module({
  imports: [PrismaModule, TracksModule, AdminAuditModule],
  controllers: [TrackCorrectionsController, TrackReportController],
  providers: [TrackCorrectionsService, TrackCorrectionsQueryService],
})
export class TrackCorrectionsModule {}
```

- [ ] **Step 6: Audit in the service**

In `apps/backend/src/track-corrections/track-corrections.service.ts`:

Imports — add, after the `@prisma/client` import:

```ts
import { AdminAuditService } from '../admin/admin-audit.service';
import { diffFields } from '../admin/admin-audit.util';
import type { AuditEntry } from '../admin/dto/admin-audit.dto';
```

and add `trackCorrectionAuditTrackSelect,` to the `../utils/prisma-selects` import list (after `trackCorrectionDecisionSelect,`).

After the `CorrectionForDecision` type, add:

```ts
type TrackAuditFields = Prisma.TrackGetPayload<{
  select: typeof trackCorrectionAuditTrackSelect;
}>;
```

Constructor — add the fifth parameter:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracksService: TracksService,
    private readonly notificationsService: NotificationsService,
    private readonly queryService: TrackCorrectionsQueryService,
    private readonly audit: AdminAuditService,
  ) {}
```

In `approve`, replace the `$transaction` call with:

```ts
await this.prisma.$transaction(async (tx) => {
  await TrackCorrectionsService.claim(tx, id, adminId, TrackCorrectionStatus.APPROVED, comment);
  const before = await tx.track.findUnique({
    where: { id: correction.trackId },
    select: trackCorrectionAuditTrackSelect,
  });
  await this.tracksService.updateTrack(correction.trackId, adminId, true, patch, tx);
  const after = await tx.track.findUnique({
    where: { id: correction.trackId },
    select: trackCorrectionAuditTrackSelect,
  });
  await this.audit.record(
    tx,
    TrackCorrectionsService.approvalAudit(id, adminId, correction.trackId, before, after),
  );
});
```

and add to the method's doc comment, before its closing `*/`:

```ts
   * The audit row (same transaction) holds the track fields really changed,
   * read back after updateTrack; nothing is logged if any step fails.
```

In `reject`, replace

```ts
await TrackCorrectionsService.claim(
  this.prisma,
  id,
  adminId,
  TrackCorrectionStatus.REJECTED,
  comment,
);
```

with

```ts
// Claim and audit row are atomic: a 409 leaves no trace.
await this.prisma.$transaction(async (tx) => {
  await TrackCorrectionsService.claim(tx, id, adminId, TrackCorrectionStatus.REJECTED, comment);
  await this.audit.record(tx, {
    actorId: adminId,
    action: 'TRACK_CORRECTION_REJECT',
    targetType: 'TRACK_CORRECTION',
    targetId: id,
    // Track metadata only: never the proposer's message nor the comment.
    after: { trackId: correction.trackId },
  });
});
```

After `alreadyDecided()`, add:

```ts
  /**
   * Audit row of an approval: the track fields the approval actually changed
   * plus trackId. Never the proposer's message nor the review comment (free
   * text that may hold personal data).
   */
  private static approvalAudit(
    id: string,
    adminId: string,
    trackId: string,
    before: TrackAuditFields | null,
    after: TrackAuditFields | null,
  ): AuditEntry {
    const changes = diffFields(before ?? {}, after ?? {});
    return {
      actorId: adminId,
      action: "TRACK_CORRECTION_APPROVE",
      targetType: "TRACK_CORRECTION",
      targetId: id,
      before: { trackId, ...changes?.before },
      after: { trackId, ...changes?.after },
    };
  }
```

Run: `pnpm --filter backend exec jest src/track-corrections src/admin`
Expected: PASS.

- [ ] **Step 7: Mocked e2e — audit-log filter and DI wiring**

Append at the end of the `describe` in `apps/backend/test/admin.e2e-spec.ts`:

```ts
it('admin can filter the audit log on moderation decisions', async () => {
  currentRole = UserRole.ADMIN;
  prisma.adminAuditLog.count.mockResolvedValue(0);
  prisma.adminAuditLog.findMany.mockResolvedValue([]);
  await request(server()).get('/api/v1/admin/audit-log?targetType=TRACK_CORRECTION').expect(200);
  expect(prisma.adminAuditLog.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { targetType: 'TRACK_CORRECTION' } }),
  );
});
```

Run: `pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec` (from `apps/backend`)
Expected: PASS (the `AppModule` boot also proves the `AdminAuditModule` wiring).

- [ ] **Step 8: Real-DB integration — one exact row, none after a second decision**

In `apps/backend/test/track-corrections.integration-spec.ts`:

- Imports: add `ConflictException` (`import { ConflictException } from "@nestjs/common";`), add `UserRole` to the `@prisma/client` import, and add `import { TrackCorrectionsService } from "../src/track-corrections/track-corrections.service";`.
- After `let queries: TrackCorrectionsQueryService;` add `let service: TrackCorrectionsService;`, and in `beforeAll` after `queries = …` add `service = moduleRef.get(TrackCorrectionsService);`.
- Append inside the `describe`:

```ts
const admin = async (): Promise<string> => {
  const row = await prisma.user.create({
    data: {
      email: `${randomUUID()}@test.local`,
      password: 'x',
      firstName: 'Admin',
      lastName: 'Test',
      role: UserRole.ADMIN,
    },
    select: { id: true },
  });
  userIds.push(row.id);
  return row.id;
};

it('an approval writes one audit row with the change really applied and no free text', async () => {
  const adminId = await admin();
  const trackId = await track('España Cañí', 'Orchestre', {
    style: 'Paso Doble',
    bpm: 60,
    rawBpm: 120,
  });
  const id = await correction(trackId, TrackCorrectionReason.PASO_CLASH, {
    message: 'secret-message-zq',
    proposesClashes: true,
    proposedClashTimecodes: [40, 80],
  });

  await service.approve(id, adminId, {
    bpm: 62,
    clashTimecodes: [83.5, 40],
    comment: 'secret-comment-zq',
  });

  const rows = await prisma.adminAuditLog.findMany({
    where: { targetId: id },
    take: 10,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorId: adminId,
    action: 'TRACK_CORRECTION_APPROVE',
    targetType: 'TRACK_CORRECTION',
    before: { trackId, bpm: 60, clashTimecodes: [] },
    after: { trackId, bpm: 62, clashTimecodes: [40, 83.5] },
  });
  expect(JSON.stringify(rows[0])).not.toMatch(/secret-/);

  await expect(service.reject(id, adminId, {})).rejects.toThrow(ConflictException);
  expect(await prisma.adminAuditLog.count({ where: { targetId: id } })).toBe(1);
});

it('a rejection writes a trackId-only row', async () => {
  const adminId = await admin();
  const trackId = await track('Rumba', 'Orchestre');
  const id = await correction(trackId, TrackCorrectionReason.TITLE, {
    message: 'secret-message-zq',
  });

  await service.reject(id, adminId, { comment: 'secret-comment-zq' });

  const rows = await prisma.adminAuditLog.findMany({
    where: { targetId: id },
    take: 10,
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'TRACK_CORRECTION_REJECT',
    before: null,
    after: { trackId },
  });
  expect(JSON.stringify(rows[0])).not.toMatch(/secret-/);
});
```

Run (test DB only):

```bash
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit track-corrections.integration-spec admin.integration-spec'
```

Expected: PASS (3 track-corrections tests; `admin.integration-spec` still green with the new module wiring).

- [ ] **Step 9: Coverage gate, lint, typecheck, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
pnpm --filter backend exec jest --coverage --silent
git add apps/backend/src/admin apps/backend/src/track-corrections apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/track-corrections.integration-spec.ts
git commit -m "feat(track-corrections): audit approvals and rejections from web and mobile

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

Expected before committing: every threshold met (`src/admin` 94 / 75 / 88 / 94 and the global floor). If one fails, add unit tests for the uncovered lines the report names; never lower a threshold.

---

### Task 3: Swagger export and regenerated clients

**Files:**

- Modify (generated): `apps/backend/swagger.json`, `apps/docs/public/swagger.json`
- Regenerated, gitignored (not committed): `apps/admin/src/api/generated/**`, `apps/client/src/api/generated/**`
- Modify: `apps/admin/src/lib/auditLabels.ts` (whole file, 16 lines)
- Modify: `apps/client/src/features/track-corrections/utils/__tests__/trackCorrections.test.ts` (fixture l. 19-28)
- Modify: `apps/client/src/features/track-corrections/screens/__tests__/TrackCorrectionsReviewScreen.test.tsx` (fixture l. 68-78)

**Interfaces:**

- Consumes: the routes of Tasks 1-2.
- Produces (generated SDK, both clients): `trackCorrectionsControllerList` (query `{ skip?, take?, status?, reason?: TrackCorrectionReason[], q?: string }`), `trackCorrectionsControllerFindOne` (`{ path: { id } }`), `trackCorrectionsControllerPendingCount`, `trackCorrectionsControllerApprove`, `trackCorrectionsControllerReject`; types `TrackCorrectionAdminDto` (with `track.filename: string`), `TrackCorrectionsControllerListData`, `TrackCorrectionReason`, `TrackCorrectionStatus`, `ApproveTrackCorrectionDto`, `AuditLogEntryDto['action']` (14 actions), `AuditLogEntryDto['targetType']` (`'USER' | 'CLUB' | 'TRACK_CORRECTION'`).
- Produces (SPA): `ACTION_LABELS` covers the two new actions.

- [ ] **Step 1: Export Swagger (from `apps/backend`, not the repo root)**

```bash
cd apps/backend
pnpm run build
node scripts/export-swagger.js
cp swagger.json ../docs/public/swagger.json
pnpm exec prettier --write swagger.json ../docs/public/swagger.json
node -e 'const s=require("./swagger.json");console.log(Object.keys(s.paths).filter((p)=>p.startsWith("/track-corrections")).sort().join("\n"))'
node -e 'const s=require("./swagger.json");console.log(s.paths["/track-corrections"].get.parameters.map((x)=>x.name).sort().join(","));console.log(s.components.schemas.TrackCorrectionTrackSnapshotDto.required.includes("filename"));console.log(JSON.stringify(s.components.schemas.AuditLogEntryDto.properties.targetType.enum));console.log(s.paths["/track-corrections/{id}"].get.operationId)'
```

Expected output of the first `node` command, exactly:

```
/track-corrections
/track-corrections/mine
/track-corrections/pending-count
/track-corrections/{id}
/track-corrections/{id}/approve
/track-corrections/{id}/reject
```

Expected output of the second:

```
q,reason,skip,status,take
true
["USER","CLUB","TRACK_CORRECTION"]
TrackCorrectionsController_findOne
```

- [ ] **Step 2: Regenerate both clients and see what breaks**

From the repo root:

```bash
pnpm --filter admin exec openapi-ts
pnpm --filter client exec openapi-ts
grep -c "export const trackCorrectionsControllerFindOne" apps/admin/src/api/generated/sdk.gen.ts
pnpm --filter admin typecheck
pnpm --filter client typecheck
```

Expected: the `grep` prints `1`; both typechecks FAIL, with errors limited to `ACTION_LABELS` missing `TRACK_CORRECTION_APPROVE` / `TRACK_CORRECTION_REJECT` (admin) and `filename` missing from the two track fixtures (client).

- [ ] **Step 3: Fix the labels and the fixtures**

Replace `apps/admin/src/lib/auditLabels.ts` with:

```ts
import type { AuditLogEntryDto } from '../api/generated/types.gen';

export const ACTION_LABELS: Record<AuditLogEntryDto['action'], string> = {
  USER_UPDATE: 'Modification de fiche',
  CLUB_ACCOUNT_CREATE: 'Création de compte Club',
  INVITATION_RESEND: "Renvoi d'invitation",
  USER_CREATE: "Création d'utilisateur",
  USER_DISABLE: "Désactivation d'utilisateur",
  USER_ENABLE: "Réactivation d'utilisateur",
  USER_DELETE: "Suppression d'utilisateur",
  CLUB_CREATE: 'Création de club',
  CLUB_UPDATE: 'Modification de club',
  CLUB_DISABLE: 'Désactivation de club',
  CLUB_ENABLE: 'Réactivation de club',
  CLUB_DELETE: 'Suppression de club',
  TRACK_CORRECTION_APPROVE: 'Proposition approuvée',
  TRACK_CORRECTION_REJECT: 'Proposition refusée',
};
```

In `apps/client/src/features/track-corrections/utils/__tests__/trackCorrections.test.ts`, in the `track` fixture, add after `blacklisted: false,`:

```ts
  filename: "espana-cani.mp3",
```

In `apps/client/src/features/track-corrections/screens/__tests__/TrackCorrectionsReviewScreen.test.tsx`, in the `track` object of the `correction` fixture, add after `blacklisted: false,`:

```ts
    filename: "espana-cani.mp3",
```

(Test fixtures only: the mobile code ignores the new field.)

- [ ] **Step 4: Run the checks**

```bash
pnpm --filter admin typecheck
pnpm --filter client typecheck
pnpm --filter admin exec vitest run --testTimeout=60000
pnpm --filter client exec jest src/features/track-corrections src/services/api
```

Expected: PASS (the mobile review tests are green and unchanged apart from the fixtures).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/swagger.json apps/docs/public/swagger.json apps/admin/src/lib/auditLabels.ts apps/client/src/features/track-corrections
git commit -m "chore(api): export the lot 2 moderation contract and adapt the clients

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 4: « Modération » menu badge and queue page

**Files:**

- Modify: `apps/admin/src/api/queries.ts` (imports l. 1-15, append)
- Create: `apps/admin/src/lib/moderation.ts`, `apps/admin/src/lib/moderation.test.ts`
- Modify: `apps/admin/src/components/AppLayout.tsx` (whole file, 43 lines)
- Modify: `apps/admin/src/components/AppLayout.test.tsx` (whole file, 26 lines)
- Create: `apps/admin/src/pages/ModerationPage.tsx`, `apps/admin/src/pages/ModerationPage.test.tsx`
- Modify: `apps/admin/src/router.tsx` (imports l. 1-11, children l. 23-31)

**Interfaces:**

- Consumes: `trackCorrectionsControllerList`, `trackCorrectionsControllerPendingCount`, `unwrap`, `apiErrorMessage`, `UNAVAILABLE_MESSAGE`.
- Produces:
  - `queries.ts`: `type ModerationFilter = NonNullable<TrackCorrectionsControllerListData['query']>`; `moderationListQuery(q: ModerationFilter)` (key `['admin', 'moderation', 'list', q]`); `pendingCountQuery` (key `['admin', 'moderation', 'pending-count']`, no `refetchInterval`).
  - `lib/moderation.ts`: `REASON_LABELS: Record<TrackCorrectionReason, string>`, `REASONS: TrackCorrectionReason[]`, `STATUS_OPTIONS: { value: TrackCorrectionStatus; label: string }[]`, `STATUS_BADGES: Record<TrackCorrectionStatus, { label: string; color: string }>`, `MIN_SEARCH_LENGTH = 2`, `MAX_CLASHES = 3`, `MAX_CLASH_SECONDS = 3600`, `interface ModerationUrlState { status; reasons; q; page }`, `readModerationParams(params: URLSearchParams): ModerationUrlState`, `writeModerationParams(current: URLSearchParams, patch: Partial<ModerationUrlState>): URLSearchParams`, `moderationFilter(state: ModerationUrlState, take: number): ModerationFilter`, `nextPendingFilter(params: URLSearchParams): ModerationFilter`, `roundTenth(seconds: number): number`, `formatTimecode(seconds: number): string`, `parseTimecode(text: string): number | null`, `proposalSummary(p: TrackCorrectionAdminDto['proposed']): string`.
  - `ModerationPage` at `/moderation`.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/admin/src/lib/moderation.test.ts`:

```ts
import {
  formatTimecode,
  moderationFilter,
  nextPendingFilter,
  parseTimecode,
  proposalSummary,
  readModerationParams,
  roundTenth,
  writeModerationParams,
} from './moderation';

describe('timecodes', () => {
  it('formats m:ss, with the tenth only when it is not zero', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(40)).toBe('0:40');
    expect(formatTimecode(83.46)).toBe('1:23.5');
    expect(formatTimecode(59.96)).toBe('1:00');
  });

  it('parses m:ss, m:ss.d and plain seconds', () => {
    expect(parseTimecode('1:23.5')).toBe(83.5);
    expect(parseTimecode(' 0:40 ')).toBe(40);
    expect(parseTimecode('1:05,2')).toBe(65.2);
    expect(parseTimecode('83.5')).toBe(83.5);
    expect(parseTimecode('60:00')).toBe(3600);
  });

  it('refuses anything else, and beyond 3600 s', () => {
    for (const text of ['', 'abc', '1:60', '1:5', '-3', '60:01']) {
      expect(parseTimecode(text)).toBeNull();
    }
  });

  it('rounds to the tenth of a second', () => {
    expect(roundTenth(83.46)).toBe(83.5);
    expect(roundTenth(12.04)).toBe(12);
  });
});

describe('moderation URL state', () => {
  it('defaults to the pending queue', () => {
    expect(readModerationParams(new URLSearchParams())).toEqual({
      status: 'PENDING',
      reasons: [],
      q: '',
      page: 1,
    });
  });

  it('reads status, reasons, search and page, dropping unknown or too short values', () => {
    expect(
      readModerationParams(
        new URLSearchParams('status=REJECTED&reason=MPM,NOPE,TITLE&q=%20paso%20&page=3'),
      ),
    ).toEqual({ status: 'REJECTED', reasons: ['MPM', 'TITLE'], q: 'paso', page: 3 });
    expect(readModerationParams(new URLSearchParams('status=DONE&q=p&page=-1'))).toEqual({
      status: 'PENDING',
      reasons: [],
      q: '',
      page: 1,
    });
  });

  it('writes only non-default values and goes back to page 1 on a filter change', () => {
    const current = new URLSearchParams('reason=MPM&page=4');
    expect(writeModerationParams(current, { status: 'APPROVED' }).toString()).toBe(
      'status=APPROVED&reason=MPM',
    );
    expect(writeModerationParams(current, { page: 2 }).toString()).toBe('reason=MPM&page=2');
    expect(writeModerationParams(current, { reasons: [] }).toString()).toBe('');
  });

  it('builds the API filter of a page', () => {
    expect(moderationFilter({ status: 'PENDING', reasons: [], q: '', page: 1 }, 50)).toEqual({
      status: 'PENDING',
      skip: 0,
      take: 50,
    });
    expect(
      moderationFilter({ status: 'APPROVED', reasons: ['MPM'], q: 'paso', page: 3 }, 50),
    ).toEqual({ status: 'APPROVED', reason: ['MPM'], q: 'paso', skip: 100, take: 50 });
  });

  it('looks for the next proposal among the pending ones, whatever status the list shows', () => {
    expect(
      nextPendingFilter(new URLSearchParams('status=REJECTED&reason=MPM&q=paso&page=3')),
    ).toEqual({ status: 'PENDING', reason: ['MPM'], q: 'paso', skip: 0, take: 1 });
  });
});

describe('proposalSummary', () => {
  const none = { title: null, artist: null, style: null, bpm: null, clashTimecodes: null };

  it('lists the proposed values', () => {
    expect(proposalSummary({ ...none, title: 'Espana', bpm: 62 })).toBe(
      'Titre « Espana » · MPM 62',
    );
    expect(proposalSummary({ ...none, artist: 'X', style: 'Rumba' })).toBe(
      'Artiste « X » · Danse Rumba',
    );
    expect(proposalSummary({ ...none, clashTimecodes: [40, 83.5] })).toBe('Clashes 0:40, 1:23.5');
  });

  it('tells « no clash » apart from « no value proposed »', () => {
    expect(proposalSummary({ ...none, clashTimecodes: [] })).toBe('Aucun clash');
    expect(proposalSummary(none)).toBe('Message seul');
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/moderation.test.ts --testTimeout=60000`
Expected: FAIL (`Cannot find module './moderation'`).

- [ ] **Step 2: Add the queries**

In `apps/admin/src/api/queries.ts`, add `trackCorrectionsControllerList,` and `trackCorrectionsControllerPendingCount,` to the `./generated/sdk.gen` import list, and `TrackCorrectionsControllerListData,` to the `./generated/types.gen` type import list. After `export type AuditFilter = …`, add:

```ts
export type ModerationFilter = NonNullable<TrackCorrectionsControllerListData['query']>;
```

Append at the end of the file:

```ts
export const moderationListQuery = (q: ModerationFilter) =>
  queryOptions({
    queryKey: ['admin', 'moderation', 'list', q],
    queryFn: () => unwrap(trackCorrectionsControllerList({ query: q })),
  });

/**
 * Pending proposals, for the menu badge. Refetched on navigation and after a
 * decision only: no refetchInterval, the backend scales to zero.
 */
export const pendingCountQuery = queryOptions({
  queryKey: ['admin', 'moderation', 'pending-count'],
  queryFn: () => unwrap(trackCorrectionsControllerPendingCount()),
});
```

- [ ] **Step 3: Implement the helpers**

Create `apps/admin/src/lib/moderation.ts`:

```ts
import type {
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from '../api/generated/types.gen';
import type { ModerationFilter } from '../api/queries';

export const REASON_LABELS: Record<TrackCorrectionReason, string> = {
  TITLE: 'Titre',
  ARTIST: 'Artiste',
  DANCE: 'Danse',
  MPM: 'MPM',
  PASO_CLASH: 'Clashes paso',
  OTHER: 'Autre',
};

export const REASONS = Object.keys(REASON_LABELS) as TrackCorrectionReason[];

export const STATUS_OPTIONS: { value: TrackCorrectionStatus; label: string }[] = [
  { value: 'PENDING', label: 'À traiter' },
  { value: 'APPROVED', label: 'Approuvées' },
  { value: 'REJECTED', label: 'Refusées' },
];

export const STATUS_BADGES: Record<TrackCorrectionStatus, { label: string; color: string }> = {
  PENDING: { label: 'À traiter', color: 'yellow' },
  APPROVED: { label: 'Approuvée', color: 'green' },
  REJECTED: { label: 'Refusée', color: 'red' },
};

/** The API refuses a shorter search (400): the SPA never sends one. */
export const MIN_SEARCH_LENGTH = 2;
/** Same bounds as the API (a paso doble has 2 or 3 clashes). */
export const MAX_CLASHES = 3;
export const MAX_CLASH_SECONDS = 3600;

export interface ModerationUrlState {
  status: TrackCorrectionStatus;
  reasons: TrackCorrectionReason[];
  q: string;
  page: number;
}

const isStatus = (value: string | null): value is TrackCorrectionStatus =>
  STATUS_OPTIONS.some((o) => o.value === value);

const isReason = (value: string): value is TrackCorrectionReason =>
  (REASONS as string[]).includes(value);

/** Filters kept in the URL: `?status=APPROVED&reason=MPM,TITLE&q=paso&page=2`. */
export function readModerationParams(params: URLSearchParams): ModerationUrlState {
  const status = params.get('status');
  const q = (params.get('q') ?? '').trim();
  const page = Number(params.get('page'));
  return {
    status: isStatus(status) ? status : 'PENDING',
    reasons: (params.get('reason') ?? '').split(',').filter(isReason),
    q: q.length >= MIN_SEARCH_LENGTH ? q : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; any filter change goes back to the first page. */
export function writeModerationParams(
  current: URLSearchParams,
  patch: Partial<ModerationUrlState>,
): URLSearchParams {
  const next = { ...readModerationParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.status !== 'PENDING') params.set('status', next.status);
  if (next.reasons.length > 0) params.set('reason', next.reasons.join(','));
  if (next.q) params.set('q', next.q);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows. */
export function moderationFilter(state: ModerationUrlState, take: number): ModerationFilter {
  return {
    status: state.status,
    ...(state.reasons.length > 0 && { reason: state.reasons }),
    ...(state.q && { q: state.q }),
    skip: (state.page - 1) * take,
    take,
  };
}

/**
 * « Proposition suivante »: the oldest pending proposal matching the list's
 * reasons and search, whatever status and page the list shows.
 */
export const nextPendingFilter = (params: URLSearchParams): ModerationFilter =>
  moderationFilter({ ...readModerationParams(params), status: 'PENDING', page: 1 }, 1);

/** Rounded to the tenth of a second, the precision of « Marquer ici ». */
export const roundTenth = (seconds: number): number => Math.round(seconds * 10) / 10;

/** `m:ss`, plus `.d` when the tenth is not zero: 83.46 → "1:23.5", 40 → "0:40". */
export function formatTimecode(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const secs = Math.floor(rest / 10);
  const tenth = rest % 10;
  return `${minutes}:${String(secs).padStart(2, '0')}${tenth ? `.${tenth}` : ''}`;
}

/** Accepts `m:ss`, `m:ss.d` (or `,d`) and plain seconds; null if invalid or beyond 3600 s. */
export function parseTimecode(text: string): number | null {
  const value = text.trim();
  const clock = /^(\d+):([0-5]\d)(?:[.,](\d))?$/.exec(value);
  const plain = /^(\d+)(?:[.,](\d))?$/.exec(value);
  let seconds: number;
  if (clock) {
    seconds = Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 10;
  } else if (plain) {
    seconds = Number(plain[1]) + Number(plain[2] ?? 0) / 10;
  } else {
    return null;
  }
  return seconds <= MAX_CLASH_SECONDS ? roundTenth(seconds) : null;
}

/** One-line summary of the proposed values, for the queue table. */
export function proposalSummary(p: TrackCorrectionAdminDto['proposed']): string {
  const parts: string[] = [];
  if (p.title !== null) parts.push(`Titre « ${p.title} »`);
  if (p.artist !== null) parts.push(`Artiste « ${p.artist} »`);
  if (p.style !== null) parts.push(`Danse ${p.style}`);
  if (p.bpm !== null) parts.push(`MPM ${p.bpm}`);
  if (p.clashTimecodes !== null) {
    parts.push(
      p.clashTimecodes.length > 0
        ? `Clashes ${p.clashTimecodes.map(formatTimecode).join(', ')}`
        : 'Aucun clash',
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Message seul';
}
```

Run: `pnpm --filter admin exec vitest run src/lib/moderation.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 4: Write the failing layout tests**

Replace `apps/admin/src/components/AppLayout.test.tsx` with:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { pendingCountQuery } from '../api/queries';
import { AppLayout } from './AppLayout';

const countSpy = (count: number) =>
  vi
    .spyOn(sdk, 'trackCorrectionsControllerPendingCount')
    .mockResolvedValue({ data: { count }, error: undefined } as never);

function renderLayout() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/users" element={<p>content</p>} />
              <Route path="/clubs" element={<p>clubs page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the sections of the back-office, without a "new user" shortcut', async () => {
    countSpy(0);
    renderLayout();
    expect(screen.getByRole('link', { name: 'Utilisateurs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clubs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Modération' })).toHaveAttribute('href', '/moderation');
    expect(screen.getByRole('link', { name: "Journal d'audit" })).toBeInTheDocument();
    expect(screen.queryByText('Nouvel utilisateur')).toBeNull();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('badges « Modération » with the pending count', async () => {
    countSpy(3);
    renderLayout();
    const link = screen.getByRole('link', { name: /^Modération/ });
    expect(await within(link).findByText('3')).toBeInTheDocument();
  });

  it('shows no badge when nothing is pending', async () => {
    const spy = countSpy(0);
    renderLayout();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const link = screen.getByRole('link', { name: /^Modération/ });
    expect(within(link).queryByText('0')).toBeNull();
  });

  it('refreshes the count on navigation, never on a timer', async () => {
    const spy = countSpy(3);
    renderLayout();
    await screen.findByText('3');
    expect(spy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('link', { name: 'Clubs' }));
    expect(await screen.findByText('clubs page')).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(pendingCountQuery.refetchInterval).toBeUndefined();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/components/AppLayout.test.tsx --testTimeout=60000`
Expected: FAIL (no « Modération » link, count never requested).

- [ ] **Step 5: Implement the badge**

Replace `apps/admin/src/components/AppLayout.tsx` with:

```tsx
import { AppShell, Badge, Button, Group, NavLink, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { NavLink as RouterLink, Outlet, useLocation, useNavigate } from 'react-router';
import { pendingCountQuery } from '../api/queries';
import { useSession } from '../session/sessionStore';

export function AppLayout() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pending = useQuery(pendingCountQuery);
  const { refetch } = pending;
  // Refreshed on navigation (and invalidated after a decision), never polled:
  // every request wakes the scale-to-zero backend.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    void refetch();
  }, [pathname, refetch]);
  const count = pending.data?.count ?? 0;

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Text fw={700}>FFD Connect — Admin</Text>
          <Group>
            <Text size="sm">
              {user?.firstName} {user?.lastName}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={() => {
                clear();
                navigate('/login', { replace: true });
              }}
            >
              Déconnexion
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <NavLink component={RouterLink} to="/users" label="Utilisateurs" />
        <NavLink component={RouterLink} to="/clubs" label="Clubs" />
        <NavLink
          component={RouterLink}
          to="/moderation"
          label="Modération"
          rightSection={
            count > 0 ? (
              <Badge size="sm" color="red" circle={count < 10}>
                {count}
              </Badge>
            ) : null
          }
        />
        <NavLink component={RouterLink} to="/audit-log" label="Journal d'audit" />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
```

Run: `pnpm --filter admin exec vitest run src/components/AppLayout.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Write the failing queue page tests**

Create `apps/admin/src/pages/ModerationPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ModerationPage } from './ModerationPage';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: null,
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'espana.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
  ...overrides,
});

const page = (data: object[]) => ({
  data: { data, meta: { total: data.length, skip: 0, take: 50, hasMore: false } },
  error: undefined,
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path = '/moderation') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/moderation"
              element={
                <>
                  <ModerationPage />
                  <Probe />
                </>
              }
            />
            <Route path="/moderation/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

describe('ModerationPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the pending queue by default, with track, reason, proposer and summary', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage();
    const row = (await screen.findByText('España Cañí')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Orchestre')).toBeInTheDocument();
    expect(within(row).getByText('MPM')).toBeInTheDocument();
    expect(within(row).getByText('Eva Martin')).toBeInTheDocument();
    expect(within(row).getByText('MPM 62')).toBeInTheDocument();
    expect(screen.getByText('1 proposition')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } });
  });

  it('flags a masked title next to the real one', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(
      page([item({ track: { ...item().track, titleMasked: true } })]) as never,
    );
    renderPage();
    const row = (await screen.findByText('España Cañí')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Titre masqué')).toBeInTheDocument();
  });

  it('restores status, reasons, search and page from the URL', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?status=APPROVED&reason=MPM,TITLE&q=paso&page=2');
    await screen.findByText('España Cañí');
    expect(spy).toHaveBeenCalledWith({
      query: { status: 'APPROVED', reason: ['MPM', 'TITLE'], q: 'paso', skip: 50, take: 50 },
    });
    expect(screen.getByRole('checkbox', { name: 'MPM' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Titre' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Danse' })).not.toBeChecked();
    expect(screen.getByPlaceholderText('Titre ou artiste')).toHaveValue('paso');
  });

  it('filters on the status and the reasons, from the first page, in the URL', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?page=3');
    await screen.findByText('España Cañí');
    await userEvent.click(screen.getByText('Refusées'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'REJECTED', skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?status=REJECTED');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Clashes paso' }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'REJECTED', reason: ['PASO_CLASH'], skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?status=REJECTED&reason=PASO_CLASH');
  });

  it('does not send a one-letter search, then sends the debounced search', async () => {
    const spy = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(page([item()]) as never);
    renderPage();
    await screen.findByText('España Cañí');
    const input = screen.getByPlaceholderText('Titre ou artiste');
    await userEvent.type(input, 'p');
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(spy).not.toHaveBeenCalledWith({ query: expect.objectContaining({ q: 'p' }) });
    await userEvent.type(input, 'a');
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: { status: 'PENDING', q: 'pa', skip: 0, take: 50 },
      }),
    );
    expect(location()).toBe('/moderation?q=pa');
  });

  it('opens a row with the current filters kept in the URL', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(page([item()]) as never);
    renderPage('/moderation?reason=MPM');
    await userEvent.click(await screen.findByText('España Cañí'));
    expect(location()).toBe('/moderation/c1?reason=MPM');
  });

  it('shows only the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/pages/ModerationPage.test.tsx --testTimeout=60000`
Expected: FAIL (`Cannot find module './ModerationPage'`).

- [ ] **Step 7: Implement the queue page and its route**

Create `apps/admin/src/pages/ModerationPage.tsx`:

```tsx
import {
  Alert,
  Badge,
  Chip,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import type { TrackCorrectionReason, TrackCorrectionStatus } from '../api/generated/types.gen';
import { moderationListQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import {
  MIN_SEARCH_LENGTH,
  moderationFilter,
  type ModerationUrlState,
  proposalSummary,
  readModerationParams,
  REASON_LABELS,
  REASONS,
  STATUS_OPTIONS,
  writeModerationParams,
} from '../lib/moderation';

const PAGE_SIZE = 50;

export function ModerationPage() {
  const navigate = useNavigate();
  const { search: locationSearch } = useLocation();
  const [params, setParams] = useSearchParams();
  const state = readModerationParams(params);
  const [search, setSearch] = useState(state.q);
  const [debounced] = useDebouncedValue(search.trim(), 300);

  // The search reaches the URL (and the API) once debounced and long enough.
  useEffect(() => {
    const next = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    if (next === readModerationParams(params).q) return;
    setParams(writeModerationParams(params, { q: next }), { replace: true });
  }, [debounced, params, setParams]);

  const update = (patch: Partial<ModerationUrlState>) =>
    setParams(writeModerationParams(params, patch));

  const list = useQuery({
    ...moderationListQuery(moderationFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;

  return (
    <Stack>
      <Title order={2}>Modération</Title>
      <SegmentedControl
        w="fit-content"
        data={STATUS_OPTIONS}
        value={state.status}
        onChange={(v) => update({ status: v as TrackCorrectionStatus })}
      />
      <Chip.Group
        multiple
        value={state.reasons}
        onChange={(v) => update({ reasons: v as TrackCorrectionReason[] })}
      >
        <Group gap="xs">
          {REASONS.map((reason) => (
            <Chip key={reason} value={reason} size="sm">
              {REASON_LABELS[reason]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <TextInput
        placeholder="Titre ou artiste"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les propositions.')}
        </Alert>
      ) : list.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} proposition{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Musique</Table.Th>
                <Table.Th>Motif</Table.Th>
                <Table.Th>Proposée par</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Changements proposés</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(list.data?.data ?? []).map((c) => (
                <Table.Tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/moderation/${c.id}${locationSearch}`)}
                >
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {c.track.title}
                      </Text>
                      {c.track.titleMasked && (
                        <Badge size="xs" color="gray" variant="light">
                          Titre masqué
                        </Badge>
                      )}
                      {c.track.blacklisted && (
                        <Badge size="xs" color="red" variant="light">
                          Retirée
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {c.track.artist}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{REASON_LABELS[c.reason]}</Badge>
                  </Table.Td>
                  <Table.Td>{c.proposer?.name ?? 'Compte supprimé'}</Table.Td>
                  <Table.Td>{dayjs(c.createdAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                  <Table.Td>{proposalSummary(c.proposed)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {total > PAGE_SIZE && (
            <Pagination
              total={Math.ceil(total / PAGE_SIZE)}
              value={state.page}
              onChange={(pageIndex) => update({ page: pageIndex })}
            />
          )}
        </>
      )}
    </Stack>
  );
}
```

In `apps/admin/src/router.tsx`, add `import { ModerationPage } from './pages/ModerationPage';` after the `LoginPage` import, and add after `{ path: 'clubs/:id', element: <ClubDetailPage /> },`:

```tsx
      { path: 'moderation', element: <ModerationPage /> },
```

Run: `pnpm --filter admin exec vitest run src/pages/ModerationPage.test.tsx src/components/AppLayout.test.tsx src/lib/moderation.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
git add apps/admin/src
git commit -m "feat(admin): moderation queue with URL filters and a pending badge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 5: Detail page — audio player, clash editor, reply templates, decision

**Files:**

- Modify: `apps/admin/src/api/queries.ts` (sdk import, append `correctionQuery`)
- Modify: `apps/admin/src/lib/apiError.ts` (append `isConflict`), `apps/admin/src/lib/apiError.test.ts` (append)
- Modify: `apps/admin/src/lib/moderation.ts` (imports, append), `apps/admin/src/lib/moderation.test.ts` (append)
- Modify: `apps/admin/src/components/ChangeSummary.tsx` (`LABELS` l. 4-20, `display` l. 28-37), `apps/admin/src/components/ChangeSummary.test.tsx` (append)
- Create: `apps/admin/src/components/ClashEditor.tsx`, `apps/admin/src/components/ClashEditor.test.tsx`
- Create: `apps/admin/src/pages/ModerationDetailPage.tsx`, `apps/admin/src/pages/ModerationDetailPage.test.tsx`
- Modify: `apps/admin/src/router.tsx` (one import, one route)

**Interfaces:**

- Consumes: `trackCorrectionsControllerFindOne`, `trackCorrectionsControllerApprove`, `trackCorrectionsControllerReject`, `moderationListQuery`, `pendingCountQuery`, `nextPendingFilter`, `formatTimecode`, `parseTimecode`, `roundTenth`, `MAX_CLASHES`, `REASON_LABELS`, `STATUS_BADGES`, `API_ORIGIN` (`src/config.ts`), `ChangeSummary`, `apiErrorMessage`.
- Produces:
  - `queries.ts`: `correctionQuery(id: string)` (key `['admin', 'moderation', 'item', id]`).
  - `apiError.ts`: `isConflict(body: unknown): boolean`.
  - `lib/moderation.ts`: `REJECT_TEMPLATES`, `APPROVE_TEMPLATES` (readonly string tuples), `insertTemplate(comment: string, template: string): string`, `interface ReviewValues { title: string; artist: string; style: string; bpm: number | string; clashes: number[] }`, `initialReviewValues(c: TrackCorrectionAdminDto): ReviewValues`, `type ApproveOverrides = Pick<ApproveTrackCorrectionDto, 'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes'>`, `approveOverrides(initial: ReviewValues, values: ReviewValues): ApproveOverrides`, `approvalPreview(c: TrackCorrectionAdminDto, overrides: ApproveOverrides): { before: Record<string, unknown>; after: Record<string, unknown> }`, `trackAudioUrl(filename: string): string`.
  - `ClashEditor({ value: number[]; onChange(next: number[]): void; audioRef: RefObject<HTMLAudioElement | null> })`, `CLASH_LEAD_IN_SECONDS = 3`.
  - `ModerationDetailPage` at `/moderation/:id`.

**Player design for tests.** jsdom has no media playback. The page renders a plain `<audio controls crossOrigin="anonymous">`; the `ClashEditor` reads `audioRef.current.currentTime` when « Marquer ici » is clicked and writes it to seek; a `timeupdate` listener shows « Position : m:ss ». Tests define `currentTime` on the element (`Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value })`), stub `HTMLMediaElement.prototype.play`, and fire `timeupdate`.

- [ ] **Step 1: Write the failing helper tests**

Append to `apps/admin/src/lib/apiError.test.ts`:

```ts
describe('isConflict', () => {
  it('recognises a 409 error body', () => {
    expect(isConflict({ statusCode: 409, message: 'Cette proposition a déjà été traitée.' })).toBe(
      true,
    );
  });
  it('is false for anything else', () => {
    expect(isConflict({ statusCode: 400 })).toBe(false);
    expect(isConflict(new TypeError('Failed to fetch'))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});
```

and change its first line to `import { apiErrorMessage, isConflict } from './apiError';`.

Append to `apps/admin/src/lib/moderation.test.ts` (and add `approvalPreview, approveOverrides, initialReviewValues, insertTemplate, trackAudioUrl,` to its import list, plus `import { API_ORIGIN } from '../config';` and `import type { TrackCorrectionAdminDto } from '../api/generated/types.gen';`):

```ts
const correction: TrackCorrectionAdminDto = {
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: null,
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'España Cañí.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
};

describe('review values', () => {
  it('start from the proposal, falling back on the current track', () => {
    expect(initialReviewValues(correction)).toEqual({
      title: 'España Cañí',
      artist: 'Orchestre',
      style: 'Paso Doble',
      bpm: 62,
      clashes: [40, 80],
    });
    expect(
      initialReviewValues({
        ...correction,
        proposed: { ...correction.proposed, bpm: null, clashTimecodes: [] },
        track: { ...correction.track, style: null },
      }),
    ).toMatchObject({ style: '', bpm: 62, clashes: [] });
  });

  it('send only what the admin changed', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, initial)).toEqual({});
    expect(approveOverrides(initial, { ...initial, title: ' Espana ', bpm: 61 })).toEqual({
      title: 'Espana',
      bpm: 61,
    });
  });

  it('send an emptied clash list as [] and an untouched one not at all', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, { ...initial, clashes: [] })).toEqual({
      clashTimecodes: [],
    });
    expect(approveOverrides(initial, { ...initial, clashes: [80, 40] })).toEqual({});
    expect(approveOverrides(initial, { ...initial, clashes: [83.5, 40] })).toEqual({
      clashTimecodes: [40, 83.5],
    });
  });

  it('never send a blanked text field or an empty MPM', () => {
    const initial = initialReviewValues(correction);
    expect(approveOverrides(initial, { ...initial, title: '   ', bpm: '' })).toEqual({});
  });
});

describe('approvalPreview', () => {
  it('shows the fields that will change, from the current values', () => {
    expect(approvalPreview(correction, {})).toEqual({
      before: { bpm: 60 },
      after: { bpm: 62 },
    });
    expect(approvalPreview(correction, { clashTimecodes: [] })).toEqual({
      before: { bpm: 60, clashTimecodes: [40, 80] },
      after: { bpm: 62, clashTimecodes: [] },
    });
  });

  it('warns that the MPM is recalculated when only the dance is overridden', () => {
    expect(approvalPreview(correction, { style: 'Rumba' }).after).toEqual({
      style: 'Rumba',
      bpm: 'recalculé selon la danse',
    });
  });
});

describe('insertTemplate', () => {
  it('fills an empty comment, or appends on a new line', () => {
    expect(insertTemplate('', 'Déjà corrigé')).toBe('Déjà corrigé');
    expect(insertTemplate('Bonjour  ', 'Déjà corrigé')).toBe('Bonjour\nDéjà corrigé');
  });
});

describe('trackAudioUrl', () => {
  it('points at /uploads on the API origin, outside /api/v1, with an encoded name', () => {
    expect(trackAudioUrl('España Cañí.mp3')).toBe(
      `${API_ORIGIN}/uploads/Espa%C3%B1a%20Ca%C3%B1%C3%AD.mp3`,
    );
    expect(trackAudioUrl('x.mp3')).not.toContain('/api/v');
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib --testTimeout=60000`
Expected: FAIL (missing exports).

- [ ] **Step 2: Implement the helpers**

Append to `apps/admin/src/lib/apiError.ts`:

```ts
/** True for a 409 error body (the backend's global filter always sets statusCode). */
export function isConflict(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 409
  );
}
```

In `apps/admin/src/lib/moderation.ts`, replace the type import with:

```ts
import type {
  ApproveTrackCorrectionDto,
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from '../api/generated/types.gen';
import type { ModerationFilter } from '../api/queries';
import { API_ORIGIN } from '../config';
```

and append:

```ts
/** Reply templates: inserted in the comment, still editable. Not stored server-side. */
export const REJECT_TEMPLATES = [
  'Déjà corrigé',
  'Valeur incorrecte',
  "Doublon d'une autre proposition",
] as const;
export const APPROVE_TEMPLATES = ["Merci, c'est corrigé"] as const;

/** Fills an empty comment with the template, or appends it on a new line. */
export const insertTemplate = (comment: string, template: string): string =>
  comment.trim() ? `${comment.trimEnd()}\n${template}` : template;

/** Editable values of a pending proposal (`bpm` is '' while the input is empty). */
export interface ReviewValues {
  title: string;
  artist: string;
  style: string;
  bpm: number | string;
  clashes: number[];
}

/** The proposed value of each field, or the current one when nothing is proposed. */
export function initialReviewValues(c: TrackCorrectionAdminDto): ReviewValues {
  return {
    title: c.proposed.title ?? c.track.title,
    artist: c.proposed.artist ?? c.track.artist,
    style: c.proposed.style ?? c.track.style ?? '',
    bpm: c.proposed.bpm ?? c.resultingBpm,
    clashes: c.proposed.clashTimecodes ?? c.track.clashTimecodes,
  };
}

export type ApproveOverrides = Pick<
  ApproveTrackCorrectionDto,
  'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes'
>;

const sortedNumbers = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => {
  const x = sortedNumbers(a);
  const y = sortedNumbers(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Approve body: only what the admin changed. An absent field keeps the
 * proposal's value server-side; an emptied clash list is sent as `[]`
 * (« aucun clash »), an untouched one is not sent; a blanked text field or an
 * empty MPM is never sent.
 */
export function approveOverrides(initial: ReviewValues, values: ReviewValues): ApproveOverrides {
  const body: ApproveOverrides = {};
  for (const key of ['title', 'artist', 'style'] as const) {
    const text = values[key].trim();
    if (text && text !== initial[key]) body[key] = text;
  }
  if (typeof values.bpm === 'number' && values.bpm !== initial.bpm) body.bpm = values.bpm;
  if (!sameNumbers(values.clashes, initial.clashes)) {
    body.clashTimecodes = sortedNumbers(values.clashes);
  }
  return body;
}

const RECOMPUTED_BPM = 'recalculé selon la danse';

/**
 * Before → after of the track if approved with these overrides, changed
 * fields only. A dance override without an MPM makes the server recalculate
 * the MPM from the raw tempo, which the SPA cannot know.
 */
export function approvalPreview(
  c: TrackCorrectionAdminDto,
  overrides: ApproveOverrides,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const { track: t, proposed: p } = c;
  const current: Record<string, unknown> = {
    title: t.title,
    artist: t.artist,
    style: t.style,
    bpm: t.bpm,
    clashTimecodes: t.clashTimecodes,
  };
  const result: Record<string, unknown> = {
    title: overrides.title ?? p.title ?? t.title,
    artist: overrides.artist ?? p.artist ?? t.artist,
    style: overrides.style ?? p.style ?? t.style,
    bpm: overrides.bpm ?? (overrides.style !== undefined ? RECOMPUTED_BPM : c.resultingBpm),
    clashTimecodes: overrides.clashTimecodes ?? p.clashTimecodes ?? t.clashTimecodes,
  };
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(result)) {
    if (JSON.stringify(result[key]) !== JSON.stringify(current[key])) {
      before[key] = current[key];
      after[key] = result[key];
    }
  }
  return { before, after };
}

/** Same URL as the mobile player: `/uploads` is served outside `/api/v1`. */
export const trackAudioUrl = (filename: string): string =>
  `${API_ORIGIN}/uploads/${encodeURIComponent(filename)}`;
```

In `apps/admin/src/api/queries.ts`, add `trackCorrectionsControllerFindOne,` to the sdk import list and append:

```ts
export const correctionQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'moderation', 'item', id],
    queryFn: () => unwrap(trackCorrectionsControllerFindOne({ path: { id } })),
  });
```

Run: `pnpm --filter admin exec vitest run src/lib --testTimeout=60000`
Expected: PASS.

- [ ] **Step 3: Track labels in `ChangeSummary` — failing test first**

Append inside the `describe` of `apps/admin/src/components/ChangeSummary.test.tsx`:

```tsx
it('labels track fields and shows clashes as m:ss', () => {
  render(
    <MantineProvider>
      <ChangeSummary
        before={{ bpm: 60, clashTimecodes: [40, 80], style: 'Paso Doble' }}
        after={{ bpm: 62, clashTimecodes: [], style: 'Rumba' }}
      />
    </MantineProvider>,
  );
  expect(screen.getByText('MPM')).toBeInTheDocument();
  expect(screen.getByText('Clashes paso')).toBeInTheDocument();
  expect(screen.getByText('Danse')).toBeInTheDocument();
  expect(screen.getByText('0:40, 1:20')).toBeInTheDocument();
  expect(screen.getByText('Aucun clash')).toBeInTheDocument();
});
```

Run: `pnpm --filter admin exec vitest run src/components/ChangeSummary.test.tsx --testTimeout=60000`
Expected: FAIL (raw keys, raw seconds).

In `apps/admin/src/components/ChangeSummary.tsx`:

- Add `import { formatTimecode } from '../lib/moderation';` after the labels import.
- In `LABELS`, add after `registrationMode: "Mode d'inscription",`:

```ts
  title: 'Titre',
  artist: 'Artiste',
  style: 'Danse',
  bpm: 'MPM',
  clashTimecodes: 'Clashes paso',
  trackId: 'Musique',
```

- In `display`, insert as the second line (after the `null` / `undefined` check):

```ts
if (key === 'clashTimecodes' && Array.isArray(value)) {
  return value.length
    ? value.map((v) => (typeof v === 'number' ? formatTimecode(v) : String(v))).join(', ')
    : 'Aucun clash';
}
```

Run: `pnpm --filter admin exec vitest run src/components/ChangeSummary.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 4: Write the failing `ClashEditor` tests**

Create `apps/admin/src/components/ClashEditor.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { vi } from 'vitest';
import { ClashEditor } from './ClashEditor';

function Harness({ initial }: { initial: number[] }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [value, setValue] = useState(initial);
  return (
    <MantineProvider>
      <audio ref={ref} data-testid="audio" />
      <ClashEditor value={value} onChange={setValue} audioRef={ref} />
      <p data-testid="value">{JSON.stringify(value)}</p>
    </MantineProvider>
  );
}

const setTime = (seconds: number) =>
  Object.defineProperty(screen.getByTestId('audio'), 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  });

const value = () => screen.getByTestId('value').textContent;

describe('ClashEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the player time, rounded to 0.1 s, keeping the chips sorted', async () => {
    render(<Harness initial={[90]} />);
    setTime(83.46);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(value()).toBe('[83.5,90]');
    expect(screen.getByLabelText('Clash 1')).toHaveValue('1:23.5');
    expect(screen.getByLabelText('Clash 2')).toHaveValue('1:30');
  });

  it('refuses a 4th clash', async () => {
    render(<Harness initial={[10, 20, 30]} />);
    const mark = screen.getByRole('button', { name: 'Marquer ici' });
    expect(mark).toBeDisabled();
    expect(screen.getByText('3 clashes au maximum')).toBeInTheDocument();
    setTime(50);
    await userEvent.click(mark);
    expect(value()).toBe('[10,20,30]');
  });

  it('edits a chip in m:ss and flags an invalid one', async () => {
    render(<Harness initial={[40, 80]} />);
    const first = screen.getByLabelText('Clash 1');
    await userEvent.clear(first);
    await userEvent.type(first, '1:45');
    await userEvent.tab();
    expect(value()).toBe('[80,105]');
    const again = screen.getByLabelText('Clash 1');
    await userEvent.clear(again);
    await userEvent.type(again, 'abc');
    await userEvent.tab();
    expect(screen.getByText('Format m:ss')).toBeInTheDocument();
    expect(value()).toBe('[80,105]');
  });

  it('removes chips down to an empty list (« no clash »)', async () => {
    render(<Harness initial={[40]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer le clash 1' }));
    expect(value()).toBe('[]');
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
  });

  it('plays a chip from 3 s before it, never before 0', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<Harness initial={[2, 40]} />);
    setTime(0);
    await userEvent.click(screen.getByRole('button', { name: 'Écouter le clash 2' }));
    expect((screen.getByTestId('audio') as HTMLAudioElement).currentTime).toBe(37);
    await userEvent.click(screen.getByRole('button', { name: 'Écouter le clash 1' }));
    expect((screen.getByTestId('audio') as HTMLAudioElement).currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
```

Run: `pnpm --filter admin exec vitest run src/components/ClashEditor.test.tsx --testTimeout=60000`
Expected: FAIL (`Cannot find module './ClashEditor'`).

- [ ] **Step 5: Implement `ClashEditor`**

Create `apps/admin/src/components/ClashEditor.tsx`:

```tsx
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { type RefObject, useState } from 'react';
import { formatTimecode, MAX_CLASHES, parseTimecode, roundTenth } from '../lib/moderation';

/** Lead-in before a clash when it is played, to hear it coming. */
export const CLASH_LEAD_IN_SECONDS = 3;

const sortedUnique = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);

interface ClashEditorProps {
  value: number[];
  onChange: (next: number[]) => void;
  /** The page's `<audio>`: read for « Marquer ici », written to seek. */
  audioRef: RefObject<HTMLAudioElement | null>;
}

/** Paso doble clashes placed by ear: up to 3 chips in m:ss; an empty list means « no clash ». */
export function ClashEditor({ value, onChange, audioRef }: ClashEditorProps) {
  const [invalid, setInvalid] = useState<number | null>(null);
  const full = value.length >= MAX_CLASHES;

  const markHere = () => {
    const audio = audioRef.current;
    if (!audio || full) return;
    setInvalid(null);
    onChange(sortedUnique([...value, roundTenth(audio.currentTime)]));
  };

  const play = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds - CLASH_LEAD_IN_SECONDS);
    // Rejected when the browser blocks playback or the file is missing: the seek stays.
    void audio.play()?.catch(() => undefined);
  };

  const edit = (index: number, text: string) => {
    const seconds = parseTimecode(text);
    if (seconds === null) {
      setInvalid(index);
      return;
    }
    setInvalid(null);
    onChange(sortedUnique(value.map((v, i) => (i === index ? seconds : v))));
  };

  const remove = (index: number) => {
    setInvalid(null);
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Clashes paso
      </Text>
      {value.length === 0 && (
        <Text size="sm" c="dimmed">
          Aucun clash
        </Text>
      )}
      {value.map((seconds, index) => (
        <Group key={`${index}-${seconds}`} gap="xs" align="flex-start">
          <TextInput
            aria-label={`Clash ${index + 1}`}
            defaultValue={formatTimecode(seconds)}
            w={110}
            error={invalid === index ? 'Format m:ss' : undefined}
            onBlur={(e) => edit(index, e.currentTarget.value)}
          />
          <Button
            size="xs"
            variant="light"
            aria-label={`Écouter le clash ${index + 1}`}
            onClick={() => play(seconds)}
          >
            Écouter
          </Button>
          <Button
            size="xs"
            variant="subtle"
            color="red"
            aria-label={`Supprimer le clash ${index + 1}`}
            onClick={() => remove(index)}
          >
            Supprimer
          </Button>
        </Group>
      ))}
      <Group gap="xs">
        <Button size="xs" onClick={markHere} disabled={full}>
          Marquer ici
        </Button>
        {full && (
          <Text size="xs" c="dimmed">
            3 clashes au maximum
          </Text>
        )}
      </Group>
    </Stack>
  );
}
```

Run: `pnpm --filter admin exec vitest run src/components/ClashEditor.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 6: Write the failing detail page tests**

Create `apps/admin/src/pages/ModerationDetailPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { ModerationDetailPage } from './ModerationDetailPage';

const pendingMpm = {
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: 'Compté au métronome',
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'España Cañí.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
};

const pendingClash = {
  ...pendingMpm,
  reason: 'PASO_CLASH',
  proposed: { title: null, artist: null, style: null, bpm: null, clashTimecodes: [40] },
  resultingBpm: 60,
};

const decided = (status: 'APPROVED' | 'REJECTED', base: object = pendingMpm) => ({
  ...base,
  status,
  reviewer: { id: 'a1', name: 'Gabin S' },
  reviewedAt: '2026-10-07T09:30:00.000Z',
  reviewComment: 'Valeur incorrecte',
});

const ok = (data: unknown) => ({ data, error: undefined });

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(item: object, path = '/moderation/c1') {
  const findOne = vi
    .spyOn(sdk, 'trackCorrectionsControllerFindOne')
    .mockResolvedValue(ok(item) as never);
  vi.spyOn(sdk, 'trackCorrectionsControllerPendingCount').mockResolvedValue(
    ok({ count: 1 }) as never,
  );
  const view = render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/moderation/:id"
              element={
                <>
                  <ModerationDetailPage />
                  <Probe />
                </>
              }
            />
            <Route path="/moderation" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, findOne };
}

const audioOf = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;

const setTime = (audio: HTMLAudioElement, seconds: number) =>
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  });

async function submitDecision(decision: 'Approuver' | 'Refuser') {
  await userEvent.click(screen.getByRole('button', { name: decision }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
  return dialog;
}

describe('ModerationDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the track file cross-origin from the API origin and shows current vs proposed', async () => {
    const { container } = renderPage(pendingMpm);
    expect(await screen.findByRole('heading', { name: 'España Cañí' })).toBeInTheDocument();
    const audio = audioOf(container);
    expect(audio).toHaveAttribute('src', `${API_ORIGIN}/uploads/Espa%C3%B1a%20Ca%C3%B1%C3%AD.mp3`);
    expect(audio).toHaveAttribute('crossorigin', 'anonymous');
    expect(audio.getAttribute('src')).not.toContain('/api/v');
    expect(screen.getByText('Compté au métronome')).toBeInTheDocument();
    expect(screen.getByText(/Eva Martin/)).toBeInTheDocument();
    setTime(audio, 83.46);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('Position : 1:23.5')).toBeInTheDocument();
  });

  it('approves with an adjusted MPM after a before → after confirmation', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED')) as never);
    renderPage(pendingMpm);
    const mpm = await screen.findByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '61');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('MPM');
    expect(dialog).toHaveTextContent('60');
    expect(dialog).toHaveTextContent('61');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { bpm: 61 } });
    expect(await screen.findByText(/Traitée par Gabin S/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proposition suivante' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it('leaves untouched values to the proposal', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED')) as never);
    renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    await submitDecision('Approuver');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: {} });
  });

  it('rejects with a template, still editable', async () => {
    const reject = vi
      .spyOn(sdk, 'trackCorrectionsControllerReject')
      .mockResolvedValue(ok(decided('REJECTED')) as never);
    renderPage(pendingMpm);
    await userEvent.click(await screen.findByRole('button', { name: 'Valeur incorrecte' }));
    const comment = screen.getByLabelText(/^Commentaire/);
    expect(comment).toHaveValue('Valeur incorrecte');
    await userEvent.type(comment, ' : 60 est juste');
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('La musique ne sera pas modifiée.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(reject).toHaveBeenCalledWith({
      path: { id: 'c1' },
      body: { comment: 'Valeur incorrecte : 60 est juste' },
    });
  });

  it('places a clash from the player time and sends the list', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingClash)) as never);
    const { container } = renderPage(pendingClash);
    await screen.findByLabelText('Clash 1');
    setTime(audioOf(container), 83.46);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(screen.getByLabelText('Clash 2')).toHaveValue('1:23.5');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('0:40, 1:23.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(approve).toHaveBeenCalledWith({
      path: { id: 'c1' },
      body: { clashTimecodes: [40, 83.5] },
    });
  });

  it('sends an emptied clash list as « no clash »', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingClash)) as never);
    renderPage(pendingClash);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le clash 1' }));
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
    await submitDecision('Approuver');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { clashTimecodes: [] } });
  });

  it('refuses a 4th clash in the editor', async () => {
    const { container } = renderPage(pendingMpm);
    await screen.findByLabelText('Clash 2');
    setTime(audioOf(container), 100);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(screen.getByRole('button', { name: 'Marquer ici' })).toBeDisabled();
    expect(screen.getByText('3 clashes au maximum')).toBeInTheDocument();
  });

  it('says « Déjà traitée » on a 409 and reloads the proposal', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerApprove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'Cette proposition a déjà été traitée.' },
      response: new Response(null, { status: 409 }),
    } as never);
    const { findOne } = renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    // First load done: the reload after the 409 sees the other admin's decision.
    findOne.mockResolvedValue(ok(decided('APPROVED')) as never);
    await submitDecision('Approuver');
    expect(await screen.findByText('Déjà traitée')).toBeInTheDocument();
    expect(await screen.findByText(/Traitée par Gabin S/)).toBeInTheDocument();
    await waitFor(() => expect(findOne).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it('shows a decided proposal read-only', async () => {
    renderPage(decided('REJECTED'));
    expect(await screen.findByText('Refusée')).toBeInTheDocument();
    expect(screen.getByText(/Traitée par Gabin S le 07\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Commentaire : Valeur incorrecte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
    expect(screen.queryByLabelText('MPM')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Proposition suivante' })).toBeNull();
  });

  it('« Proposition suivante » opens the oldest pending one matching the filters', async () => {
    const next = { ...pendingMpm, id: 'c2' };
    vi.spyOn(sdk, 'trackCorrectionsControllerReject').mockResolvedValue(
      ok(decided('REJECTED')) as never,
    );
    const list = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(
        ok({ data: [next], meta: { total: 1, skip: 0, take: 1, hasMore: false } }) as never,
      );
    const { findOne } = renderPage(pendingMpm, '/moderation/c1?status=REJECTED&reason=MPM&q=paso');
    findOne.mockImplementation((({ path }: { path: { id: string } }) =>
      Promise.resolve(ok(path.id === 'c1' ? pendingMpm : next))) as never);
    await screen.findByLabelText('MPM');
    await submitDecision('Refuser');
    await userEvent.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
    expect(list).toHaveBeenCalledWith({
      query: { status: 'PENDING', reason: ['MPM'], q: 'paso', skip: 0, take: 1 },
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/moderation/c2?status=REJECTED&reason=MPM&q=paso',
      ),
    );
    expect(await screen.findByRole('button', { name: 'Approuver' })).toBeInTheDocument();
  });

  it('goes back to the list when nothing is pending anymore', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerReject').mockResolvedValue(
      ok(decided('REJECTED')) as never,
    );
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(
      ok({ data: [], meta: { total: 0, skip: 0, take: 1, hasMore: false } }) as never,
    );
    renderPage(pendingMpm, '/moderation/c1?reason=MPM');
    await screen.findByLabelText('MPM');
    await submitDecision('Refuser');
    await userEvent.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/moderation?reason=MPM'),
    );
  });

  it('shows the shared message when the server is unreachable', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerFindOne').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/moderation/c1']}>
            <Routes>
              <Route path="/moderation/:id" element={<ModerationDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/pages/ModerationDetailPage.test.tsx --testTimeout=60000`
Expected: FAIL (`Cannot find module './ModerationDetailPage'`).

- [ ] **Step 7: Implement the detail page and its route**

Create `apps/admin/src/pages/ModerationDetailPage.tsx`:

```tsx
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { type RefObject, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  trackCorrectionsControllerApprove,
  trackCorrectionsControllerReject,
} from '../api/generated/sdk.gen';
import type { TrackCorrectionAdminDto } from '../api/generated/types.gen';
import { correctionQuery, moderationListQuery, pendingCountQuery, unwrap } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { ClashEditor } from '../components/ClashEditor';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import {
  APPROVE_TEMPLATES,
  approvalPreview,
  approveOverrides,
  formatTimecode,
  initialReviewValues,
  insertTemplate,
  nextPendingFilter,
  REASON_LABELS,
  REJECT_TEMPLATES,
  type ReviewValues,
  STATUS_BADGES,
  trackAudioUrl,
} from '../lib/moderation';

type Decision = 'approve' | 'reject';

type ComparedField = 'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes';

const FIELDS: { key: ComparedField; label: string }[] = [
  { key: 'title', label: 'Titre' },
  { key: 'artist', label: 'Artiste' },
  { key: 'style', label: 'Danse' },
  { key: 'bpm', label: 'MPM' },
  { key: 'clashTimecodes', label: 'Clashes paso' },
];

function show(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => formatTimecode(Number(v))).join(', ') : 'Aucun clash';
  }
  return String(value);
}

export function ModerationDetailPage() {
  const { id = '' } = useParams();
  // A new id (« Proposition suivante ») starts from a fresh form.
  return <CorrectionReview key={id} id={id} />;
}

function CorrectionReview({ id }: { id: string }) {
  const { search } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const [decided, setDecided] = useState(false);
  const [conflict, setConflict] = useState(false);
  const item = useQuery(correctionQuery(id));

  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'moderation', 'list'] });
    void qc.invalidateQueries({ queryKey: pendingCountQuery.queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const next = useMutation({
    mutationFn: async () => {
      const page = await qc.fetchQuery(moderationListQuery(nextPendingFilter(params)));
      return page.data[0]?.id ?? null;
    },
    onSuccess: (nextId) =>
      navigate(nextId ? `/moderation/${nextId}${search}` : `/moderation${search}`),
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, 'Impossible de charger la proposition suivante.'),
      }),
  });

  if (item.isError) {
    return <Alert color="red">{apiErrorMessage(item.error, 'Proposition introuvable.')}</Alert>;
  }
  if (!item.data) return <Loader />;
  const c = item.data;
  const badge = STATUS_BADGES[c.status];

  return (
    <Stack>
      <Anchor component={Link} to={`/moderation${search}`}>
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{c.track.title}</Title>
          {c.track.titleMasked && (
            <Badge color="gray" variant="light">
              Titre masqué
            </Badge>
          )}
          {c.track.blacklisted && (
            <Badge color="red" variant="light">
              Retirée
            </Badge>
          )}
        </Group>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed">
        {c.track.artist} · {REASON_LABELS[c.reason]} · proposée par{' '}
        {c.proposer?.name ?? 'un compte supprimé'} le{' '}
        {dayjs(c.createdAt).format('DD/MM/YYYY HH:mm')}
      </Text>
      {conflict && <Alert color="orange">Déjà traitée</Alert>}
      {(decided || conflict) && (
        <Group>
          <Button loading={next.isPending} onClick={() => next.mutate()}>
            Proposition suivante
          </Button>
        </Group>
      )}
      <Card withBorder>
        <Stack gap="xs">
          <audio
            ref={audioRef}
            controls
            preload="metadata"
            // CORS load: helmet's Cross-Origin-Resource-Policy: same-origin
            // blocks a no-cors media load from the back-office origin.
            crossOrigin="anonymous"
            src={trackAudioUrl(c.track.filename)}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            style={{ width: '100%' }}
          />
          <Text size="sm" c="dimmed">
            Position : {formatTimecode(position)}
          </Text>
        </Stack>
      </Card>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Champ</Table.Th>
            <Table.Th>Actuel</Table.Th>
            <Table.Th>Proposé</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {FIELDS.map(({ key, label }) => (
            <Table.Tr key={key}>
              <Table.Td>{label}</Table.Td>
              <Table.Td>{show(c.track[key])}</Table.Td>
              <Table.Td>{show(c.proposed[key])}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Card withBorder>
        <Text size="sm" fw={500}>
          Message de l'auteur
        </Text>
        <Text size="sm">{c.message ?? '—'}</Text>
      </Card>
      {c.status === 'PENDING' ? (
        <DecisionForm
          c={c}
          audioRef={audioRef}
          onDecided={(updated) => {
            qc.setQueryData(correctionQuery(id).queryKey, updated);
            refreshAfterDecision();
            setDecided(true);
          }}
          onConflict={() => {
            setConflict(true);
            refreshAfterDecision();
            void qc.invalidateQueries({ queryKey: correctionQuery(id).queryKey });
          }}
        />
      ) : (
        <Card withBorder>
          <Stack gap={4}>
            <Text size="sm">
              Traitée par {c.reviewer?.name ?? 'un admin supprimé'}
              {c.reviewedAt && ` le ${dayjs(c.reviewedAt).format('DD/MM/YYYY HH:mm')}`}
            </Text>
            <Text size="sm">Commentaire : {c.reviewComment ?? '—'}</Text>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

interface DecisionFormProps {
  c: TrackCorrectionAdminDto;
  audioRef: RefObject<HTMLAudioElement | null>;
  onDecided: (updated: TrackCorrectionAdminDto) => void;
  onConflict: () => void;
}

function DecisionForm({ c, audioRef, onDecided, onConflict }: DecisionFormProps) {
  const [initial] = useState<ReviewValues>(() => initialReviewValues(c));
  const [values, setValues] = useState<ReviewValues>(initial);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const overrides = approveOverrides(initial, values);
  const preview = approvalPreview(c, overrides);
  const trimmed = comment.trim();

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decision === 'approve'
        ? unwrap(
            trackCorrectionsControllerApprove({
              path: { id: c.id },
              body: { ...overrides, ...(trimmed && { comment: trimmed }) },
            }),
          )
        : unwrap(
            trackCorrectionsControllerReject({
              path: { id: c.id },
              body: trimmed ? { comment: trimmed } : {},
            }),
          ),
    onSuccess: (updated, decision) => {
      setConfirm(null);
      notifications.show({
        color: 'green',
        message: decision === 'approve' ? 'Proposition approuvée' : 'Proposition refusée',
      });
      onDecided(updated);
    },
    onError: (e) => {
      if (isConflict(e)) {
        setConfirm(null);
        onConflict();
      }
    },
  });

  const set = <K extends keyof ReviewValues>(key: K, value: ReviewValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const open = (decision: Decision) => {
    decide.reset();
    setConfirm(decision);
  };
  const template = (text: string) => (
    <Button
      key={text}
      size="xs"
      variant="light"
      onClick={() => setComment((prev) => insertTemplate(prev, text))}
    >
      {text}
    </Button>
  );

  return (
    <>
      <Card withBorder>
        <Stack>
          <Title order={4}>Valeurs à appliquer</Title>
          <SimpleGrid cols={2}>
            <TextInput
              label="Titre"
              value={values.title}
              onChange={(e) => set('title', e.currentTarget.value)}
            />
            <TextInput
              label="Artiste"
              value={values.artist}
              onChange={(e) => set('artist', e.currentTarget.value)}
            />
            <TextInput
              label="Danse"
              value={values.style}
              onChange={(e) => set('style', e.currentTarget.value)}
            />
            <NumberInput
              label="MPM"
              min={1}
              max={400}
              decimalScale={1}
              value={values.bpm}
              onChange={(v) => set('bpm', v)}
            />
          </SimpleGrid>
          <ClashEditor
            value={values.clashes}
            onChange={(v) => set('clashes', v)}
            audioRef={audioRef}
          />
          <Textarea
            label="Commentaire (transmis à l'auteur)"
            autosize
            minRows={2}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
          />
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Refus :
            </Text>
            {REJECT_TEMPLATES.map(template)}
            <Text size="sm" c="dimmed">
              Validation :
            </Text>
            {APPROVE_TEMPLATES.map(template)}
          </Group>
          <Group justify="flex-end">
            <Button color="red" variant="light" onClick={() => open('reject')}>
              Refuser
            </Button>
            <Button color="green" onClick={() => open('approve')}>
              Approuver
            </Button>
          </Group>
        </Stack>
      </Card>
      <Modal
        opened={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'approve' ? 'Confirmer la validation' : 'Confirmer le refus'}
      >
        <Stack>
          {confirm === 'approve' &&
            (Object.keys(preview.after).length > 0 ? (
              <ChangeSummary before={preview.before} after={preview.after} />
            ) : (
              <Text size="sm">La musique ne change pas.</Text>
            ))}
          {confirm === 'reject' && <Text size="sm">La musique ne sera pas modifiée.</Text>}
          {trimmed && <Text size="sm">Commentaire : {trimmed}</Text>}
          {decide.isError && !isConflict(decide.error) && (
            <Alert color="red">{apiErrorMessage(decide.error, 'Décision impossible.')}</Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Annuler
            </Button>
            <Button loading={decide.isPending} onClick={() => confirm && decide.mutate(confirm)}>
              Confirmer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
```

In `apps/admin/src/router.tsx`, add `import { ModerationDetailPage } from './pages/ModerationDetailPage';` next to the `ModerationPage` import, and add after `{ path: 'moderation', element: <ModerationPage /> },`:

```tsx
      { path: 'moderation/:id', element: <ModerationDetailPage /> },
```

Run: `pnpm --filter admin exec vitest run src/pages/ModerationDetailPage.test.tsx src/components src/lib --testTimeout=60000`
Expected: PASS.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
git add apps/admin/src
git commit -m "feat(admin): moderation detail with audio player, clash editor and reply templates

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 6: CSP, audit-log link, runbook and full verification

**Files:**

- Modify: `apps/admin/public/staticwebapp.config.json` (l. 7)
- Create: `apps/admin/src/csp.test.ts`
- Modify: `apps/admin/src/pages/AuditLogPage.tsx` (`Target`, l. 13-29), `apps/admin/src/pages/AuditLogPage.test.tsx` (append)
- Modify: `docs/exploitation/backoffice-admin.md` (Objet l. 8-25, new section after « Clubs » l. 132-157, « Journal d'audit » l. 363-391, « Coût » l. 392-424)

**Interfaces:**

- Consumes: `ACTION_LABELS` (Task 3), the `/moderation/:id` route (Task 5).
- Produces: CSP with `media-src`; audit rows on `TRACK_CORRECTION` link to `/moderation/<id>` with « Voir la proposition »; French runbook.

- [ ] **Step 1: Write the failing CSP and audit-log tests**

Create `apps/admin/src/csp.test.ts`:

```ts
import config from '../public/staticwebapp.config.json';

describe('Static Web App CSP', () => {
  const csp = config.globalHeaders['Content-Security-Policy'];

  it('lets <audio> load track files from both API origins', () => {
    expect(csp).toContain(
      "media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr",
    );
  });

  it('keeps the API reachable for fetch', () => {
    expect(csp).toContain(
      "connect-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr",
    );
  });
});
```

Append inside `describe('AuditLogPage', ...)` of `apps/admin/src/pages/AuditLogPage.test.tsx`:

```tsx
it('links a moderation decision to its proposal, with a French label', async () => {
  vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
    data: {
      data: [
        {
          id: 'l4',
          action: 'TRACK_CORRECTION_REJECT',
          targetType: 'TRACK_CORRECTION',
          targetId: 'c1',
          before: null,
          after: { trackId: 't1' },
          actorId: 'a1',
          actorName: 'Gabin S',
          createdAt: '2026-10-09T10:00:00.000Z',
        },
      ],
      meta: { total: 1, skip: 0, take: 50, hasMore: false },
    },
    error: undefined,
  } as never);
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuditLogPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  expect(await screen.findByText('Proposition refusée')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir la proposition' })).toHaveAttribute(
    'href',
    '/moderation/c1',
  );
  expect(screen.getByText('Musique')).toBeInTheDocument();
});
```

Run: `pnpm --filter admin exec vitest run src/csp.test.ts src/pages/AuditLogPage.test.tsx --testTimeout=60000`
Expected: FAIL (no `media-src`; the moderation target links to `/clubs/c1` as « Voir le club »).

- [ ] **Step 2: CSP and audit-log link**

In `apps/admin/public/staticwebapp.config.json`, replace the `Content-Security-Policy` value with:

```json
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
```

In `apps/admin/src/pages/AuditLogPage.tsx`, after the `DELETIONS` constant, add:

```tsx
const TARGET_LINKS: Record<AuditLogEntryDto['targetType'], { path: string; label: string }> = {
  USER: { path: 'users', label: 'Voir la fiche' },
  CLUB: { path: 'clubs', label: 'Voir le club' },
  TRACK_CORRECTION: { path: 'moderation', label: 'Voir la proposition' },
};
```

and replace the end of `Target` (from `const isUser = …` to the closing `);` of its `return`) with:

```tsx
const link = TARGET_LINKS[entry.targetType];
return (
  <Anchor component={Link} to={`/${link.path}/${entry.targetId}`}>
    {link.label}
  </Anchor>
);
```

Run: `pnpm --filter admin exec vitest run src/csp.test.ts src/pages/AuditLogPage.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 3: Commit the SPA changes**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
git add apps/admin/public/staticwebapp.config.json apps/admin/src
git commit -m "feat(admin): allow track audio in the CSP and link moderation audit rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

- [ ] **Step 4: Runbook (French)**

In `docs/exploitation/backoffice-admin.md`:

1. In **Objet**, replace `plateforme. Lots 1 et 1b :` with `plateforme. Lots 1, 1b, 1c et 2 :`, and insert before the line `- journal d'audit de toutes les écritures admin.`:

```markdown
- modération des propositions de correction des musiques : écoute de la
  musique, ajustement des valeurs proposées, placement des clashs paso à
  l'oreille, validation ou refus avec commentaire ;
```

2. Insert a new section between the end of **Clubs** and `## Hébergement`:

```markdown
## Modération

Écran « Modération » : la file des propositions de correction des musiques
envoyées depuis l'app (titre, artiste, danse, MPM, clashs paso doble). L'écran
de revue de l'app mobile reste disponible ; les deux agissent sur les mêmes
données.

- **Mêmes routes que l'app mobile**, toutes réservées au rôle `ADMIN` :
  `GET /track-corrections` (filtres `status`, `reason`, `q`),
  `GET /track-corrections/:id`, `GET /track-corrections/pending-count`,
  `POST /track-corrections/:id/approve` et `POST /track-corrections/:id/reject`.
  Une décision prise sur le web ou sur mobile a exactement le même effet
  (application à la musique, notification de l'auteur, journal d'audit).
- **Badge du menu** : nombre de propositions en attente, relu à chaque
  changement de page et après chaque décision. Aucun rafraîchissement
  périodique : le backend est en scale-to-zero (voir « Coût »).
- **Liste** : statut (« À traiter » par défaut, « Approuvées », « Refusées »),
  motifs (plusieurs possibles) et recherche sur le titre ou l'artiste
  (2 caractères au moins, sans tenir compte de la casse). Les filtres sont dans
  l'URL : un lien copié rouvre la même vue.
- **Détail** :
  - lecteur audio de la musique (`<API>/uploads/<fichier>`, le même fichier que
    l'app) ;
  - valeurs actuelles et proposées, message de l'auteur ;
  - les valeurs proposées sont modifiables avant validation. Seules les
    valeurs changées par l'admin sont envoyées ; les autres restent celles de
    la proposition ;
  - **clashs paso** : 3 au plus, au format `m:ss`. « Marquer ici » ajoute la
    position du lecteur (au dixième de seconde) ; chaque clash peut être
    corrigé, supprimé ou réécouté (lecture 3 s avant). Une liste vide est
    valide : la musique est alors enregistrée **sans clash** ;
  - modèles de réponse (« Déjà corrigé », « Valeur incorrecte », « Doublon
    d'une autre proposition », « Merci, c'est corrigé ») insérés dans le
    commentaire, qui reste modifiable. Ils sont définis dans le code
    (`apps/admin/src/lib/moderation.ts`) : ni table, ni écran de gestion ;
  - confirmation avant → après, puis « Proposition suivante » : la plus
    ancienne proposition **en attente** qui correspond aux motifs et à la
    recherche de la liste (retour à la liste s'il n'y en a plus).
- **Double décision** (deux admins, ou web et mobile) : la seconde reçoit
  409 ; l'écran affiche « Déjà traitée » et recharge la proposition.
- **Lecture audio : CSP et CORS.**
  - La CSP du back-office (`apps/admin/public/staticwebapp.config.json`)
    autorise `media-src` sur les deux API (staging et prod).
  - Le lecteur charge le fichier en mode CORS (`crossorigin="anonymous"`) : le
    backend envoie `Cross-Origin-Resource-Policy: same-origin` (helmet), qui
    bloquerait un chargement sans CORS depuis `admin.ffd.gabin-simond.fr`.
    L'origine admin doit donc figurer dans `CORS_ORIGINS` (voir « CORS »),
    ce qui est déjà requis pour l'API.
  - Si une musique ne se lit pas, ouvrir la console du navigateur : une
    erreur CORS signale une origine manquante dans `CORS_ORIGINS` ; une 404
    sur `/uploads/…` signale un fichier absent du blob `tracks`.
```

3. In **Journal d'audit**, replace

```markdown
- `action` : `USER_UPDATE`, `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`,
  `USER_DELETE`, `INVITATION_RESEND`, `CLUB_UPDATE`, `CLUB_DISABLE`,
  `CLUB_ENABLE`, `CLUB_DELETE` (`CLUB_ACCOUNT_CREATE` reste lisible pour les
  lignes du lot 1) ;
- `targetType` / `targetId` : l'objet modifié ;
```

with

```markdown
- `action` : `USER_UPDATE`, `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`,
  `USER_DELETE`, `INVITATION_RESEND`, `CLUB_CREATE`, `CLUB_UPDATE`,
  `CLUB_DISABLE`, `CLUB_ENABLE`, `CLUB_DELETE`, `TRACK_CORRECTION_APPROVE`,
  `TRACK_CORRECTION_REJECT` (`CLUB_ACCOUNT_CREATE` reste lisible pour les
  lignes du lot 1) ;
- `targetType` / `targetId` : l'objet modifié (`USER`, `CLUB`, ou
  `TRACK_CORRECTION` avec l'identifiant de la proposition) ;
- décisions de modération, **prises sur le web ou sur mobile** : les champs
  de la musique réellement modifiés par la validation (titre, artiste,
  danse, MPM, clashs), relus après application (un MPM recalculé par un
  changement de danse y figure), et `trackId` ; un refus ne contient que
  `trackId`. **Jamais** le message de l'auteur ni le commentaire de l'admin
  (texte libre pouvant contenir des données personnelles). Aucune ligne si
  la décision échoue (409, 404) ;
```

and in the bullet `- Consultation : écran « Journal d'audit » du back-office (filtres par admin et par cible) et historique sur la fiche de chaque utilisateur.`, append before the final period: `, avec un lien vers la proposition pour une décision de modération`.

4. In **Coût**, insert after the **Backend** bullet (before `- **Logs :**`):

```markdown
- **Modération :** aucun coût nouveau (ni job, ni infrastructure, ni
  polling). Le badge relit le compteur existant à la navigation ; écouter une
  musique lit le fichier depuis le blob `tracks` via `/uploads`, comme l'app.
```

Run: `pnpm exec prettier --check docs/exploitation/backoffice-admin.md` — expected: PASS (run `--write` if not, then re-check).

```bash
git add docs/exploitation/backoffice-admin.md
git commit -m "docs(admin): moderation runbook for the back-office

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

- [ ] **Step 5: Full verification**

```bash
pnpm --filter client exec jest src/features/track-corrections
cd apps/backend && pnpm exec jest --config "${TMPDIR:-/tmp}/jest-e2e-nodb.json" --runInBand --forceExit admin.e2e-spec && cd ../..
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit track-corrections.integration-spec admin.integration-spec'
pnpm preflight
```

Expected: all green — mobile review tests unchanged, mocked e2e, real-DB integration, then `pnpm preflight` (typecheck + lint + format + tests + audit). If `jest-e2e-nodb.json` is missing in `$TMPDIR`, recreate it with the command of "How to run tests".

---

## Final verification (after Task 6)

- [ ] `pnpm preflight` green; mocked e2e and real-DB integration green (Task 6 Step 5).
- [ ] `test-verifier`, then `code-reviewer` + `security-reviewer` in parallel on the branch diff (ADMIN-only routes, audit content with no free text, CSP change, cross-origin audio are in scope).
- [ ] Manual smoke on a local stack (`docker compose --profile infra up -d`; `CORS_ORIGINS=http://localhost:5173 pnpm --filter backend start:dev`; `VITE_API_URL=http://localhost:3000/api/v1 pnpm --filter admin dev`), with a track whose file is in `apps/backend/uploads/`: open « Modération », filter by reason and search, open a proposal, play and seek, « Marquer ici » twice, remove one clash, approve with a template, check « Proposition suivante », reject another, and read both rows in « Journal d'audit ». If the audio does not play, read the browser console and report (do not change `main.ts` in this lot without the user's approval).
- [ ] Ask the user before pushing `feature/admin-lot2-moderation` and opening the PR to `develop`. Backend and SPA can ship in either order: the API changes are additive and the mobile app is unaffected.

---

## Self-review

**Spec coverage**

| Spec                                                                                       | Task        |
| ------------------------------------------------------------------------------------------ | ----------- |
| §1 badge, filter by reason, search, listen, adjust, place clashes, approve/reject, next    | 4, 5        |
| §2 extend `track-corrections`, no duplicate controller                                     | 1           |
| §2 audit written in the service (web + mobile)                                             | 2           |
| §2 templates as an SPA constant; badge on load and after decision, no polling              | 4, 5        |
| §3 existing behaviour kept (order, 409, notification, value rules)                         | 1, 2        |
| §4 `reason` repeatable/comma-separated, enum-validated                                     | 1           |
| §4 `q` trimmed 2–100, case-insensitive title OR artist; no-filter output unchanged; `take` | 1           |
| §4 `GET /track-corrections/:id`, 404                                                       | 1           |
| §4 audit actions, target type, before/after, no free text, no row on failure, no migration | 2           |
| §4 audit-log `targetType=TRACK_CORRECTION`                                                 | 2           |
| §4 CSP `media-src`                                                                         | 6           |
| §5 menu « Modération » with badge                                                          | 4           |
| §5 list filters in the URL, table, `titleMasked`, error alert with shared message          | 4           |
| §5 detail: player, comparison, message, overrides, clash editor, templates, confirmation   | 5           |
| §5 409 « Déjà traitée » + reload; read-only decided view; « Proposition suivante »         | 5           |
| §6 backend unit, real-DB, mocked e2e, SPA tests, mobile green, thresholds                  | 1-6         |
| §7 ADMIN-only, metadata-only audit, `/uploads` public                                      | 1, 2, 6     |
| §8 cost: none                                                                              | 6 (runbook) |
| Track filename for the audio URL (not in the DTO before)                                   | 1, 3        |
| Swagger regen + both clients                                                               | 3           |
| Runbook                                                                                    | 6           |

**Decisions taken where the spec was silent:**

- **Reject had no transaction**; the spec says "inside the existing transaction". Claim and audit row now share one interactive `$transaction`, so a 409 leaves no row.
- **"Fields actually changed"** is computed by reading `title`, `artist`, `style`, `bpm`, `clashTimecodes` before and after `updateTrack` inside the transaction and diffing with the existing `diffFields`; an approval that changes nothing logs `{ trackId }` on both sides.
- **Module wiring**: a new `AdminAuditModule` exports `AdminAuditService`; `AdminModule` imports it instead of providing the service.
- **Filename**: absent from the admin DTO; added as a required `track.filename` (additive). The two mobile test fixtures typed on the generated DTO gain the field.
- **Cross-origin audio**: helmet's default `Cross-Origin-Resource-Policy: same-origin` would block `<audio>` from the admin origin even with the CSP change; the player uses `crossOrigin="anonymous"` so the existing CORS allow-list applies, and the backend stays unchanged.
- **`titleMasked` in the list**: the admin sees the real title with a « Titre masqué » badge (and « Retirée » for a blacklisted track).
- **Timecode format**: `m:ss`, with `.d` only when the tenth is not zero; the editor also accepts plain seconds and a comma decimal.
- **Template insertion**: fills an empty comment or appends on a new line.
- **« Proposition suivante »** always looks among **pending** proposals with the list's reasons and search, whatever status/page the list shows; the button appears after a decision or a 409.
- **Short search**: fewer than 2 characters is never sent; the API answers 400 to it.
- **Approve body**: only fields the admin changed; blank text and empty MPM are not sent; the confirmation shows « recalculé selon la danse » for the MPM when only the dance is overridden.
- Audit labels: « Proposition approuvée » / « Proposition refusée »; target link « Voir la proposition ».

**Placeholder scan:** no TBD/TODO; every code step carries the code; every run step names the command and the expected result.

**Type consistency:** `ListTrackCorrectionsQueryDto.reason` / `q` (Task 1) produce the `TrackCorrectionsControllerListData['query']` used as `ModerationFilter` (Tasks 4-5). `findOne` (Task 1) produces `trackCorrectionsControllerFindOne` (checked in Task 3, used by `correctionQuery` in Task 5). `trackCorrectionAuditTrackSelect` and the `AdminAuditService` constructor argument (Task 2) match the spec mocks in the same task. `AUDIT_ACTIONS` / `AUDIT_TARGET_TYPES` (Task 2) drive `ACTION_LABELS` (Task 3) and `TARGET_LINKS` (Task 6). `moderationListQuery` / `pendingCountQuery` (Task 4) are reused by the detail page (Task 5). `formatTimecode`, `parseTimecode`, `roundTenth`, `MAX_CLASHES`, `nextPendingFilter`, `STATUS_BADGES`, `REASON_LABELS` (Task 4) are defined before Task 5 uses them; `ReviewValues`, `approveOverrides`, `approvalPreview`, `initialReviewValues`, `insertTemplate`, `trackAudioUrl`, `isConflict`, `correctionQuery` (Task 5) are defined in the step before the page that uses them.

**Review Focus check:** each line has its pinning test in the task that owns the code — route order (Task 1 e2e), query-string shape (Task 1 DTO + e2e, Task 4 list), audit content and atomicity (Task 2 unit + real-DB), cross-origin audio (Task 5 detail test on `src` / `crossorigin`, Task 6 CSP test), approve body semantics (Task 5 `approveOverrides` + detail tests).
