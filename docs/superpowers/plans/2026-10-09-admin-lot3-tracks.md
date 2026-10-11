# Admin back-office — Lot 3 (tracks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage the track library from the web back-office: a « Musiques » catalogue that shows every track (blacklisted, pending, failed and ambiance ones included) with filters kept in the URL, a detail page to listen, edit, place paso clashes, mask, blacklist and delete a track, and a bulk import page that pre-fills a review table from a track-prep output folder (or plain MP3 files) in the browser and uploads one file per request. Every create, edit, mask, blacklist and delete, web or mobile, is written to the audit log.

**Architecture:** An additive `Track.contentHash` column (unique) stores the SHA-256 of imported audio. `TracksService` writes `TRACK_UPDATE` / `TRACK_DELETE` audit rows inside the write transaction, so the mobile `PATCH` / `DELETE /tracks/:id` are audited too; the correction-approval path passes `skipAudit` because it already writes `TRACK_CORRECTION_APPROVE`; `DELETE` answers 409 while PENDING corrections exist. A new `TrackFilesService` stores and deletes track files (blob `tracks` container behind a circuit breaker + timeout, or `uploads/` on disk without blob). A new `AdminTracksController` (`/admin/tracks`, class-level ADMIN guards) serves the catalogue through `AdminTracksQueryService` and the import through `TrackImportService` (multer memory storage with a route-scoped size limit, magic-byte validation, server-side SHA-256, dedup by `sourceKey` / hash, server-generated names, blob cleanup on failure, `BpmService` when no raw tempo is given). The admin SPA gets a regenerated client, a catalogue list and detail page reusing lot 2's `ClashEditor` and audio pattern, an MPM preview that mirrors the backend rule (pinned by a shared fixture), and an import page built on pure helpers (`lib/trackImport.ts`, an in-house ID3 reader `lib/id3.ts`, Web Crypto hashing in `lib/files.ts`).

**Tech Stack:** NestJS 11, Prisma 7.10 / PostgreSQL 15, multer 2.4 (`@nestjs/platform-express` 11.2), opossum, Jest 29 + supertest; React 19, Vite 8, Mantine 8, TanStack Query 5, React Router 7, Vitest 4 + Testing Library (jsdom 27); `@hey-api/openapi-ts` 0.99.

**Spec:** `docs/superpowers/specs/2026-10-09-admin-lot3-tracks-design.md` (binding). Lot 2 plan, for conventions: `/Users/gabin/Development/FFD-Connect-lot2/docs/superpowers/plans/2026-10-09-admin-lot2-moderation.md`. Lot 1b plan, for the offline migration: `docs/superpowers/plans/2026-10-07-admin-lot1b-accounts-clubs.md`.

**Worktree:** `/Users/gabin/Development/FFD-Connect-lot3`, branch `feature/admin-lot3-tracks` (develop `5d7b766` + spec commit `796eacc`). All paths below are relative to it unless absolute.

## Global Constraints

- Every new endpoint is `ADMIN`-only: `AdminTracksController` carries `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` **at class level** (as `AdminController`), `@Controller("admin/tracks")`. `PATCH` / `DELETE /tracks/:id` keep their per-method ADMIN guards and stay shared with the mobile app.
- Migration: additive only, `Track.contentHash String? @unique`, produced offline with `prisma migrate diff` into `prisma/schema/migrations/20261009200000_track_content_hash/migration.sql`. Exactly one `ALTER TABLE "Track" ADD COLUMN "contentHash" TEXT` and one `CREATE UNIQUE INDEX "Track_contentHash_key"`; any `DROP`, `ALTER COLUMN` or `DEFAULT` means stop.
- `GET /admin/tracks`: **without** `LIBRARY_TRACK_WHERE`. Filters: `q` trimmed, **2–100** characters, case-insensitive `contains` on `title` OR `artist`; `status` ∈ `READY`, `PENDING`, `ERROR`; `blacklisted`, `titleMasked`, `ambiance` booleans given as the strings `true` / `false` only (anything else is a 400); `style` trimmed, 1–64 characters, case-insensitive equality; `ambiance=true` = style OR artist « Ambiance » (any case), `ambiance=false` = neither, **tracks with a null style included**. `skip` / `take` from `PaginationParamsDto` (`take` ≤ **100**). Order: `createdAt` desc, then `id` desc.
- Admin track DTO (`AdminTrackDto`, list item and detail): `id`, `title`, `artist`, `style`, `bpm`, `rawBpm`, `clashTimecodes`, `titleMasked`, `blacklisted`, `status`, `sourceKey`, `filename`, `artwork`, `createdAt`, `pendingCorrections` (count of PENDING corrections). `GET /admin/tracks/:id`: same DTO, `ParseUUIDPipe`, **404** « Musique introuvable » if absent.
- `POST /admin/tracks/check` (HTTP 200): body `{ items: { sourceKey?: string (1–100), sha256: string (64 hex, lower-cased) }[] }`, **1–200** items; answer `{ items: { exists: boolean, trackId?: string }[] }` in request order; a hit by hash or by `sourceKey` counts.
- `POST /admin/tracks` (HTTP 201, multipart): parts `audio` (required) and `artwork` (optional), at most one each; fields `title` (1–200), `artist` (1–200), `style` (optional, one of the canonical labels below or « Ambiance »), `mpm` (optional integer **1–400**), `rawBpm` (optional number **1–400**), `sourceKey` (optional, ≤ **100**), `sha256` (required, 64 hex). An empty optional field means absent.
- Upload validation, by content only (never the client file name or declared type): audio is MP3 when it starts with `ID3` or a valid MPEG audio frame header (sync `0xFFE`, version ≠ reserved, layer ≠ reserved, bitrate ≠ `1111`), size ≤ **20 MB** (`20 * 1024 * 1024` bytes); artwork is JPEG (`FF D8 FF`) or PNG (`89 50 4E 47 0D 0A 1A 0A`), size ≤ **2 MB** (`2 * 1024 * 1024`). Oversized → **413**; wrong content → **400**; the server recomputes the SHA-256 and refuses a mismatch → **400**.
- Route-scoped body limit: multer `limits = { fileSize: 20 MB, files: 2, fields: 10, fieldSize: 1024, parts: 12 }` on this route only; no global body-parser limit changes; `main.ts` is not touched.
- Duplicates: same `sourceKey` or same content hash → **409** `{ message: « Cette musique est déjà dans la bibliothèque. », existingTrackId }`, checked before anything is stored; a unique-constraint race (P2002) on insert is also a 409 after cleanup. `existingTrackId` and `pendingCorrections` are added to the global filter's whitelisted 409 keys.
- Storage: server-generated flat names `<uuid>.mp3` and `<uuid>.<jpg|png>` (extension from the magic bytes), uploaded to the blob container `tracks` (`BlobStorageService` default container) **before** the row is created; if the row (or the second upload) fails, the uploaded files are deleted. Without blob configuration, files go to `<cwd>/uploads/` (served by `ServeStaticModule`).
- Blob resilience: uploads through `CircuitBreakerService.fire("azure-blob-write", …)` (new key: timeout **45 s**, 50 %, reset 30 s, volume 5) wrapping `withTimeout(…, 30_000)`; deletes through the existing `"azure-blob"` key wrapping `withTimeout(…, 8_000)`; deletes are best-effort and never throw.
- Tempo of an import: `rawBpm` from the request, else `BpmService.analyzeBpm` on a temp copy (timeout **60 s**). With a raw tempo > 0: `bpm = TracksService.bpmForPatch(rawBpm, { bpm: mpm, style }) ?? Math.round(rawBpm)`, status `READY`. Without a raw tempo (analysis failed or returned 0): `mpm` given → `bpm = mpm`, `rawBpm = 0`, `READY`; no `mpm` → `bpm = 0`, `rawBpm = 0`, status **`ERROR`**. An admin `PATCH` that sets an MPM > 0 on an `ERROR` track moves it to `READY` (the "fixable in the catalogue" path).
- Created rows: `jobId = "admin-import"`, `submittedById` = the admin, `contentHash` = the server SHA-256.
- `DELETE /tracks/:id`: **409** `{ message: TRACK_HAS_PENDING_CORRECTIONS_MESSAGE, pendingCorrections }` when the track has PENDING corrections; otherwise row + audit row in one transaction, then audio and artwork files best-effort.
- Audit (target type `TRACK`, `targetId` = track id; `AdminAuditLog.targetType` is a string: no migration for it):
  - `TRACK_CREATE`: `after = { title, artist, style, bpm, sourceKey, status }`;
  - `TRACK_UPDATE`: `diffFields` of `title`, `artist`, `style`, `bpm`, `titleMasked`, `blacklisted`, `clashTimecodes`, `status`, read before (the guard read) and after (the `update` result) inside the transaction; **no row** when nothing changed; `actorId` = the caller (mobile edits included);
  - `TRACK_DELETE`: `before = { title, artist, sourceKey, filename }`;
  - written in `TracksService` / `TrackImportService` with `AdminAuditService.record(tx, …)` inside the write transaction; **no row** when the write fails; the correction approval calls `updateTrack(…, tx, { skipAudit: true })`: one `TRACK_CORRECTION_APPROVE` row, never a `TRACK_UPDATE` beside it; no free text beyond track metadata.
- `GET /admin/audit-log` accepts `targetType=TRACK`; the SPA links `TRACK` rows to `/tracks/:id` (« Voir la musique »), `TRACK_DELETE` rows show « Supprimé ».
- Canonical dance labels (backend `TRACK_DANCE_LABELS`, same order as the mobile editor's `DANCE_GROUPS` and track-prep's `STYLE_LABELS`): « Valse Lente », « Tango », « Valse Viennoise », « Quickstep », « Slow Fox », « Samba », « Cha-cha », « Rumba », « Paso Doble », « Jive »; import style options = these + « Ambiance » (`TRACK_STYLE_OPTIONS`). The SPA list is pinned to the generated union by a `Record<StyleOption, true>`.
- `GET /track-corrections` gains an optional `trackId` (UUID) filter, so the track page links to `/moderation?track=<id>`; without it the response is unchanged.
- SPA import: files read and hashed one at a time; duplicate check by batches of **200**; uploads **2 in parallel at most**; a row is sent only when ✅ (title, artist and dance present, no duplicate, ≤ 20 MB, not skipped); a 409 during the send counts as a duplicate, not a failure; « Réessayer les échecs » re-sends failed rows only.
- No polling: every new query sets `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `retry: false`; no `refetchInterval`.
- Admin SPA CSP: `img-src 'self' data: https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr` (artwork), every other directive unchanged. Audio and artwork URLs: `${API_ORIGIN}/uploads/${encodeURIComponent(name)}`, loaded with `crossOrigin="anonymous"`.
- ID3: in-house reader (`apps/admin/src/lib/id3.ts`), **no new dependency** in `apps/admin/package.json`.
- UI copy verbatim from the spec: « Musiques », « Importer des musiques », « Prêtes », « En attente », « En erreur », « Blacklistées », « Titre masqué », « Ambiance », « Masquer le titre », « Blacklister », « Zone dangereuse », « Importer », « N importées, D doublons, E échecs », « Réessayer les échecs »; row statuses « ✅ », « ⚠️ », « ⛔ »; error state = alert with the shared « Serveur injoignable, réessayez dans un instant. » (`UNAVAILABLE_MESSAGE`) for a network failure.
- Prisma: `select` constants from `src/utils/prisma-selects.ts`, `take` on every `findMany`. No `any` (eslint error), no `process.env` in new backend code (`ConfigService`; the existing `BpmService` `FFMPEG_PATH` read is untouched), no new React Context.
- Code, comments and commits in English; user-facing copy (admin UI, API messages) in French; `docs/exploitation/` in French.
- Formatting follows each app: backend double quotes, admin SPA single quotes. The code blocks of this plan went through the root Prettier config (single quotes everywhere, as in the lot 1b and lot 2 plans); the pre-commit hook reformats each file to its app's style, so copy the code as is. Prettier also normalised the leading indentation of fragments: re-indent each fragment to its surrounding code, and match the "replace …" blocks on content, not on whitespace.
- Coverage: thresholds unchanged (`src/admin` 94 / 75 / 88 / 94, global floor). Never lower a threshold: add tests.
- Cost: none (no new service, no job, no polling; a few MB per track in the existing `tracks` container).
- Conventional commits; never `--no-verify`. Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv
  ```
- No push and no PR without the user's explicit go.

### How to run tests (applies to every task)

- **Fresh worktree.** If `node_modules` is missing, once, from the repo root: `pnpm install --frozen-lockfile` (postinstall generates the Prisma client and both OpenAPI clients from the committed `swagger.json`). After the schema change of Task 1: `pnpm --filter backend exec prisma generate`.
- **Backend env file.** Anything that boots `AppModule` (mocked e2e, integration, swagger export) reads `apps/backend/.env`, gitignored and absent from a fresh worktree. If missing: `cp apps/backend/.env.example apps/backend/.env`. Never commit it. Mocked e2e also needs Redis for BullMQ: `docker compose --profile infra up -d`.
- **Backend unit tests:** `pnpm --filter backend exec jest <path>`.
- **Mocked-Prisma e2e (no database).** `test/jest-e2e.json` has a `globalSetup` that runs `prisma db push --accept-data-loss`; it must not run here. Build a copy without it and run the mocked specs with it:
  ```bash
  cd apps/backend
  E2E_NODB="${TMPDIR:-/tmp}/jest-e2e-nodb.json"
  node -e 'const p=require("path");const c=require("./test/jest-e2e.json");delete c.globalSetup;delete c.globalTeardown;c.rootDir=p.resolve("test");require("fs").writeFileSync(process.argv[1],JSON.stringify(c))' "$E2E_NODB"
  pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec
  ```
- **Real-database tests run only on the dedicated test database**, through bash, sourcing the controller-provided file that exports `DATABASE_URL` for the test DB:
  ```bash
  bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit tracks.integration-spec'
  ```
  The integration `globalSetup` runs `prisma db push` on that database, which adds `contentHash` there. The test DB has no migration history: if you ever need `prisma migrate deploy` and it fails with **P3005**, use `prisma db push` against **that same DB only**. Never run `prisma db push`, `prisma migrate dev`, `migrate reset` or the full `test:e2e` / `test:integration` scripts against any other database. The migration of Task 1 is produced **offline** with `prisma migrate diff`.
- **Admin SPA:** `pnpm --filter admin exec vitest run <paths> --testTimeout=60000`. The machine is often heavily loaded; the `pnpm test -- --flag` form drops the flag, so always use `exec vitest run`. jsdom 27 has **no `Blob.arrayBuffer()`**: code and tests read files through `FileReader` (`lib/files.ts`); `crypto.subtle` and `TextEncoder` / `TextDecoder` are available (checked on this machine).
- **Mobile client:** `pnpm --filter client exec jest <path>`.
- **Swagger.** `pnpm docs:export` fails from the repo root. Run the steps by hand (Task 5): `cd apps/backend && pnpm run build && node scripts/export-swagger.js`, copy to `apps/docs/public/swagger.json`, run Prettier on both, then regenerate both clients (`pnpm --filter admin exec openapi-ts`, `pnpm --filter client exec openapi-ts`; the generated folders are gitignored).
- **Final step:** `pnpm preflight`.

## Review Focus

1. **The audit row is written exactly once, by the service, for what was really applied** — mobile `PATCH` / `DELETE` must be audited (the row is in `TracksService`, not the controller), the correction approval must not add a `TRACK_UPDATE` beside its `TRACK_CORRECTION_APPROVE` (the real `TracksService` would otherwise write one), a write that fails or changes nothing must leave no row, and the diff must come from the rows read inside the transaction (the MPM recomputed by a dance change). A mock of `TracksService` hides all of this. Pinned in Task 2: unit tests "skips its own audit row…", "writes no audit row when nothing changed / when the update fails", the corrections spec "writes the approval row only…" with the **real** `TracksService`, and the real-DB tests "audits a PATCH … once" and "an approval writes its own audit row only".
2. **Query-string booleans and the Ambiance NULL trap** — `?blacklisted=false` arrives as the string `"false"`: `@Type(() => Boolean)` would read it as `true` and show the blacklisted tracks instead of hiding them; and `ambiance=false` written as `NOT { style = Ambiance OR artist = Ambiance }` drops every track whose style is NULL (SQL three-valued logic), i.e. most legacy tracks. Unit tests on a mocked Prisma see neither. Pinned in Task 3: DTO test "reads only the strings true and false", the mocked e2e "parses the catalogue flags as booleans, false included" through the real `ValidationPipe`, and the real-DB test "ambiance=false keeps a null style".
3. **The upload trust boundary** — validation by content (a `.mp3` name with `audio/mpeg` but WAV bytes must be refused), the hash recomputed server-side, names never taken from the client, a size limit that multer enforces per route (413 before the body is buffered beyond 20 MB), uploaded blobs deleted when the row or the second upload fails, and a P2002 race turned into a clean 409 that still carries `existingTrackId` through the global filter. Pinned in Task 4 (service unit tests "refuses a file that is not an MP3 by its content", "refuses a hash that does not match", "stores both files under server-generated names", "deletes the stored files when the row cannot be written", "turns a unique-constraint race into a 409"; mocked e2e "refuses an audio file over 20 MB (413)" and "refuses a file that is not an MP3, whatever its name and declared type") and Task 2 (filter test "carries the track 409 details").
4. **MPM parity between the server and the SPA** — the detail page previews the MPM a dance change will produce and the import table recomputes it when the admin changes a row's dance; both mirror `BpmService.calculateMpm` / `TracksService.bpmForPatch`. A drift (a tempo range edited on one side) shows one MPM and stores another, and no single-side test catches it. Pinned by one shared fixture, `apps/backend/test/fixtures/mpm-cases.json`, read by `src/tracks/mpm-parity.spec.ts` (Task 4) and `apps/admin/src/lib/mpm.test.ts` (Task 6), plus the detail test "previews the MPM recomputed from the raw tempo and leaves it to the server" (Task 6) and the `withStyle` tests (Task 7).
5. **Cross-origin artwork** — the backend sends `Cross-Origin-Resource-Policy: same-origin` (helmet) on `/uploads`, so an `<img>` without `crossOrigin="anonymous"` is blocked from `admin.ffd.gabin-simond.fr`, and the CSP `img-src` must allow both API origins; jsdom enforces neither, so the page "works" in tests and shows broken images in production. Pinned in Task 6 (CSP test pinning `img-src` exactly, detail test on the `<img>` `src` and `crossorigin` attributes).

---

## File Structure

**Backend (`apps/backend`)**

| File                                                                                                       | Responsibility                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `prisma/schema/track.prisma` (modify)                                                                      | `contentHash String? @unique`                                                                                    |
| `prisma/schema/migrations/20261009200000_track_content_hash/migration.sql` (generated)                     | additive migration                                                                                               |
| `src/common/circuit-breaker/circuit-breaker.service.ts` (modify)                                           | `azure-blob-write` breaker                                                                                       |
| `src/tracks/track-files.service.ts` (create) + spec                                                        | save / best-effort delete of track files (blob or disk)                                                          |
| `src/admin/dto/admin-audit.dto.ts` (modify) + spec                                                         | `TRACK_*` actions, `TRACK` target                                                                                |
| `src/utils/prisma-selects.ts` (modify)                                                                     | `trackAuditSelect`, `trackUpdateTargetSelect`, `trackDeletionSelect`, `adminTrackSelect`, `trackDuplicateSelect` |
| `src/tracks/tracks.service.ts` (modify) + spec                                                             | audited update / delete, `skipAudit`, 409 on pending corrections, ERROR → READY                                  |
| `src/tracks/tracks.controller.ts` (modify) + spec                                                          | actor on delete, 409 documented                                                                                  |
| `src/tracks/tracks.module.ts` (modify)                                                                     | `AdminAuditModule`, new providers and controller                                                                 |
| `src/track-corrections/track-corrections.service.ts` (modify) + spec                                       | approval passes `skipAudit`                                                                                      |
| `src/track-corrections/dto/track-correction.dto.ts`, `track-corrections.query-service.ts` (modify) + specs | `trackId` filter                                                                                                 |
| `src/common/filters/http-exception.filter.ts` (modify) + spec                                              | `existingTrackId`, `pendingCorrections` in 409 bodies                                                            |
| `src/tracks/dance-labels.ts` (create)                                                                      | canonical dance labels, « Ambiance »                                                                             |
| `src/tracks/track-visibility.util.ts` (modify) + spec                                                      | `AMBIANCE_TRACK_WHERE`, `NOT_AMBIANCE_TRACK_WHERE`                                                               |
| `src/tracks/dto/admin-track.dto.ts` (create) + spec                                                        | list query, `AdminTrackDto`, page                                                                                |
| `src/tracks/admin-tracks.query-service.ts` (create) + spec                                                 | catalogue list / detail                                                                                          |
| `src/tracks/dto/track-import.dto.ts` (create) + spec                                                       | check and import DTOs                                                                                            |
| `src/tracks/track-file-signature.util.ts` (create) + spec                                                  | MP3 / JPEG / PNG magic bytes                                                                                     |
| `src/tracks/track-import.service.ts` (create) + spec                                                       | check, import, tempo, cleanup, audit                                                                             |
| `src/tracks/admin-tracks.controller.ts` (create) + spec                                                    | `/admin/tracks` routes, multer limits                                                                            |
| `src/tracks/mpm-parity.spec.ts` (create), `test/fixtures/mpm-cases.json` (create)                          | MPM rule pinned for the SPA mirror                                                                               |
| `test/admin.e2e-spec.ts` (modify)                                                                          | role matrix, query parsing, upload limits                                                                        |
| `test/tracks.integration-spec.ts` (create)                                                                 | real-DB audit, delete refusal, filters, import dedup                                                             |
| `swagger.json` + `apps/docs/public/swagger.json` (regenerated)                                             | API contract                                                                                                     |

**Mobile client (`apps/client`)**: no code change; the regenerated client must typecheck and the track tests stay green (Task 5).

**Admin SPA (`apps/admin`)**

| File                                                                     | Responsibility                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/lib/auditLabels.ts` (modify)                                        | three track action labels                                               |
| `src/components/ChangeSummary.tsx` (modify) + test                       | track flag / status labels, booleans « Oui » / « Non »                  |
| `src/pages/AuditLogPage.tsx` (modify) + test                             | `TRACK` link, `TRACK_DELETE` « Supprimé »                               |
| `src/lib/mpm.ts` (create) + test                                         | mirror of `calculateMpm` / `bpmForPatch`                                |
| `src/lib/tracks.ts` (create) + test                                      | style options, status labels, URL state, PATCH body, preview            |
| `src/api/queries.ts` (modify) + test                                     | `tracksQuery`, `trackQuery`                                             |
| `src/pages/TracksPage.tsx` (create) + test                               | catalogue list                                                          |
| `src/pages/TrackDetailPage.tsx` (create) + test                          | player, artwork, edit, switches, delete, history                        |
| `src/lib/moderation.ts`, `src/pages/ModerationPage.tsx` (modify) + tests | `?track=` filter                                                        |
| `public/staticwebapp.config.json`, `src/csp.test.ts` (modify)            | `img-src`                                                               |
| `src/lib/files.ts` (create) + test                                       | FileReader bytes / text, SHA-256, dropped folders                       |
| `src/lib/id3.ts` (create) + test, `src/test/id3Fixture.ts` (create)      | ID3v2.3/2.4 TIT2, TPE1, TCON, APIC                                      |
| `src/lib/trackImport.ts` (create) + test                                 | manifest, file names, rows, statuses, check, upload body, pool, summary |
| `src/pages/TrackImportPage.tsx` (create) + test                          | drop zone, review table, send, summary, retry                           |
| `src/router.tsx` (modify)                                                | `/tracks`, `/tracks/import`, `/tracks/:id`                              |
| `src/components/AppLayout.tsx` (modify) + test                           | « Musiques » entry                                                      |

**Docs:** `docs/exploitation/backoffice-admin.md` (French).

---

### Task 1: `Track.contentHash` migration, track file storage and the blob write breaker

**Files:**

- Modify: `apps/backend/prisma/schema/track.prisma` (`sourceKey` l. 31-33)
- Create (generated): `apps/backend/prisma/schema/migrations/20261009200000_track_content_hash/migration.sql`
- Modify: `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts` (`BreakerKey` l. 8-15, `BREAKER_CONFIGS` end l. 64-72)
- Create: `apps/backend/src/tracks/track-files.service.ts`, `apps/backend/src/tracks/track-files.service.spec.ts`
- Modify: `apps/backend/src/tracks/tracks.module.ts` (whole file, 15 lines)

**Interfaces:**

- Consumes: `BlobStorageService.isEnabled()`, `uploadBuffer(buffer, blobName)` (default container `tracks`), `deleteFile(blobName)`; `CircuitBreakerService.fire(key, fn)`; `withTimeout(promise, ms, label)`; `isFlatMediaFilename(name)`; `getErrorMessage(error)`.
- Produces:
  - Prisma: `Track.contentHash: string | null` (unique); `Prisma.TrackWhereUniqueInput` gains `contentHash`.
  - `BreakerKey` gains `"azure-blob-write"`.
  - `TRACK_FILE_UPLOAD_TIMEOUT_MS = 30_000`, `TRACK_FILE_DELETE_TIMEOUT_MS = 8_000`.
  - `TrackFilesService.save(name: string, buffer: Buffer): Promise<void>` (throws on failure or on a non-flat media name), `TrackFilesService.remove(names: readonly string[]): Promise<void>` (never throws).

- [ ] **Step 1: Add the column**

In `apps/backend/prisma/schema/track.prisma`, insert after the line `  sourceKey     String?     @unique`:

```prisma
  /// SHA-256 (hex) of the audio file imported from the back-office, to refuse
  /// a second import of the same file. Null for tracks added before lot 3.
  contentHash   String?     @unique
```

- [ ] **Step 2: Produce the migration offline**

From the repo root:

```bash
BEFORE=$(mktemp -d)
git archive HEAD apps/backend/prisma/schema | tar -x -C "$BEFORE"
DIR="$PWD/apps/backend/prisma/schema/migrations/20261009200000_track_content_hash"
mkdir -p "$DIR"
(cd apps/backend && pnpm exec prisma migrate diff \
  --from-schema "$BEFORE/apps/backend/prisma/schema" \
  --to-schema prisma/schema --script --output "$DIR/migration.sql")
cat "$DIR/migration.sql"
pnpm --filter backend exec prisma generate
```

Expected `migration.sql` content, and nothing else (checked while writing this plan on scratch copies of the schema):

```sql
-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Track_contentHash_key" ON "Track"("contentHash");
```

If it contains any `DROP`, `ALTER COLUMN` or `DEFAULT`, stop and report: the migration must be additive. The folder name sorts after the latest migration (`20261009090000_wallet_pass_download_count`).

- [ ] **Step 3: Write the failing storage tests**

Create `apps/backend/src/tracks/track-files.service.spec.ts`:

```ts
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CircuitBreakerService } from '../common/circuit-breaker/circuit-breaker.service';
import { BlobStorageService } from '../storage/blob-storage.service';
import { TrackFilesService } from './track-files.service';

describe('TrackFilesService', () => {
  let blob: { isEnabled: jest.Mock; uploadBuffer: jest.Mock; deleteFile: jest.Mock };
  let breaker: { fire: jest.Mock };
  let cwd: string;

  // Built after the cwd spy: the service resolves uploads/ on construction.
  const build = () =>
    new TrackFilesService(
      blob as unknown as BlobStorageService,
      breaker as unknown as CircuitBreakerService,
    );

  beforeEach(async () => {
    blob = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadBuffer: jest.fn().mockResolvedValue('https://blob/tracks/x'),
      deleteFile: jest.fn().mockResolvedValue(true),
    };
    breaker = {
      fire: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    };
    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'track-files-'));
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it('uploads to the tracks container behind the blob write breaker', async () => {
    const buffer = Buffer.from('ID3');
    await build().save('3f2c.mp3', buffer);
    expect(breaker.fire).toHaveBeenCalledWith('azure-blob-write', expect.any(Function));
    expect(blob.uploadBuffer).toHaveBeenCalledWith(buffer, '3f2c.mp3');
  });

  it('writes to uploads/ on disk when blob storage is disabled', async () => {
    blob.isEnabled.mockReturnValue(false);
    await build().save('3f2c.png', Buffer.from('png'));
    await expect(fsp.readFile(path.join(cwd, 'uploads', '3f2c.png'), 'utf8')).resolves.toBe('png');
    expect(blob.uploadBuffer).not.toHaveBeenCalled();
  });

  it.each(['../x.mp3', 'a/b.mp3', '.hidden.mp3', 'x.exe'])('refuses the name %s', async (name) => {
    await expect(build().save(name, Buffer.from('x'))).rejects.toThrow('Refused track file name');
    expect(blob.uploadBuffer).not.toHaveBeenCalled();
  });

  it('propagates an upload failure (the caller rolls back)', async () => {
    blob.uploadBuffer.mockRejectedValue(new Error('blob down'));
    await expect(build().save('a.mp3', Buffer.from('x'))).rejects.toThrow('blob down');
  });

  it('deletes each blob behind the blob breaker and never throws', async () => {
    blob.deleteFile.mockRejectedValueOnce(new Error('blob down')).mockResolvedValueOnce(true);
    await expect(build().remove(['a.mp3', 'b.jpg'])).resolves.toBeUndefined();
    expect(breaker.fire).toHaveBeenCalledWith('azure-blob', expect.any(Function));
    expect(blob.deleteFile).toHaveBeenCalledWith('a.mp3');
    expect(blob.deleteFile).toHaveBeenCalledWith('b.jpg');
  });

  it('deletes from uploads/ on disk when blob storage is disabled, flattening the name', async () => {
    blob.isEnabled.mockReturnValue(false);
    await fsp.mkdir(path.join(cwd, 'uploads'));
    await fsp.writeFile(path.join(cwd, 'uploads', 'old.mp3'), 'x');
    await build().remove(['../uploads/old.mp3']);
    await expect(fsp.stat(path.join(cwd, 'uploads', 'old.mp3'))).rejects.toThrow();
  });

  it('does nothing for an empty list', async () => {
    await build().remove([]);
    expect(breaker.fire).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/track-files.service.spec.ts`
Expected: FAIL — `Cannot find module './track-files.service'`.

- [ ] **Step 4: Add the breaker key**

In `apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts`, replace

```ts
  | "azure-blob";
```

with

```ts
  | "azure-blob"
  | "azure-blob-write";
```

and append inside `BREAKER_CONFIGS`, after the `"azure-blob"` entry:

```ts
  // Track file uploads of the back-office import (up to 20 MB each): their own
  // breaker, so their longer budget does not loosen the /uploads reads.
  "azure-blob-write": {
    errorThresholdPercentage: 50,
    timeout: 45_000,
    resetTimeout: 30_000,
    volumeThreshold: 5,
  },
```

- [ ] **Step 5: Implement `TrackFilesService`**

Create `apps/backend/src/tracks/track-files.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { CircuitBreakerService } from '../common/circuit-breaker/circuit-breaker.service';
import { BlobStorageService } from '../storage/blob-storage.service';
import { getErrorMessage } from '../utils/error.utils';
import { withTimeout } from '../utils/timeout.utils';
import { isFlatMediaFilename } from './media-response.util';

/** One upload of at most 20 MB to the blob `tracks` container. */
export const TRACK_FILE_UPLOAD_TIMEOUT_MS = 30_000;
/** One best-effort blob delete. */
export const TRACK_FILE_DELETE_TIMEOUT_MS = 8_000;

/**
 * Audio and artwork files of the track library, stored flat under their name:
 * in the blob `tracks` container (served by `/uploads/<name>`, see
 * UploadsFallbackController), or in `<cwd>/uploads/` when blob storage is not
 * configured (local dev, served by ServeStaticModule).
 *
 * Blob calls go through a circuit breaker + timeout (ADR-0009). Uploads have
 * their own breaker: a 20 MB upload must not share the 10 s budget of the
 * `/uploads` reads.
 */
@Injectable()
export class TrackFilesService {
  private readonly logger = new Logger(TrackFilesService.name);
  private readonly uploadsRoot = path.join(process.cwd(), 'uploads');

  constructor(
    private readonly blobStorage: BlobStorageService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /** Stores a file under a server-generated flat name; throws on failure. */
  async save(name: string, buffer: Buffer): Promise<void> {
    if (!isFlatMediaFilename(name)) {
      throw new Error(`Refused track file name ${name}`);
    }
    if (!this.blobStorage.isEnabled()) {
      await fsp.mkdir(this.uploadsRoot, { recursive: true });
      await fsp.writeFile(path.join(this.uploadsRoot, name), buffer);
      return;
    }
    await this.circuitBreaker.fire('azure-blob-write', () =>
      withTimeout(
        this.blobStorage.uploadBuffer(buffer, name),
        TRACK_FILE_UPLOAD_TIMEOUT_MS,
        'blob upload (track)',
      ),
    );
  }

  /**
   * Best-effort deletion, never throws: the caller already committed (or
   * rolled back) its row. Each failure is logged with the file name, so the
   * orphan can be removed by hand.
   */
  async remove(names: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(names.map((name) => this.removeOne(name)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Track file deletion failed for "${names[index]}" — manual cleanup required: ${getErrorMessage(result.reason)}`,
        );
      }
    });
  }

  private async removeOne(name: string): Promise<void> {
    const safeName = path.basename(name);
    if (!this.blobStorage.isEnabled()) {
      await fsp.rm(path.join(this.uploadsRoot, safeName), { force: true });
      return;
    }
    await this.circuitBreaker.fire('azure-blob', () =>
      withTimeout(
        this.blobStorage.deleteFile(safeName),
        TRACK_FILE_DELETE_TIMEOUT_MS,
        'blob delete (track)',
      ),
    );
  }
}
```

In `apps/backend/src/tracks/tracks.module.ts`, add `import { TrackFilesService } from "./track-files.service";` and replace `providers: [TracksService, BpmService],` with:

```ts
  providers: [TracksService, BpmService, TrackFilesService],
```

(`BlobStorageService` and `CircuitBreakerService` come from global modules.)

Run: `pnpm --filter backend exec jest src/tracks/track-files.service.spec.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
git add apps/backend/prisma/schema/track.prisma apps/backend/prisma/schema/migrations/20261009200000_track_content_hash apps/backend/src/common/circuit-breaker/circuit-breaker.service.ts apps/backend/src/tracks/track-files.service.ts apps/backend/src/tracks/track-files.service.spec.ts apps/backend/src/tracks/tracks.module.ts
git commit -m "feat(tracks): add Track.contentHash and a breaker-guarded track file store

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 2: `TRACK` audit target, audited update and delete, delete refused while corrections are pending

**Files:**

- Modify: `apps/backend/src/admin/dto/admin-audit.dto.ts` (`AUDIT_ACTIONS` / `AUDIT_TARGET_TYPES`, l. 5-25)
- Modify: `apps/backend/src/admin/dto/admin-audit.dto.spec.ts` (whole file, 37 lines)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (append after `trackCorrectionAuditTrackSelect`, l. 373-384)
- Modify: `apps/backend/src/tracks/tracks.service.ts` (whole file, 276 lines)
- Modify: `apps/backend/src/tracks/tracks.service.spec.ts` (imports and setup l. 1-49, first `updateTrack` test l. 285-302, new tests at the end of `describe("updateTrack")` l. 472, `describe("deleteTrack")` l. 495-533)
- Modify: `apps/backend/src/tracks/tracks.controller.ts` (`update` description l. 144-148, `remove` l. 171-187)
- Modify: `apps/backend/src/tracks/tracks.controller.spec.ts` (`describe("remove")` l. 256-275)
- Modify: `apps/backend/src/tracks/tracks.module.ts` (imports)
- Modify: `apps/backend/src/track-corrections/track-corrections.service.ts` (`approve`, l. 268-274)
- Modify: `apps/backend/src/track-corrections/track-corrections.service.spec.ts` (assertions l. 690-699, 733-745, 758-766; `describe("approve (TracksService réel)")` l. 1073-1095)
- Modify: `apps/backend/src/common/filters/http-exception.filter.ts` (`CONFLICT_DETAIL_KEYS`, l. 28-35)
- Modify: `apps/backend/src/common/filters/http-exception.filter.spec.ts` (append after the club-usage 409 test, l. 212-236)
- Create: `apps/backend/test/tracks.integration-spec.ts`

**Interfaces:**

- Consumes: `AdminAuditService.record(tx, entry)` (`AdminAuditModule`), `diffFields(before, after)`, `TrackFilesService.remove(names)` (Task 1), `idOnlySelect`.
- Produces:
  - `AUDIT_ACTIONS` gains `"TRACK_CREATE"`, `"TRACK_UPDATE"`, `"TRACK_DELETE"`; `AUDIT_TARGET_TYPES = ["USER", "CLUB", "TRACK_CORRECTION", "TRACK"]`.
  - `trackAuditSelect` (`title`, `artist`, `style`, `bpm`, `titleMasked`, `blacklisted`, `clashTimecodes`, `status`), `trackUpdateTargetSelect` (`submittedById`, `rawBpm` + `trackAuditSelect`), `trackDeletionSelect` (`title`, `artist`, `sourceKey`, `filename`, `artwork`).
  - `TracksService` constructor `(prisma: PrismaService, bpmService: BpmService, files: TrackFilesService, audit: AdminAuditService)` (no `BlobStorageService` any more).
  - `interface UpdateTrackOptions { skipAudit?: boolean }`; `TracksService.updateTrack(id: string, userId: string, isAdmin: boolean, patch: UpdateTrackDto, client?: Prisma.TransactionClient, options?: UpdateTrackOptions): Promise<void>`.
  - `TracksService.deleteTrack(id: string, actorId: string): Promise<void>`; `TRACK_HAS_PENDING_CORRECTIONS_MESSAGE`.
  - `TracksService.bpmForPatch(rawBpm, patch)` unchanged (reused by Task 4).
  - `CONFLICT_DETAIL_KEYS` gains `"existingTrackId"`, `"pendingCorrections"`.

- [ ] **Step 1: Write the failing audit DTO test**

Replace `apps/backend/src/admin/dto/admin-audit.dto.spec.ts` with:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, ListAuditLogQueryDto } from './admin-audit.dto';

describe('ListAuditLogQueryDto', () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(ListAuditLogQueryDto, plain)).map((e) => e.property);

  it('accepts track corrections and tracks as target types', () => {
    expect(errors({ targetType: 'TRACK_CORRECTION' })).toEqual([]);
    expect(errors({ targetType: 'TRACK' })).toEqual([]);
  });

  it('refuses an unknown target type', () => {
    expect(errors({ targetType: 'COMPETITION' })).toEqual(['targetType']);
  });

  it('knows the moderation decisions and the track writes', () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'TRACK_CORRECTION_APPROVE',
        'TRACK_CORRECTION_REJECT',
        'TRACK_CREATE',
        'TRACK_UPDATE',
        'TRACK_DELETE',
      ]),
    );
    expect(AUDIT_TARGET_TYPES).toEqual(['USER', 'CLUB', 'TRACK_CORRECTION', 'TRACK']);
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/dto/admin-audit.dto.spec.ts`
Expected: FAIL — `TRACK` refused, actions missing.

- [ ] **Step 2: Add the actions and the target type**

In `apps/backend/src/admin/dto/admin-audit.dto.ts`, replace

```ts
  "TRACK_CORRECTION_APPROVE",
  "TRACK_CORRECTION_REJECT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = ["USER", "CLUB", "TRACK_CORRECTION"] as const;
```

with

```ts
  "TRACK_CORRECTION_APPROVE",
  "TRACK_CORRECTION_REJECT",
  // Track library (lot 3): back-office import, and edits / deletions from the
  // back-office or the mobile app.
  "TRACK_CREATE",
  "TRACK_UPDATE",
  "TRACK_DELETE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = [
  "USER",
  "CLUB",
  "TRACK_CORRECTION",
  "TRACK",
] as const;
```

Run: `pnpm --filter backend exec jest src/admin/dto/admin-audit.dto.spec.ts`
Expected: PASS.

- [ ] **Step 3: Add the track selects**

In `apps/backend/src/utils/prisma-selects.ts`, insert after the closing `} as const;` of `trackCorrectionAuditTrackSelect`:

```ts
/**
 * Track fields of a TRACK_UPDATE audit row: read by the write guard and
 * returned by the update itself, inside the same transaction.
 */
export const trackAuditSelect = {
  title: true,
  artist: true,
  style: true,
  bpm: true,
  titleMasked: true,
  blacklisted: true,
  clashTimecodes: true,
  status: true,
} as const;

/** Guard read of TracksService.updateTrack: owner, raw tempo, audited fields. */
export const trackUpdateTargetSelect = {
  submittedById: true,
  rawBpm: true,
  ...trackAuditSelect,
} as const;

/** What a track deletion audits (metadata only) and which files it removes. */
export const trackDeletionSelect = {
  title: true,
  artist: true,
  sourceKey: true,
  filename: true,
  artwork: true,
} as const;
```

- [ ] **Step 4: Write the failing service tests**

In `apps/backend/src/tracks/tracks.service.spec.ts`:

Replace the import block and the setup (from the first line to the end of `beforeEach`, l. 1-49) with:

```ts
import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TrackCorrectionStatus, TrackStatus } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { HIDDEN_TRACK_CASES, TrackRow, useTrackTable } from '../../test/mocks/track-where.mock';
import { AdminAuditService } from '../admin/admin-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { idOnlySelect, trackAuditSelect } from '../utils/prisma-selects';
import { BpmService } from './bpm.service';
import { TrackFilesService } from './track-files.service';
import { TRACK_HAS_PENDING_CORRECTIONS_MESSAGE, TracksService } from './tracks.service';

describe('TracksService', () => {
  let service: TracksService;
  let prisma: MockPrismaService;
  let mockBpm: { calculateMpm: jest.Mock };
  let files: { remove: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    // Interactive transaction: the callback gets the same mocked client.
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    mockBpm = {
      calculateMpm: jest.fn((bpm: number) => Math.round(bpm)),
    };
    files = { remove: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prisma },
        { provide: BpmService, useValue: mockBpm },
        { provide: TrackFilesService, useValue: files },
        { provide: AdminAuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TracksService>(TracksService);
  });
```

(`HIDDEN_TRACK_CASES`, `TrackRow`, `useTrackTable` stay used by the existing `findOne` tests.)

In the test "reads and writes through the given transaction client", replace

```ts
expect(tx.track.update).toHaveBeenCalledWith({
  where: { id: 't1' },
  data: { title: 'New' },
});
```

with

```ts
expect(tx.track.update).toHaveBeenCalledWith({
  where: { id: 't1' },
  data: { title: 'New' },
  select: trackAuditSelect,
});
expect(prisma.$transaction).not.toHaveBeenCalled();
```

Append inside `describe("updateTrack", ...)`, after the test "ignores clash timecodes from a non-admin":

```ts
it('audits the fields really applied, read back in the same transaction', async () => {
  prisma.track.findUnique.mockResolvedValue({
    submittedById: null,
    rawBpm: 104,
    title: 'Old',
    artist: 'A',
    style: 'Tango',
    bpm: 33,
    titleMasked: false,
    blacklisted: false,
    clashTimecodes: [],
    status: TrackStatus.READY,
  } as never);
  prisma.track.update.mockResolvedValue({
    title: 'Old',
    artist: 'A',
    style: 'Rumba',
    bpm: 26,
    titleMasked: false,
    blacklisted: true,
    clashTimecodes: [],
    status: TrackStatus.READY,
  } as never);
  mockBpm.calculateMpm.mockReturnValue(26);

  await service.updateTrack('t1', 'admin-1', true, { style: 'Rumba', blacklisted: true });

  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(prisma.track.update).toHaveBeenCalledWith({
    where: { id: 't1' },
    data: { style: 'Rumba', blacklisted: true, bpm: 26 },
    select: trackAuditSelect,
  });
  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(audit.record).toHaveBeenCalledWith(prisma, {
    actorId: 'admin-1',
    action: 'TRACK_UPDATE',
    targetType: 'TRACK',
    targetId: 't1',
    before: { style: 'Tango', bpm: 33, blacklisted: false },
    after: { style: 'Rumba', bpm: 26, blacklisted: true },
  });
});

it('writes no audit row when nothing changed', async () => {
  const row = {
    title: 'Same',
    artist: 'A',
    style: null,
    bpm: 0,
    titleMasked: false,
    blacklisted: false,
    clashTimecodes: [],
    status: TrackStatus.READY,
  };
  prisma.track.findUnique.mockResolvedValue({ submittedById: null, rawBpm: 0, ...row } as never);
  prisma.track.update.mockResolvedValue(row as never);

  await service.updateTrack('t1', 'admin-1', true, { title: 'Same' });

  expect(prisma.track.update).toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});

it('writes no audit row when the update fails', async () => {
  prisma.track.findUnique.mockResolvedValue({ submittedById: null, rawBpm: 0 } as never);
  prisma.track.update.mockRejectedValue(new Error('db down'));

  await expect(service.updateTrack('t1', 'admin-1', true, { title: 'X' })).rejects.toThrow(
    'db down',
  );
  expect(audit.record).not.toHaveBeenCalled();
});

it("audits through the caller's transaction when one is given", async () => {
  const tx = createMockPrismaService();
  tx.track.findUnique.mockResolvedValue({ submittedById: null, rawBpm: 0, title: 'Old' } as never);
  tx.track.update.mockResolvedValue({ title: 'New' } as never);

  await service.updateTrack('t1', 'admin-1', true, { title: 'New' }, tx);

  expect(audit.record).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      action: 'TRACK_UPDATE',
      before: { title: 'Old' },
      after: { title: 'New' },
    }),
  );
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it('skips its own audit row when the caller audits (correction approval)', async () => {
  const tx = createMockPrismaService();
  tx.track.findUnique.mockResolvedValue({ submittedById: null, rawBpm: 0, title: 'Old' } as never);
  tx.track.update.mockResolvedValue({ title: 'New' } as never);

  await service.updateTrack('t1', 'admin-1', true, { title: 'New' }, tx, { skipAudit: true });

  expect(tx.track.update).toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});

it('publishes an ERROR track once an admin sets its MPM', async () => {
  prisma.track.findUnique.mockResolvedValue({
    submittedById: null,
    rawBpm: 0,
    bpm: 0,
    status: TrackStatus.ERROR,
  } as never);
  prisma.track.update.mockResolvedValue({ bpm: 52, status: TrackStatus.READY } as never);

  await service.updateTrack('t1', 'admin-1', true, { bpm: 52 });

  expect(prisma.track.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { bpm: 52, status: TrackStatus.READY } }),
  );
  expect(audit.record).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({
      before: { bpm: 0, status: TrackStatus.ERROR },
      after: { bpm: 52, status: TrackStatus.READY },
    }),
  );
});

it('keeps an ERROR track out of the library without a tempo, and never promotes another status', async () => {
  prisma.track.update.mockResolvedValue({} as never);
  prisma.track.findUnique.mockResolvedValueOnce({
    submittedById: null,
    rawBpm: 0,
    status: TrackStatus.ERROR,
  } as never);
  await service.updateTrack('t1', 'admin-1', true, { title: 'X', bpm: 0 });
  expect(prisma.track.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: { title: 'X', bpm: 0 } }),
  );

  prisma.track.findUnique.mockResolvedValueOnce({
    submittedById: null,
    rawBpm: 0,
    status: TrackStatus.PENDING,
  } as never);
  await service.updateTrack('t1', 'admin-1', true, { bpm: 52 });
  expect(prisma.track.update).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: { bpm: 52 } }),
  );
});
```

Replace the whole `describe("deleteTrack", ...)` block with:

```ts
describe('deleteTrack', () => {
  const row = {
    title: 'Rumba',
    artist: 'Orchestre',
    sourceKey: 'apple:1',
    filename: 'a.mp3',
    artwork: 'a.jpg',
  };

  it('throws NotFoundException when the track is missing', async () => {
    prisma.track.findUnique.mockResolvedValue(null);

    await expect(service.deleteTrack('missing', 'admin-1')).rejects.toThrow(NotFoundException);
    expect(prisma.track.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses (409) while correction proposals are pending, and keeps the files', async () => {
    prisma.track.findUnique.mockResolvedValue(row as never);
    prisma.trackCorrection.count.mockResolvedValue(2);

    const error = await service.deleteTrack('t1', 'admin-1').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      message: TRACK_HAS_PENDING_CORRECTIONS_MESSAGE,
      pendingCorrections: 2,
    });
    expect(prisma.trackCorrection.count).toHaveBeenCalledWith({
      where: { trackId: 't1', status: TrackCorrectionStatus.PENDING },
    });
    expect(prisma.track.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('deletes the row with its audit row in one transaction, then both files', async () => {
    prisma.track.findUnique.mockResolvedValue(row as never);
    prisma.trackCorrection.count.mockResolvedValue(0);
    prisma.track.delete.mockResolvedValue({ id: 't1' } as never);

    await service.deleteTrack('t1', 'admin-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.track.delete).toHaveBeenCalledWith({ where: { id: 't1' }, select: idOnlySelect });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: 'admin-1',
      action: 'TRACK_DELETE',
      targetType: 'TRACK',
      targetId: 't1',
      before: { title: 'Rumba', artist: 'Orchestre', sourceKey: 'apple:1', filename: 'a.mp3' },
    });
    expect(files.remove).toHaveBeenCalledWith(['a.mp3', 'a.jpg']);
  });

  it('removes only the audio file of a track without artwork', async () => {
    prisma.track.findUnique.mockResolvedValue({ ...row, artwork: null } as never);
    prisma.trackCorrection.count.mockResolvedValue(0);
    prisma.track.delete.mockResolvedValue({ id: 't1' } as never);

    await service.deleteTrack('t1', 'admin-1');

    expect(files.remove).toHaveBeenCalledWith(['a.mp3']);
  });

  it('leaves the files and writes no audit row when the deletion fails', async () => {
    prisma.track.findUnique.mockResolvedValue(row as never);
    prisma.trackCorrection.count.mockResolvedValue(0);
    prisma.track.delete.mockRejectedValue(new Error('db down'));

    await expect(service.deleteTrack('t1', 'admin-1')).rejects.toThrow('db down');
    expect(audit.record).not.toHaveBeenCalled();
    expect(files.remove).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/tracks.service.spec.ts`
Expected: FAIL — `TRACK_HAS_PENDING_CORRECTIONS_MESSAGE` is not exported, `deleteTrack` takes one argument, no audit is written.

- [ ] **Step 5: Implement the audited `TracksService`**

Replace `apps/backend/src/tracks/tracks.service.ts` with:

```ts
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TrackCorrectionStatus, TrackStatus } from '@prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import { diffFields } from '../admin/admin-audit.util';
import { PaginationParamsDto } from '../common/dto/pagination-params.dto';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  idOnlySelect,
  trackAuditSelect,
  trackDeletionSelect,
  trackUpdateTargetSelect,
} from '../utils/prisma-selects';
import { BpmService } from './bpm.service';
import { UpdateTrackDto } from './dto/update-track.dto';
import { PASO_MAX_CLASHES, PASO_MAX_CLASHES_MESSAGE } from './paso-clashes';
import { TrackFilesService } from './track-files.service';
import { LIBRARY_TRACK_WHERE, MASKED_TITLE_LABEL, trackByIdWhere } from './track-visibility.util';

/** 409 of DELETE /tracks/:id while correction proposals wait for a decision. */
export const TRACK_HAS_PENDING_CORRECTIONS_MESSAGE =
  'Des propositions de correction sont en attente sur cette musique : traitez-les dans Modération, ou blacklistez la musique.';

export interface UpdateTrackOptions {
  /**
   * No TRACK_UPDATE row: the caller writes its own audit row in the same
   * transaction (a correction approval logs TRACK_CORRECTION_APPROVE).
   */
  skipAudit?: boolean;
}

/** Champs de base récupérés pour toute piste audio. Ne pas exposer status/jobId dans les listes. */
const TRACK_BASE_SELECT = {
  id: true,
  title: true,
  artist: true,
  filename: true,
  artwork: true,
  style: true,
  bpm: true,
  // Raw detected tempo (BPM) — lets the client preview the dance-aware MPM
  // live before saving. submittedById drives the edit permission (owner/admin).
  rawBpm: true,
  submittedById: true,
  // Modération : renvoyés au client. titleMasked pilote l'affichage du libellé
  // neutre côté non-admin ; blacklisted permet à l'admin d'afficher un indicateur.
  titleMasked: true,
  blacklisted: true,
  // Paso doble : timecodes des appels affichés sur le lecteur (#paso-clashes).
  clashTimecodes: true,
  createdAt: true,
} satisfies Prisma.TrackSelect;

type TrackBase = Prisma.TrackGetPayload<{ select: typeof TRACK_BASE_SELECT }>;

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bpmService: BpmService,
    private readonly files: TrackFilesService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Nombre maximal de pistes d'ambiance renvoyées (requête bornée). */
  static readonly AMBIANCE_TAKE = 50;

  /**
   * Filtre Prisma des pistes d'ambiance (musique de pause du mode compétition) :
   * style OU artiste « Ambiance » (insensible à la casse), READY, non blacklistées.
   * Exactement les pistes d'ambiance que LIBRARY_TRACK_WHERE exclut de la bibliothèque.
   */
  private static readonly AMBIANCE_WHERE: Prisma.TrackWhereInput = {
    AND: [
      {
        OR: [
          { style: { equals: 'Ambiance', mode: 'insensitive' } },
          { artist: { equals: 'Ambiance', mode: 'insensitive' } },
        ],
      },
      { status: TrackStatus.READY },
      { blacklisted: false },
    ],
  };

  /**
   * Applique le masquage du titre en fonction du rôle du demandeur.
   * Les admins voient toujours le titre réel (+ le flag titleMasked pour
   * afficher un indicateur). Les non-admins reçoivent un libellé neutre
   * lorsque la piste est marquée titleMasked.
   */
  private static maskTitle<T extends TrackBase>(track: T, isAdmin: boolean): T {
    if (track.titleMasked && !isAdmin) {
      return { ...track, title: MASKED_TITLE_LABEL };
    }
    return track;
  }

  /**
   * Récupère toutes les pistes audio READY avec pagination.
   * Exclut Ambiance et les tracks en cours de traitement.
   */
  async findAll(pagination: PaginationParamsDto = new PaginationParamsDto(), isAdmin = false) {
    const { skip, take } = pagination;
    const where = LIBRARY_TRACK_WHERE;

    const [total, tracks] = await Promise.all([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: TRACK_BASE_SELECT,
      }),
    ]);

    const masked = tracks.map((t) => TracksService.maskTitle(t, isAdmin));
    return createPaginatedResponse(masked, total, skip ?? 0, take ?? 10);
  }

  /**
   * Récupère les pistes d'ambiance (musique de pause du mode compétition),
   * exclues de la bibliothèque par LIBRARY_TRACK_WHERE. Même forme et même masquage
   * de titre que `findAll`, pour que le client les mappe à l'identique.
   */
  async findAmbiance(isAdmin = false): Promise<TrackBase[]> {
    const tracks = await this.prisma.track.findMany({
      where: TracksService.AMBIANCE_WHERE,
      orderBy: { createdAt: 'desc' },
      take: TracksService.AMBIANCE_TAKE,
      select: TRACK_BASE_SELECT,
    });
    return tracks.map((t) => TracksService.maskTitle(t, isAdmin));
  }

  /**
   * Récupère une piste audio par son ID. Pour un non-admin, une piste hors
   * bibliothèque (blacklistée, non READY, Ambiance) renvoie le même 404
   * qu'une piste inexistante.
   */
  async findOne(id: string, isAdmin = false) {
    const track = await this.prisma.track.findFirst({
      where: trackByIdWhere(id, isAdmin),
      select: TRACK_BASE_SELECT,
    });
    if (!track) throw new NotFoundException(`Track ${id} not found`);
    return TracksService.maskTitle(track, isAdmin);
  }

  /**
   * Met à jour les champs éditables d'une track (titre, artiste, style, bpm).
   * Seul le submitter ou un admin peut éditer. Les champs non fournis sont préservés.
   *
   * Every applied change is audited (TRACK_UPDATE) in the same transaction,
   * whoever calls: back-office or mobile app. `client` is the caller's
   * interactive transaction when the update must be atomic with other writes
   * (correction approval); otherwise a transaction is opened here.
   */
  async updateTrack(
    id: string,
    userId: string,
    isAdmin: boolean,
    patch: UpdateTrackDto,
    client?: Prisma.TransactionClient,
    options: UpdateTrackOptions = {},
  ): Promise<void> {
    if (client) {
      await this.applyUpdate(client, id, userId, isAdmin, patch, options);
      return;
    }
    await this.prisma.$transaction((tx) =>
      this.applyUpdate(tx, id, userId, isAdmin, patch, options),
    );
  }

  private async applyUpdate(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    isAdmin: boolean,
    patch: UpdateTrackDto,
    options: UpdateTrackOptions,
  ): Promise<void> {
    const existing = await tx.track.findUnique({
      where: { id },
      select: trackUpdateTargetSelect,
    });
    if (!existing) {
      throw new NotFoundException(`Track ${id} not found`);
    }
    if (!isAdmin && existing.submittedById && existing.submittedById !== userId) {
      throw new HttpException(
        'Vous ne pouvez modifier que les musiques que vous avez ajoutées.',
        HttpStatus.FORBIDDEN,
      );
    }
    const data: Prisma.TrackUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.artist !== undefined) data.artist = patch.artist;
    if (patch.style !== undefined) data.style = patch.style || null;
    // Champs de modération : réservés aux admins. Ignorés silencieusement pour
    // un non-admin (le contrôleur PATCH est déjà ADMIN-only, ceci est une
    // défense en profondeur).
    if (isAdmin && patch.titleMasked !== undefined) {
      data.titleMasked = patch.titleMasked;
    }
    if (isAdmin && patch.blacklisted !== undefined) {
      data.blacklisted = patch.blacklisted;
    }
    // Appels paso doble : données de compétition autoritaires → ADMIN only.
    // Triés croissants et dédupliqués pour un affichage stable sur le lecteur.
    // Au plus PASO_MAX_CLASHES : le DTO le garantit pour PATCH /tracks/:id,
    // mais la validation d'une proposition passe ici avec des valeurs stockées
    // avant l'introduction de cette borne.
    if (isAdmin && patch.clashTimecodes !== undefined) {
      const clashes = [...new Set(patch.clashTimecodes)].sort((a, b) => a - b);
      if (clashes.length > PASO_MAX_CLASHES) {
        throw new BadRequestException(PASO_MAX_CLASHES_MESSAGE);
      }
      data.clashTimecodes = clashes;
    }
    const bpm = this.bpmForPatch(existing.rawBpm, patch);
    if (bpm !== undefined) data.bpm = bpm;
    // A back-office import without a detectable tempo creates the track in
    // ERROR (out of the library): the admin who sets its MPM publishes it.
    if (isAdmin && existing.status === TrackStatus.ERROR && bpm !== undefined && bpm > 0) {
      data.status = TrackStatus.READY;
    }
    if (Object.keys(data).length === 0) return;
    const after = await tx.track.update({
      where: { id },
      data,
      select: trackAuditSelect,
    });
    this.logger.log(`Updated track ${id} (fields: ${Object.keys(data).join(',')})`);
    if (options.skipAudit) return;
    // Read back inside the transaction: the row holds what was really applied
    // (MPM recalculated on a dance change, sorted clashes), not the request.
    const changes = diffFields(existing, after);
    if (!changes) return;
    await this.audit.record(tx, {
      actorId: userId,
      action: 'TRACK_UPDATE',
      targetType: 'TRACK',
      targetId: id,
      before: changes.before,
      after: changes.after,
    });
  }

  /**
   * Tempo (MPM) qu'un patch écrira sur la piste, ou undefined s'il n'y touche
   * pas. Source unique de la règle appliquée par updateTrack, exposée pour que
   * la file de modération affiche le MPM qui RÉSULTERA d'une validation :
   * - tempo explicite → il est appliqué tel quel ;
   * - sinon, changement de danse avec un tempo brut détecté → MPM recalculé
   *   depuis le BPM brut pour la nouvelle danse (en danse on parle en MPM).
   */
  bpmForPatch(rawBpm: number, patch: Pick<UpdateTrackDto, 'bpm' | 'style'>): number | undefined {
    if (patch.bpm !== undefined) return patch.bpm;
    if (patch.style && rawBpm > 0) {
      const mpm = this.bpmService.calculateMpm(rawBpm, patch.style);
      if (mpm > 0) return mpm;
    }
    return undefined;
  }

  /**
   * Deletes a track for good (admin moderation, web or mobile). Refused (409)
   * while correction proposals wait for a decision: the deletion would cascade
   * them away unanswered. The row and its audit row share one transaction; the
   * audio and artwork files go afterwards, best-effort.
   */
  async deleteTrack(id: string, actorId: string): Promise<void> {
    const files = await this.prisma.$transaction(async (tx) => {
      const track = await tx.track.findUnique({
        where: { id },
        select: trackDeletionSelect,
      });
      if (!track) {
        throw new NotFoundException(`Track ${id} not found`);
      }
      const pendingCorrections = await tx.trackCorrection.count({
        where: { trackId: id, status: TrackCorrectionStatus.PENDING },
      });
      if (pendingCorrections > 0) {
        throw new ConflictException({
          message: TRACK_HAS_PENDING_CORRECTIONS_MESSAGE,
          pendingCorrections,
        });
      }
      await tx.track.delete({ where: { id }, select: idOnlySelect });
      await this.audit.record(tx, {
        actorId,
        action: 'TRACK_DELETE',
        targetType: 'TRACK',
        targetId: id,
        // Track metadata only.
        before: {
          title: track.title,
          artist: track.artist,
          sourceKey: track.sourceKey,
          filename: track.filename,
        },
      });
      return [track.filename, track.artwork].filter((name): name is string => Boolean(name));
    });
    await this.files.remove(files);
    this.logger.log(`Deleted track ${id}`);
  }
}
```

In `apps/backend/src/tracks/tracks.module.ts`, add `import { AdminAuditModule } from "../admin/admin-audit.module";` and replace `imports: [PrismaModule, HttpModule],` with:

```ts
  // The audit trail on its own (no AdminModule auth/users imports).
  imports: [PrismaModule, HttpModule, AdminAuditModule],
```

Run: `pnpm --filter backend exec jest src/tracks/tracks.service.spec.ts`
Expected: PASS (the existing `findAll` / `findAmbiance` / `findOne` / `updateTrack` / `bpmForPatch` tests unchanged, plus the new ones).

- [ ] **Step 6: Delete with the actor from the controller**

In `apps/backend/src/tracks/tracks.controller.spec.ts`, replace the whole `describe("remove", ...)` block with:

```ts
describe('remove', () => {
  it('delegates to the service deleteTrack with the caller as actor', async () => {
    mockTracksService.deleteTrack.mockResolvedValue(undefined);

    await controller.remove('track-1', adminReq);

    expect(mockTracksService.deleteTrack).toHaveBeenCalledWith('track-1', 'admin-1');
  });

  it('propagates NotFoundException from the service', async () => {
    mockTracksService.deleteTrack.mockRejectedValue(
      new NotFoundException('Track track-x not found'),
    );

    await expect(controller.remove('track-x', adminReq)).rejects.toThrow(NotFoundException);
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/tracks.controller.spec.ts`
Expected: FAIL — `deleteTrack` called with `("track-1")` only.

In `apps/backend/src/tracks/tracks.controller.ts`, in the `update` `@ApiOperation`, replace the description with:

```ts
    description:
      "Réservé aux administrateurs. Permet de corriger titre, artiste, style et BPM après ajout. Champs absents = inchangés. Chaque modification appliquée est tracée dans le journal d'audit (TRACK_UPDATE). Une musique en erreur (tempo non détecté) passe en READY quand un MPM > 0 est saisi.",
```

and replace the `remove` method with its decorators:

```ts
  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Supprime une musique (modération)",
    description:
      "Réservé aux administrateurs. Supprime définitivement la piste de la bibliothèque partagée, puis son fichier audio et sa pochette. Refusé (409) tant que des propositions de correction sont en attente sur la musique. Tracé dans le journal d'audit (TRACK_DELETE).",
  })
  @ApiParam({ name: "id", description: "UUID de la musique" })
  @ApiResponse({ status: 204, description: "Track supprimée" })
  @ApiResponse({ status: 403, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Track non trouvée" })
  @ApiResponse({
    status: 409,
    description:
      "Propositions de correction en attente (pendingCorrections) : les traiter ou blacklister la musique",
  })
  async remove(
    @Param("id") id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.tracksService.deleteTrack(id, req.user.userId);
  }
```

Run: `pnpm --filter backend exec jest src/tracks/tracks.controller.spec.ts`
Expected: PASS.

- [ ] **Step 7: The approval writes its own row only**

In `apps/backend/src/track-corrections/track-corrections.service.spec.ts`:

In the three `expect(tracks.updateTrack).toHaveBeenCalledWith(...)` assertions of the tests "marque APPROVED et applique les valeurs proposées via updateTrack, en transaction", "les valeurs de l'admin remplacent celles de la proposition" and "applique les clashs proposés (y compris une liste vide)", replace the last argument line `        tx,` with:

```ts
        tx,
        { skipAudit: true },
```

In `describe("approve (TracksService réel)", ...)`, replace the construction of `realTracks` with:

```ts
const realTracks = new TracksService(
  prisma as unknown as PrismaService,
  { calculateMpm: jest.fn().mockReturnValue(0) } as never,
  {} as never,
  audit as unknown as AdminAuditService,
);
```

and append inside that `describe`:

```ts
it('writes the approval row only: the applied update is not audited twice', async () => {
  prisma.trackCorrection.findUnique.mockResolvedValue(decisionRow() as never);
  // A real change, so the real updateTrack WOULD audit it without skipAudit.
  tx.track.update.mockResolvedValue({ title: 'Espana Cani', bpm: 62 } as never);

  await realService.approve('c1', 'admin-1', {});

  expect(audit.record).toHaveBeenCalledTimes(1);
  expect(audit.record.mock.calls[0][1]).toMatchObject({
    action: 'TRACK_CORRECTION_APPROVE',
    targetType: 'TRACK_CORRECTION',
  });
});
```

Run: `pnpm --filter backend exec jest src/track-corrections/track-corrections.service.spec.ts`
Expected: FAIL — `updateTrack` called without `{ skipAudit: true }`; the new test sees two audit rows.

In `apps/backend/src/track-corrections/track-corrections.service.ts`, in `approve`, replace

```ts
await this.tracksService.updateTrack(correction.trackId, adminId, true, patch, tx);
```

with

```ts
// skipAudit: this decision is logged once, as TRACK_CORRECTION_APPROVE.
await this.tracksService.updateTrack(correction.trackId, adminId, true, patch, tx, {
  skipAudit: true,
});
```

Run: `pnpm --filter backend exec jest src/track-corrections src/tracks`
Expected: PASS.

- [ ] **Step 8: Keep the track 409 details through the global filter**

Append in `apps/backend/src/common/filters/http-exception.filter.spec.ts`, after the test "carries the club-usage counts through a 409, and nothing else":

```ts
it('carries the track 409 details (duplicate import, pending corrections)', () => {
  filter.catch(
    new HttpException(
      { message: 'Cette musique est déjà dans la bibliothèque.', existingTrackId: 't1' },
      HttpStatus.CONFLICT,
    ),
    mockArgumentsHost,
  );
  expect(mockResponse.json.mock.lastCall?.[0]).toMatchObject({ existingTrackId: 't1' });

  filter.catch(
    new HttpException(
      { message: 'Des propositions de correction sont en attente', pendingCorrections: 2 },
      HttpStatus.CONFLICT,
    ),
    mockArgumentsHost,
  );
  expect(mockResponse.json.mock.lastCall?.[0]).toMatchObject({ pendingCorrections: 2 });
});
```

Run: `pnpm --filter backend exec jest src/common/filters/http-exception.filter.spec.ts`
Expected: FAIL — the keys are dropped.

In `apps/backend/src/common/filters/http-exception.filter.ts`, replace

```ts
  "soloTeamCount",
] as const;
```

with

```ts
  "soloTeamCount",
  // Track library: the existing track of a duplicate import, and the pending
  // corrections that block a deletion.
  "existingTrackId",
  "pendingCorrections",
] as const;
```

and in the comment above the `body` constant, replace `(create / rename) or what still points at a club (delete).` with `(create / rename), what still points at a club (delete), the existing track of a duplicate import, or the corrections that block a track deletion.`

Run: `pnpm --filter backend exec jest src/common/filters/http-exception.filter.spec.ts`
Expected: PASS.

- [ ] **Step 9: Real-DB integration — audit once, no double row on approval, delete refusal**

Create `apps/backend/test/tracks.integration-spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { Prisma, TrackCorrectionReason, TrackStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrackCorrectionsService } from '../src/track-corrections/track-corrections.service';
import { TrackFilesService } from '../src/tracks/track-files.service';
import { TracksService } from '../src/tracks/tracks.service';
import { buildServiceModule } from './integration-app.builder';

describe('Tracks (integration, real DB)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tracks: TracksService;
  let corrections: TrackCorrectionsService;
  // No blob, no disk: the file store is a double.
  const files = {
    save: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const trackIds: string[] = [];
  const userIds: string[] = [];
  const correctionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule({
      extra: (builder) => builder.overrideProvider(TrackFilesService).useValue(files),
    });
    moduleRef = built.module;
    prisma = built.prisma;
    tracks = moduleRef.get(TracksService);
    corrections = moduleRef.get(TrackCorrectionsService);
  });

  beforeEach(() => jest.clearAllMocks());

  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: [...trackIds, ...correctionIds] } },
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

  const adminUser = async (): Promise<string> => {
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

  const track = async (
    title: string,
    extra: Partial<Prisma.TrackUncheckedCreateInput> = {},
  ): Promise<string> => {
    const row = await prisma.track.create({
      data: { title, artist: 'Orchestre', filename: `${randomUUID()}.mp3`, ...extra },
      select: { id: true },
    });
    trackIds.push(row.id);
    return row.id;
  };

  const correction = async (
    trackId: string,
    reason: TrackCorrectionReason,
    extra: Partial<Prisma.TrackCorrectionUncheckedCreateInput> = {},
  ): Promise<string> => {
    const row = await prisma.trackCorrection.create({
      data: { trackId, reason, ...extra },
      select: { id: true },
    });
    correctionIds.push(row.id);
    return row.id;
  };

  it('audits a PATCH (web or mobile) once, with the MPM recomputed for the new dance', async () => {
    const admin = await adminUser();
    const id = await track('Audit', {
      rawBpm: 100,
      bpm: 50,
      style: 'Samba',
      status: TrackStatus.READY,
    });

    await tracks.updateTrack(id, admin, true, { style: 'Rumba' });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: 'TRACK', targetId: id },
      select: { action: true, actorId: true, before: true, after: true },
      take: 10,
    });
    expect(rows).toEqual([
      {
        action: 'TRACK_UPDATE',
        actorId: admin,
        before: { style: 'Samba', bpm: 50 },
        after: { style: 'Rumba', bpm: 25 },
      },
    ]);
  });

  it('an approval writes its own audit row only, never a TRACK_UPDATE', async () => {
    const admin = await adminUser();
    const id = await track('Approval', { bpm: 60 });
    const proposal = await correction(id, TrackCorrectionReason.MPM, { proposedBpm: 62 });

    await corrections.approve(proposal, admin, {});

    expect(await prisma.adminAuditLog.count({ where: { targetType: 'TRACK', targetId: id } })).toBe(
      0,
    );
    expect(
      await prisma.adminAuditLog.findMany({
        where: { targetId: proposal },
        select: { action: true },
        take: 10,
      }),
    ).toEqual([{ action: 'TRACK_CORRECTION_APPROVE' }]);
  });

  it('refuses to delete a track with a pending proposal, then deletes it once decided', async () => {
    const admin = await adminUser();
    const id = await track('Delete', {
      sourceKey: `test:${randomUUID()}`,
      artwork: `${randomUUID()}.jpg`,
    });
    const proposal = await correction(id, TrackCorrectionReason.OTHER, { message: 'x' });

    const refused = await tracks.deleteTrack(id, admin).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect(await prisma.track.count({ where: { id } })).toBe(1);

    await corrections.reject(proposal, admin, {});
    await tracks.deleteTrack(id, admin);

    expect(await prisma.track.count({ where: { id } })).toBe(0);
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { targetType: 'TRACK', targetId: id },
        select: { action: true, before: true },
      }),
    ).toMatchObject({ action: 'TRACK_DELETE', before: { title: 'Delete', artist: 'Orchestre' } });
    expect(files.remove).toHaveBeenCalledWith([
      expect.stringMatching(/\.mp3$/),
      expect.stringMatching(/\.jpg$/),
    ]);
  });
});
```

(`trackIds`, `correctionIds`, `track`, `correction` and `files` are reused by the tests of Tasks 3 and 4 in the same file.)

Run (test DB only):

```bash
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit tracks.integration-spec track-corrections.integration-spec'
```

Expected: PASS (3 new tests; the lot 2 moderation integration tests stay green).

- [ ] **Step 10: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
pnpm --filter backend exec jest src/admin src/tracks src/track-corrections src/common/filters
git add apps/backend/src/admin/dto apps/backend/src/utils/prisma-selects.ts apps/backend/src/tracks apps/backend/src/track-corrections apps/backend/src/common/filters apps/backend/test/tracks.integration-spec.ts
git commit -m "feat(tracks): audit track edits and deletions, refuse a deletion with pending corrections

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 3: `GET /admin/tracks`, `GET /admin/tracks/:id` and the `trackId` filter of the moderation queue

**Files:**

- Create: `apps/backend/src/tracks/dance-labels.ts`
- Modify: `apps/backend/src/tracks/track-visibility.util.ts` (after `LIBRARY_TRACK_WHERE`, l. 19), `apps/backend/src/tracks/track-visibility.util.spec.ts` (append)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (import at the top, append after `trackDeletionSelect` of Task 2)
- Create: `apps/backend/src/tracks/dto/admin-track.dto.ts`, `apps/backend/src/tracks/dto/admin-track.dto.spec.ts`
- Create: `apps/backend/src/tracks/admin-tracks.query-service.ts`, `apps/backend/src/tracks/admin-tracks.query-service.spec.ts`
- Create: `apps/backend/src/tracks/admin-tracks.controller.ts`, `apps/backend/src/tracks/admin-tracks.controller.spec.ts`
- Modify: `apps/backend/src/tracks/tracks.module.ts` (controllers, providers)
- Modify: `apps/backend/src/track-corrections/dto/track-correction.dto.ts` (end of `ListTrackCorrectionsQueryDto`, l. 194-208)
- Modify: `apps/backend/src/track-corrections/track-corrections.query-service.ts` (`where` of `listForAdmin`, l. 68-74)
- Modify: `apps/backend/src/track-corrections/track-corrections.query-service.spec.ts` (append inside `describe("listForAdmin")`)
- Modify: `apps/backend/src/track-corrections/track-corrections.controller.spec.ts` (append inside `describe("DTO de proposition")`)
- Modify: `apps/backend/test/admin.e2e-spec.ts` (`ADMIN_ROUTES` l. 14-37, imports, new tests at the end of the `describe`)
- Modify: `apps/backend/test/tracks.integration-spec.ts` (imports, new test)

**Interfaces:**

- Consumes: `PaginationParamsDto`, `createPaginatedResponse`, `AdminPageMetaDto`, `TrackStatus`, `TrackCorrectionStatus`.
- Produces:
  - `TRACK_DANCE_LABELS` (readonly tuple of the 10 labels), `AMBIANCE_STYLE = "Ambiance"`, `TRACK_STYLE_OPTIONS`, `type TrackStyleOption`.
  - `AMBIANCE_TRACK_WHERE`, `NOT_AMBIANCE_TRACK_WHERE: Prisma.TrackWhereInput`.
  - `adminTrackSelect` (DTO fields + `_count.corrections` filtered on PENDING).
  - `ListAdminTracksQueryDto` (`q?`, `status?`, `blacklisted?`, `titleMasked?`, `style?`, `ambiance?` + pagination), `AdminTrackDto`, `AdminTracksPageDto`, `ADMIN_TRACK_SEARCH_MIN_LENGTH = 2`, `ADMIN_TRACK_SEARCH_MAX_LENGTH = 100`.
  - `adminTracksWhere(query): Prisma.TrackWhereInput`, `toAdminTrackDto(row): AdminTrackDto`, `AdminTracksQueryService.list(query): Promise<AdminTracksPageDto>`, `AdminTracksQueryService.detail(id): Promise<AdminTrackDto>`.
  - `AdminTracksController` (`@Controller("admin/tracks")`): `list` → `AdminTracksController_list` → SDK `adminTracksControllerList`; `findOne` → `AdminTracksController_findOne` → `adminTracksControllerFindOne` (Task 5).
  - `ListTrackCorrectionsQueryDto.trackId?: string`.

- [ ] **Step 1: Write the failing filter tests**

Create `apps/backend/src/tracks/dance-labels.ts`:

```ts
/**
 * Canonical dance labels stored in Track.style: the dances the mobile track
 * editor offers (apps/client/src/features/player/utils/danceTempo.ts,
 * DANCE_GROUPS, same order) and that track-prep writes in its manifest. Each
 * one is recognised by BpmService.calculateMpm (pinned by mpm-parity.spec.ts).
 */
export const TRACK_DANCE_LABELS = [
  'Valse Lente',
  'Tango',
  'Valse Viennoise',
  'Quickstep',
  'Slow Fox',
  'Samba',
  'Cha-cha',
  'Rumba',
  'Paso Doble',
  'Jive',
] as const;

/** Style (or artist) of the pause music of the competition mode, kept out of the library. */
export const AMBIANCE_STYLE = 'Ambiance';

/** Values accepted as `style` by the back-office import. */
export const TRACK_STYLE_OPTIONS = [...TRACK_DANCE_LABELS, AMBIANCE_STYLE] as const;
export type TrackStyleOption = (typeof TRACK_STYLE_OPTIONS)[number];
```

Append to `apps/backend/src/tracks/track-visibility.util.spec.ts` (add `AMBIANCE_TRACK_WHERE, NOT_AMBIANCE_TRACK_WHERE` to its import from `./track-visibility.util`):

```ts
describe('Ambiance filters of the admin catalogue', () => {
  it('matches the style OR the artist « Ambiance », any case', () => {
    expect(AMBIANCE_TRACK_WHERE).toEqual({
      OR: [
        { style: { equals: 'Ambiance', mode: 'insensitive' } },
        { artist: { equals: 'Ambiance', mode: 'insensitive' } },
      ],
    });
  });

  it('keeps the tracks whose style is null when excluding the ambiance', () => {
    expect(NOT_AMBIANCE_TRACK_WHERE).toEqual({
      AND: [
        { artist: { not: { equals: 'Ambiance' }, mode: 'insensitive' } },
        {
          OR: [{ style: { not: { equals: 'Ambiance' }, mode: 'insensitive' } }, { style: null }],
        },
      ],
    });
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/track-visibility.util.spec.ts`
Expected: FAIL — the two constants are not exported.

- [ ] **Step 2: Implement the ambiance filters**

In `apps/backend/src/tracks/track-visibility.util.ts`, add `import { AMBIANCE_STYLE } from "./dance-labels";` after the `@prisma/client` import, and insert after `LIBRARY_TRACK_WHERE`:

```ts
/** Ambiance tracks (pause music of the competition mode): style OR artist « Ambiance », any case. */
export const AMBIANCE_TRACK_WHERE: Prisma.TrackWhereInput = {
  OR: [
    { style: { equals: AMBIANCE_STYLE, mode: 'insensitive' } },
    { artist: { equals: AMBIANCE_STYLE, mode: 'insensitive' } },
  ],
};

/**
 * Every other track. Deliberately not `NOT: AMBIANCE_TRACK_WHERE`: in SQL,
 * NOT (style ILIKE 'Ambiance') is NULL for a null style, which would drop
 * every track without a dance (same construction as LIBRARY_TRACK_WHERE).
 */
export const NOT_AMBIANCE_TRACK_WHERE: Prisma.TrackWhereInput = {
  AND: [
    { artist: { not: { equals: AMBIANCE_STYLE }, mode: 'insensitive' } },
    {
      OR: [{ style: { not: { equals: AMBIANCE_STYLE }, mode: 'insensitive' } }, { style: null }],
    },
  ],
};
```

Run: `pnpm --filter backend exec jest src/tracks/track-visibility.util.spec.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing DTO tests**

Create `apps/backend/src/tracks/dto/admin-track.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListAdminTracksQueryDto } from './admin-track.dto';

describe('ListAdminTracksQueryDto', () => {
  const parse = (plain: Record<string, unknown>) => plainToInstance(ListAdminTracksQueryDto, plain);
  const errors = (plain: Record<string, unknown>) =>
    validateSync(parse(plain)).map((e) => e.property);

  it('reads only the strings true and false as booleans, "false" included', () => {
    const dto = parse({ blacklisted: 'false', titleMasked: 'true', ambiance: 'false' });
    expect(dto).toMatchObject({ blacklisted: false, titleMasked: true, ambiance: false });
    expect(errors({ blacklisted: 'false', titleMasked: 'true', ambiance: 'false' })).toEqual([]);
  });

  it.each(['yes', '1', '', 'TRUE'])('refuses the flag value %p', (value) => {
    expect(errors({ blacklisted: value })).toEqual(['blacklisted']);
  });

  it('trims the search, then requires 2 to 100 characters', () => {
    expect(parse({ q: '  pa  ' }).q).toBe('pa');
    expect(errors({ q: '  pa  ' })).toEqual([]);
    expect(errors({ q: ' p ' })).toEqual(['q']);
    expect(errors({ q: 'x'.repeat(101) })).toEqual(['q']);
  });

  it('accepts the three statuses only', () => {
    expect(errors({ status: 'ERROR' })).toEqual([]);
    expect(errors({ status: 'DONE' })).toEqual(['status']);
  });

  it('trims the dance and bounds it', () => {
    expect(parse({ style: ' Rumba ' }).style).toBe('Rumba');
    expect(errors({ style: 'x'.repeat(65) })).toEqual(['style']);
    expect(errors({ style: '  ' })).toEqual(['style']);
  });

  it('keeps the pagination bounds', () => {
    expect(errors({ take: '100' })).toEqual([]);
    expect(errors({ take: '101' })).toEqual(['take']);
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/dto/admin-track.dto.spec.ts`
Expected: FAIL — `Cannot find module './admin-track.dto'`.

- [ ] **Step 4: Implement the DTOs and the select**

Create `apps/backend/src/tracks/dto/admin-track.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrackStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AdminPageMetaDto } from '../../admin/dto/admin-audit.dto';
import { PaginationParamsDto } from '../../common/dto/pagination-params.dto';

/** Bounds of the catalogue search (track title or artist). */
export const ADMIN_TRACK_SEARCH_MIN_LENGTH = 2;
export const ADMIN_TRACK_SEARCH_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Query-string flag: only the strings "true" and "false" (what the generated
 * clients send for a boolean). `@Type(() => Boolean)` would read "false" as
 * true; any other value stays a string and fails @IsBoolean.
 */
const toFlag = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * Admin catalogue filters. Unlike GET /tracks, no library filter: blacklisted,
 * pending, failed and ambiance tracks are listed too.
 */
export class ListAdminTracksQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({
    description: "Recherche dans le titre ou l'artiste, sans tenir compte de la casse",
    minLength: ADMIN_TRACK_SEARCH_MIN_LENGTH,
    maxLength: ADMIN_TRACK_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(ADMIN_TRACK_SEARCH_MIN_LENGTH)
  @MaxLength(ADMIN_TRACK_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: TrackStatus, enumName: 'TrackStatus' })
  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true : seulement les musiques blacklistées ; false : seulement les autres',
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  blacklisted?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true : seulement les titres masqués ; false : seulement les autres',
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  titleMasked?: boolean;

  @ApiPropertyOptional({
    description: 'Danse (libellé exact, sans tenir compte de la casse)',
    maxLength: 64,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  style?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      "true : seulement l'ambiance (style ou artiste « Ambiance ») ; false : tout sauf l'ambiance",
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  ambiance?: boolean;
}

/** One track as the back-office sees it (real title, moderation flags, status). */
export class AdminTrackDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Titre réel, même masqué' }) title!: string;
  @ApiProperty() artist!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Danse (texte libre ; « Ambiance » pour la musique de pause)',
  })
  style!: string | null;
  @ApiProperty({ description: 'Tempo en MPM (mesures par minute)' }) bpm!: number;
  @ApiProperty({ description: 'Tempo brut détecté (BPM), 0 si inconnu' }) rawBpm!: number;
  @ApiProperty({ type: [Number], description: 'Paso doble : timecodes (secondes) des clashs' })
  clashTimecodes!: number[];
  @ApiProperty() titleMasked!: boolean;
  @ApiProperty() blacklisted!: boolean;
  @ApiProperty({ enum: TrackStatus, enumName: 'TrackStatus' }) status!: TrackStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Source track-prep (ex. apple:1091542189)',
  })
  sourceKey!: string | null;
  @ApiProperty({
    description: 'Fichier audio, servi par GET /uploads/{filename} (hors préfixe /api/v1)',
  })
  filename!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Pochette, servie par GET /uploads/{artwork}',
  })
  artwork!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ description: 'Propositions de correction en attente' })
  pendingCorrections!: number;
}

export class AdminTracksPageDto {
  @ApiProperty({ type: [AdminTrackDto] }) data!: AdminTrackDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
```

In `apps/backend/src/utils/prisma-selects.ts`, insert after the file's opening doc comment (before the `userBaseSelect` doc comment):

```ts
import { TrackCorrectionStatus } from '@prisma/client';
```

and append after `trackDeletionSelect`:

```ts
/** Back-office catalogue: every field of AdminTrackDto, plus the pending corrections. */
export const adminTrackSelect = {
  id: true,
  title: true,
  artist: true,
  style: true,
  bpm: true,
  rawBpm: true,
  clashTimecodes: true,
  titleMasked: true,
  blacklisted: true,
  status: true,
  sourceKey: true,
  filename: true,
  artwork: true,
  createdAt: true,
  _count: {
    select: { corrections: { where: { status: TrackCorrectionStatus.PENDING } } },
  },
} as const;
```

Run: `pnpm --filter backend exec jest src/tracks/dto/admin-track.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing query-service tests**

Create `apps/backend/src/tracks/admin-tracks.query-service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { adminTrackSelect } from '../utils/prisma-selects';
import { AdminTracksQueryService } from './admin-tracks.query-service';
import { AMBIANCE_TRACK_WHERE, NOT_AMBIANCE_TRACK_WHERE } from './track-visibility.util';

const row = {
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Paso Doble',
  bpm: 60,
  rawBpm: 120.4,
  clashTimecodes: [40, 80],
  titleMasked: true,
  blacklisted: false,
  status: TrackStatus.READY,
  sourceKey: 'apple:1',
  filename: '3f2c.mp3',
  artwork: '3f2c.jpg',
  createdAt: new Date('2026-10-09T10:00:00Z'),
  _count: { corrections: 2 },
};

describe('AdminTracksQueryService', () => {
  let prisma: MockPrismaService;
  let service: AdminTracksQueryService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminTracksQueryService(prisma as unknown as PrismaService);
  });

  it('lists every track (no library filter), newest first, with the pending count', async () => {
    prisma.track.count.mockResolvedValue(1);
    prisma.track.findMany.mockResolvedValue([row] as never);

    const page = await service.list({ skip: 0, take: 20 });

    expect(prisma.track.count).toHaveBeenCalledWith({ where: {} });
    expect(prisma.track.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      select: adminTrackSelect,
    });
    const { _count, ...fields } = row;
    expect(page.data).toEqual([{ ...fields, pendingCorrections: _count.corrections }]);
    expect(page.meta).toEqual({ total: 1, skip: 0, take: 20, hasMore: false });
  });

  it('combines every filter', async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({
      q: 'paso',
      status: TrackStatus.ERROR,
      blacklisted: false,
      titleMasked: true,
      style: 'Paso Doble',
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
                { title: { contains: 'paso', mode: 'insensitive' } },
                { artist: { contains: 'paso', mode: 'insensitive' } },
              ],
            },
            { status: TrackStatus.ERROR },
            { blacklisted: false },
            { titleMasked: true },
            { style: { equals: 'Paso Doble', mode: 'insensitive' } },
            AMBIANCE_TRACK_WHERE,
          ],
        },
        skip: 50,
        take: 50,
      }),
    );
  });

  it('excludes the ambiance with the null-safe filter', async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({ ambiance: false, skip: 0, take: 10 });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [NOT_AMBIANCE_TRACK_WHERE] } }),
    );
  });

  it('defaults to the first 20 tracks', async () => {
    prisma.track.count.mockResolvedValue(0);
    prisma.track.findMany.mockResolvedValue([]);

    await service.list({ skip: undefined, take: undefined });

    expect(prisma.track.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('returns one track with the same shape', async () => {
    prisma.track.findUnique.mockResolvedValue(row as never);

    await expect(service.detail('t1')).resolves.toMatchObject({ id: 't1', pendingCorrections: 2 });
    expect(prisma.track.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: adminTrackSelect,
    });
  });

  it('answers 404 for an unknown track', async () => {
    prisma.track.findUnique.mockResolvedValue(null);
    await expect(service.detail('nope')).rejects.toThrow(NotFoundException);
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/admin-tracks.query-service.spec.ts`
Expected: FAIL — `Cannot find module './admin-tracks.query-service'`.

- [ ] **Step 6: Implement the query service**

Create `apps/backend/src/tracks/admin-tracks.query-service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { adminTrackSelect } from '../utils/prisma-selects';
import { AdminTrackDto, AdminTracksPageDto, ListAdminTracksQueryDto } from './dto/admin-track.dto';
import { AMBIANCE_TRACK_WHERE, NOT_AMBIANCE_TRACK_WHERE } from './track-visibility.util';

const DEFAULT_TAKE = 20;

type AdminTrackRow = Prisma.TrackGetPayload<{ select: typeof adminTrackSelect }>;

export function toAdminTrackDto({ _count, ...fields }: AdminTrackRow): AdminTrackDto {
  return { ...fields, pendingCorrections: _count.corrections };
}

/** Catalogue filter: every track; LIBRARY_TRACK_WHERE is deliberately absent. */
export function adminTracksWhere(query: ListAdminTracksQueryDto): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [];
  if (query.q) {
    and.push({
      OR: [
        { title: { contains: query.q, mode: 'insensitive' } },
        { artist: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }
  if (query.status) and.push({ status: query.status });
  if (query.blacklisted !== undefined) and.push({ blacklisted: query.blacklisted });
  if (query.titleMasked !== undefined) and.push({ titleMasked: query.titleMasked });
  if (query.style) and.push({ style: { equals: query.style, mode: 'insensitive' } });
  if (query.ambiance !== undefined) {
    and.push(query.ambiance ? AMBIANCE_TRACK_WHERE : NOT_AMBIANCE_TRACK_WHERE);
  }
  return and.length > 0 ? { AND: and } : {};
}

/** Reads of the back-office track catalogue. */
@Injectable()
export class AdminTracksQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminTracksQueryDto): Promise<AdminTracksPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where = adminTracksWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: adminTrackSelect,
      }),
    ]);
    return createPaginatedResponse(rows.map(toAdminTrackDto), total, skip, take);
  }

  async detail(id: string): Promise<AdminTrackDto> {
    const row = await this.prisma.track.findUnique({
      where: { id },
      select: adminTrackSelect,
    });
    if (!row) throw new NotFoundException('Musique introuvable');
    return toAdminTrackDto(row);
  }
}
```

Run: `pnpm --filter backend exec jest src/tracks/admin-tracks.query-service.spec.ts`
Expected: PASS.

- [ ] **Step 7: The controller, ADMIN-only at class level**

Create `apps/backend/src/tracks/admin-tracks.controller.spec.ts`:

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminTracksController } from './admin-tracks.controller';
import { AdminTracksQueryService } from './admin-tracks.query-service';

describe('AdminTracksController', () => {
  const query = { list: jest.fn(), detail: jest.fn() };
  const controller = new AdminTracksController(query as unknown as AdminTracksQueryService);

  beforeEach(() => jest.clearAllMocks());

  it('is guarded and restricted to ADMIN at class level', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTracksController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminTracksController)).toEqual([UserRole.ADMIN]);
  });

  it('lists the catalogue with the filters', async () => {
    query.list.mockResolvedValue({ data: [], meta: {} });
    const filters = { ambiance: false, skip: 0, take: 50 };
    await expect(controller.list(filters)).resolves.toEqual({ data: [], meta: {} });
    expect(query.list).toHaveBeenCalledWith(filters);
  });

  it('returns one track', async () => {
    query.detail.mockResolvedValue({ id: 't1' });
    await expect(controller.findOne('t1')).resolves.toEqual({ id: 't1' });
    expect(query.detail).toHaveBeenCalledWith('t1');
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/admin-tracks.controller.spec.ts`
Expected: FAIL — `Cannot find module './admin-tracks.controller'`.

Create `apps/backend/src/tracks/admin-tracks.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { AdminTracksQueryService } from './admin-tracks.query-service';
import { AdminTrackDto, AdminTracksPageDto, ListAdminTracksQueryDto } from './dto/admin-track.dto';

/**
 * Back-office track catalogue and import. Guards and role are set on the
 * CLASS (as AdminController): no route can be exposed by omission. Edits and
 * deletions go through PATCH / DELETE /tracks/:id, shared with the mobile app.
 */
@ApiTags('admin')
@ApiCommonErrorResponses()
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/tracks')
export class AdminTracksController {
  constructor(private readonly query: AdminTracksQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'Catalogue des musiques (vue administrateur)',
    description:
      "Toutes les musiques, y compris blacklistées, en attente, en erreur et d'ambiance (pas de filtre bibliothèque). Plus récentes d'abord. Filtres : q (titre ou artiste, 2 à 100 caractères), status, blacklisted, titleMasked, style, ambiance.",
  })
  @ApiResponse({ status: 200, type: AdminTracksPageDto })
  list(@Query() query: ListAdminTracksQueryDto): Promise<AdminTracksPageDto> {
    return this.query.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Une musique (vue administrateur)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: AdminTrackDto })
  @ApiResponse({ status: 404, description: 'Musique introuvable' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTrackDto> {
    return this.query.detail(id);
  }
}
```

In `apps/backend/src/tracks/tracks.module.ts`, import `AdminTracksController` and `AdminTracksQueryService`, and replace the `controllers` / `providers` lines with:

```ts
  controllers: [TracksController, AdminTracksController, UploadsFallbackController],
  providers: [TracksService, BpmService, TrackFilesService, AdminTracksQueryService],
```

Run: `pnpm --filter backend exec jest src/tracks`
Expected: PASS.

- [ ] **Step 8: `trackId` on the moderation queue**

Append inside `describe("listForAdmin", ...)` of `apps/backend/src/track-corrections/track-corrections.query-service.spec.ts`:

```ts
it("filters on one track's proposals", async () => {
  prisma.trackCorrection.count.mockResolvedValue(0);
  prisma.trackCorrection.findMany.mockResolvedValue([]);

  await service.listForAdmin({
    status: TrackCorrectionStatus.PENDING,
    trackId: '4f1c2a8e-1b2c-4d5e-8f90-123456789abc',
    skip: 0,
    take: 10,
  });

  expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        status: TrackCorrectionStatus.PENDING,
        trackId: '4f1c2a8e-1b2c-4d5e-8f90-123456789abc',
      },
    }),
  );
});
```

Append inside `describe("DTO de proposition", ...)` of `apps/backend/src/track-corrections/track-corrections.controller.spec.ts`:

```ts
it('accepts a track filter by UUID only', async () => {
  await expect(
    errorsOf(ListTrackCorrectionsQueryDto, { trackId: '4f1c2a8e-1b2c-4d5e-8f90-123456789abc' }),
  ).resolves.toEqual([]);
  await expect(errorsOf(ListTrackCorrectionsQueryDto, { trackId: 't1' })).resolves.toContain(
    'trackId',
  );
});
```

Run: `pnpm --filter backend exec jest src/track-corrections`
Expected: FAIL — `trackId` is not a property of the query DTO (TypeScript) and is refused by the whitelist.

In `apps/backend/src/track-corrections/dto/track-correction.dto.ts`, append inside `ListTrackCorrectionsQueryDto`, after `q`:

```ts

  @ApiPropertyOptional({
    description: "Propositions d'une seule musique (lien depuis la fiche musique)",
    format: "uuid",
  })
  @IsOptional()
  @IsUUID()
  trackId?: string;
```

In `apps/backend/src/track-corrections/track-corrections.query-service.ts`, in `listForAdmin`, replace

```ts
      ...(query.q && { track: trackSearchWhere(query.q) }),
    };
```

with

```ts
      ...(query.q && { track: trackSearchWhere(query.q) }),
      ...(query.trackId && { trackId: query.trackId }),
    };
```

and update the comment above it to `// Without reason/q/trackId the where is exactly the one of lot 1 (mobile contract).`

Run: `pnpm --filter backend exec jest src/track-corrections`
Expected: PASS.

- [ ] **Step 9: Mocked e2e — role matrix and query-string parsing**

In `apps/backend/test/admin.e2e-spec.ts`, add `import { NOT_AMBIANCE_TRACK_WHERE } from "../src/tracks/track-visibility.util";` to the imports, and append to `ADMIN_ROUTES` (before the closing `];`):

```ts
  // Track catalogue (lot 3): ADMIN-only at class level.
  ["get", "/api/v1/admin/tracks"],
  ["get", "/api/v1/admin/tracks/00000000-0000-4000-8000-000000000000"],
```

(The two `POST` routes are added to the matrix in Task 4, with the routes themselves: an unknown route answers 404 before any guard runs.)

Append at the end of `describe("Admin routes (e2e) — role matrix", ...)`:

```ts
it('parses the catalogue flags as booleans, "false" included', async () => {
  currentRole = UserRole.ADMIN;
  prisma.track.count.mockResolvedValue(0);
  prisma.track.findMany.mockResolvedValue([]);
  await request(server())
    .get(
      '/api/v1/admin/tracks?blacklisted=false&titleMasked=true&ambiance=false&status=ERROR&q=%20paso%20&style=Rumba&take=50',
    )
    .expect(200);
  expect(prisma.track.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: 'paso', mode: 'insensitive' } },
              { artist: { contains: 'paso', mode: 'insensitive' } },
            ],
          },
          { status: 'ERROR' },
          { blacklisted: false },
          { titleMasked: true },
          { style: { equals: 'Rumba', mode: 'insensitive' } },
          NOT_AMBIANCE_TRACK_WHERE,
        ],
      },
      take: 50,
    }),
  );
});

it.each(['blacklisted=yes', 'ambiance=1', 'status=DONE', 'q=p', 'take=101'])(
  'refuses the catalogue filter %s (400)',
  async (qs) => {
    currentRole = UserRole.ADMIN;
    await request(server()).get(`/api/v1/admin/tracks?${qs}`).expect(400);
  },
);

it('GET /admin/tracks/:id answers 404 for an unknown track and 400 for a non-UUID', async () => {
  currentRole = UserRole.ADMIN;
  prisma.track.findUnique.mockResolvedValue(null);
  await request(server())
    .get('/api/v1/admin/tracks/00000000-0000-4000-8000-000000000000')
    .expect(404);
  await request(server()).get('/api/v1/admin/tracks/not-a-uuid').expect(400);
});

it('filters the moderation queue on one track', async () => {
  currentRole = UserRole.ADMIN;
  prisma.trackCorrection.count.mockResolvedValue(0);
  prisma.trackCorrection.findMany.mockResolvedValue([]);
  await request(server())
    .get('/api/v1/track-corrections?trackId=00000000-0000-4000-8000-000000000000')
    .expect(200);
  expect(prisma.trackCorrection.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { trackId: '00000000-0000-4000-8000-000000000000' } }),
  );
});
```

Run the mocked e2e (see "How to run tests"): `pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec`
Expected: PASS (role matrix of the two new routes for `LICENSEE`, `CLUB`, `STAFF` and unauthenticated, plus the new tests). Run it once with `@Transform(toFlag)` temporarily replaced by `@Type(() => Boolean)` on `blacklisted` to see the first test fail with `{ blacklisted: true }`, then restore.

- [ ] **Step 10: Real-DB integration — the catalogue filters**

In `apps/backend/test/tracks.integration-spec.ts`, add to the imports:

```ts
import { TrackCorrectionStatus } from '@prisma/client';
import { AdminTracksQueryService } from '../src/tracks/admin-tracks.query-service';
import { ListAdminTracksQueryDto } from '../src/tracks/dto/admin-track.dto';
```

(merge `TrackCorrectionStatus` into the existing `@prisma/client` import), and append inside the `describe`:

```ts
it('lists every track for the admin and filters them; ambiance=false keeps a null style', async () => {
  const queries = moduleRef.get(AdminTracksQueryService);
  const token = `zt${randomUUID().slice(0, 6)}`;
  const a = await track(`Rumba ${token}`, { style: 'Rumba', status: TrackStatus.READY });
  const b = await track(`${token} pause`, { artist: 'Ambiance', status: TrackStatus.READY });
  const c = await track(`Nuit ${token}`, { blacklisted: true, status: TrackStatus.ERROR });
  const d = await track(`Jour ${token}`, { style: 'ambiance', titleMasked: true });
  await correction(a, TrackCorrectionReason.MPM, { proposedBpm: 26 });
  await correction(a, TrackCorrectionReason.TITLE, { status: TrackCorrectionStatus.REJECTED });

  const ids = async (filter: Partial<ListAdminTracksQueryDto>) =>
    (await queries.list({ q: token, skip: 0, take: 100, ...filter })).data.map((t) => t.id).sort();

  expect(await ids({})).toEqual([a, b, c, d].sort());
  expect(await ids({ status: TrackStatus.ERROR })).toEqual([c]);
  expect(await ids({ blacklisted: true })).toEqual([c]);
  expect(await ids({ blacklisted: false })).toEqual([a, b, d].sort());
  expect(await ids({ titleMasked: true })).toEqual([d]);
  expect(await ids({ style: 'RUMBA' })).toEqual([a]);
  expect(await ids({ ambiance: true })).toEqual([b, d].sort());
  // c has no style: a NOT (… OR …) filter would have dropped it.
  expect(await ids({ ambiance: false })).toEqual([a, c].sort());

  const page = await queries.list({ q: token, skip: 0, take: 100 });
  expect(page.meta.total).toBe(4);
  expect(page.data.find((t) => t.id === a)?.pendingCorrections).toBe(1);
  expect(page.data.find((t) => t.id === d)).toMatchObject({
    titleMasked: true,
    title: `Jour ${token}`,
  });
});
```

Run (test DB only):

```bash
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit tracks.integration-spec'
```

Expected: PASS (4 tests).

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
git add apps/backend/src/tracks apps/backend/src/utils/prisma-selects.ts apps/backend/src/track-corrections apps/backend/test/admin.e2e-spec.ts apps/backend/test/tracks.integration-spec.ts
git commit -m "feat(tracks): admin catalogue GET /admin/tracks and GET /admin/tracks/:id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 4: `POST /admin/tracks/check` and the multipart `POST /admin/tracks`

**Files:**

- Create: `apps/backend/src/tracks/track-file-signature.util.ts`, `apps/backend/src/tracks/track-file-signature.util.spec.ts`
- Create: `apps/backend/src/tracks/dto/track-import.dto.ts`, `apps/backend/src/tracks/dto/track-import.dto.spec.ts`
- Modify: `apps/backend/src/utils/prisma-selects.ts` (append after `adminTrackSelect` of Task 3)
- Create: `apps/backend/src/tracks/track-import.service.ts`, `apps/backend/src/tracks/track-import.service.spec.ts`
- Modify: `apps/backend/src/tracks/admin-tracks.controller.ts` (imports, constructor, two methods), `apps/backend/src/tracks/admin-tracks.controller.spec.ts` (construction l. 9-10, new tests)
- Modify: `apps/backend/src/tracks/tracks.module.ts` (providers)
- Create: `apps/backend/test/fixtures/mpm-cases.json`, `apps/backend/src/tracks/mpm-parity.spec.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts` (`ADMIN_ROUTES`, new tests at the end)
- Modify: `apps/backend/test/tracks.integration-spec.ts` (imports, new test)

**Interfaces:**

- Consumes: `TracksService.bpmForPatch(rawBpm, { bpm, style })`, `BpmService.analyzeBpm(filePath)` / `calculateMpm`, `TrackFilesService.save` / `remove` (Task 1), `AdminAuditService.record`, `AdminTracksQueryService.detail` (Task 3), `TRACK_STYLE_OPTIONS` (Task 3), `createMemoryUploadStorage()` (`src/utils/upload-storage.util.ts`), `withTimeout`, `idOnlySelect`.
- Produces:
  - `isMp3(buffer: Buffer): boolean`, `artworkExtension(buffer: Buffer): ArtworkExtension | null`, `type ArtworkExtension = "jpg" | "png"`.
  - `TRACK_CHECK_MAX_ITEMS = 200`; `CheckTrackItemDto { sourceKey?: string; sha256: string }`, `CheckTracksDto { items }`, `TrackCheckResultDto { exists: boolean; trackId?: string }`, `CheckTracksResultDto { items }`, `ImportTrackDto { title; artist; style?: TrackStyleOption; mpm?: number; rawBpm?: number; sourceKey?: string; sha256 }`.
  - `trackDuplicateSelect` (`id`, `sourceKey`, `contentHash`).
  - `TRACK_IMPORT_MAX_AUDIO_BYTES`, `TRACK_IMPORT_MAX_ARTWORK_BYTES`, `TRACK_IMPORT_JOB_ID = "admin-import"`, `TRACK_TEMPO_ANALYSIS_TIMEOUT_MS = 60_000`, `TRACK_DUPLICATE_MESSAGE`, `TRACK_IMPORT_MULTIPART_LIMITS`, `interface UploadedTrackFile { buffer: Buffer; size: number }`.
  - `TrackImportService.check(items): Promise<CheckTracksResultDto>`, `TrackImportService.importTrack(actorId, dto, audio?, artwork?): Promise<AdminTrackDto>`.
  - `AdminTracksController` constructor `(query: AdminTracksQueryService, importer: TrackImportService)`; `check` → `AdminTracksController_check` → SDK `adminTracksControllerCheck`; `create` → `AdminTracksController_create` → `adminTracksControllerCreate` (body `AdminTracksControllerCreateData['body']`, multipart).

- [ ] **Step 1: Write the failing signature tests**

Create `apps/backend/src/tracks/track-file-signature.util.spec.ts`:

```ts
import { artworkExtension, isMp3 } from './track-file-signature.util';

const bytes = (...values: number[]) => Buffer.from(values);

describe('track file signatures', () => {
  it.each([
    ['an ID3v2 tag', Buffer.from('ID3\u0003\u0000')],
    ['an MPEG-1 Layer III frame', bytes(0xff, 0xfb, 0x90, 0x64)],
    ['an MPEG-2 Layer III frame', bytes(0xff, 0xf3, 0x48, 0xc4)],
  ])('recognises %s as MP3', (_label, buffer) => {
    expect(isMp3(buffer)).toBe(true);
  });

  it.each([
    ['a WAV file', Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')],
    ['an ADTS AAC frame (layer 00)', bytes(0xff, 0xf1, 0x50, 0x80)],
    ['a frame with the reserved MPEG version', bytes(0xff, 0xeb, 0x90, 0x64)],
    ['a frame with the forbidden bitrate', bytes(0xff, 0xfb, 0xf0, 0x64)],
    ['a PNG', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ['an empty file', Buffer.alloc(0)],
    ['a two-byte file', bytes(0xff, 0xfb)],
  ])('refuses %s', (_label, buffer) => {
    expect(isMp3(buffer)).toBe(false);
  });

  it('names the artwork after its content', () => {
    expect(artworkExtension(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('jpg');
    expect(artworkExtension(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe(
      'png',
    );
    expect(artworkExtension(Buffer.from('GIF89a'))).toBeNull();
    expect(artworkExtension(Buffer.from('ID3'))).toBeNull();
    expect(artworkExtension(bytes(0x89, 0x50, 0x4e))).toBeNull();
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/track-file-signature.util.spec.ts`
Expected: FAIL — `Cannot find module './track-file-signature.util'`.

- [ ] **Step 2: Implement the signatures**

Create `apps/backend/src/tracks/track-file-signature.util.ts`:

```ts
/**
 * Track uploads are recognised by their first bytes, never by the client's
 * file name or declared type.
 */

/** MP3: an ID3v2 tag, or an MPEG audio frame header (Layer I–III). */
export function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  // "ID3"
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return true;
  if (buffer.length < 4) return false;
  const sync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  const version = (buffer[1] >> 3) & 0x03; // 01 = reserved
  const layer = (buffer[1] >> 1) & 0x03; // 00 = reserved (ADTS AAC uses it)
  const bitrate = (buffer[2] >> 4) & 0x0f; // 1111 = forbidden
  return sync && version !== 0x01 && layer !== 0x00 && bitrate !== 0x0f;
}

export type ArtworkExtension = 'jpg' | 'png';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Extension of a JPEG or PNG artwork, or null for anything else. */
export function artworkExtension(buffer: Buffer): ArtworkExtension | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
  ) {
    return 'png';
  }
  return null;
}
```

Run: `pnpm --filter backend exec jest src/tracks/track-file-signature.util.spec.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing DTO tests**

Create `apps/backend/src/tracks/dto/track-import.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CheckTracksDto, ImportTrackDto } from './track-import.dto';

const SHA = 'a'.repeat(64);

describe('ImportTrackDto (multipart fields)', () => {
  const parse = (plain: Record<string, unknown>) => plainToInstance(ImportTrackDto, plain);
  const errors = (plain: Record<string, unknown>) =>
    validateSync(parse(plain)).map((e) => e.property);
  const valid = { title: 'In the Mood', artist: 'Empress Orchestra', sha256: SHA };

  it('accepts a track-prep row sent as strings', () => {
    const plain = {
      ...valid,
      style: 'Jive',
      mpm: '42',
      rawBpm: '169.64',
      sourceKey: ' apple:1091542189 ',
      sha256: 'A'.repeat(64),
    };
    expect(errors(plain)).toEqual([]);
    expect(parse(plain)).toMatchObject({
      style: 'Jive',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1091542189',
      sha256: SHA,
    });
  });

  it('treats empty optional fields as absent', () => {
    const plain = { ...valid, style: '', mpm: '', rawBpm: ' ', sourceKey: '' };
    expect(errors(plain)).toEqual([]);
    expect(parse(plain)).toMatchObject({
      style: undefined,
      mpm: undefined,
      rawBpm: undefined,
      sourceKey: undefined,
    });
  });

  it('accepts « Ambiance » and every canonical dance, nothing else', () => {
    expect(errors({ ...valid, style: 'Ambiance' })).toEqual([]);
    expect(errors({ ...valid, style: 'Valse Viennoise' })).toEqual([]);
    expect(errors({ ...valid, style: 'Valse' })).toEqual(['style']);
    expect(errors({ ...valid, style: 'rumba' })).toEqual(['style']);
  });

  it.each([
    ['title', { title: '' }],
    ['title', { title: 'x'.repeat(201) }],
    ['artist', { artist: '   ' }],
    ['mpm', { mpm: '0' }],
    ['mpm', { mpm: '401' }],
    ['mpm', { mpm: '42.5' }],
    ['rawBpm', { rawBpm: 'abc' }],
    ['rawBpm', { rawBpm: '400.5' }],
    ['sourceKey', { sourceKey: 'x'.repeat(101) }],
    ['sha256', { sha256: 'xyz' }],
    ['sha256', { sha256: 'a'.repeat(63) }],
  ])('refuses a bad %s', (property, override) => {
    expect(errors({ ...valid, ...override })).toEqual([property]);
  });
});

describe('CheckTracksDto', () => {
  const errors = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(CheckTracksDto, plain)).map((e) => e.property);

  it('accepts 1 to 200 items', () => {
    expect(errors({ items: [{ sha256: SHA, sourceKey: 'apple:1' }] })).toEqual([]);
    expect(errors({ items: Array.from({ length: 200 }, () => ({ sha256: SHA })) })).toEqual([]);
  });

  it('refuses an empty list, more than 200 items, or a bad item', () => {
    expect(errors({ items: [] })).toEqual(['items']);
    expect(errors({ items: Array.from({ length: 201 }, () => ({ sha256: SHA })) })).toEqual([
      'items',
    ]);
    expect(errors({ items: [{ sha256: 'nope' }] })).toEqual(['items']);
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/dto/track-import.dto.spec.ts`
Expected: FAIL — `Cannot find module './track-import.dto'`.

- [ ] **Step 4: Implement the DTOs**

Create `apps/backend/src/tracks/dto/track-import.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TRACK_STYLE_OPTIONS, type TrackStyleOption } from '../dance-labels';

/** At most this many files per duplicate check (the SPA sends batches). */
export const TRACK_CHECK_MAX_ITEMS = 200;
export const TRACK_IMPORT_TEXT_MAX_LENGTH = 200;
export const TRACK_SOURCE_KEY_MAX_LENGTH = 100;
export const TRACK_TEMPO_MAX = 400;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Multipart fields arrive as strings: an empty optional field means "absent". */
const optionalText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Number from a multipart string. Not `@Type(() => Number)`: it would turn
 * an empty field into 0 before this transform runs. "abc" becomes NaN and
 * fails the number validators.
 */
const optionalNumber = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Number(trimmed);
};

const lowerHex = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CheckTrackItemDto {
  @ApiPropertyOptional({ maxLength: TRACK_SOURCE_KEY_MAX_LENGTH, example: 'apple:1091542189' })
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Length(1, TRACK_SOURCE_KEY_MAX_LENGTH)
  sourceKey?: string;

  @ApiProperty({
    description: 'SHA-256 du fichier audio (hexadécimal)',
    pattern: '^[0-9a-f]{64}$',
  })
  @Transform(lowerHex)
  @IsString()
  @Matches(SHA256_HEX)
  sha256!: string;
}

export class CheckTracksDto {
  @ApiProperty({ type: [CheckTrackItemDto], minItems: 1, maxItems: TRACK_CHECK_MAX_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRACK_CHECK_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CheckTrackItemDto)
  items!: CheckTrackItemDto[];
}

export class TrackCheckResultDto {
  @ApiProperty({ description: 'Une musique existe déjà (même source ou même fichier)' })
  exists!: boolean;

  @ApiPropertyOptional({ description: 'La musique existante' })
  trackId?: string;
}

export class CheckTracksResultDto {
  @ApiProperty({
    type: [TrackCheckResultDto],
    description: "Une réponse par élément, dans l'ordre de la requête",
  })
  items!: TrackCheckResultDto[];
}

/**
 * Text fields of POST /admin/tracks (multipart). The OpenAPI body, files
 * included, is described on the controller (@ApiBody schema).
 */
export class ImportTrackDto {
  @Transform(trim)
  @IsString()
  @Length(1, TRACK_IMPORT_TEXT_MAX_LENGTH)
  title!: string;

  @Transform(trim)
  @IsString()
  @Length(1, TRACK_IMPORT_TEXT_MAX_LENGTH)
  artist!: string;

  @IsOptional()
  @Transform(optionalText)
  @IsIn(TRACK_STYLE_OPTIONS)
  style?: TrackStyleOption;

  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  @Max(TRACK_TEMPO_MAX)
  mpm?: number;

  @IsOptional()
  @Transform(optionalNumber)
  @IsNumber()
  @Min(1)
  @Max(TRACK_TEMPO_MAX)
  rawBpm?: number;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Length(1, TRACK_SOURCE_KEY_MAX_LENGTH)
  sourceKey?: string;

  @Transform(lowerHex)
  @IsString()
  @Matches(SHA256_HEX)
  sha256!: string;
}
```

In `apps/backend/src/utils/prisma-selects.ts`, append after `adminTrackSelect`:

```ts
/** Duplicate lookup of the import: a hit by content hash or by source key. */
export const trackDuplicateSelect = {
  id: true,
  sourceKey: true,
  contentHash: true,
} as const;
```

Run: `pnpm --filter backend exec jest src/tracks/dto/track-import.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing import-service tests**

Create `apps/backend/src/tracks/track-import.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, TrackStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { AdminAuditService } from '../admin/admin-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { idOnlySelect, trackDuplicateSelect } from '../utils/prisma-selects';
import { AdminTracksQueryService } from './admin-tracks.query-service';
import { BpmService } from './bpm.service';
import { ImportTrackDto } from './dto/track-import.dto';
import { TrackFilesService } from './track-files.service';
import {
  TRACK_DUPLICATE_MESSAGE,
  TRACK_IMPORT_MAX_ARTWORK_BYTES,
  TRACK_IMPORT_MAX_AUDIO_BYTES,
  TrackImportService,
} from './track-import.service';
import { TracksService } from './tracks.service';

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64, 1)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const file = (buffer: Buffer, size = buffer.length) => ({ buffer, size });
const UUID_NAME = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const dto = (extra: Partial<ImportTrackDto> = {}): ImportTrackDto => ({
  title: 'In the Mood',
  artist: 'Empress Orchestra',
  style: 'Jive',
  rawBpm: 169.64,
  mpm: 42,
  sourceKey: 'apple:1',
  sha256: sha(MP3),
  ...extra,
});

describe('TrackImportService', () => {
  let prisma: MockPrismaService;
  let files: { save: jest.Mock; remove: jest.Mock };
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };
  let analyze: jest.SpyInstance;
  let service: TrackImportService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    prisma.track.findFirst.mockResolvedValue(null);
    prisma.track.create.mockResolvedValue({ id: 't-new' } as never);
    files = {
      save: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    query = { detail: jest.fn().mockResolvedValue({ id: 't-new' }) };
    // Real tempo rules (calculateMpm, bpmForPatch); only the ffmpeg analysis is faked.
    const bpm = new BpmService();
    analyze = jest.spyOn(bpm, 'analyzeBpm');
    const tracks = new TracksService(
      prisma as unknown as PrismaService,
      bpm,
      files as unknown as TrackFilesService,
      audit as unknown as AdminAuditService,
    );
    service = new TrackImportService(
      prisma as unknown as PrismaService,
      tracks,
      bpm,
      files as unknown as TrackFilesService,
      audit as unknown as AdminAuditService,
      query as unknown as AdminTracksQueryService,
    );
  });

  const createData = () =>
    (prisma.track.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
  const savedName = (index: number) => files.save.mock.calls[index][0] as string;
  const conflictOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => {
        expect(e).toBeInstanceOf(ConflictException);
        return (e as ConflictException).getResponse();
      },
    );

  describe('importTrack', () => {
    it('stores both files under server-generated names, then the row and its audit row', async () => {
      await expect(service.importTrack('admin-1', dto(), file(MP3), file(JPEG))).resolves.toEqual({
        id: 't-new',
      });

      expect(files.save).toHaveBeenCalledTimes(2);
      expect(savedName(0)).toMatch(new RegExp(`^${UUID_NAME}\\.mp3$`));
      expect(files.save.mock.calls[0][1]).toBe(MP3);
      expect(savedName(1)).toMatch(new RegExp(`^${UUID_NAME}\\.jpg$`));
      expect(files.save.mock.calls[1][1]).toBe(JPEG);
      expect(prisma.track.create).toHaveBeenCalledWith({
        data: {
          title: 'In the Mood',
          artist: 'Empress Orchestra',
          style: 'Jive',
          filename: savedName(0),
          artwork: savedName(1),
          bpm: 42,
          rawBpm: 169.64,
          status: TrackStatus.READY,
          sourceKey: 'apple:1',
          contentHash: sha(MP3),
          jobId: 'admin-import',
          submittedById: 'admin-1',
        },
        select: idOnlySelect,
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: 'admin-1',
        action: 'TRACK_CREATE',
        targetType: 'TRACK',
        targetId: 't-new',
        after: {
          title: 'In the Mood',
          artist: 'Empress Orchestra',
          style: 'Jive',
          bpm: 42,
          sourceKey: 'apple:1',
          status: TrackStatus.READY,
        },
      });
      expect(query.detail).toHaveBeenCalledWith('t-new');
      expect(analyze).not.toHaveBeenCalled();
      expect(files.remove).not.toHaveBeenCalled();
    });

    it('names a PNG artwork .png, and stores no artwork when none is sent', async () => {
      await service.importTrack('admin-1', dto(), file(MP3), file(PNG));
      expect(savedName(1)).toMatch(/\.png$/);

      files.save.mockClear();
      prisma.track.create.mockClear();
      await service.importTrack('admin-1', dto(), file(MP3), undefined);
      expect(files.save).toHaveBeenCalledTimes(1);
      expect(createData()).toMatchObject({ artwork: null });
    });

    it('refuses a missing audio part (400)', async () => {
      await expect(service.importTrack('admin-1', dto(), undefined, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a file that is not an MP3 by its content, before anything else', async () => {
      const wav = Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt ');
      await expect(
        service.importTrack('admin-1', dto({ sha256: sha(wav) }), file(wav), undefined),
      ).rejects.toThrow("Le fichier audio n'est pas un MP3.");
      expect(prisma.track.findFirst).not.toHaveBeenCalled();
      expect(files.save).not.toHaveBeenCalled();
    });

    it('refuses an artwork that is neither JPEG nor PNG (400)', async () => {
      await expect(
        service.importTrack('admin-1', dto(), file(MP3), file(Buffer.from('GIF89a'))),
      ).rejects.toThrow('La pochette doit être une image JPEG ou PNG.');
      expect(files.save).not.toHaveBeenCalled();
    });

    it('refuses an oversized audio file or artwork (413)', async () => {
      await expect(
        service.importTrack(
          'admin-1',
          dto(),
          file(MP3, TRACK_IMPORT_MAX_AUDIO_BYTES + 1),
          undefined,
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      await expect(
        service.importTrack(
          'admin-1',
          dto(),
          file(MP3),
          file(JPEG, TRACK_IMPORT_MAX_ARTWORK_BYTES + 1),
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(files.save).not.toHaveBeenCalled();
    });

    it('refuses a hash that does not match the received file (400)', async () => {
      await expect(
        service.importTrack('admin-1', dto({ sha256: '0'.repeat(64) }), file(MP3), undefined),
      ).rejects.toThrow("L'empreinte SHA-256 ne correspond pas au fichier reçu.");
      expect(files.save).not.toHaveBeenCalled();
    });

    it('refuses a duplicate source or file (409) with the existing track, before storing anything', async () => {
      prisma.track.findFirst.mockResolvedValue({ id: 't-old' } as never);

      await expect(
        conflictOf(service.importTrack('admin-1', dto(), file(MP3), undefined)),
      ).resolves.toEqual({
        message: TRACK_DUPLICATE_MESSAGE,
        existingTrackId: 't-old',
      });
      expect(prisma.track.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: sha(MP3) }, { sourceKey: 'apple:1' }] },
        select: idOnlySelect,
      });
      expect(files.save).not.toHaveBeenCalled();
    });

    it('looks for the content hash only when there is no source key', async () => {
      await service.importTrack('admin-1', dto({ sourceKey: undefined }), file(MP3), undefined);
      expect(prisma.track.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: sha(MP3) }] },
        select: idOnlySelect,
      });
      expect(createData()).toMatchObject({ sourceKey: null });
    });

    it('deletes the stored files when the row cannot be written, and audits nothing', async () => {
      prisma.track.create.mockRejectedValue(new Error('db down'));

      await expect(service.importTrack('admin-1', dto(), file(MP3), file(JPEG))).rejects.toThrow(
        'db down',
      );
      expect(files.remove).toHaveBeenCalledWith([savedName(0), savedName(1)]);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('deletes the audio file when the artwork upload fails', async () => {
      files.save.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('blob down'));

      await expect(service.importTrack('admin-1', dto(), file(MP3), file(JPEG))).rejects.toThrow(
        'blob down',
      );
      expect(files.remove).toHaveBeenCalledWith([savedName(0)]);
      expect(prisma.track.create).not.toHaveBeenCalled();
    });

    it('turns a unique-constraint race into a 409 and cleans up', async () => {
      prisma.track.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 't-race' } as never);
      prisma.track.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      );

      await expect(
        conflictOf(service.importTrack('admin-1', dto(), file(MP3), undefined)),
      ).resolves.toEqual({
        message: TRACK_DUPLICATE_MESSAGE,
        existingTrackId: 't-race',
      });
      expect(files.remove).toHaveBeenCalledWith([savedName(0)]);
    });

    it('analyses the tempo when rawBpm is missing, converts it for the dance, and cleans the temp copy', async () => {
      analyze.mockResolvedValue(100);

      await service.importTrack(
        'admin-1',
        dto({ rawBpm: undefined, mpm: undefined, style: 'Samba' }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({ rawBpm: 100, bpm: 50, status: TrackStatus.READY });
      const analysed = analyze.mock.calls[0][0] as string;
      expect(path.basename(analysed)).toBe('audio.mp3');
      await expect(fsp.stat(path.dirname(analysed))).rejects.toThrow();
    });

    it('keeps the rounded raw tempo as MPM without a dance', async () => {
      await service.importTrack(
        'admin-1',
        dto({ style: undefined, rawBpm: 123.6, mpm: undefined }),
        file(MP3),
        undefined,
      );
      expect(createData()).toMatchObject({ rawBpm: 123.6, bpm: 124, style: null });
    });

    it('creates the track in ERROR when the analysis fails and no MPM is given', async () => {
      analyze.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      await service.importTrack(
        'admin-1',
        dto({ rawBpm: undefined, mpm: undefined }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({ rawBpm: 0, bpm: 0, status: TrackStatus.ERROR });
      expect(audit.record.mock.calls[0][1]).toMatchObject({
        after: { bpm: 0, status: TrackStatus.ERROR },
      });
    });

    it("keeps the admin's MPM when the analysis fails", async () => {
      analyze.mockRejectedValue(new Error('ffmpeg exited with code 1'));

      await service.importTrack(
        'admin-1',
        dto({ rawBpm: undefined, mpm: 52 }),
        file(MP3),
        undefined,
      );

      expect(createData()).toMatchObject({ rawBpm: 0, bpm: 52, status: TrackStatus.READY });
    });
  });

  describe('check', () => {
    it('answers per item, in order, by hash or by source', async () => {
      const [h1, h2, h3] = ['1', '2', '3'].map((c) => c.repeat(64));
      prisma.track.findMany.mockResolvedValue([
        { id: 't1', contentHash: h1, sourceKey: null },
        { id: 't2', contentHash: null, sourceKey: 'apple:2' },
      ] as never);

      await expect(
        service.check([
          { sourceKey: 'apple:9', sha256: h1 },
          { sourceKey: 'apple:2', sha256: h2 },
          { sha256: h3 },
        ]),
      ).resolves.toEqual({
        items: [
          { exists: true, trackId: 't1' },
          { exists: true, trackId: 't2' },
          { exists: false },
        ],
      });
      expect(prisma.track.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { contentHash: { in: [h1, h2, h3] } },
            { sourceKey: { in: ['apple:9', 'apple:2'] } },
          ],
        },
        select: trackDuplicateSelect,
        take: 5,
      });
    });

    it('looks up hashes only when no item has a source', async () => {
      prisma.track.findMany.mockResolvedValue([]);
      await service.check([{ sha256: 'a'.repeat(64) }, { sha256: 'a'.repeat(64) }]);
      expect(prisma.track.findMany).toHaveBeenCalledWith({
        where: { OR: [{ contentHash: { in: ['a'.repeat(64)] } }] },
        select: trackDuplicateSelect,
        take: 1,
      });
    });
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/track-import.service.spec.ts`
Expected: FAIL — `Cannot find module './track-import.service'`.

- [ ] **Step 6: Implement the import service**

Create `apps/backend/src/tracks/track-import.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma, TrackStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AdminAuditService } from '../admin/admin-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { getErrorMessage } from '../utils/error.utils';
import { idOnlySelect, trackDuplicateSelect } from '../utils/prisma-selects';
import { withTimeout } from '../utils/timeout.utils';
import { AdminTracksQueryService } from './admin-tracks.query-service';
import { BpmService } from './bpm.service';
import { AdminTrackDto } from './dto/admin-track.dto';
import { CheckTrackItemDto, CheckTracksResultDto, ImportTrackDto } from './dto/track-import.dto';
import { ArtworkExtension, artworkExtension, isMp3 } from './track-file-signature.util';
import { TrackFilesService } from './track-files.service';
import { TracksService } from './tracks.service';

export const TRACK_IMPORT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const TRACK_IMPORT_MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
export const TRACK_IMPORT_JOB_ID = 'admin-import';
export const TRACK_TEMPO_ANALYSIS_TIMEOUT_MS = 60_000;
export const TRACK_DUPLICATE_MESSAGE = 'Cette musique est déjà dans la bibliothèque.';

/**
 * Route-scoped body limit of POST /admin/tracks, enforced by multer while it
 * reads the request (413 beyond 20 MB per file): no global body-parser limit
 * changes. `fileSize` applies to each file; the 2 MB artwork cap is checked
 * by the service.
 */
export const TRACK_IMPORT_MULTIPART_LIMITS = {
  fileSize: TRACK_IMPORT_MAX_AUDIO_BYTES,
  files: 2,
  fields: 10,
  fieldSize: 1024,
  parts: 12,
};

/** An uploaded part, as multer's memory storage hands it over. */
export interface UploadedTrackFile {
  buffer: Buffer;
  size: number;
}

interface Tempo {
  rawBpm: number;
  bpm: number;
  status: TrackStatus;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Back-office import of track files: duplicate check and one-file import. */
@Injectable()
export class TrackImportService {
  private readonly logger = new Logger(TrackImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracks: TracksService,
    private readonly bpm: BpmService,
    private readonly files: TrackFilesService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminTracksQueryService,
  ) {}

  /** Which items already exist (same source or same audio file), in request order. */
  async check(items: readonly CheckTrackItemDto[]): Promise<CheckTracksResultDto> {
    const hashes = [...new Set(items.map((item) => item.sha256))];
    const keys = [...new Set(items.flatMap((item) => (item.sourceKey ? [item.sourceKey] : [])))];
    const rows = await this.prisma.track.findMany({
      where: {
        OR: [
          { contentHash: { in: hashes } },
          ...(keys.length > 0 ? [{ sourceKey: { in: keys } }] : []),
        ],
      },
      select: trackDuplicateSelect,
      // Both columns are unique: at most one row per hash and one per key.
      take: hashes.length + keys.length,
    });
    const byHash = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const row of rows) {
      if (row.contentHash) byHash.set(row.contentHash, row.id);
      if (row.sourceKey) byKey.set(row.sourceKey, row.id);
    }
    return {
      items: items.map((item) => {
        const trackId =
          byHash.get(item.sha256) ?? (item.sourceKey ? byKey.get(item.sourceKey) : undefined);
        return trackId ? { exists: true, trackId } : { exists: false };
      }),
    };
  }

  /**
   * One track of the back-office import. The files are checked by content
   * (never by name or declared type), stored under server-generated names
   * before the row is written, and deleted again if the row cannot be.
   */
  async importTrack(
    actorId: string,
    dto: ImportTrackDto,
    audio: UploadedTrackFile | undefined,
    artwork: UploadedTrackFile | undefined,
  ): Promise<AdminTrackDto> {
    if (!audio) throw new BadRequestException('Fichier audio requis.');
    if (audio.size > TRACK_IMPORT_MAX_AUDIO_BYTES) {
      throw new PayloadTooLargeException('Le fichier audio dépasse 20 Mo.');
    }
    if (!isMp3(audio.buffer)) {
      throw new BadRequestException("Le fichier audio n'est pas un MP3.");
    }
    const artworkExt = artwork ? TrackImportService.checkArtwork(artwork) : null;
    const contentHash = createHash('sha256').update(audio.buffer).digest('hex');
    if (contentHash !== dto.sha256) {
      throw new BadRequestException("L'empreinte SHA-256 ne correspond pas au fichier reçu.");
    }
    const existing = await this.findDuplicate(dto.sourceKey, contentHash);
    if (existing) throw TrackImportService.duplicate(existing);

    const tempo = await this.tempo(audio.buffer, dto);
    const filename = `${randomUUID()}.mp3`;
    const artworkName = artworkExt ? `${randomUUID()}.${artworkExt}` : null;
    const stored: string[] = [];
    let trackId: string;
    try {
      await this.files.save(filename, audio.buffer);
      stored.push(filename);
      if (artwork && artworkName) {
        await this.files.save(artworkName, artwork.buffer);
        stored.push(artworkName);
      }
      trackId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.track.create({
          data: {
            title: dto.title,
            artist: dto.artist,
            style: dto.style ?? null,
            filename,
            artwork: artworkName,
            bpm: tempo.bpm,
            rawBpm: tempo.rawBpm,
            status: tempo.status,
            sourceKey: dto.sourceKey ?? null,
            contentHash,
            jobId: TRACK_IMPORT_JOB_ID,
            submittedById: actorId,
          },
          select: idOnlySelect,
        });
        await this.audit.record(tx, {
          actorId,
          action: 'TRACK_CREATE',
          targetType: 'TRACK',
          targetId: created.id,
          after: {
            title: dto.title,
            artist: dto.artist,
            style: dto.style ?? null,
            bpm: tempo.bpm,
            sourceKey: dto.sourceKey ?? null,
            status: tempo.status,
          },
        });
        return created.id;
      });
    } catch (error) {
      await this.files.remove(stored);
      if (isUniqueViolation(error)) {
        // Another import of the same file or source won the race.
        throw TrackImportService.duplicate(await this.findDuplicate(dto.sourceKey, contentHash));
      }
      throw error;
    }
    this.logger.log(`Track ${trackId} imported by ${actorId} (${tempo.status})`);
    return this.query.detail(trackId);
  }

  private static checkArtwork(artwork: UploadedTrackFile): ArtworkExtension {
    if (artwork.size > TRACK_IMPORT_MAX_ARTWORK_BYTES) {
      throw new PayloadTooLargeException('La pochette dépasse 2 Mo.');
    }
    const ext = artworkExtension(artwork.buffer);
    if (!ext) {
      throw new BadRequestException('La pochette doit être une image JPEG ou PNG.');
    }
    return ext;
  }

  private static duplicate(existingTrackId: string | null): ConflictException {
    return new ConflictException({
      message: TRACK_DUPLICATE_MESSAGE,
      ...(existingTrackId && { existingTrackId }),
    });
  }

  private async findDuplicate(
    sourceKey: string | undefined,
    contentHash: string,
  ): Promise<string | null> {
    const row = await this.prisma.track.findFirst({
      where: { OR: [{ contentHash }, ...(sourceKey ? [{ sourceKey }] : [])] },
      select: idOnlySelect,
    });
    return row?.id ?? null;
  }

  /**
   * Tempo of the new track. The raw BPM comes from the import (track-prep
   * manifest) or from BpmService; the MPM is the admin's, else the raw tempo
   * converted for the dance (same rule as PATCH /tracks/:id), else the rounded
   * raw tempo. No tempo at all (analysis failed, no MPM given): the track is
   * created in ERROR, out of the library, until an admin sets its MPM.
   */
  private async tempo(audio: Buffer, dto: ImportTrackDto): Promise<Tempo> {
    const rawBpm = dto.rawBpm ?? (await this.analyze(audio));
    if (rawBpm > 0) {
      const bpm =
        this.tracks.bpmForPatch(rawBpm, { bpm: dto.mpm, style: dto.style }) ?? Math.round(rawBpm);
      return { rawBpm, bpm, status: TrackStatus.READY };
    }
    if (dto.mpm !== undefined) {
      return { rawBpm: 0, bpm: dto.mpm, status: TrackStatus.READY };
    }
    return { rawBpm: 0, bpm: 0, status: TrackStatus.ERROR };
  }

  /** Raw BPM detected by ffmpeg + music-tempo on a temp copy, or 0 when it fails. */
  private async analyze(audio: Buffer): Promise<number> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'track-import-'));
    const file = path.join(dir, 'audio.mp3');
    try {
      await fsp.writeFile(file, audio);
      const bpm = await withTimeout(
        this.bpm.analyzeBpm(file),
        TRACK_TEMPO_ANALYSIS_TIMEOUT_MS,
        'tempo analysis',
      );
      return Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
    } catch (error) {
      this.logger.warn(`Tempo analysis failed: ${getErrorMessage(error)}`);
      return 0;
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  }
}
```

In `apps/backend/src/tracks/tracks.module.ts`, import `TrackImportService` and add it to `providers` (after `AdminTracksQueryService`).

Run: `pnpm --filter backend exec jest src/tracks/track-import.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Wire the routes**

In `apps/backend/src/tracks/admin-tracks.controller.spec.ts`, replace the construction of `controller` with:

```ts
const importer = { check: jest.fn(), importTrack: jest.fn() };
const controller = new AdminTracksController(
  query as unknown as AdminTracksQueryService,
  importer as unknown as TrackImportService,
);
const req = { user: { userId: 'admin-1', role: UserRole.ADMIN } } as unknown as RequestWithUser;
```

add the imports `import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";` and `import { TRACK_IMPORT_MULTIPART_LIMITS, TrackImportService } from "./track-import.service";`, and append inside the `describe`:

```ts
it('checks duplicates for the items', async () => {
  importer.check.mockResolvedValue({ items: [{ exists: false }] });
  await expect(controller.check({ items: [{ sha256: 'a'.repeat(64) }] })).resolves.toEqual({
    items: [{ exists: false }],
  });
  expect(importer.check).toHaveBeenCalledWith([{ sha256: 'a'.repeat(64) }]);
});

it('imports the first audio and artwork parts, with the caller as actor', async () => {
  importer.importTrack.mockResolvedValue({ id: 't1' });
  const body = { title: 'T', artist: 'A', sha256: 'a'.repeat(64) };
  const audio = { buffer: Buffer.from('ID3'), size: 3 } as Express.Multer.File;
  const artwork = { buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3 } as Express.Multer.File;

  await expect(
    controller.create(req, body, { audio: [audio], artwork: [artwork] }),
  ).resolves.toEqual({
    id: 't1',
  });
  expect(importer.importTrack).toHaveBeenCalledWith('admin-1', body, audio, artwork);

  await controller.create(req, body, undefined);
  expect(importer.importTrack).toHaveBeenLastCalledWith('admin-1', body, undefined, undefined);
});

it('limits the multipart body of this route only', () => {
  expect(TRACK_IMPORT_MULTIPART_LIMITS).toEqual({
    fileSize: 20 * 1024 * 1024,
    files: 2,
    fields: 10,
    fieldSize: 1024,
    parts: 12,
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/admin-tracks.controller.spec.ts`
Expected: FAIL — the constructor takes one argument, `check` / `create` do not exist.

In `apps/backend/src/tracks/admin-tracks.controller.ts`, replace the imports with:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { RequestWithUser } from '../auth/interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { createMemoryUploadStorage } from '../utils/upload-storage.util';
import { AdminTracksQueryService } from './admin-tracks.query-service';
import { TRACK_STYLE_OPTIONS } from './dance-labels';
import { AdminTrackDto, AdminTracksPageDto, ListAdminTracksQueryDto } from './dto/admin-track.dto';
import {
  CheckTracksDto,
  CheckTracksResultDto,
  ImportTrackDto,
  TRACK_IMPORT_TEXT_MAX_LENGTH,
  TRACK_SOURCE_KEY_MAX_LENGTH,
  TRACK_TEMPO_MAX,
} from './dto/track-import.dto';
import { TRACK_IMPORT_MULTIPART_LIMITS, TrackImportService } from './track-import.service';

interface ImportTrackFiles {
  audio?: Express.Multer.File[];
  artwork?: Express.Multer.File[];
}
```

replace the constructor with:

```ts
  constructor(
    private readonly query: AdminTracksQueryService,
    private readonly importer: TrackImportService,
  ) {}
```

and insert after `list` (before `@Get(":id")`):

```ts
  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Doublons avant import',
    description:
      'Pour chaque élément (200 au plus), indique si une musique existe déjà avec la même source (sourceKey) ou le même fichier audio (SHA-256). Réponses dans l’ordre de la requête.',
  })
  @ApiResponse({ status: 200, type: CheckTracksResultDto })
  check(@Body() dto: CheckTracksDto): Promise<CheckTracksResultDto> {
    return this.importer.check(dto.items);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'audio', maxCount: 1 },
        { name: 'artwork', maxCount: 1 },
      ],
      { storage: createMemoryUploadStorage(), limits: TRACK_IMPORT_MULTIPART_LIMITS },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['audio', 'title', 'artist', 'sha256'],
      properties: {
        audio: { type: 'string', format: 'binary', description: 'MP3, 20 Mo au plus' },
        artwork: {
          type: 'string',
          format: 'binary',
          description: 'Pochette JPEG ou PNG, 2 Mo au plus',
        },
        title: { type: 'string', minLength: 1, maxLength: TRACK_IMPORT_TEXT_MAX_LENGTH },
        artist: { type: 'string', minLength: 1, maxLength: TRACK_IMPORT_TEXT_MAX_LENGTH },
        style: {
          type: 'string',
          enum: [...TRACK_STYLE_OPTIONS],
          description: 'Danse (libellé canonique) ou « Ambiance »',
        },
        mpm: {
          type: 'integer',
          minimum: 1,
          maximum: TRACK_TEMPO_MAX,
          description: 'Tempo dansé (MPM) ; sinon calculé selon la danse',
        },
        rawBpm: {
          type: 'number',
          minimum: 1,
          maximum: TRACK_TEMPO_MAX,
          description: 'Tempo brut (BPM) ; sinon détecté par le serveur',
        },
        sourceKey: {
          type: 'string',
          maxLength: TRACK_SOURCE_KEY_MAX_LENGTH,
          description: 'Source track-prep (ex. apple:1091542189)',
        },
        sha256: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
          description: 'SHA-256 du fichier audio (hexadécimal), recalculé par le serveur',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Importer une musique',
    description:
      "Un fichier par requête. MP3 reconnu par son contenu ; noms de stockage générés par le serveur ; tempo analysé si rawBpm est absent ; statut ERROR si aucun tempo n'est connu. Tracé dans le journal d'audit (TRACK_CREATE).",
  })
  @ApiResponse({ status: 201, type: AdminTrackDto })
  @ApiResponse({ status: 400, description: 'Fichier ou champ invalide, empreinte SHA-256 différente' })
  @ApiResponse({
    status: 409,
    description: 'Doublon (même source ou même fichier) : existingTrackId',
  })
  @ApiResponse({ status: 413, description: 'Fichier audio > 20 Mo ou pochette > 2 Mo' })
  create(
    @Req() req: RequestWithUser,
    @Body() dto: ImportTrackDto,
    @UploadedFiles() files: ImportTrackFiles | undefined,
  ): Promise<AdminTrackDto> {
    return this.importer.importTrack(
      req.user.userId,
      dto,
      files?.audio?.[0],
      files?.artwork?.[0],
    );
  }
```

Run: `pnpm --filter backend exec jest src/tracks`
Expected: PASS.

- [ ] **Step 8: Pin the MPM rule for the SPA mirror**

Create `apps/backend/test/fixtures/mpm-cases.json` (values computed with the current `BpmService.calculateMpm`):

```json
[
  { "rawBpm": 90, "style": "Valse Lente", "mpm": 30 },
  { "rawBpm": 180, "style": "Valse Viennoise", "mpm": 60 },
  { "rawBpm": 128, "style": "Tango", "mpm": 32 },
  { "rawBpm": 120, "style": "Slow Fox", "mpm": 30 },
  { "rawBpm": 200, "style": "Quickstep", "mpm": 50 },
  { "rawBpm": 100, "style": "Samba", "mpm": 50 },
  { "rawBpm": 120, "style": "Paso Doble", "mpm": 60 },
  { "rawBpm": 128, "style": "Cha-cha", "mpm": 32 },
  { "rawBpm": 100, "style": "Rumba", "mpm": 25 },
  { "rawBpm": 168, "style": "Jive", "mpm": 42 },
  { "rawBpm": 184, "style": "Samba", "mpm": 46 },
  { "rawBpm": 200, "style": "Rumba", "mpm": 25 },
  { "rawBpm": 100, "style": "Quickstep", "mpm": 50 },
  { "rawBpm": 50, "style": "Samba", "mpm": 50 },
  { "rawBpm": 169.64, "style": "Jive", "mpm": 42 },
  { "rawBpm": 87.3, "style": "Valse Lente", "mpm": 29 },
  { "rawBpm": 123.6, "style": "Paso Doble", "mpm": 62 },
  { "rawBpm": 120, "style": "Ambiance", "mpm": 120 },
  { "rawBpm": 120, "style": null, "mpm": 120 },
  { "rawBpm": 123.6, "style": null, "mpm": 124 },
  { "rawBpm": 120, "style": "LATIN", "mpm": 120 },
  { "rawBpm": 0, "style": "Rumba", "mpm": 0 }
]
```

Create `apps/backend/src/tracks/mpm-parity.spec.ts` (own file: `bpm.service.spec.ts` mocks `fs`):

```ts
import * as fs from 'fs';
import * as path from 'path';
import { BpmService } from './bpm.service';
import { TRACK_DANCE_LABELS } from './dance-labels';

interface MpmCase {
  rawBpm: number;
  style: string | null;
  mpm: number;
}

/** Shared with apps/admin/src/lib/mpm.test.ts: the back-office mirrors this rule. */
const CASES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../test/fixtures/mpm-cases.json'), 'utf8'),
) as MpmCase[];

describe('MPM rule shared with the back-office', () => {
  const bpm = new BpmService();

  it.each(CASES)('$rawBpm BPM, $style → $mpm MPM', ({ rawBpm, style, mpm }) => {
    expect(bpm.calculateMpm(rawBpm, style ?? undefined)).toBe(mpm);
  });

  it.each(TRACK_DANCE_LABELS)('recognises the canonical dance %s', (label) => {
    // An unknown style keeps the raw tempo; every known dance converts 120 BPM.
    expect(bpm.calculateMpm(120, label)).not.toBe(120);
  });
});
```

Run: `pnpm --filter backend exec jest src/tracks/mpm-parity.spec.ts`
Expected: PASS (32 tests). Change one `mpm` of the fixture to see it fail, then restore.

- [ ] **Step 9: Mocked e2e — role matrix, size limit and content check**

In `apps/backend/test/admin.e2e-spec.ts`, append to `ADMIN_ROUTES` (after the two catalogue rows of Task 3):

```ts
  ["post", "/api/v1/admin/tracks/check"],
  ["post", "/api/v1/admin/tracks"],
```

and append at the end of the `describe`:

```ts
const postImport = () =>
  request(server())
    .post('/api/v1/admin/tracks')
    .field('title', 'T')
    .field('artist', 'A')
    .field('sha256', 'a'.repeat(64));

it('refuses an audio file over 20 MB (413) at the multer limit of the route, and stores nothing', async () => {
  currentRole = UserRole.ADMIN;
  prisma.track.create.mockClear();
  const res = await postImport().attach(
    'audio',
    Buffer.alloc(20 * 1024 * 1024 + 1, 0xff),
    'big.mp3',
  );
  expect(res.status).toBe(413);
  // multer's own message: the route limit fired while reading, not the service after buffering.
  expect(res.body.message).toBe('File too large');
  expect(prisma.track.create).not.toHaveBeenCalled();
});

it('refuses a file that is not an MP3, whatever its name and declared type (400)', async () => {
  currentRole = UserRole.ADMIN;
  const res = await postImport().attach(
    'audio',
    Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVEfmt '),
    {
      filename: 'song.mp3',
      contentType: 'audio/mpeg',
    },
  );
  expect(res.status).toBe(400);
  expect(res.body.message).toBe("Le fichier audio n'est pas un MP3.");
});

it('refuses an unexpected file part (400)', async () => {
  currentRole = UserRole.ADMIN;
  const res = await postImport().attach('image', Buffer.from('ID3'), 'x.mp3');
  expect(res.status).toBe(400);
});

it('refuses a duplicate check of more than 200 items (400)', async () => {
  currentRole = UserRole.ADMIN;
  await request(server())
    .post('/api/v1/admin/tracks/check')
    .send({ items: Array.from({ length: 201 }, () => ({ sha256: 'a'.repeat(64) })) })
    .expect(400);
});
```

Run the mocked e2e (see "How to run tests"): `pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec`
Expected: PASS (the matrix now includes the two `POST` routes: 403 for `LICENSEE`, `CLUB`, `STAFF`, 401/403 unauthenticated — guards run before the multer interceptor). Run it once with `limits: TRACK_IMPORT_MULTIPART_LIMITS` removed from the interceptor to see the 413 test fail on the message (the service then refuses with « Le fichier audio dépasse 20 Mo. », after multer buffered the whole body), then restore the limit.

- [ ] **Step 10: Real-DB integration — import, then duplicates by hash and by source**

In `apps/backend/test/tracks.integration-spec.ts`, add to the imports:

```ts
import { createHash } from 'crypto';
import { TrackImportService } from '../src/tracks/track-import.service';
```

(merge `createHash` into the existing `crypto` import), and append inside the `describe`:

```ts
it('imports a track, then refuses the same file and the same source (409)', async () => {
  const importer = moduleRef.get(TrackImportService);
  const admin = await adminUser();
  const mp3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.from(randomUUID())]);
  const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const part = (buffer: Buffer) => ({ buffer, size: buffer.length });
  const existingOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) =>
        (e as { getResponse(): { existingTrackId?: string } }).getResponse().existingTrackId,
    );
  const audio = mp3();
  const sourceKey = `test:${randomUUID()}`;

  const created = await importer.importTrack(
    admin,
    { title: 'Import', artist: 'Test', style: 'Rumba', rawBpm: 100, sha256: sha(audio), sourceKey },
    part(audio),
    undefined,
  );
  trackIds.push(created.id);
  expect(created).toMatchObject({
    bpm: 25,
    rawBpm: 100,
    status: 'READY',
    sourceKey,
    pendingCorrections: 0,
  });
  expect(
    await prisma.track.findUniqueOrThrow({
      where: { id: created.id },
      select: { contentHash: true, jobId: true, submittedById: true },
    }),
  ).toEqual({ contentHash: sha(audio), jobId: 'admin-import', submittedById: admin });

  // Same file, another source.
  await expect(
    existingOf(
      importer.importTrack(
        admin,
        { title: 'X', artist: 'Y', sha256: sha(audio), sourceKey: `test:${randomUUID()}` },
        part(audio),
        undefined,
      ),
    ),
  ).resolves.toBe(created.id);
  // Another file, same source.
  const other = mp3();
  await expect(
    existingOf(
      importer.importTrack(
        admin,
        { title: 'X', artist: 'Y', rawBpm: 100, sha256: sha(other), sourceKey },
        part(other),
        undefined,
      ),
    ),
  ).resolves.toBe(created.id);

  await expect(
    importer.check([
      { sha256: sha(audio) },
      { sha256: sha(other), sourceKey },
      { sha256: '0'.repeat(64) },
    ]),
  ).resolves.toEqual({
    items: [
      { exists: true, trackId: created.id },
      { exists: true, trackId: created.id },
      { exists: false },
    ],
  });
  expect(
    await prisma.adminAuditLog.findMany({
      where: { targetType: 'TRACK', targetId: created.id },
      select: { action: true, after: true },
      take: 10,
    }),
  ).toEqual([
    {
      action: 'TRACK_CREATE',
      after: {
        title: 'Import',
        artist: 'Test',
        style: 'Rumba',
        bpm: 25,
        sourceKey,
        status: 'READY',
      },
    },
  ]);
  // Only the first import reached the file store.
  expect(files.save).toHaveBeenCalledTimes(1);
});
```

Run (test DB only):

```bash
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit tracks.integration-spec'
```

Expected: PASS (5 tests).

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
pnpm --filter backend exec jest src/tracks src/admin src/track-corrections
git add apps/backend/src/tracks apps/backend/src/utils/prisma-selects.ts apps/backend/test/fixtures/mpm-cases.json apps/backend/test/admin.e2e-spec.ts apps/backend/test/tracks.integration-spec.ts
git commit -m "feat(tracks): bulk import API with duplicate check, content validation and audit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 5: Swagger export, regenerated clients, audit labels and the `TRACK` audit-log link

**Files:**

- Modify (generated): `apps/backend/swagger.json`, `apps/docs/public/swagger.json`
- Regenerated, gitignored (not committed): `apps/admin/src/api/generated/**`, `apps/client/src/api/generated/**`
- Modify: `apps/admin/src/lib/auditLabels.ts` (whole file, 18 lines)
- Modify: `apps/admin/src/pages/AuditLogPage.tsx` (`DELETIONS` / `TARGET_LINKS`, l. 13-19), `apps/admin/src/pages/AuditLogPage.test.tsx` (append)
- Modify: `apps/admin/src/components/ChangeSummary.tsx` (`LABELS` / `VALUE_LABELS` / `display`, l. 5-49), `apps/admin/src/components/ChangeSummary.test.tsx` (append)

**Interfaces:**

- Consumes: the routes of Tasks 2-4.
- Produces (generated SDK, both clients): `adminTracksControllerList` (query `{ skip?, take?, q?, status?: TrackStatus, blacklisted?: boolean, titleMasked?: boolean, style?: string, ambiance?: boolean }`), `adminTracksControllerFindOne` (`{ path: { id } }`), `adminTracksControllerCheck` (`{ body: CheckTracksDto }`), `adminTracksControllerCreate` (`{ body: AdminTracksControllerCreateData['body'] }`, multipart through `formDataBodySerializer`), `tracksControllerUpdate`, `tracksControllerRemove` (existing); types `AdminTrackDto`, `AdminTracksPageDto`, `TrackStatus` (`'PENDING' | 'READY' | 'ERROR'`), `CheckTracksDto`, `CheckTracksResultDto`, `AdminTracksControllerListData`, `AdminTracksControllerCreateData` (body `style?:` the 11 options union), `TrackCorrectionsControllerListData['query']['trackId']`, `AuditLogEntryDto['action']` (17 actions), `AuditLogEntryDto['targetType']` (`'USER' | 'CLUB' | 'TRACK_CORRECTION' | 'TRACK'`).
- Produces (SPA): `ACTION_LABELS` covers the 3 new actions; `TARGET_LINKS.TRACK = { path: 'tracks', label: 'Voir la musique' }`; `ChangeSummary` labels `titleMasked`, `blacklisted`, `status`, `sourceKey`, `filename` and shows booleans as « Oui » / « Non ».

- [ ] **Step 1: Export Swagger (from `apps/backend`, not the repo root)**

```bash
cd apps/backend
pnpm run build
node scripts/export-swagger.js
cp swagger.json ../docs/public/swagger.json
pnpm exec prettier --write swagger.json ../docs/public/swagger.json
node -e 'const s=require("./swagger.json");console.log(Object.keys(s.paths).filter((p)=>p.startsWith("/admin/tracks")).sort().join("\n"))'
node -e 'const s=require("./swagger.json");const t=s.paths["/admin/tracks"];console.log(t.get.operationId,t.post.operationId,s.paths["/admin/tracks/check"].post.operationId,s.paths["/admin/tracks/{id}"].get.operationId);console.log(t.get.parameters.map((x)=>x.name).sort().join(","));console.log(Object.keys(t.post.requestBody.content).join(","));console.log(JSON.stringify(t.post.requestBody.content["multipart/form-data"].schema.properties.style.enum));console.log(JSON.stringify(s.components.schemas.AuditLogEntryDto.properties.targetType.enum));console.log(s.paths["/track-corrections"].get.parameters.map((x)=>x.name).sort().join(","));console.log("409" in s.paths["/tracks/{id}"].delete.responses)'
cd ../..
```

Expected output of the first `node` command, exactly:

```
/admin/tracks
/admin/tracks/check
/admin/tracks/{id}
```

Expected output of the second:

```
AdminTracksController_list AdminTracksController_create AdminTracksController_check AdminTracksController_findOne
ambiance,blacklisted,q,skip,status,style,take,titleMasked
multipart/form-data
["Valse Lente","Tango","Valse Viennoise","Quickstep","Slow Fox","Samba","Cha-cha","Rumba","Paso Doble","Jive","Ambiance"]
["USER","CLUB","TRACK_CORRECTION","TRACK"]
q,reason,skip,status,take,trackId
true
```

- [ ] **Step 2: Regenerate both clients and see what breaks**

From the repo root:

```bash
pnpm --filter admin exec openapi-ts
pnpm --filter client exec openapi-ts
grep -c "export const adminTracksControllerCreate" apps/admin/src/api/generated/sdk.gen.ts
grep -n "export const adminTracksControllerCreate" -A 8 apps/admin/src/api/generated/sdk.gen.ts
pnpm --filter admin typecheck
pnpm --filter client typecheck
```

Expected: the first `grep` prints `1`; `adminTracksControllerCreate` spreads `formDataBodySerializer` and sets `'Content-Type': null` (the browser writes the multipart boundary), like `reportsControllerCreate`; the admin typecheck FAILS with errors limited to `ACTION_LABELS` (missing `TRACK_CREATE`, `TRACK_UPDATE`, `TRACK_DELETE`) and `TARGET_LINKS` (missing `TRACK`); the client typecheck PASSES (the mobile app uses none of the changed shapes).

- [ ] **Step 3: Write the failing SPA tests**

Append inside `describe('AuditLogPage', ...)` of `apps/admin/src/pages/AuditLogPage.test.tsx`:

```tsx
it('links a track row to the track page, and shows a deleted track as deleted', async () => {
  vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
    data: {
      data: [
        {
          id: 'l5',
          action: 'TRACK_UPDATE',
          targetType: 'TRACK',
          targetId: 't1',
          before: { blacklisted: false },
          after: { blacklisted: true },
          actorId: 'a1',
          actorName: 'Gabin S',
          createdAt: '2026-10-09T10:00:00.000Z',
        },
        {
          id: 'l6',
          action: 'TRACK_DELETE',
          targetType: 'TRACK',
          targetId: 't2',
          before: { title: 'Rumba', artist: 'Orchestre', sourceKey: null, filename: 'a.mp3' },
          after: null,
          actorId: 'a1',
          actorName: 'Gabin S',
          createdAt: '2026-10-09T10:05:00.000Z',
        },
      ],
      meta: { total: 2, skip: 0, take: 50, hasMore: false },
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
  expect(await screen.findByText('Modification de musique')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir la musique' })).toHaveAttribute(
    'href',
    '/tracks/t1',
  );
  expect(screen.getByText('Suppression de musique')).toBeInTheDocument();
  expect(screen.getByText('Supprimé')).toBeInTheDocument();
  expect(screen.getByText('Blacklistée')).toBeInTheDocument();
  expect(screen.getByText('Oui')).toBeInTheDocument();
});
```

Append inside `describe('ChangeSummary', ...)` of `apps/admin/src/components/ChangeSummary.test.tsx`:

```tsx
it('labels the track moderation flags, the status and the source, booleans in French', () => {
  render(
    <MantineProvider>
      <ChangeSummary
        before={{ titleMasked: false, blacklisted: true, status: 'ERROR', sourceKey: null }}
        after={{ titleMasked: true, blacklisted: false, status: 'READY', sourceKey: 'apple:1' }}
      />
    </MantineProvider>,
  );
  expect(screen.getByText('Titre masqué')).toBeInTheDocument();
  expect(screen.getByText('Blacklistée')).toBeInTheDocument();
  expect(screen.getByText('Statut')).toBeInTheDocument();
  expect(screen.getByText('Source')).toBeInTheDocument();
  expect(screen.getAllByText('Oui')).toHaveLength(2);
  expect(screen.getAllByText('Non')).toHaveLength(2);
  expect(screen.getByText('En erreur')).toBeInTheDocument();
  expect(screen.getByText('Prête')).toBeInTheDocument();
  expect(screen.getByText('apple:1')).toBeInTheDocument();
});
```

Run: `pnpm --filter admin exec vitest run src/pages/AuditLogPage.test.tsx src/components/ChangeSummary.test.tsx --testTimeout=60000`
Expected: FAIL (no label for the track actions, `TRACK` has no link, booleans shown as `true` / `false`).

- [ ] **Step 4: Labels, link and summary**

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
  TRACK_CREATE: 'Ajout de musique',
  TRACK_UPDATE: 'Modification de musique',
  TRACK_DELETE: 'Suppression de musique',
};
```

In `apps/admin/src/pages/AuditLogPage.tsx`, replace

```tsx
const DELETIONS: AuditLogEntryDto['action'][] = ['USER_DELETE', 'CLUB_DELETE'];
```

with

```tsx
const DELETIONS: AuditLogEntryDto['action'][] = ['USER_DELETE', 'CLUB_DELETE', 'TRACK_DELETE'];
```

and add to `TARGET_LINKS`, after the `TRACK_CORRECTION` entry:

```tsx
  TRACK: { path: 'tracks', label: 'Voir la musique' },
```

In `apps/admin/src/components/ChangeSummary.tsx`, add to `LABELS` after `trackId: 'Musique',`:

```tsx
  titleMasked: 'Titre masqué',
  blacklisted: 'Blacklistée',
  status: 'Statut',
  sourceKey: 'Source',
  filename: 'Fichier',
```

add to `VALUE_LABELS` after `registrationMode: REGISTRATION_MODE_LABELS,`:

```tsx
  // Track status (audit rows of the track catalogue).
  status: { READY: 'Prête', PENDING: 'En attente', ERROR: 'En erreur' },
```

and in `display`, insert after the `if (value === null || value === undefined) return '—';` line:

```tsx
if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
```

Run: `pnpm --filter admin exec vitest run src/pages/AuditLogPage.test.tsx src/components/ChangeSummary.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Run the checks**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter client typecheck
pnpm --filter admin exec vitest run --testTimeout=60000
pnpm --filter client exec jest src/features/player src/features/track-corrections src/services/api
```

Expected: PASS (the mobile track tests are green and unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/swagger.json apps/docs/public/swagger.json apps/admin/src/lib/auditLabels.ts apps/admin/src/pages/AuditLogPage.tsx apps/admin/src/pages/AuditLogPage.test.tsx apps/admin/src/components/ChangeSummary.tsx apps/admin/src/components/ChangeSummary.test.tsx
git commit -m "chore(api): export the lot 3 tracks contract and label track audit rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 6: SPA catalogue — list `/tracks` and detail `/tracks/:id`

**Files:**

- Create: `apps/admin/src/lib/mpm.ts`, `apps/admin/src/lib/mpm.test.ts`
- Create: `apps/admin/src/lib/tracks.ts`, `apps/admin/src/lib/tracks.test.ts`
- Modify: `apps/admin/src/api/queries.ts` (imports l. 1-19, append), `apps/admin/src/api/queries.test.ts` (append)
- Create: `apps/admin/src/pages/TracksPage.tsx`, `apps/admin/src/pages/TracksPage.test.tsx`
- Create: `apps/admin/src/pages/TrackDetailPage.tsx`, `apps/admin/src/pages/TrackDetailPage.test.tsx`
- Modify: `apps/admin/src/lib/moderation.ts` (`ModerationUrlState` … `moderationFilter`, l. 39-89), `apps/admin/src/lib/moderation.test.ts` (append inside `describe('moderation URL state')`)
- Modify: `apps/admin/src/pages/ModerationPage.tsx` (after the title, l. 80), `apps/admin/src/pages/ModerationPage.test.tsx` (append)
- Modify: `apps/admin/public/staticwebapp.config.json` (l. 7), `apps/admin/src/csp.test.ts` (l. 22-33, append)
- Modify: `apps/admin/src/router.tsx` (imports l. 1-13, children l. 24-35)

**Interfaces:**

- Consumes: `adminTracksControllerList`, `adminTracksControllerFindOne`, `tracksControllerUpdate`, `tracksControllerRemove`, `adminControllerAuditLog` (Task 5); `unwrap`, `ensureOk`, `auditQuery`; `apiErrorMessage`, `isConflict`, `UNAVAILABLE_MESSAGE`; `MIN_SEARCH_LENGTH`, `sortedUnique`, `trackAudioUrl`, `formatTimecode` (`lib/moderation.ts`); `ClashEditor`, `ChangeSummary`; `withLegacy` (`lib/diff.ts`); `ACTION_LABELS`; `apps/backend/test/fixtures/mpm-cases.json` (Task 4).
- Produces:
  - `lib/mpm.ts`: `normalizeDance(input?: string | null): DanceKey | null`, `calculateMpm(rawBpm: number, style?: string | null): number`, `bpmForPatch(rawBpm: number, patch: { bpm?: number; style?: string }): number | undefined`.
  - `lib/tracks.ts`: `type StyleOption`, `AMBIANCE`, `STYLE_OPTIONS: StyleOption[]`, `DANCE_LABELS: StyleOption[]`, `TRACK_STATUS_BADGES`, `TRACK_STATUS_FILTERS`, `MAX_SEARCH_LENGTH = 100`, `interface TracksUrlState`, `readTracksParams`, `writeTracksParams`, `tracksFilter`, `interface TrackEditValues`, `initialEditValues`, `type TrackPatch`, `trackPatch`, `resultingBpm`, `trackChangePreview`, `titleConfirms`, `trackArtworkUrl`.
  - `queries.ts`: `type TracksFilter = NonNullable<AdminTracksControllerListData['query']>`, `tracksQuery(q)` (key `['admin', 'tracks', 'list', q]`), `trackQuery(id)` (key `['admin', 'tracks', 'item', id]`), both without focus / reconnect refetch and without retry.
  - `ModerationUrlState.trackId?: string` (`?track=<uuid>`), forwarded as `trackId` by `moderationFilter`.
  - Pages `TracksPage` at `/tracks`, `TrackDetailPage` at `/tracks/:id`.

- [ ] **Step 1: Write the failing MPM mirror tests**

Create `apps/admin/src/lib/mpm.test.ts`:

```ts
// Shared with apps/backend/src/tracks/mpm-parity.spec.ts: one fixture, two implementations.
import cases from '../../../backend/test/fixtures/mpm-cases.json';
import { bpmForPatch, calculateMpm, normalizeDance } from './mpm';

describe('calculateMpm (mirror of BpmService.calculateMpm)', () => {
  it.each(cases)('$rawBpm BPM, $style → $mpm MPM', ({ rawBpm, style, mpm }) => {
    expect(calculateMpm(rawBpm, style)).toBe(mpm);
  });
});

describe('bpmForPatch (mirror of TracksService.bpmForPatch)', () => {
  it('keeps an explicit MPM', () => {
    expect(bpmForPatch(120, { bpm: 30, style: 'Rumba' })).toBe(30);
  });

  it('recomputes from the raw tempo on a dance change', () => {
    expect(bpmForPatch(100, { style: 'Rumba' })).toBe(25);
  });

  it('leaves the MPM alone without raw tempo, without dance, or with a cleared dance', () => {
    expect(bpmForPatch(0, { style: 'Rumba' })).toBeUndefined();
    expect(bpmForPatch(100, {})).toBeUndefined();
    expect(bpmForPatch(100, { style: '' })).toBeUndefined();
  });
});

describe('normalizeDance', () => {
  it('maps track-prep tokens and synonyms to a dance', () => {
    expect(normalizeDance('VALSE VIENNOISE')).toBe('viennoise');
    expect(normalizeDance('CHA-CHA')).toBe('cha-cha');
    expect(normalizeDance('Slowfox')).toBe('slow fox');
    expect(normalizeDance('AUTRE')).toBeNull();
    expect(normalizeDance(null)).toBeNull();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/mpm.test.ts --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./mpm"`.

- [ ] **Step 2: Implement the mirror**

Create `apps/admin/src/lib/mpm.ts`:

```ts
/**
 * Mirror of the backend tempo rules, for the live MPM preview of the track
 * page and the import table: BpmService.calculateMpm and
 * TracksService.bpmForPatch (apps/backend/src/tracks). The backend stays the
 * source of truth and recomputes on save; both implementations are pinned by
 * the shared fixture apps/backend/test/fixtures/mpm-cases.json.
 */
interface DanceTempo {
  bpmRange: [number, number];
  beatsPerMeasure: number;
}

const DANCE_TEMPOS = {
  rumba: { bpmRange: [95, 115], beatsPerMeasure: 4 },
  'cha-cha': { bpmRange: [115, 140], beatsPerMeasure: 4 },
  samba: { bpmRange: [90, 115], beatsPerMeasure: 2 },
  'paso doble': { bpmRange: [110, 130], beatsPerMeasure: 2 },
  jive: { bpmRange: [158, 186], beatsPerMeasure: 4 },
  'valse lente': { bpmRange: [78, 98], beatsPerMeasure: 3 },
  tango: { bpmRange: [115, 140], beatsPerMeasure: 4 },
  viennoise: { bpmRange: [168, 190], beatsPerMeasure: 3 },
  'slow fox': { bpmRange: [100, 128], beatsPerMeasure: 4 },
  quickstep: { bpmRange: [188, 220], beatsPerMeasure: 4 },
} satisfies Record<string, DanceTempo>;

export type DanceKey = keyof typeof DANCE_TEMPOS;

/** Same patterns, same order as the backend's normalizeStyle. */
export function normalizeDance(input?: string | null): DanceKey | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  if (/cha[\s-]?cha|chacha/.test(s)) return 'cha-cha';
  if (/paso/.test(s)) return 'paso doble';
  if (/samba/.test(s)) return 'samba';
  if (/jive/.test(s)) return 'jive';
  if (/rumba/.test(s)) return 'rumba';
  if (/quick\s?step/.test(s)) return 'quickstep';
  if (/slow ?fox|foxtrot|^fox$/.test(s)) return 'slow fox';
  if (/vienn|valse rapide/.test(s)) return 'viennoise';
  if (/slow ?waltz|valse lente|^waltz$|^valse$/.test(s)) return 'valse lente';
  if (/tango/.test(s)) return 'tango';
  return null;
}

/** The octave-shifted candidate closest to the centre of the dance's range. */
function normalizeToRange(bpm: number, [min, max]: [number, number]): number {
  if (bpm <= 0) return 0;
  const center = (min + max) / 2;
  let best = bpm;
  let bestDist = Math.abs(bpm - center);
  for (const candidate of [bpm, bpm * 2, bpm / 2, bpm * 4, bpm / 4]) {
    const dist = Math.abs(candidate - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** Raw BPM → MPM for the dance; the rounded raw BPM when the dance is unknown. */
export function calculateMpm(rawBpm: number, style?: string | null): number {
  if (rawBpm === 0) return 0;
  const key = normalizeDance(style);
  if (key === null) return Math.round(rawBpm);
  const tempo: DanceTempo = DANCE_TEMPOS[key];
  return Math.round(normalizeToRange(rawBpm, tempo.bpmRange) / tempo.beatsPerMeasure);
}

/** MPM a PATCH will write, or undefined when it leaves the MPM as it is. */
export function bpmForPatch(
  rawBpm: number,
  patch: { bpm?: number; style?: string },
): number | undefined {
  if (patch.bpm !== undefined) return patch.bpm;
  if (patch.style && rawBpm > 0) {
    const mpm = calculateMpm(rawBpm, patch.style);
    if (mpm > 0) return mpm;
  }
  return undefined;
}
```

Run: `pnpm --filter admin exec vitest run src/lib/mpm.test.ts --testTimeout=60000`
Expected: PASS (22 fixture cases + 4 tests).

- [ ] **Step 3: Write the failing catalogue helper tests**

Create `apps/admin/src/lib/tracks.test.ts`:

```ts
import type { AdminTrackDto } from '../api/generated/types.gen';
import { API_ORIGIN } from '../config';
import {
  DANCE_LABELS,
  initialEditValues,
  readTracksParams,
  resultingBpm,
  STYLE_OPTIONS,
  titleConfirms,
  trackArtworkUrl,
  trackChangePreview,
  trackPatch,
  tracksFilter,
  writeTracksParams,
} from './tracks';

const track: AdminTrackDto = {
  id: 't1',
  title: 'Samba de Janeiro',
  artist: 'Bellini',
  style: 'Samba',
  bpm: 50,
  rawBpm: 100,
  clashTimecodes: [],
  titleMasked: false,
  blacklisted: false,
  status: 'READY',
  sourceKey: null,
  filename: 'a.mp3',
  artwork: 'a.jpg',
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
};

describe('style options', () => {
  it('lists the canonical dances then « Ambiance », in the backend order', () => {
    expect(STYLE_OPTIONS).toEqual([
      'Valse Lente',
      'Tango',
      'Valse Viennoise',
      'Quickstep',
      'Slow Fox',
      'Samba',
      'Cha-cha',
      'Rumba',
      'Paso Doble',
      'Jive',
      'Ambiance',
    ]);
    expect(DANCE_LABELS).toHaveLength(10);
    expect(DANCE_LABELS).not.toContain('Ambiance');
  });
});

describe('catalogue URL state', () => {
  it('defaults to every track, first page', () => {
    expect(readTracksParams(new URLSearchParams())).toEqual({
      q: '',
      status: null,
      blacklisted: false,
      titleMasked: false,
      ambiance: false,
      style: '',
      page: 1,
    });
  });

  it('reads every filter and drops unknown, too short or false values', () => {
    expect(
      readTracksParams(
        new URLSearchParams(
          'q=%20paso%20&status=ERROR&blacklisted=true&titleMasked=true&ambiance=true&style=Rumba&page=2',
        ),
      ),
    ).toEqual({
      q: 'paso',
      status: 'ERROR',
      blacklisted: true,
      titleMasked: true,
      ambiance: true,
      style: 'Rumba',
      page: 2,
    });
    expect(
      readTracksParams(new URLSearchParams('q=p&status=DONE&blacklisted=1&style=Valse&page=-3')),
    ).toEqual(readTracksParams(new URLSearchParams()));
  });

  it('writes only non-default values and goes back to page 1 on a filter change', () => {
    const current = new URLSearchParams('status=READY&page=4');
    expect(writeTracksParams(current, { ambiance: true }).toString()).toBe(
      'status=READY&ambiance=true',
    );
    expect(writeTracksParams(current, { page: 5 }).toString()).toBe('status=READY&page=5');
    expect(writeTracksParams(current, { status: null }).toString()).toBe('');
  });

  it('sends a chip as true only, never as false', () => {
    expect(tracksFilter(readTracksParams(new URLSearchParams()), 50)).toEqual({
      skip: 0,
      take: 50,
    });
    expect(
      tracksFilter(
        readTracksParams(
          new URLSearchParams('q=paso&status=PENDING&titleMasked=true&style=Jive&page=3'),
        ),
        50,
      ),
    ).toEqual({
      q: 'paso',
      status: 'PENDING',
      titleMasked: true,
      style: 'Jive',
      skip: 100,
      take: 50,
    });
  });
});

describe('PATCH body and preview', () => {
  const initial = initialEditValues(track);

  it('sends nothing when nothing changed', () => {
    expect(trackPatch(track, initial, false)).toEqual({});
  });

  it('leaves the MPM to the server on a dance change, and previews it', () => {
    const patch = trackPatch(track, { ...initial, style: 'Rumba' }, false);
    expect(patch).toEqual({ style: 'Rumba' });
    expect(resultingBpm(track, patch)).toBe(25);
    expect(trackChangePreview(track, patch)).toEqual({
      before: { style: 'Samba', bpm: 50 },
      after: { style: 'Rumba', bpm: 25 },
    });
  });

  it('sends a typed MPM, even unchanged when the dance changes, so it prevails', () => {
    expect(trackPatch(track, { ...initial, bpm: 52 }, true)).toEqual({ bpm: 52 });
    expect(trackPatch(track, { ...initial, bpm: 50 }, true)).toEqual({});
    expect(trackPatch(track, { ...initial, style: 'Rumba', bpm: 50 }, true)).toEqual({
      style: 'Rumba',
      bpm: 50,
    });
    expect(trackPatch(track, { ...initial, bpm: '' }, true)).toEqual({});
  });

  it('trims text, never sends a blank one, and sorts the clashes', () => {
    expect(
      trackPatch(
        track,
        { ...initial, title: '  Nouveau  ', artist: '   ', clashes: [80, 40, 80] },
        false,
      ),
    ).toEqual({ title: 'Nouveau', clashTimecodes: [40, 80] });
  });

  it('clears the dance with an empty style, keeping the MPM', () => {
    const patch = trackPatch(track, { ...initial, style: '' }, false);
    expect(patch).toEqual({ style: '' });
    expect(trackChangePreview(track, patch)).toEqual({
      before: { style: 'Samba' },
      after: { style: null },
    });
  });

  it('shows that an MPM publishes a track left in error', () => {
    const failed = { ...track, status: 'ERROR' as const, bpm: 0, rawBpm: 0 };
    const patch = trackPatch(failed, { ...initialEditValues(failed), bpm: 52 }, true);
    expect(trackChangePreview(failed, patch)).toEqual({
      before: { bpm: 0, status: 'ERROR' },
      after: { bpm: 52, status: 'READY' },
    });
  });
});

describe('small helpers', () => {
  it('confirms a deletion with the title, ignoring case and spaces', () => {
    expect(titleConfirms('  samba DE janeiro ', 'Samba de Janeiro')).toBe(true);
    expect(titleConfirms('Samba', 'Samba de Janeiro')).toBe(false);
    expect(titleConfirms('   ', '   ')).toBe(false);
  });

  it('serves the artwork from the API origin, name encoded', () => {
    expect(trackArtworkUrl('cover é.jpg')).toBe(`${API_ORIGIN}/uploads/cover%20%C3%A9.jpg`);
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/tracks.test.ts --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./tracks"`.

- [ ] **Step 4: Implement the helpers and the queries**

Create `apps/admin/src/lib/tracks.ts`:

```ts
import type {
  AdminTrackDto,
  AdminTracksControllerCreateData,
  TrackStatus,
  UpdateTrackDto,
} from '../api/generated/types.gen';
import type { TracksFilter } from '../api/queries';
import { MIN_SEARCH_LENGTH, sortedUnique, trackAudioUrl } from './moderation';
import { bpmForPatch } from './mpm';

/** Import style options: the backend's TRACK_STYLE_OPTIONS, as the generated union. */
export type StyleOption = NonNullable<AdminTracksControllerCreateData['body']['style']>;

/**
 * Exactly the generated union: a dance added, renamed or removed on the
 * backend fails the typecheck here (missing or unknown key).
 */
const STYLE_SET: Record<StyleOption, true> = {
  'Valse Lente': true,
  Tango: true,
  'Valse Viennoise': true,
  Quickstep: true,
  'Slow Fox': true,
  Samba: true,
  'Cha-cha': true,
  Rumba: true,
  'Paso Doble': true,
  Jive: true,
  Ambiance: true,
};

export const AMBIANCE: StyleOption = 'Ambiance';
/** The canonical dances then « Ambiance », in the backend order. */
export const STYLE_OPTIONS = Object.keys(STYLE_SET) as StyleOption[];
export const DANCE_LABELS: StyleOption[] = STYLE_OPTIONS.filter((s) => s !== AMBIANCE);

export const TRACK_STATUS_BADGES: Record<TrackStatus, { label: string; color: string }> = {
  READY: { label: 'Prête', color: 'green' },
  PENDING: { label: 'En attente', color: 'yellow' },
  ERROR: { label: 'En erreur', color: 'red' },
};

export const TRACK_STATUS_FILTERS: { value: TrackStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'READY', label: 'Prêtes' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'ERROR', label: 'En erreur' },
];

/** The API refuses a longer search (400). */
export const MAX_SEARCH_LENGTH = 100;

export interface TracksUrlState {
  q: string;
  status: TrackStatus | null;
  blacklisted: boolean;
  titleMasked: boolean;
  ambiance: boolean;
  style: string;
  page: number;
}

const STATUSES: TrackStatus[] = ['READY', 'PENDING', 'ERROR'];
const isStatus = (value: string | null): value is TrackStatus =>
  STATUSES.some((status) => status === value);

/**
 * Filters kept in the URL:
 * `?q=paso&status=ERROR&blacklisted=true&titleMasked=true&ambiance=true&style=Rumba&page=2`.
 */
export function readTracksParams(params: URLSearchParams): TracksUrlState {
  const status = params.get('status');
  const q = (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  const style = params.get('style') ?? '';
  const page = Number(params.get('page'));
  return {
    q: q.length >= MIN_SEARCH_LENGTH ? q : '',
    status: isStatus(status) ? status : null,
    blacklisted: params.get('blacklisted') === 'true',
    titleMasked: params.get('titleMasked') === 'true',
    ambiance: params.get('ambiance') === 'true',
    style: DANCE_LABELS.some((dance) => dance === style) ? style : '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** New params with `patch` applied; any filter change goes back to the first page. */
export function writeTracksParams(
  current: URLSearchParams,
  patch: Partial<TracksUrlState>,
): URLSearchParams {
  const next = { ...readTracksParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.blacklisted) params.set('blacklisted', 'true');
  if (next.titleMasked) params.set('titleMasked', 'true');
  if (next.ambiance) params.set('ambiance', 'true');
  if (next.style) params.set('style', next.style);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows; a chip only ever filters on `true`. */
export function tracksFilter(state: TracksUrlState, take: number): TracksFilter {
  return {
    ...(state.q && { q: state.q }),
    ...(state.status && { status: state.status }),
    ...(state.blacklisted && { blacklisted: true }),
    ...(state.titleMasked && { titleMasked: true }),
    ...(state.ambiance && { ambiance: true }),
    ...(state.style && { style: state.style }),
    skip: (state.page - 1) * take,
    take,
  };
}

/** Editable values of the track page (`bpm` is '' while the input is empty). */
export interface TrackEditValues {
  title: string;
  artist: string;
  style: string;
  bpm: number | string;
  clashes: number[];
}

export const initialEditValues = (t: AdminTrackDto): TrackEditValues => ({
  title: t.title,
  artist: t.artist,
  style: t.style ?? '',
  bpm: t.bpm,
  clashes: t.clashTimecodes,
});

export type TrackPatch = Pick<
  UpdateTrackDto,
  'title' | 'artist' | 'style' | 'bpm' | 'clashTimecodes'
>;

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  JSON.stringify(sortedUnique(a)) === JSON.stringify(sortedUnique(b));

/**
 * PATCH /tracks/:id body: changed fields only. The MPM goes only when the
 * admin typed one (also when it equals the current value while the dance
 * changes: it then prevails over the recalculation); a dance change alone
 * lets the server recompute it from the raw tempo, as the preview shows. A
 * blanked text field is never sent; an empty style clears the dance.
 */
export function trackPatch(
  t: AdminTrackDto,
  values: TrackEditValues,
  bpmTouched: boolean,
): TrackPatch {
  const body: TrackPatch = {};
  const title = values.title.trim();
  if (title && title !== t.title) body.title = title;
  const artist = values.artist.trim();
  if (artist && artist !== t.artist) body.artist = artist;
  if (values.style !== (t.style ?? '')) body.style = values.style;
  if (
    bpmTouched &&
    typeof values.bpm === 'number' &&
    (values.bpm !== t.bpm || body.style !== undefined)
  ) {
    body.bpm = values.bpm;
  }
  if (!sameNumbers(values.clashes, t.clashTimecodes)) {
    body.clashTimecodes = sortedUnique(values.clashes);
  }
  return body;
}

/** MPM after this PATCH, computed as the server does (TracksService.bpmForPatch). */
export const resultingBpm = (t: AdminTrackDto, patch: TrackPatch): number =>
  bpmForPatch(t.rawBpm, patch) ?? t.bpm;

/** Before → after of the confirmation, as the server will apply it (status included). */
export function trackChangePreview(
  t: AdminTrackDto,
  patch: TrackPatch,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const set = (key: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      before[key] = from;
      after[key] = to;
    }
  };
  if (patch.title !== undefined) set('title', t.title, patch.title);
  if (patch.artist !== undefined) set('artist', t.artist, patch.artist);
  if (patch.style !== undefined) set('style', t.style, patch.style || null);
  const bpm = bpmForPatch(t.rawBpm, patch);
  if (bpm !== undefined) set('bpm', t.bpm, bpm);
  if (patch.clashTimecodes !== undefined) {
    set('clashTimecodes', t.clashTimecodes, patch.clashTimecodes);
  }
  // Server rule: an admin MPM > 0 publishes a track the import left in ERROR.
  if (t.status === 'ERROR' && bpm !== undefined && bpm > 0) set('status', t.status, 'READY');
  return { before, after };
}

/** The typed title confirms a deletion: case and surrounding spaces ignored. */
export const titleConfirms = (typed: string, title: string): boolean =>
  typed.trim() !== '' && typed.trim().toLowerCase() === title.trim().toLowerCase();

/** Same URL scheme as the audio file: `/uploads` is served outside `/api/v1`. */
export const trackArtworkUrl = (artwork: string): string => trackAudioUrl(artwork);
```

In `apps/admin/src/api/queries.ts`, add `adminTracksControllerFindOne, adminTracksControllerList,` to the `sdk.gen` import (first, alphabetically), `AdminTracksControllerListData,` to the `types.gen` import, the type after `ModerationFilter`:

```ts
export type TracksFilter = NonNullable<AdminTracksControllerListData['query']>;
```

and append:

```ts
/**
 * Track catalogue. Same rule as the moderation queries: a refocus, a
 * reconnect or a retry would wake the scale-to-zero backend.
 */
export const tracksQuery = (q: TracksFilter) =>
  queryOptions({
    queryKey: ['admin', 'tracks', 'list', q],
    queryFn: () => unwrap(adminTracksControllerList({ query: q })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

export const trackQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'tracks', 'item', id],
    queryFn: () => unwrap(adminTracksControllerFindOne({ path: { id } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
```

Append to `apps/admin/src/api/queries.test.ts` (add `trackQuery, tracksQuery` to its import from `./queries`):

```ts
describe('track queries', () => {
  it('never wake the scale-to-zero backend on a refocus, a reconnect or a retry', () => {
    const flags = { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false };
    expect(tracksQuery({ skip: 0, take: 50 })).toMatchObject({
      queryKey: ['admin', 'tracks', 'list', { skip: 0, take: 50 }],
      ...flags,
    });
    expect(trackQuery('t1')).toMatchObject({
      queryKey: ['admin', 'tracks', 'item', 't1'],
      ...flags,
    });
    expect(tracksQuery({}).refetchInterval).toBeUndefined();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/tracks.test.ts src/api/queries.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Write the failing list-page tests**

Create `apps/admin/src/pages/TracksPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { TracksPage } from './TracksPage';

const track = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Paso Doble',
  bpm: 60,
  rawBpm: 120,
  clashTimecodes: [40],
  titleMasked: true,
  blacklisted: true,
  status: 'ERROR',
  sourceKey: null,
  filename: 'a.mp3',
  artwork: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
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

function renderPage(path = '/tracks') {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/tracks"
              element={
                <>
                  <TracksPage />
                  <Probe />
                </>
              }
            />
            <Route path="/tracks/import" element={<Probe />} />
            <Route path="/tracks/:id" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('TracksPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows every track with its badges, a link per title and the import button', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([track()]) as never);
    renderPage();
    const link = await screen.findByRole('link', { name: 'España Cañí' });
    expect(link).toHaveAttribute('href', '/tracks/t1');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Titre masqué')).toBeInTheDocument();
    expect(within(table).getByText('Blacklistée')).toBeInTheDocument();
    expect(within(table).getByText('En erreur')).toBeInTheDocument();
    expect(within(table).getByText('Paso Doble')).toBeInTheDocument();
    expect(within(table).getByText('09/10/2026')).toBeInTheDocument();
    expect(screen.getByText('1 musique')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importer des musiques' })).toHaveAttribute(
      'href',
      '/tracks/import',
    );
  });

  it('restores the filters from the URL and sends them to the API', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?status=ERROR&blacklisted=true&style=Rumba&q=paso&page=2');
    await screen.findByText('Aucune musique');
    expect(list).toHaveBeenCalledWith({
      query: { q: 'paso', status: 'ERROR', blacklisted: true, style: 'Rumba', skip: 50, take: 50 },
    });
    expect(screen.getByRole('checkbox', { name: 'Blacklistées' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ambiance' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'En erreur' })).toBeChecked();
  });

  it('puts a chip in the URL and goes back to the first page', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage('/tracks?page=3');
    await screen.findByText('Aucune musique');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ambiance' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/tracks?ambiance=true'),
    );
    expect(list).toHaveBeenLastCalledWith({ query: { ambiance: true, skip: 0, take: 50 } });
  });

  it('filters on a status', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    await userEvent.click(screen.getByRole('radio', { name: 'En attente' }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } }),
    );
  });

  it('does not send a one-letter search, then sends the debounced search', async () => {
    const list = vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue(page([]) as never);
    renderPage();
    await screen.findByText('Aucune musique');
    const search = screen.getByRole('textbox', { name: 'Rechercher' });
    await userEvent.type(search, 'p');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(list).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ q: 'p' }) }),
    );
    await userEvent.type(search, 'a');
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { q: 'pa', skip: 0, take: 50 } }),
    );
  });

  it('shows only the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'adminTracksControllerList').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderPage();
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/pages/TracksPage.test.tsx --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./TracksPage"`.

- [ ] **Step 6: Implement the list page**

Create `apps/admin/src/pages/TracksPage.tsx`:

```tsx
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Chip,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { TrackStatus } from '../api/generated/types.gen';
import { tracksQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { MIN_SEARCH_LENGTH } from '../lib/moderation';
import {
  DANCE_LABELS,
  readTracksParams,
  TRACK_STATUS_BADGES,
  TRACK_STATUS_FILTERS,
  tracksFilter,
  type TracksUrlState,
  writeTracksParams,
} from '../lib/tracks';

const PAGE_SIZE = 50;

type Flag = 'blacklisted' | 'titleMasked' | 'ambiance';

const FLAGS: { key: Flag; label: string }[] = [
  { key: 'blacklisted', label: 'Blacklistées' },
  { key: 'titleMasked', label: 'Titre masqué' },
  { key: 'ambiance', label: 'Ambiance' },
];

export function TracksPage() {
  const [params, setParams] = useSearchParams();
  const state = readTracksParams(params);
  const [search, setSearch] = useState(state.q);
  const [debounced] = useDebouncedValue(search.trim(), 300);

  // Same debounce as the moderation queue: the search reaches the URL (and the
  // API) once debounced and long enough, and only when the input changed.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const written = useRef(state.q);
  useEffect(() => {
    const next = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    if (next === readTracksParams(paramsRef.current).q) return;
    written.current = next;
    setParamsRef.current(writeTracksParams(paramsRef.current, { q: next }), { replace: true });
  }, [debounced]);

  // Back/Forward (or any outside change of `q`) moves the input with it.
  useEffect(() => {
    if (state.q === written.current) return;
    written.current = state.q;
    setSearch(state.q);
  }, [state.q]);

  const update = (patch: Partial<TracksUrlState>) => setParams(writeTracksParams(params, patch));

  const list = useQuery({
    ...tracksQuery(tracksFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Musiques</Title>
        <Button component={Link} to="/tracks/import">
          Importer des musiques
        </Button>
      </Group>
      <SegmentedControl
        w="fit-content"
        data={TRACK_STATUS_FILTERS}
        value={state.status ?? 'ALL'}
        onChange={(v) => update({ status: v === 'ALL' ? null : (v as TrackStatus) })}
      />
      <Group>
        <Chip.Group
          multiple
          value={FLAGS.filter((f) => state[f.key]).map((f) => f.key)}
          onChange={(v) =>
            update({
              blacklisted: v.includes('blacklisted'),
              titleMasked: v.includes('titleMasked'),
              ambiance: v.includes('ambiance'),
            })
          }
        >
          <Group gap="xs">
            {FLAGS.map((f) => (
              <Chip key={f.key} value={f.key} size="sm">
                {f.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Select
          aria-label="Danse"
          placeholder="Danse"
          clearable
          w={200}
          data={DANCE_LABELS}
          value={state.style || null}
          onChange={(v) => update({ style: v ?? '' })}
        />
      </Group>
      <TextInput
        aria-label="Rechercher"
        placeholder="Titre ou artiste"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les musiques.')}
        </Alert>
      ) : list.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} musique{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Titre</Table.Th>
                <Table.Th>Artiste</Table.Th>
                <Table.Th>Danse</Table.Th>
                <Table.Th>MPM</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Ajoutée le</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>Aucune musique</Table.Td>
                </Table.Tr>
              )}
              {(list.data?.data ?? []).map((t) => {
                const badge = TRACK_STATUS_BADGES[t.status];
                return (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Group gap="xs">
                        <Anchor component={Link} to={`/tracks/${t.id}`} size="sm" fw={500}>
                          {t.title}
                        </Anchor>
                        {t.titleMasked && (
                          <Badge size="xs" color="gray" variant="light">
                            Titre masqué
                          </Badge>
                        )}
                        {t.blacklisted && (
                          <Badge size="xs" color="red" variant="light">
                            Blacklistée
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t.artist}</Table.Td>
                    <Table.Td>{t.style ?? '—'}</Table.Td>
                    <Table.Td>{t.bpm}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={badge.color}>
                        {badge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{dayjs(t.createdAt).format('DD/MM/YYYY')}</Table.Td>
                  </Table.Tr>
                );
              })}
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

In `apps/admin/src/router.tsx`, import `TracksPage` and `TrackDetailPage` (`./pages/TracksPage`, `./pages/TrackDetailPage`) and insert after `{ path: 'moderation/:id', element: <ModerationDetailPage /> },`:

```tsx
      { path: 'tracks', element: <TracksPage /> },
      { path: 'tracks/:id', element: <TrackDetailPage /> },
```

(`TrackDetailPage` is created in Step 8; add its import and route then if you run the typecheck before.)

Run: `pnpm --filter admin exec vitest run src/pages/TracksPage.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 7: Write the failing detail-page tests**

Create `apps/admin/src/pages/TrackDetailPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { TrackDetailPage } from './TrackDetailPage';

const base = {
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Samba',
  bpm: 50,
  rawBpm: 100,
  clashTimecodes: [],
  titleMasked: false,
  blacklisted: false,
  status: 'READY',
  sourceKey: 'apple:1',
  filename: 'España Cañí.mp3',
  artwork: 'cover é.jpg',
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
};

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response('{}', { status: 200 }),
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(track: object = base) {
  vi.spyOn(sdk, 'adminTracksControllerFindOne').mockResolvedValue(ok(track) as never);
  vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue(
    ok({ data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } }) as never,
  );
  return render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/tracks/t1']}>
          <Routes>
            <Route
              path="/tracks/:id"
              element={
                <>
                  <TrackDetailPage />
                  <Probe />
                </>
              }
            />
            <Route path="/tracks" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function confirmSave() {
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirmer les modifications' });
  return dialog;
}

describe('TrackDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the track and shows its artwork from the API origin, in CORS mode', async () => {
    renderPage();
    const audio = await screen.findByLabelText('Lecteur de la musique');
    expect(audio).toHaveAttribute(
      'src',
      `${API_ORIGIN}/uploads/${encodeURIComponent('España Cañí.mp3')}`,
    );
    expect(audio).toHaveAttribute('crossorigin', 'anonymous');
    const cover = screen.getByRole('img', { name: 'Pochette' });
    expect(cover).toHaveAttribute(
      'src',
      `${API_ORIGIN}/uploads/${encodeURIComponent('cover é.jpg')}`,
    );
    // helmet's Cross-Origin-Resource-Policy blocks a no-cors image load.
    expect(cover).toHaveAttribute('crossorigin', 'anonymous');
  });

  it('previews the MPM recomputed from the raw tempo and leaves it to the server', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Danse', { selector: 'input' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Rumba' }));
    expect(screen.getByLabelText('MPM')).toHaveValue('25');
    expect(screen.getByText('Recalculé selon la danse')).toBeInTheDocument();

    const dialog = await confirmSave();
    expect(dialog).toHaveTextContent('Samba');
    expect(dialog).toHaveTextContent('Rumba');
    expect(dialog).toHaveTextContent('50');
    expect(dialog).toHaveTextContent('25');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { style: 'Rumba' } });
  });

  it('sends a typed MPM', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    const mpm = await screen.findByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '27');
    const dialog = await confirmSave();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { bpm: 27 } });
  });

  it('asks before blacklisting, and sends the flag only', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Blacklister'));
    const dialog = await screen.findByRole('dialog', { name: 'Blacklister la musique' });
    expect(dialog).toHaveTextContent("retirée de la bibliothèque de l'app");
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Blacklister' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { blacklisted: true } });
  });

  it('asks before masking the title', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Masquer le titre'));
    const dialog = await screen.findByRole('dialog', { name: 'Masquer le titre' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Masquer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { titleMasked: true } });
  });

  it('deletes only once the title is typed, then goes back to the list', async () => {
    const remove = vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      '  españa cañí ',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith({ path: { id: 't1' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/tracks'));
  });

  it('suggests blacklisting when the server refuses the deletion (409)', async () => {
    vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 409,
        message:
          'Des propositions de correction sont en attente sur cette musique : traitez-les dans Modération, ou blacklistez la musique.',
        pendingCorrections: 1,
      },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(
      await within(dialog).findByText(/propositions de correction sont en attente/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Blacklister à la place' }));
    expect(
      await screen.findByRole('dialog', { name: 'Blacklister la musique' }),
    ).toBeInTheDocument();
  });

  it('blocks the deletion while proposals are pending, and links them in Modération', async () => {
    renderPage({ ...base, pendingCorrections: 2 });
    expect(await screen.findByRole('button', { name: 'Supprimer la musique' })).toBeDisabled();
    expect(
      screen.getByRole('link', { name: '2 propositions en attente dans Modération' }),
    ).toHaveAttribute('href', '/moderation?track=t1');
    expect(screen.getByRole('button', { name: 'Blacklister à la place' })).toBeEnabled();
  });

  it('publishes a track left in error once an MPM is typed', async () => {
    renderPage({ ...base, status: 'ERROR', bpm: 0, rawBpm: 0 });
    expect(await screen.findByText('Tempo non détecté')).toBeInTheDocument();
    const mpm = screen.getByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '52');
    const dialog = await confirmSave();
    expect(dialog).toHaveTextContent('En erreur');
    expect(dialog).toHaveTextContent('Prête');
  });

  it('shows the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'adminTracksControllerFindOne').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue(
      ok({ data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } }) as never,
    );
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={['/tracks/t1']}>
            <Routes>
              <Route path="/tracks/:id" element={<TrackDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/pages/TrackDetailPage.test.tsx --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./TrackDetailPage"`.

- [ ] **Step 8: Implement the detail page**

Create `apps/admin/src/pages/TrackDetailPage.tsx`:

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
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { tracksControllerRemove, tracksControllerUpdate } from '../api/generated/sdk.gen';
import type { UpdateTrackDto } from '../api/generated/types.gen';
import { auditQuery, ensureOk, trackQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { ClashEditor } from '../components/ClashEditor';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { withLegacy } from '../lib/diff';
import { formatTimecode, trackAudioUrl } from '../lib/moderation';
import {
  initialEditValues,
  resultingBpm,
  STYLE_OPTIONS,
  titleConfirms,
  trackArtworkUrl,
  trackChangePreview,
  type TrackEditValues,
  trackPatch,
  type TrackPatch,
  TRACK_STATUS_BADGES,
} from '../lib/tracks';

type Toggle = 'titleMasked' | 'blacklisted';

interface ToggleCopy {
  title: string;
  text: string;
  confirm: string;
}

const TOGGLE_COPY: Record<Toggle, { on: ToggleCopy; off: ToggleCopy }> = {
  titleMasked: {
    on: {
      title: 'Masquer le titre',
      text: "Les utilisateurs de l'app verront « Titre masqué » à la place du titre. Les admins voient toujours le vrai titre.",
      confirm: 'Masquer',
    },
    off: {
      title: 'Afficher le titre',
      text: "Le vrai titre sera de nouveau visible dans l'app.",
      confirm: 'Afficher',
    },
  },
  blacklisted: {
    on: {
      title: 'Blacklister la musique',
      text: "La musique sera retirée de la bibliothèque de l'app pour tous les utilisateurs.",
      confirm: 'Blacklister',
    },
    off: {
      title: 'Retirer de la blacklist',
      text: "La musique reviendra dans la bibliothèque de l'app si elle est prête.",
      confirm: 'Retirer de la blacklist',
    },
  },
};

const toggleBody = (key: Toggle, value: boolean): UpdateTrackDto =>
  key === 'titleMasked' ? { titleMasked: value } : { blacklisted: value };

export function TrackDetailPage() {
  const { id = '' } = useParams();
  // Another track starts from a fresh form.
  return <TrackEditor key={id} id={id} />;
}

function TrackEditor({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0);
  const track = useQuery(trackQuery(id));
  const history = useQuery({
    ...auditQuery({ targetType: 'TRACK', targetId: id, skip: 0, take: 20 }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const [values, setValues] = useState<TrackEditValues | null>(null);
  const [bpmTouched, setBpmTouched] = useState(false);
  const [pending, setPending] = useState<TrackPatch | null>(null);
  const [toggle, setToggle] = useState<{ key: Toggle; value: boolean } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');

  // The form follows the server after each save.
  useEffect(() => {
    if (track.data) {
      setValues(initialEditValues(track.data));
      setBpmTouched(false);
    }
  }, [track.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trackQuery(id).queryKey });
    void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const save = useMutation({
    mutationFn: (body: UpdateTrackDto) => ensureOk(tracksControllerUpdate({ path: { id }, body })),
    onSuccess: () => {
      refresh();
      setPending(null);
      setToggle(null);
      notifications.show({ color: 'green', message: 'Musique mise à jour' });
    },
  });

  const remove = useMutation({
    mutationFn: () => ensureOk(tracksControllerRemove({ path: { id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      notifications.show({ color: 'green', message: 'Musique supprimée' });
      navigate('/tracks', { replace: true });
      qc.removeQueries({ queryKey: trackQuery(id).queryKey });
    },
    // A 409 means proposals arrived since the page loaded: refresh the count.
    onError: (e) => {
      if (isConflict(e)) void qc.invalidateQueries({ queryKey: trackQuery(id).queryKey });
    },
  });

  if (track.isError) {
    return <Alert color="red">{apiErrorMessage(track.error, 'Musique introuvable.')}</Alert>;
  }
  if (!track.data || !values) return <Loader />;
  const t = track.data;
  const patch = trackPatch(t, values, bpmTouched);
  const preview = resultingBpm(t, patch);
  const change = pending ? trackChangePreview(t, pending) : null;
  const badge = TRACK_STATUS_BADGES[t.status];
  const toggleCopy = toggle ? TOGGLE_COPY[toggle.key][toggle.value ? 'on' : 'off'] : null;
  const blocked = t.pendingCorrections > 0;
  const deleteConflict = remove.isError && isConflict(remove.error);
  const pendingLabel = blocked
    ? `${t.pendingCorrections} proposition${t.pendingCorrections > 1 ? 's' : ''} en attente dans Modération`
    : 'Propositions de correction dans Modération';

  const askToggle = (key: Toggle, value: boolean) => {
    save.reset();
    setToggle({ key, value });
  };
  const closeDelete = () => {
    setDeleteOpen(false);
    setTypedTitle('');
    remove.reset();
  };

  return (
    <Stack>
      <Anchor component={Link} to="/tracks">
        Retour à la liste
      </Anchor>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{t.title}</Title>
          {t.titleMasked && (
            <Badge color="gray" variant="light">
              Titre masqué
            </Badge>
          )}
          {t.blacklisted && (
            <Badge color="red" variant="light">
              Blacklistée
            </Badge>
          )}
        </Group>
        <Badge size="lg" variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed">
        Ajoutée le {dayjs(t.createdAt).format('DD/MM/YYYY HH:mm')}
        {t.sourceKey ? ` · source ${t.sourceKey}` : ''} · tempo détecté :{' '}
        {t.rawBpm > 0 ? `${Math.round(t.rawBpm)} BPM` : 'aucun'}
      </Text>
      {t.status === 'ERROR' && (
        <Alert color="red" title="Tempo non détecté">
          Saisissez le MPM puis enregistrez pour publier la musique.
        </Alert>
      )}
      <Card withBorder>
        <Group align="flex-start" wrap="nowrap">
          {t.artwork && (
            <img
              src={trackArtworkUrl(t.artwork)}
              // CORS load: helmet's Cross-Origin-Resource-Policy: same-origin
              // blocks a no-cors image load from the back-office origin.
              crossOrigin="anonymous"
              alt="Pochette"
              width={120}
              height={120}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
          )}
          <Stack gap="xs" style={{ flex: 1 }}>
            <audio
              ref={audioRef}
              aria-label="Lecteur de la musique"
              controls
              preload="metadata"
              crossOrigin="anonymous"
              src={trackAudioUrl(t.filename)}
              onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
              style={{ width: '100%' }}
            />
            <Text size="sm" c="dimmed">
              Position : {formatTimecode(position)}
            </Text>
          </Stack>
        </Group>
      </Card>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (Object.keys(patch).length > 0) {
            save.reset();
            setPending(patch);
          }
        }}
      >
        <Stack>
          <SimpleGrid cols={2}>
            <TextInput
              label="Titre"
              value={values.title}
              onChange={(e) => setValues({ ...values, title: e.currentTarget.value })}
            />
            <TextInput
              label="Artiste"
              value={values.artist}
              onChange={(e) => setValues({ ...values, artist: e.currentTarget.value })}
            />
            <Select
              label="Danse"
              clearable
              data={withLegacy(STYLE_OPTIONS, t.style)}
              value={values.style || null}
              onChange={(v) => setValues({ ...values, style: v ?? '' })}
            />
            <NumberInput
              label="MPM"
              min={0}
              max={400}
              allowDecimal={false}
              value={bpmTouched ? values.bpm : preview}
              description={
                !bpmTouched && patch.style !== undefined && preview !== t.bpm
                  ? 'Recalculé selon la danse'
                  : undefined
              }
              onChange={(v) => {
                setBpmTouched(true);
                setValues({ ...values, bpm: v });
              }}
            />
          </SimpleGrid>
          <ClashEditor
            value={values.clashes}
            onChange={(clashes) => setValues({ ...values, clashes })}
            audioRef={audioRef}
          />
          <Group>
            <Button type="submit" disabled={Object.keys(patch).length === 0}>
              Enregistrer
            </Button>
          </Group>
        </Stack>
      </form>

      <Card withBorder>
        <Stack gap="xs">
          <Switch
            label="Masquer le titre"
            checked={t.titleMasked}
            onChange={(e) => askToggle('titleMasked', e.currentTarget.checked)}
          />
          <Switch
            label="Blacklister"
            description="Retire la musique de la bibliothèque de l'app"
            checked={t.blacklisted}
            onChange={(e) => askToggle('blacklisted', e.currentTarget.checked)}
          />
          <Anchor component={Link} to={`/moderation?track=${t.id}`} size="sm">
            {pendingLabel}
          </Anchor>
        </Stack>
      </Card>

      <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
        <Stack gap="xs">
          <Title order={4} c="red">
            Zone dangereuse
          </Title>
          <Text size="sm">
            {blocked
              ? 'Suppression impossible tant que des propositions de correction attendent une décision : traitez-les dans Modération, ou blacklistez la musique.'
              : 'La musique, son fichier audio et sa pochette seront supprimés définitivement.'}
          </Text>
          <Group>
            <Button
              color="red"
              variant="outline"
              disabled={blocked}
              onClick={() => {
                remove.reset();
                setDeleteOpen(true);
              }}
            >
              Supprimer la musique
            </Button>
            {blocked && !t.blacklisted && (
              <Button variant="light" color="red" onClick={() => askToggle('blacklisted', true)}>
                Blacklister à la place
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      <Title order={4}>Historique admin</Title>
      {history.isError ? (
        <Alert color="red">
          {apiErrorMessage(history.error, "Impossible de charger l'historique.")}
        </Alert>
      ) : history.data?.data.length ? (
        history.data.data.map((h) => (
          <Card key={h.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(h.createdAt).format('DD/MM/YYYY HH:mm')} —{' '}
              {ACTION_LABELS[h.action] ?? h.action} par {h.actorName ?? 'admin supprimé'}
            </Text>
            {h.after && <ChangeSummary before={h.before ?? {}} after={h.after} />}
          </Card>
        ))
      ) : (
        <Text size="sm" c="dimmed">
          Aucune modification admin.
        </Text>
      )}

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Confirmer les modifications"
      >
        {pending && change && (
          <Stack>
            <ChangeSummary before={change.before} after={change.after} />
            {save.isError && (
              <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPending(null)}>
                Annuler
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate(pending)}>
                Confirmer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={toggle !== null} onClose={() => setToggle(null)} title={toggleCopy?.title}>
        {toggle && toggleCopy && (
          <Stack>
            <Text size="sm">{toggleCopy.text}</Text>
            {save.isError && (
              <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setToggle(null)}>
                Annuler
              </Button>
              <Button
                color={toggle.key === 'blacklisted' && toggle.value ? 'red' : undefined}
                loading={save.isPending}
                onClick={() => save.mutate(toggleBody(toggle.key, toggle.value))}
              >
                {toggleCopy.confirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={deleteOpen} onClose={closeDelete} title="Supprimer cette musique">
        <Stack>
          <Text size="sm">
            « {t.title} » sera supprimée définitivement, avec son fichier audio et sa pochette.
          </Text>
          {remove.isError && (
            <Alert color="red">{apiErrorMessage(remove.error, 'Suppression impossible')}</Alert>
          )}
          <TextInput
            label="Recopiez le titre pour confirmer"
            placeholder={t.title}
            value={typedTitle}
            onChange={(e) => setTypedTitle(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Annuler
            </Button>
            {deleteConflict && !t.blacklisted ? (
              <Button
                color="red"
                variant="light"
                onClick={() => {
                  closeDelete();
                  askToggle('blacklisted', true);
                }}
              >
                Blacklister à la place
              </Button>
            ) : (
              <Button
                color="red"
                disabled={!titleConfirms(typedTitle, t.title)}
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Supprimer définitivement
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
```

Add the `TrackDetailPage` import and route to `apps/admin/src/router.tsx` if Step 6 left them out.

Run: `pnpm --filter admin exec vitest run src/pages/TrackDetailPage.test.tsx src/pages/TracksPage.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 9: Open the moderation queue on one track**

Append inside `describe('moderation URL state', ...)` of `apps/admin/src/lib/moderation.test.ts`:

```ts
it('reads and writes the track filter, UUIDs only', () => {
  const id = '4f1c2a8e-1b2c-4d5e-8f90-123456789abc';
  expect(readModerationParams(new URLSearchParams(`track=${id}`))).toEqual({
    status: 'PENDING',
    reasons: [],
    q: '',
    page: 1,
    trackId: id,
  });
  expect(readModerationParams(new URLSearchParams('track=t1'))).not.toHaveProperty('trackId');
  expect(
    writeModerationParams(new URLSearchParams(`track=${id}&page=2`), {
      status: 'APPROVED',
    }).toString(),
  ).toBe(`status=APPROVED&track=${id}`);
  expect(
    writeModerationParams(new URLSearchParams(`track=${id}`), { trackId: undefined }).toString(),
  ).toBe('');
  expect(
    moderationFilter({ status: 'PENDING', reasons: [], q: '', page: 1, trackId: id }, 50),
  ).toEqual({ status: 'PENDING', trackId: id, skip: 0, take: 50 });
});
```

Append inside the `describe` of `apps/admin/src/pages/ModerationPage.test.tsx`:

```tsx
it("shows one track's proposals from the track page link, and widens to every track", async () => {
  const id = '4f1c2a8e-1b2c-4d5e-8f90-123456789abc';
  const list = vi
    .spyOn(sdk, 'trackCorrectionsControllerList')
    .mockResolvedValue(page([item()]) as never);
  renderPage(`/moderation?track=${id}`);
  expect(await screen.findByText("Propositions d'une seule musique")).toBeInTheDocument();
  expect(list).toHaveBeenLastCalledWith({
    query: { status: 'PENDING', trackId: id, skip: 0, take: 50 },
  });
  expect(screen.getByRole('link', { name: 'Voir la musique' })).toHaveAttribute(
    'href',
    `/tracks/${id}`,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Toutes les musiques' }));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/moderation'));
  expect(list).toHaveBeenLastCalledWith({ query: { status: 'PENDING', skip: 0, take: 50 } });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/moderation.test.ts src/pages/ModerationPage.test.tsx --testTimeout=60000`
Expected: FAIL — no `trackId` in the URL state, no banner.

In `apps/admin/src/lib/moderation.ts`:

Append to `interface ModerationUrlState`, after `page: number;`:

```ts
  /** One track's proposals (link from the track page); absent: every track. */
  trackId?: string;
```

Insert before `/** Filters kept in the URL: … */`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

In `readModerationParams`, add `const track = params.get('track') ?? '';` after the `page` constant, and add as the last property of the returned object:

```ts
    ...(UUID.test(track) && { trackId: track }),
```

In `writeModerationParams`, insert before `return params;`:

```ts
if (next.trackId) params.set('track', next.trackId);
```

In `moderationFilter`, insert after the `q` spread:

```ts
    ...(state.trackId && { trackId: state.trackId }),
```

Update the doc comment of `readModerationParams` to `/** Filters kept in the URL: \`?status=APPROVED&reason=MPM,TITLE&q=paso&page=2&track=<uuid>\`. \*/`.

In `apps/admin/src/pages/ModerationPage.tsx`, insert after `<Title order={2}>Modération</Title>`:

```tsx
{
  state.trackId && (
    <Alert color="blue" title="Propositions d'une seule musique">
      <Group gap="md">
        <Anchor component={Link} to={`/tracks/${state.trackId}`} size="sm">
          Voir la musique
        </Anchor>
        <Anchor
          component="button"
          type="button"
          size="sm"
          onClick={() => update({ trackId: undefined })}
        >
          Toutes les musiques
        </Anchor>
      </Group>
    </Alert>
  );
}
```

Run: `pnpm --filter admin exec vitest run src/lib/moderation.test.ts src/pages/ModerationPage.test.tsx --testTimeout=60000`
Expected: PASS (the lot 2 tests unchanged: without `?track=` the state has no `trackId` key).

- [ ] **Step 10: Allow the artwork in the CSP**

In `apps/admin/src/csp.test.ts`, in the `toEqual` of "pins every directive exactly…", replace `'img-src': "'self' data:",` with:

```ts
      'img-src': `'self' data: ${API_ORIGINS}`,
```

and append inside the `describe`:

```ts
it('lets <img> load track artwork from both API origins', () => {
  expect(directives['img-src']).toBe(`'self' data: ${API_ORIGINS}`);
});
```

Run: `pnpm --filter admin exec vitest run src/csp.test.ts --testTimeout=60000`
Expected: FAIL (`img-src` is `'self' data:`).

In `apps/admin/public/staticwebapp.config.json`, replace the `Content-Security-Policy` value with:

```json
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; font-src 'self'; connect-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
```

Run: `pnpm --filter admin exec vitest run src/csp.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin exec vitest run --testTimeout=60000
git add apps/admin/public/staticwebapp.config.json apps/admin/src
git commit -m "feat(admin): track catalogue list and detail with MPM preview, switches and delete

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

---

### Task 7: SPA import `/tracks/import`

**Files:**

- Create: `apps/admin/src/lib/files.ts`, `apps/admin/src/lib/files.test.ts`
- Create: `apps/admin/src/test/id3Fixture.ts` (test helper, imported by tests only)
- Create: `apps/admin/src/lib/id3.ts`, `apps/admin/src/lib/id3.test.ts`
- Create: `apps/admin/src/lib/trackImport.ts`, `apps/admin/src/lib/trackImport.test.ts`
- Create: `apps/admin/src/pages/TrackImportPage.tsx`, `apps/admin/src/pages/TrackImportPage.test.tsx`
- Modify: `apps/admin/src/router.tsx` (imports, children)

**Interfaces:**

- Consumes: `adminTracksControllerCheck`, `adminTracksControllerCreate` (Task 5), `unwrap`, `apiErrorMessage`, `isConflict`, `calculateMpm` / `normalizeDance` (Task 6), `STYLE_OPTIONS`, `AMBIANCE`, `type StyleOption` (Task 6).
- Produces:
  - `lib/files.ts`: `readBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>>`, `readText(blob: Blob): Promise<string>`, `sha256Hex(blob: Blob): Promise<string>`, `droppedFiles(transfer: DataTransfer): Promise<File[]>`.
  - `lib/id3.ts`: `ID3_MAX_TAG_BYTES = 4 * 1024 * 1024`, `interface Id3Picture { mime: string; type: number; data: Uint8Array<ArrayBuffer> }`, `interface Id3Tags { title?; artist?; genre?; picture? }`, `readId3(file: Blob): Promise<Id3Tags | null>`.
  - `lib/trackImport.ts`: `MAX_AUDIO_BYTES`, `MAX_ARTWORK_BYTES`, `CHECK_BATCH_SIZE = 200`, `MAX_PARALLEL_UPLOADS = 2`, `interface ManifestTrack`, `parseManifest`, `interface NameInfo`, `parseTrackPrepName`, `canonicalStyle`, `interface PickedFiles`, `sortFiles`, `interface RowSources`, `type RowState`, `interface ImportRow`, `type RowIssue`, `ISSUE_LABELS`, `rowIssue`, `isSendable`, `buildRow`, `markBatchDuplicates`, `withStyle`, `type CheckItem`, `type CheckAnswer`, `findExisting`, `uploadBody`, `type UploadOutcome`, `uploadOutcome`, `runPool`, `importSummary`, `summaryText`.
  - Page `TrackImportPage` at `/tracks/import`.

**ID3 library choice.** The import needs five things from an MP3: TIT2 (title), TPE1 (artist), TCON (genre: the dance in track-prep files), APIC (front cover), and nothing else (TBPM is ignored: in a random MP3 it is a BPM, not an MPM, and track-prep's MPM is already in the file name). Candidates: `music-metadata` (MIT, maintained, browser build via `parseBlob`) pulls `strtok3`, `token-types`, `file-type` and `@borewit/text-codec` and supports ~30 formats we do not need; `jsmediatags` (BSD) has had no release since 2019; `id3js` is small but barely maintained. A ~150-line reader of ID3v2.3 / v2.4 text frames and APIC (syncsafe sizes, extended header, tag- and frame-level unsynchronisation, the four text encodings, padding) covers every file track-prep writes (`ffmpeg -id3v2_version 3`, checked on a real track-prep output: `49 44 33 03 00 …`, TBPM / TIT2 / TPE1 / TCON / APIC frames) and most other MP3s; anything it cannot read is simply absent and the file name takes over. It adds no dependency, so no license review, no bundle weight, and — per the runbook — no change to `apps/admin/package.json`, which would otherwise trigger the backend CI jobs and a `backend-staging` redeploy. Decision: in-house reader, `apps/admin/src/lib/id3.ts`.

- [ ] **Step 1: Write the failing file-helper tests**

Create `apps/admin/src/lib/files.test.ts`:

```ts
import { droppedFiles, readText, sha256Hex } from './files';

const file = (name: string, text = name) => new File([text], name);

const fileEntry = (f: File) => ({
  isFile: true,
  isDirectory: false,
  file: (ok: (value: File) => void) => ok(f),
});

/** A directory whose reader answers in two batches, then an empty one (as browsers do). */
const dirEntry = (children: unknown[]) => {
  const batches = [children.slice(0, 1), children.slice(1), []];
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []),
    }),
  };
};

describe('file helpers', () => {
  it('hashes a file with SHA-256, lowercase hex', async () => {
    await expect(sha256Hex(new Blob(['abc']))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('reads a text file', async () => {
    await expect(readText(new Blob(['{"version":1}']))).resolves.toBe('{"version":1}');
  });

  it('collects the files of a dropped folder, sub-folders included', async () => {
    const a = file('01.mp3');
    const b = file('01.jpg');
    const c = file('manifest.json');
    const transfer = {
      items: [
        {
          webkitGetAsEntry: () => dirEntry([fileEntry(a), dirEntry([fileEntry(b)]), fileEntry(c)]),
        },
      ],
      files: [],
    } as unknown as DataTransfer;
    await expect(droppedFiles(transfer)).resolves.toEqual([a, b, c]);
  });

  it('falls back to the plain file list without entries', async () => {
    const a = file('a.mp3');
    const transfer = { items: [], files: [a] } as unknown as DataTransfer;
    await expect(droppedFiles(transfer)).resolves.toEqual([a]);
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/files.test.ts --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./files"`.

- [ ] **Step 2: Implement the file helpers**

Create `apps/admin/src/lib/files.ts`:

```ts
/**
 * Bytes of a Blob. FileReader rather than Blob.arrayBuffer(): same result in
 * browsers, and jsdom (the test environment) has no Blob.arrayBuffer().
 */
export function readBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'));
    reader.readAsArrayBuffer(blob);
  });
}

export function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Lecture du fichier impossible'));
    reader.readAsText(blob);
  });
}

/** SHA-256 of a file, lowercase hex: the server recomputes it and refuses a mismatch. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await readBytes(blob));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function entryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await entryFile(entry as FileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries answers in batches (100 in Chromium): read until empty.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested: File[] = [];
  for (const child of children) nested.push(...(await entryFiles(child)));
  return nested;
}

/** Files of a drop, dropped folders (and their sub-folders) included. */
export async function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(transfer.files);
  const files: File[] = [];
  for (const entry of entries) files.push(...(await entryFiles(entry)));
  return files;
}
```

Run: `pnpm --filter admin exec vitest run src/lib/files.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 3: Write the ID3 fixture builder and the failing reader tests**

Create `apps/admin/src/test/id3Fixture.ts`:

```ts
/** Builds ID3v2 tags byte by byte, for the ID3 reader and import page tests. */
const latin1 = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const syncsafe = (size: number): number[] => [
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
];

const uint32 = (size: number): number[] => [
  (size >>> 24) & 0xff,
  (size >> 16) & 0xff,
  (size >> 8) & 0xff,
  size & 0xff,
];

export function id3Frame(id: string, body: number[], version: 3 | 4 = 3): number[] {
  return [
    ...latin1(id),
    ...(version === 4 ? syncsafe(body.length) : uint32(body.length)),
    0,
    0,
    ...body,
  ];
}

/** ISO-8859-1 text frame (encoding 0). */
export const textFrame = (id: string, value: string, version: 3 | 4 = 3): number[] =>
  id3Frame(id, [0, ...latin1(value)], version);

/** UTF-16 text frame with a little-endian BOM (encoding 1), what ffmpeg writes for accents. */
export function utf16Frame(id: string, value: string): number[] {
  const body = [1, 0xff, 0xfe];
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    body.push(unit & 0xff, unit >> 8);
  }
  return id3Frame(id, body);
}

/** UTF-8 text frame (encoding 3, ID3v2.4 only). */
export const utf8Frame = (id: string, value: string): number[] =>
  id3Frame(id, [3, ...new TextEncoder().encode(value)], 4);

export const pictureFrame = (
  mime: string,
  data: number[],
  type = 3,
  version: 3 | 4 = 3,
): number[] =>
  id3Frame('APIC', [0, ...latin1(mime), 0, type, ...latin1('cover'), 0, ...data], version);

/** An MP3: an ID3v2 tag (16 bytes of padding) then one MPEG frame header. */
export function mp3Bytes(
  frames: number[][],
  version: 3 | 4 = 3,
  salt = '',
): Uint8Array<ArrayBuffer> {
  const body = [...frames.flat(), ...new Array<number>(16).fill(0)];
  return Uint8Array.from([
    0x49,
    0x44,
    0x33,
    version,
    0,
    0,
    ...syncsafe(body.length),
    ...body,
    0xff,
    0xfb,
    0x90,
    0x64,
    ...latin1(salt),
  ]);
}

export const mp3File = (name: string, bytes: Uint8Array<ArrayBuffer>): File =>
  new File([bytes], name, { type: 'audio/mpeg' });

export const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
```

Create `apps/admin/src/lib/id3.test.ts`:

```ts
import {
  id3Frame,
  JPEG_BYTES,
  mp3Bytes,
  pictureFrame,
  textFrame,
  utf16Frame,
  utf8Frame,
} from '../test/id3Fixture';
import { readId3 } from './id3';

const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);

describe('readId3', () => {
  it('reads title, artist and genre of a track-prep tag (ID3v2.3, Latin-1), TBPM ignored', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes([
          textFrame('TBPM', '42'),
          textFrame('TIT2', 'In the Mood'),
          textFrame('TPE1', 'Empress Orchestra'),
          textFrame('TCON', 'Jive'),
        ]),
      ),
    );
    expect(tags).toEqual({ title: 'In the Mood', artist: 'Empress Orchestra', genre: 'Jive' });
  });

  it('decodes UTF-16 with a BOM (v2.3) and UTF-8 (v2.4)', async () => {
    expect(await readId3(blob(mp3Bytes([utf16Frame('TIT2', 'España Cañí')])))).toEqual({
      title: 'España Cañí',
    });
    expect(await readId3(blob(mp3Bytes([utf8Frame('TPE1', 'Orquesta Española')], 4)))).toEqual({
      artist: 'Orquesta Española',
    });
  });

  it('keeps the first value of a multi-value v2.4 frame and strips a numeric genre', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes(
          [
            utf8Frame('TPE1', 'A\u0000B'),
            id3Frame('TCON', [3, ...new TextEncoder().encode('(13)Samba')], 4),
          ],
          4,
        ),
      ),
    );
    expect(tags).toEqual({ artist: 'A', genre: 'Samba' });
  });

  it('reads the front cover, preferring it to another picture', async () => {
    const tags = await readId3(
      blob(
        mp3Bytes([
          pictureFrame('image/png', [1, 2, 3], 0),
          pictureFrame('image/jpeg', JPEG_BYTES, 3),
        ]),
      ),
    );
    expect(tags?.picture?.mime).toBe('image/jpeg');
    expect(tags?.picture?.type).toBe(3);
    expect(Array.from(tags?.picture?.data ?? [])).toEqual(JPEG_BYTES);
  });

  it('stops at the padding and skips unknown frames', async () => {
    const tags = await readId3(
      blob(mp3Bytes([textFrame('TXXX', 'x'), textFrame('TIT2', 'Titre')])),
    );
    expect(tags).toEqual({ title: 'Titre' });
  });

  it('answers null without a tag, for ID3v2.2, or for a tag over 4 MB', async () => {
    expect(await readId3(new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])]))).toBeNull();
    const v22 = mp3Bytes([textFrame('TIT2', 'x')]);
    v22[3] = 2;
    expect(await readId3(blob(v22))).toBeNull();
    const huge = mp3Bytes([]);
    huge.set([0x02, 0x40, 0x00, 0x00], 6); // syncsafe 5 MB
    expect(await readId3(blob(huge))).toBeNull();
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/id3.test.ts --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./id3"`.

- [ ] **Step 4: Implement the ID3 reader**

Create `apps/admin/src/lib/id3.ts`:

```ts
import { readBytes } from './files';

/**
 * Minimal ID3v2.3 / v2.4 reader for the import page: title (TIT2), artist
 * (TPE1), genre (TCON, the dance in track-prep files) and the front cover
 * (APIC). In-house rather than a tag library: five frames, no dependency.
 * Anything it cannot read is simply absent; the file name takes over.
 */
export interface Id3Picture {
  mime: string;
  /** ID3 picture type: 3 = front cover. */
  type: number;
  data: Uint8Array<ArrayBuffer>;
}

export interface Id3Tags {
  title?: string;
  artist?: string;
  genre?: string;
  picture?: Id3Picture;
}

/** Bigger tags are not read: a cover is at most a few hundred KB. */
export const ID3_MAX_TAG_BYTES = 4 * 1024 * 1024;

const FRONT_COVER = 3;

const syncsafe = (b: Uint8Array, at: number): number =>
  ((b[at] & 0x7f) << 21) |
  ((b[at + 1] & 0x7f) << 14) |
  ((b[at + 2] & 0x7f) << 7) |
  (b[at + 3] & 0x7f);

const uint32 = (b: Uint8Array, at: number): number =>
  b[at] * 0x1000000 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function utf16(bytes: Uint8Array, bigEndian: boolean): string {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(
      bigEndian ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8),
    );
  }
  return text;
}

/** Text of a frame body; v2.4 may hold several NUL-separated values: the first is kept. */
function decodeText(encoding: number, bytes: Uint8Array): string {
  let text: string;
  if (encoding === 0) {
    text = latin1(bytes);
  } else if (encoding === 1) {
    const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
    const bom = bigEndian || (bytes[0] === 0xff && bytes[1] === 0xfe);
    text = utf16(bom ? bytes.subarray(2) : bytes, bigEndian);
  } else if (encoding === 2) {
    text = utf16(bytes, true);
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text.split('\u0000')[0].trim();
}

/** Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
function resync(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    out.push(data[i]);
    if (data[i] === 0xff && data[i + 1] === 0x00) i += 1;
  }
  return Uint8Array.from(out);
}

/** APIC: encoding, MIME (Latin-1, NUL), picture type, description (NUL), data. */
function readPicture(body: Uint8Array<ArrayBuffer>): Id3Picture | null {
  const encoding = body[0];
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 0) return null;
  let mime = latin1(body.subarray(1, mimeEnd)).toLowerCase();
  if (mime === 'jpg') mime = 'image/jpeg';
  if (mime === 'png') mime = 'image/png';
  const type = body[mimeEnd + 1];
  let at = mimeEnd + 2;
  if (encoding === 1 || encoding === 2) {
    while (at + 1 < body.length && !(body[at] === 0 && body[at + 1] === 0)) at += 2;
    at += 2;
  } else {
    while (at < body.length && body[at] !== 0) at += 1;
    at += 1;
  }
  return at < body.length ? { mime, type, data: body.slice(at) } : null;
}

function readFrame(id: string, body: Uint8Array<ArrayBuffer>, tags: Id3Tags): void {
  if (body.length < 2) return;
  const text = () => decodeText(body[0], body.subarray(1)) || undefined;
  if (id === 'TIT2') tags.title ??= text();
  else if (id === 'TPE1') tags.artist ??= text();
  else if (id === 'TCON') tags.genre ??= text()?.replace(/^\(\d+\)\s*/, '') || undefined;
  else if (id === 'APIC') {
    const picture = readPicture(body);
    if (
      picture &&
      (!tags.picture || (picture.type === FRONT_COVER && tags.picture.type !== FRONT_COVER))
    ) {
      tags.picture = picture;
    }
  }
}

/** Tags of an MP3, or null when it has no readable ID3v2.3 / v2.4 tag. */
export async function readId3(file: Blob): Promise<Id3Tags | null> {
  const header = await readBytes(file.slice(0, 10));
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) {
    return null;
  }
  const major = header[3];
  if (major !== 3 && major !== 4) return null;
  const flags = header[5];
  const size = syncsafe(header, 6);
  if (size > ID3_MAX_TAG_BYTES) return null;
  let tag = await readBytes(file.slice(10, 10 + size));
  // v2.3 unsynchronises the whole tag; v2.4 flags it frame by frame.
  if (major === 3 && flags & 0x80) tag = resync(tag);
  let at = 0;
  if (flags & 0x40) at = major === 4 ? syncsafe(tag, 0) : uint32(tag, 0) + 4;
  const tags: Id3Tags = {};
  while (at + 10 <= tag.length) {
    const id = String.fromCharCode(tag[at], tag[at + 1], tag[at + 2], tag[at + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const frameSize = major === 4 ? syncsafe(tag, at + 4) : uint32(tag, at + 4);
    const formatFlags = tag[at + 9];
    const start = at + 10;
    const end = start + frameSize;
    if (frameSize <= 0 || end > tag.length) break;
    at = end;
    let body = tag.subarray(start, end);
    if (major === 4) {
      if (formatFlags & 0x0c) continue; // compressed or encrypted
      if (formatFlags & 0x40) body = body.subarray(1); // group id
      if (formatFlags & 0x01) body = body.subarray(4); // data length indicator
      if (formatFlags & 0x02) body = resync(body);
    } else {
      if (formatFlags & 0xc0) continue; // compressed or encrypted
      if (formatFlags & 0x20) body = body.subarray(1); // group id
    }
    readFrame(id, body, tags);
  }
  return tags;
}
```

Run: `pnpm --filter admin exec vitest run src/lib/id3.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 5: Write the failing import-helper tests**

Create `apps/admin/src/lib/trackImport.test.ts`:

```ts
import { JPEG_BYTES, mp3Bytes, mp3File, pictureFrame, textFrame } from '../test/id3Fixture';
import { readId3 } from './id3';
import {
  buildRow,
  canonicalStyle,
  findExisting,
  type ImportRow,
  importSummary,
  isSendable,
  MAX_ARTWORK_BYTES,
  MAX_AUDIO_BYTES,
  markBatchDuplicates,
  parseManifest,
  parseTrackPrepName,
  rowIssue,
  runPool,
  sortFiles,
  summaryText,
  uploadBody,
  uploadOutcome,
  withStyle,
} from './trackImport';

const sources = {
  readTags: readId3,
  hash: (file: Blob) => Promise.resolve(`h-${(file as File).name}`),
};

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  key: 'a.mp3',
  file: new File(['x'], 'a.mp3'),
  artwork: null,
  title: 'T',
  artist: 'A',
  style: 'Rumba',
  mpm: '',
  mpmTouched: false,
  sha256: 'h1',
  existing: null,
  batchDuplicate: false,
  skip: false,
  state: 'idle',
  ...overrides,
});

const json = (value: unknown, name = 'manifest.json') =>
  new File([JSON.stringify(value)], name, { type: 'application/json' });

describe('manifest.json', () => {
  it('indexes the version 1 tracks by file name, normalised to NFC', () => {
    const manifest = parseManifest(
      JSON.stringify({
        version: 1,
        tracks: [
          {
            filename: 'Cañí.mp3'.normalize('NFD'),
            artwork: 'Cañí.jpg',
            title: 'España Cañí',
            artist: 'Orquesta',
            style: 'Paso Doble',
            rawBpm: 123.6,
            mpm: 62,
            sourceKey: 'apple:7',
            sourceUrl: 'https://example.test',
          },
          { title: 'no file name' },
        ],
      }),
    );
    expect(manifest?.size).toBe(1);
    expect(manifest?.get('Cañí.mp3')).toEqual({
      filename: 'Cañí.mp3'.normalize('NFD'),
      artwork: 'Cañí.jpg',
      title: 'España Cañí',
      artist: 'Orquesta',
      style: 'Paso Doble',
      rawBpm: 123.6,
      mpm: 62,
      sourceKey: 'apple:7',
    });
  });

  it('refuses anything that is not a version 1 manifest', () => {
    expect(parseManifest('{not json')).toBeNull();
    expect(parseManifest(JSON.stringify({ version: 2, tracks: [] }))).toBeNull();
    expect(parseManifest(JSON.stringify({ version: 1 }))).toBeNull();
  });
});

describe('track-prep file names', () => {
  it('reads dance, artist, title and MPM, with the fullwidth separator', () => {
    expect(parseTrackPrepName('01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).mp3')).toEqual({
      style: 'Jive',
      artist: 'Empress Orchestra',
      title: 'In the Mood',
      mpm: 42,
    });
    expect(
      parseTrackPrepName('02-JIVE ｜ DJ Maksy - On Ira (Jive 43bpm) (43 MPM).mp3'),
    ).toMatchObject({
      title: 'On Ira (Jive 43bpm)',
      mpm: 43,
    });
  });

  it('accepts the ASCII bar, a raw BPM, an unknown dance and no tempo', () => {
    expect(parseTrackPrepName('07-AUTRE | Artiste - Titre (124 BPM).mp3')).toEqual({
      style: null,
      artist: 'Artiste',
      title: 'Titre',
      rawBpm: 124,
    });
    expect(parseTrackPrepName('03-VALSE LENTE ｜ A – B - C.mp3')).toEqual({
      style: 'Valse Lente',
      artist: 'A – B',
      title: 'C',
    });
  });

  it('ignores any other name', () => {
    expect(parseTrackPrepName('Ma chanson.mp3')).toBeNull();
    expect(parseTrackPrepName('01-JIVE - Artiste - Titre.mp3')).toBeNull();
  });

  it('maps a dance written any way to its canonical label', () => {
    expect(canonicalStyle('VALSE VIENNOISE')).toBe('Valse Viennoise');
    expect(canonicalStyle('cha cha cha')).toBe('Cha-cha');
    expect(canonicalStyle(' ambiance ')).toBe('Ambiance');
    expect(canonicalStyle('AUTRE')).toBeNull();
    expect(canonicalStyle(undefined)).toBeNull();
  });
});

describe('building the rows', () => {
  it('sorts the dropped files: MP3s by name, images, manifest, others ignored', async () => {
    const picked = await sortFiles([
      new File(['x'], 'b.mp3'),
      new File(['x'], 'notes.txt'),
      new File(['x'], '.DS_Store'),
      new File(['x'], 'a.MP3'),
      new File(['x'], 'a.jpg'),
      json({ version: 1, tracks: [] }),
    ]);
    expect(picked.audio.map((f) => f.name)).toEqual(['a.MP3', 'b.mp3']);
    expect([...picked.images.keys()]).toEqual(['a.jpg']);
    expect(picked.manifest?.size).toBe(0);
    expect(picked.manifestInvalid).toBe(false);
    expect(picked.ignored).toEqual(['notes.txt']);
    const broken = new File(['{oops'], 'manifest.json');
    expect((await sortFiles([broken])).manifestInvalid).toBe(true);
  });

  it('takes everything from the manifest when it lists the file', async () => {
    const audio = new File(['x'], '01-JIVE ｜ E - M (42 MPM).mp3');
    const cover = new File(['x'], '01.jpg');
    const picked = await sortFiles([
      audio,
      cover,
      json({
        version: 1,
        tracks: [
          {
            filename: audio.name,
            artwork: '01.jpg',
            title: 'In the Mood',
            artist: 'Empress Orchestra',
            style: 'Jive',
            rawBpm: 169.64,
            mpm: 42,
            sourceKey: 'apple:1',
          },
        ],
      }),
    ]);
    expect(await buildRow(audio, picked, sources)).toMatchObject({
      key: audio.name,
      title: 'In the Mood',
      artist: 'Empress Orchestra',
      style: 'Jive',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
      artwork: cover,
      sha256: `h-${audio.name}`,
      state: 'idle',
    });
  });

  it('falls back to the ID3 tags, then the file name, and the embedded cover', async () => {
    const bytes = mp3Bytes([
      textFrame('TIT2', 'Banto'),
      textFrame('TCON', 'Samba'),
      pictureFrame('image/jpeg', JPEG_BYTES),
    ]);
    const audio = mp3File('05-SAMBA ｜ DJ Maksy - Banto (Samba 51) (51 MPM).mp3', bytes);
    const built = await buildRow(audio, await sortFiles([audio]), sources);
    expect(built).toMatchObject({ title: 'Banto', artist: 'DJ Maksy', style: 'Samba', mpm: 51 });
    expect(built.rawBpm).toBeUndefined();
    expect(built.sourceKey).toBeUndefined();
    expect(built.artwork?.type).toBe('image/jpeg');
  });

  it('prefers a sibling image to the embedded cover, and ignores an artwork over 2 MB', async () => {
    const audio = mp3File('song.mp3', mp3Bytes([pictureFrame('image/jpeg', JPEG_BYTES)]));
    const sibling = new File(['x'], 'song.jpg');
    expect((await buildRow(audio, await sortFiles([audio, sibling]), sources)).artwork).toBe(
      sibling,
    );
    const huge = new File([new Uint8Array(MAX_ARTWORK_BYTES + 1)], 'song.png');
    const built = await buildRow(audio, await sortFiles([audio, huge]), sources);
    expect(built.artwork).not.toBe(huge);
    expect(built.artwork?.type).toBe('image/jpeg');
  });

  it('uses the bare file name as title when nothing else matches', async () => {
    const audio = new File(['not an mp3 tag'], 'Ma chanson.mp3');
    expect(await buildRow(audio, await sortFiles([audio]), sources)).toMatchObject({
      title: 'Ma chanson',
      artist: '',
      style: '',
      mpm: '',
    });
  });
});

describe('row statuses', () => {
  it('flags duplicates first, then the size, then the missing fields', () => {
    const big = new File(['x'], 'big.mp3');
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    expect(rowIssue(row())).toBeNull();
    expect(rowIssue(row({ existing: { trackId: 't1' }, title: '' }))).toBe('duplicate');
    expect(rowIssue(row({ batchDuplicate: true }))).toBe('batch-duplicate');
    expect(rowIssue(row({ file: big }))).toBe('too-big');
    expect(rowIssue(row({ title: '  ' }))).toBe('missing-title');
    expect(rowIssue(row({ artist: '' }))).toBe('missing-artist');
    expect(rowIssue(row({ style: '' }))).toBe('missing-dance');
  });

  it('sends only the ready rows that are neither skipped nor done', () => {
    expect(isSendable(row())).toBe(true);
    expect(isSendable(row({ state: 'failed' }))).toBe(true);
    expect(isSendable(row({ skip: true }))).toBe(false);
    expect(isSendable(row({ state: 'done' }))).toBe(false);
    expect(isSendable(row({ style: '' }))).toBe(false);
  });

  it('flags the second copy of a file or of a source in the batch', () => {
    const marked = markBatchDuplicates([
      row({ key: 'a', sha256: 'h1', sourceKey: 'apple:1' }),
      row({ key: 'b', sha256: 'h1' }),
      row({ key: 'c', sha256: 'h3', sourceKey: 'apple:1' }),
      row({ key: 'd', sha256: 'h4' }),
    ]);
    expect(marked.map((r) => r.batchDuplicate)).toEqual([false, true, true, false]);
  });
});

describe('dance change in the table', () => {
  it('recomputes the MPM from the raw tempo, as the server would', () => {
    expect(withStyle(row({ style: 'Samba', rawBpm: 100, mpm: 50 }), 'Rumba')).toMatchObject({
      style: 'Rumba',
      mpm: 25,
    });
    expect(withStyle(row({ style: 'Samba', rawBpm: 123.6, mpm: 62 }), '')).toMatchObject({
      mpm: 124,
    });
  });

  it('keeps a typed MPM, and drops a file-name MPM without raw tempo (the server analyses)', () => {
    expect(withStyle(row({ rawBpm: 100, mpm: 30, mpmTouched: true }), 'Rumba')).toMatchObject({
      mpm: 30,
    });
    expect(withStyle(row({ mpm: 51 }), 'Rumba')).toMatchObject({ mpm: '' });
  });
});

describe('duplicate check', () => {
  it('asks by batches of 200 and maps the hits to their rows', async () => {
    const rows = Array.from({ length: 450 }, (_, i) =>
      row({ key: `r${i}`, sha256: `h${i}`, ...(i === 0 && { sourceKey: 'apple:0' }) }),
    );
    const check = vi.fn(async (items: { sha256: string; sourceKey?: string }[]) =>
      items.map((item) =>
        item.sha256 === 'h0' || item.sha256 === 'h449'
          ? { exists: true, trackId: `t-${item.sha256}` }
          : { exists: false },
      ),
    );
    const found = await findExisting(rows, check);
    expect(check.mock.calls.map(([items]) => items.length)).toEqual([200, 200, 50]);
    expect(check.mock.calls[0][0][0]).toEqual({ sha256: 'h0', sourceKey: 'apple:0' });
    expect(check.mock.calls[0][0][1]).toEqual({ sha256: 'h1' });
    expect([...found.entries()]).toEqual([
      ['r0', 't-h0'],
      ['r449', 't-h449'],
    ]);
  });
});

describe('upload', () => {
  it('sends the files and the filled fields only', () => {
    const cover = new Blob(['x'], { type: 'image/jpeg' });
    const r = row({ artwork: cover, mpm: 42, rawBpm: 169.64, sourceKey: 'apple:1', title: ' T ' });
    expect(uploadBody(r)).toEqual({
      audio: r.file,
      artwork: cover,
      title: 'T',
      artist: 'A',
      style: 'Rumba',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
      sha256: 'h1',
    });
    expect(uploadBody(row({ style: '' }))).toEqual({
      audio: expect.any(File),
      title: 'T',
      artist: 'A',
      sha256: 'h1',
    });
  });

  it('turns each answer into an outcome', () => {
    expect(uploadOutcome({ data: { id: 't1' } })).toEqual({ state: 'done', trackId: 't1' });
    expect(uploadOutcome({ error: { statusCode: 409, existingTrackId: 't9' } })).toEqual({
      state: 'duplicate',
      trackId: 't9',
    });
    expect(uploadOutcome({ error: { statusCode: 409 } })).toEqual({ state: 'duplicate' });
    expect(uploadOutcome({ error: { statusCode: 413, message: 'File too large' } })).toEqual({
      state: 'failed',
      error: 'Fichier trop volumineux (MP3 : 20 Mo, pochette : 2 Mo au plus).',
    });
    expect(uploadOutcome({ error: new TypeError('Failed to fetch') })).toEqual({
      state: 'failed',
      error: 'Serveur injoignable, réessayez dans un instant.',
    });
    expect(
      uploadOutcome({ error: { statusCode: 400, message: "Le fichier audio n'est pas un MP3." } }),
    ).toEqual({
      state: 'failed',
      error: "Le fichier audio n'est pas un MP3.",
    });
  });

  it('never runs more uploads at once than the limit, and runs them all', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 * (6 - n)));
      inFlight -= 1;
      done.push(n);
    });
    expect(peak).toBe(2);
    expect([...done].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('sums up the import, skipped rows aside', () => {
    const summary = importSummary([
      row({ state: 'done' }),
      row({ state: 'done' }),
      row({ existing: { trackId: 't1' } }),
      row({ batchDuplicate: true }),
      row({ state: 'failed', error: 'x' }),
      row({ skip: true, state: 'failed' }),
      row(),
    ]);
    expect(summary).toEqual({ imported: 2, duplicates: 2, failed: 1 });
    expect(summaryText(summary)).toBe('2 importées, 2 doublons, 1 échecs');
  });
});
```

Run: `pnpm --filter admin exec vitest run src/lib/trackImport.test.ts --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./trackImport"`.

- [ ] **Step 6: Implement the import helpers**

Create `apps/admin/src/lib/trackImport.ts`:

```ts
import type { AdminTracksControllerCreateData } from '../api/generated/types.gen';
import { apiErrorMessage, isConflict } from './apiError';
import { readText } from './files';
import type { Id3Tags } from './id3';
import { calculateMpm, type DanceKey, normalizeDance } from './mpm';
import { AMBIANCE, type StyleOption } from './tracks';

/** Same limits as the API (POST /admin/tracks). */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
/** Items per POST /admin/tracks/check: the API refuses more. */
export const CHECK_BATCH_SIZE = 200;
/** Uploads in flight at once. */
export const MAX_PARALLEL_UPLOADS = 2;

const nfc = (name: string): string => name.normalize('NFC');

/** track-prep `manifest.json`, version 1: the fields the import uses. */
export interface ManifestTrack {
  filename: string;
  artwork: string | null;
  title: string;
  artist: string;
  style: string | null;
  rawBpm: number;
  mpm: number;
  sourceKey: string | null;
}

/**
 * Manifest entries by file name (NFC: macOS may hand the picked file names
 * decomposed), or null when the text is not a version 1 manifest.
 */
export function parseManifest(text: string): Map<string, ManifestTrack> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { version, tracks } = data as { version?: unknown; tracks?: unknown };
  if (version !== 1 || !Array.isArray(tracks)) return null;
  const byFile = new Map<string, ManifestTrack>();
  for (const entry of tracks as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.filename !== 'string') continue;
    byFile.set(nfc(e.filename), {
      filename: e.filename,
      artwork: typeof e.artwork === 'string' ? e.artwork : null,
      title: typeof e.title === 'string' ? e.title : '',
      artist: typeof e.artist === 'string' ? e.artist : '',
      style: typeof e.style === 'string' ? e.style : null,
      rawBpm: typeof e.rawBpm === 'number' ? e.rawBpm : 0,
      mpm: typeof e.mpm === 'number' ? e.mpm : 0,
      sourceKey: typeof e.sourceKey === 'string' ? e.sourceKey : null,
    });
  }
  return byFile;
}

const STYLE_BY_DANCE: Record<DanceKey, StyleOption> = {
  rumba: 'Rumba',
  'cha-cha': 'Cha-cha',
  samba: 'Samba',
  'paso doble': 'Paso Doble',
  jive: 'Jive',
  'valse lente': 'Valse Lente',
  tango: 'Tango',
  viennoise: 'Valse Viennoise',
  'slow fox': 'Slow Fox',
  quickstep: 'Quickstep',
};

/** Canonical label of a dance written any way (manifest, ID3 genre, file-name token). */
export function canonicalStyle(input: string | null | undefined): StyleOption | null {
  if (!input) return null;
  if (input.trim().toLowerCase() === 'ambiance') return AMBIANCE;
  const key = normalizeDance(input);
  return key ? STYLE_BY_DANCE[key] : null;
}

export interface NameInfo {
  style: StyleOption | null;
  artist: string;
  title: string;
  mpm?: number;
  rawBpm?: number;
}

/**
 * track-prep file name `NN-DANSE ｜ Artiste - Titre (52 MPM).mp3`: fullwidth
 * bar U+FF5C (the one NTFS accepts) or ASCII `|`; `(N BPM)` when the dance is
 * unknown (`AUTRE`); no tempo part when none was detected.
 */
const TRACK_PREP_NAME =
  /^\d+-(.+?) [｜|] (.+?) - (.+?)(?: \((\d+(?:[.,]\d+)?) (MPM|BPM)\))?\.mp3$/i;

export function parseTrackPrepName(filename: string): NameInfo | null {
  const match = TRACK_PREP_NAME.exec(nfc(filename));
  if (!match) return null;
  const [, styleToken, artist, title, tempo, unit] = match;
  const value = tempo ? Number(tempo.replace(',', '.')) : 0;
  const info: NameInfo = {
    style: canonicalStyle(styleToken),
    artist: artist.trim(),
    title: title.trim(),
  };
  if (value > 0 && unit.toUpperCase() === 'MPM') info.mpm = Math.round(value);
  if (value > 0 && unit.toUpperCase() === 'BPM') info.rawBpm = value;
  return info;
}

export interface PickedFiles {
  /** MP3 files, sorted by name (track-prep numbers them). */
  audio: File[];
  /** JPEG / PNG files by NFC name. */
  images: Map<string, File>;
  manifest: Map<string, ManifestTrack> | null;
  /** A manifest.json was dropped but could not be read. */
  manifestInvalid: boolean;
  /** Other files, hidden ones aside. */
  ignored: string[];
}

export async function sortFiles(files: readonly File[]): Promise<PickedFiles> {
  const picked: PickedFiles = {
    audio: [],
    images: new Map(),
    manifest: null,
    manifestInvalid: false,
    ignored: [],
  };
  for (const file of files) {
    const name = nfc(file.name);
    const lower = name.toLowerCase();
    if (lower.endsWith('.mp3')) picked.audio.push(file);
    else if (/\.(jpe?g|png)$/.test(lower)) picked.images.set(name, file);
    else if (lower === 'manifest.json') {
      picked.manifest = parseManifest(await readText(file));
      picked.manifestInvalid = picked.manifest === null;
    } else if (!name.startsWith('.')) picked.ignored.push(name);
  }
  picked.audio.sort((a, b) => nfc(a.name).localeCompare(nfc(b.name)));
  return picked;
}

export interface RowSources {
  readTags: (file: Blob) => Promise<Id3Tags | null>;
  hash: (file: Blob) => Promise<string>;
}

export type RowState = 'idle' | 'sending' | 'done' | 'failed';

/** One MP3 of the review table. */
export interface ImportRow {
  /** Relative path (or name) of the file: unique in the batch. */
  key: string;
  file: File;
  artwork: Blob | null;
  title: string;
  artist: string;
  style: StyleOption | '';
  /** '' while empty: the server then computes it. */
  mpm: number | '';
  mpmTouched: boolean;
  rawBpm?: number;
  sourceKey?: string;
  sha256: string;
  /** Already in the library (check or 409), with the existing track when known. */
  existing: { trackId?: string } | null;
  batchDuplicate: boolean;
  skip: boolean;
  state: RowState;
  error?: string;
  trackId?: string;
}

const usableArtwork = (image: Blob | null | undefined): Blob | null =>
  image && image.size <= MAX_ARTWORK_BYTES ? image : null;

function siblingImage(base: string, images: Map<string, File>): File | undefined {
  for (const ext of ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG']) {
    const image = images.get(base + ext);
    if (image) return image;
  }
  return undefined;
}

/**
 * Pre-fill of one row, in the browser (nothing is sent): the manifest entry
 * when it lists the file; otherwise the ID3 tags, completed by the track-prep
 * file name; otherwise the file name without extension as title.
 */
export async function buildRow(
  file: File,
  picked: PickedFiles,
  sources: RowSources,
): Promise<ImportRow> {
  const name = nfc(file.name);
  const row: ImportRow = {
    key: nfc(file.webkitRelativePath || file.name),
    file,
    artwork: null,
    title: '',
    artist: '',
    style: '',
    mpm: '',
    mpmTouched: false,
    sha256: await sources.hash(file),
    existing: null,
    batchDuplicate: false,
    skip: false,
    state: 'idle',
  };
  const entry = picked.manifest?.get(name);
  if (entry) {
    return {
      ...row,
      title: entry.title,
      artist: entry.artist,
      style: canonicalStyle(entry.style) ?? '',
      mpm: entry.mpm > 0 ? Math.round(entry.mpm) : '',
      ...(entry.rawBpm > 0 ? { rawBpm: entry.rawBpm } : {}),
      ...(entry.sourceKey ? { sourceKey: entry.sourceKey } : {}),
      artwork: usableArtwork(entry.artwork ? picked.images.get(nfc(entry.artwork)) : null),
    };
  }
  const tags = await sources.readTags(file);
  const fromName = parseTrackPrepName(name);
  const base = name.replace(/\.mp3$/i, '');
  const picture =
    tags?.picture && (tags.picture.mime === 'image/jpeg' || tags.picture.mime === 'image/png')
      ? new Blob([tags.picture.data], { type: tags.picture.mime })
      : null;
  return {
    ...row,
    title: tags?.title ?? fromName?.title ?? base,
    artist: tags?.artist ?? fromName?.artist ?? '',
    style: canonicalStyle(tags?.genre) ?? fromName?.style ?? '',
    mpm: fromName?.mpm ?? '',
    ...(fromName?.rawBpm !== undefined ? { rawBpm: fromName.rawBpm } : {}),
    artwork: usableArtwork(siblingImage(base, picked.images)) ?? usableArtwork(picture),
  };
}

export type RowIssue =
  | 'duplicate'
  | 'batch-duplicate'
  | 'too-big'
  | 'missing-title'
  | 'missing-artist'
  | 'missing-dance';

export const ISSUE_LABELS: Record<RowIssue, { icon: string; label: string }> = {
  duplicate: { icon: '⛔', label: 'Doublon' },
  'batch-duplicate': { icon: '⛔', label: 'Doublon dans le lot' },
  'too-big': { icon: '⛔', label: 'Fichier de plus de 20 Mo' },
  'missing-title': { icon: '⚠️', label: 'Titre manquant' },
  'missing-artist': { icon: '⚠️', label: 'Artiste manquant' },
  'missing-dance': { icon: '⚠️', label: 'Danse manquante' },
};

/** Why a row cannot be sent (⛔ or ⚠️), or null when it is ✅ ready. */
export function rowIssue(row: ImportRow): RowIssue | null {
  if (row.existing) return 'duplicate';
  if (row.batchDuplicate) return 'batch-duplicate';
  if (row.file.size > MAX_AUDIO_BYTES) return 'too-big';
  if (!row.title.trim()) return 'missing-title';
  if (!row.artist.trim()) return 'missing-artist';
  if (!row.style) return 'missing-dance';
  return null;
}

export const isSendable = (row: ImportRow): boolean =>
  !row.skip && row.state !== 'done' && rowIssue(row) === null;

/** The second copy of a file (same hash) or of a source in the batch is a duplicate. */
export function markBatchDuplicates(rows: readonly ImportRow[]): ImportRow[] {
  const hashes = new Set<string>();
  const keys = new Set<string>();
  return rows.map((row) => {
    const duplicate =
      hashes.has(row.sha256) || (row.sourceKey !== undefined && keys.has(row.sourceKey));
    hashes.add(row.sha256);
    if (row.sourceKey) keys.add(row.sourceKey);
    return { ...row, batchDuplicate: duplicate };
  });
}

/**
 * Dance change in the table. Unless the admin typed an MPM, it follows the
 * dance as the server computes it from the raw tempo; without a raw tempo the
 * server analyses the file, so the MPM is left to it.
 */
export function withStyle(row: ImportRow, style: StyleOption | ''): ImportRow {
  if (row.mpmTouched) return { ...row, style };
  return { ...row, style, mpm: row.rawBpm ? calculateMpm(row.rawBpm, style) : '' };
}

export type CheckItem = { sha256: string; sourceKey?: string };
export type CheckAnswer = { exists: boolean; trackId?: string };

/** Rows already in the library, by row key (one request per 200 rows). */
export async function findExisting(
  rows: readonly ImportRow[],
  check: (items: CheckItem[]) => Promise<CheckAnswer[]>,
): Promise<Map<string, string | undefined>> {
  const found = new Map<string, string | undefined>();
  for (let start = 0; start < rows.length; start += CHECK_BATCH_SIZE) {
    const batch = rows.slice(start, start + CHECK_BATCH_SIZE);
    const answers = await check(
      batch.map((row) => ({
        sha256: row.sha256,
        ...(row.sourceKey ? { sourceKey: row.sourceKey } : {}),
      })),
    );
    answers.forEach((answer, index) => {
      const target = batch[index];
      if (answer.exists && target) found.set(target.key, answer.trackId);
    });
  }
  return found;
}

/** Multipart body of POST /admin/tracks: the files and the filled fields only. */
export function uploadBody(row: ImportRow): AdminTracksControllerCreateData['body'] {
  return {
    audio: row.file,
    ...(row.artwork ? { artwork: row.artwork } : {}),
    title: row.title.trim(),
    artist: row.artist.trim(),
    ...(row.style ? { style: row.style } : {}),
    ...(typeof row.mpm === 'number' ? { mpm: row.mpm } : {}),
    ...(row.rawBpm !== undefined ? { rawBpm: row.rawBpm } : {}),
    ...(row.sourceKey ? { sourceKey: row.sourceKey } : {}),
    sha256: row.sha256,
  };
}

export type UploadOutcome =
  | { state: 'done'; trackId: string }
  | { state: 'duplicate'; trackId?: string }
  | { state: 'failed'; error: string };

/** Outcome of one upload: a 409 is a duplicate, not a failure. */
export function uploadOutcome(result: { data?: { id: string }; error?: unknown }): UploadOutcome {
  if (result.error === undefined && result.data) {
    return { state: 'done', trackId: result.data.id };
  }
  const body = result.error;
  if (isConflict(body)) {
    const id = (body as { existingTrackId?: unknown }).existingTrackId;
    return typeof id === 'string' ? { state: 'duplicate', trackId: id } : { state: 'duplicate' };
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 413
  ) {
    return {
      state: 'failed',
      error: 'Fichier trop volumineux (MP3 : 20 Mo, pochette : 2 Mo au plus).',
    };
  }
  return { state: 'failed', error: apiErrorMessage(body, "Échec de l'envoi.") };
}

/** Runs `work` on every item, at most `limit` at a time. `work` must not reject. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  failed: number;
}

export function importSummary(rows: readonly ImportRow[]): ImportSummary {
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0 };
  for (const row of rows) {
    if (row.skip) continue;
    if (row.state === 'done') summary.imported += 1;
    else if (row.state === 'failed') summary.failed += 1;
    else if (row.existing || row.batchDuplicate) summary.duplicates += 1;
  }
  return summary;
}

/** « N importées, D doublons, E échecs » (spec wording, numbers as is). */
export const summaryText = ({ imported, duplicates, failed }: ImportSummary): string =>
  `${imported} importées, ${duplicates} doublons, ${failed} échecs`;
```

Run: `pnpm --filter admin exec vitest run src/lib/trackImport.test.ts --testTimeout=60000`
Expected: PASS.

- [ ] **Step 7: Write the failing import-page tests**

Create `apps/admin/src/pages/TrackImportPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { JPEG_BYTES, mp3Bytes, mp3File, textFrame } from '../test/id3Fixture';
import { TrackImportPage } from './TrackImportPage';

const ok = (data: unknown) => ({ data, error: undefined });
const failure = (error: unknown) => ({ data: undefined, error });

type CreateOptions = { body: { title: string } & Record<string, unknown> };

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TrackImportPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const pick = (files: File[]) =>
  fireEvent.change(screen.getByTestId('files-input'), { target: { files } });

/** An MP3 tagged like track-prep does; the name salts the bytes (distinct hashes). */
const tagged = (name: string, title: string, artist: string, genre?: string) =>
  mp3File(
    name,
    mp3Bytes(
      [
        textFrame('TIT2', title),
        textFrame('TPE1', artist),
        ...(genre ? [textFrame('TCON', genre)] : []),
      ],
      3,
      name,
    ),
  );

const importButton = () => screen.getByRole('button', { name: 'Importer' });

const checkAnswers = (...items: object[]) =>
  vi.spyOn(sdk, 'adminTracksControllerCheck').mockResolvedValue(ok({ items }) as never);

const createImpl = (impl: (options: CreateOptions) => unknown) =>
  vi
    .spyOn(sdk, 'adminTracksControllerCreate')
    .mockImplementation((async (options: CreateOptions) => impl(options)) as never);

describe('TrackImportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-fills from a track-prep manifest, checks duplicates and imports the ready rows', async () => {
    const names = [
      '01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).mp3',
      '02-SAMBA ｜ DJ Maksy - Banto (51 MPM).mp3',
      '03-RUMBA ｜ Ana - Luz (25 MPM).mp3',
    ];
    const audio = names.map((name) => mp3File(name, mp3Bytes([], 3, name)));
    const cover = new File(
      [Uint8Array.from(JPEG_BYTES)],
      '01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).jpg',
      {
        type: 'image/jpeg',
      },
    );
    const manifest = new File(
      [
        JSON.stringify({
          version: 1,
          tracks: [
            {
              filename: names[0],
              artwork: cover.name,
              title: 'In the Mood',
              artist: 'Empress Orchestra',
              style: 'Jive',
              rawBpm: 169.64,
              mpm: 42,
              sourceKey: 'apple:1',
            },
            {
              filename: names[1],
              artwork: null,
              title: 'Banto',
              artist: 'DJ Maksy',
              style: 'Samba',
              rawBpm: 102,
              mpm: 51,
              sourceKey: 'apple:2',
            },
            {
              filename: names[2],
              artwork: null,
              title: 'Luz',
              artist: 'Ana',
              style: 'Rumba',
              rawBpm: 100,
              mpm: 25,
              sourceKey: 'apple:3',
            },
          ],
        }),
      ],
      'manifest.json',
      { type: 'application/json' },
    );
    const check = checkAnswers(
      { exists: false },
      { exists: true, trackId: 't-old' },
      { exists: false },
    );
    const create = createImpl((options) => ok({ id: `new-${options.body.title}` }));
    renderPage();

    pick([manifest, cover, ...audio]);

    expect(await screen.findAllByText('✅ Prête')).toHaveLength(2);
    expect(screen.getByText('⛔ Doublon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/tracks/t-old');
    expect(screen.getByLabelText(`Titre — ${names[0]}`)).toHaveValue('In the Mood');
    expect((check.mock.calls[0][0] as { body: { items: unknown[] } }).body.items).toEqual([
      { sha256: expect.stringMatching(/^[0-9a-f]{64}$/), sourceKey: 'apple:1' },
      expect.objectContaining({ sourceKey: 'apple:2' }),
      expect.objectContaining({ sourceKey: 'apple:3' }),
    ]);

    await userEvent.click(importButton());

    expect(await screen.findByText('2 importées, 1 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    const bodies = create.mock.calls.map(([options]) => (options as CreateOptions).body);
    expect(bodies[0]).toMatchObject({
      title: 'In the Mood',
      artist: 'Empress Orchestra',
      style: 'Jive',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
    });
    expect(bodies[0].audio).toBe(audio[0]);
    expect(bodies[0].artwork).toBe(cover);
    expect(bodies[1]).toMatchObject({ title: 'Luz', sourceKey: 'apple:3' });
    expect(bodies[1]).not.toHaveProperty('artwork');
  });

  it('falls back to the tags and the file name, and waits for a dance', async () => {
    checkAnswers({ exists: false });
    renderPage();

    pick([mp3File('Ma chanson.mp3', mp3Bytes([textFrame('TPE1', 'Orchestre')]))]);

    expect(await screen.findByText('⚠️ Danse manquante')).toBeInTheDocument();
    expect(screen.getByLabelText('Titre — Ma chanson.mp3')).toHaveValue('Ma chanson');
    expect(screen.getByLabelText('Artiste — Ma chanson.mp3')).toHaveValue('Orchestre');
    await waitFor(() => expect(screen.getByText('0 musique prête à importer')).toBeInTheDocument());
    expect(importButton()).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Danse — Ma chanson.mp3', { selector: 'input' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Rumba' }));

    expect(await screen.findByText('✅ Prête')).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it('flags a file present twice in the batch', async () => {
    const bytes = mp3Bytes([
      textFrame('TIT2', 'Same'),
      textFrame('TPE1', 'A'),
      textFrame('TCON', 'Jive'),
    ]);
    checkAnswers({ exists: false }, { exists: false });
    renderPage();

    pick([mp3File('a.mp3', bytes), mp3File('b.mp3', bytes)]);

    expect(await screen.findByText('⛔ Doublon dans le lot')).toBeInTheDocument();
    expect(screen.getAllByText('✅ Prête')).toHaveLength(1);
  });

  it('reports each failure with its reason and retries the failures only', async () => {
    checkAnswers({ exists: false }, { exists: false });
    let firstTry = true;
    const create = createImpl((options) => {
      if (options.body.title === 'A' && firstTry) {
        firstTry = false;
        return failure({ statusCode: 500, message: 'Erreur interne' });
      }
      return ok({ id: `new-${options.body.title}` });
    });
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba'), tagged('b.mp3', 'B', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(importButton());

    expect(await screen.findByText('1 importées, 0 doublons, 1 échecs')).toBeInTheDocument();
    expect(screen.getByText('a.mp3 : Erreur interne')).toBeInTheDocument();
    expect(screen.getByText('⛔ Échec : Erreur interne')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Réessayer les échecs' }));

    expect(await screen.findByText('2 importées, 0 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(3);
    expect((create.mock.calls[2][0] as CreateOptions).body.title).toBe('A');
  });

  it('counts a 409 during the send as a duplicate, with a link to the existing track', async () => {
    checkAnswers({ exists: false });
    createImpl(() =>
      failure({
        statusCode: 409,
        message: 'Cette musique est déjà dans la bibliothèque.',
        existingTrackId: 't9',
      }),
    );
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(importButton());

    expect(await screen.findByText('0 importées, 1 doublons, 0 échecs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/tracks/t9');
  });

  it('never sends a skipped row', async () => {
    checkAnswers({ exists: false }, { exists: false });
    const create = createImpl((options) => ok({ id: `new-${options.body.title}` }));
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba'), tagged('b.mp3', 'B', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(screen.getByLabelText('Ignorer b.mp3'));
    await userEvent.click(importButton());

    expect(await screen.findByText('1 importées, 0 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as CreateOptions).body.title).toBe('A');
  });

  it('keeps the import closed until the duplicate check answered', async () => {
    const check = vi
      .spyOn(sdk, 'adminTracksControllerCheck')
      .mockResolvedValueOnce(failure(new TypeError('Failed to fetch')) as never)
      .mockResolvedValueOnce(ok({ items: [{ exists: false }] }) as never);
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba')]);

    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    expect(importButton()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Vérifier à nouveau' }));

    await waitFor(() => expect(importButton()).toBeEnabled());
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('accepts files dropped on the zone', async () => {
    checkAnswers({ exists: false });
    renderPage();

    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [tagged('a.mp3', 'A', 'X', 'Rumba')], items: [] },
    });

    expect(await screen.findByText('✅ Prête')).toBeInTheDocument();
  });

  it('offers the folder and file pickers as real buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choisir des fichiers' })).toBeEnabled();
    expect(screen.getByTestId('folder-input')).toHaveAttribute('webkitdirectory');
  });
});
```

Run: `pnpm --filter admin exec vitest run src/pages/TrackImportPage.test.tsx --testTimeout=60000`
Expected: FAIL — `Failed to resolve import "./TrackImportPage"`.

- [ ] **Step 8: Implement the import page**

Create `apps/admin/src/pages/TrackImportPage.tsx`:

```tsx
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  List,
  Loader,
  NumberInput,
  Paper,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { adminTracksControllerCheck, adminTracksControllerCreate } from '../api/generated/sdk.gen';
import { unwrap } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { droppedFiles, sha256Hex } from '../lib/files';
import { readId3 } from '../lib/id3';
import {
  buildRow,
  type CheckItem,
  findExisting,
  type ImportRow,
  importSummary,
  isSendable,
  ISSUE_LABELS,
  markBatchDuplicates,
  MAX_PARALLEL_UPLOADS,
  rowIssue,
  runPool,
  sortFiles,
  summaryText,
  uploadBody,
  type UploadOutcome,
  uploadOutcome,
  withStyle,
} from '../lib/trackImport';
import { STYLE_OPTIONS, type StyleOption } from '../lib/tracks';

type CheckState = 'idle' | 'running' | 'ok' | 'error';

const checkItems = (items: CheckItem[]) =>
  unwrap(adminTracksControllerCheck({ body: { items } })).then((result) => result.items);

function outcomePatch(outcome: UploadOutcome): Partial<ImportRow> {
  if (outcome.state === 'done')
    return { state: 'done', trackId: outcome.trackId, error: undefined };
  if (outcome.state === 'duplicate') {
    return { state: 'idle', existing: { trackId: outcome.trackId }, error: undefined };
  }
  return { state: 'failed', error: outcome.error };
}

function RowStatus({ row }: { row: ImportRow }) {
  if (row.skip) {
    return (
      <Text size="sm" c="dimmed">
        Ignorée
      </Text>
    );
  }
  if (row.state === 'done') {
    return (
      <Group gap={4}>
        <Text size="sm">✅ Importée</Text>
        {row.trackId && (
          <Anchor component={Link} to={`/tracks/${row.trackId}`} size="sm">
            Voir
          </Anchor>
        )}
      </Group>
    );
  }
  if (row.state === 'sending') {
    return (
      <Group gap={4}>
        <Loader size="xs" />
        <Text size="sm">Envoi…</Text>
      </Group>
    );
  }
  if (row.state === 'failed') {
    return (
      <Text size="sm" c="red">
        ⛔ Échec : {row.error}
      </Text>
    );
  }
  const issue = rowIssue(row);
  if (!issue) return <Text size="sm">✅ Prête</Text>;
  const { icon, label } = ISSUE_LABELS[issue];
  return (
    <Group gap={4}>
      <Text size="sm">
        {icon} {label}
      </Text>
      {row.existing?.trackId && (
        <Anchor component={Link} to={`/tracks/${row.existing.trackId}`} size="sm">
          Voir
        </Anchor>
      )}
    </Group>
  );
}

export function TrackImportPage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>('idle');
  const [checkError, setCheckError] = useState<unknown>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [manifestInvalid, setManifestInvalid] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    // Not a React prop: set as an attribute so the picker selects a whole folder.
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const running = progress !== null;
  const busy = running || reading !== null || check === 'running';

  const patchRow = (key: string, patch: Partial<ImportRow>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const runCheck = async (list: readonly ImportRow[]) => {
    setCheck('running');
    try {
      const found = await findExisting(list, checkItems);
      setRows((current) =>
        current.map((r) =>
          found.has(r.key) ? { ...r, existing: { trackId: found.get(r.key) } } : r,
        ),
      );
      setCheck('ok');
    } catch (error) {
      setCheckError(error);
      setCheck('error');
    }
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setRows([]);
    setFinished(false);
    setReadError(null);
    setCheck('idle');
    try {
      const picked = await sortFiles(files);
      setIgnored(picked.ignored);
      setManifestInvalid(picked.manifestInvalid);
      setReading({ done: 0, total: picked.audio.length });
      const built: ImportRow[] = [];
      // One file at a time: hashing reads the whole MP3 in memory.
      for (const file of picked.audio) {
        built.push(await buildRow(file, picked, { readTags: readId3, hash: sha256Hex }));
        setReading({ done: built.length, total: picked.audio.length });
      }
      const list = markBatchDuplicates(built);
      setRows(list);
      setReading(null);
      if (list.length > 0) await runCheck(list);
    } catch {
      setReading(null);
      setReadError('Lecture des fichiers impossible.');
    }
  };

  const send = async (targets: ImportRow[]) => {
    if (targets.length === 0) return;
    setFinished(false);
    setProgress({ done: 0, total: targets.length });
    await runPool(targets, MAX_PARALLEL_UPLOADS, async (row) => {
      patchRow(row.key, { state: 'sending', error: undefined });
      let outcome: UploadOutcome;
      try {
        outcome = uploadOutcome(await adminTracksControllerCreate({ body: uploadBody(row) }));
      } catch (error) {
        outcome = uploadOutcome({ error });
      }
      patchRow(row.key, outcomePatch(outcome));
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    });
    setProgress(null);
    setFinished(true);
    void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const pick = (input: HTMLInputElement) => {
    const list = Array.from(input.files ?? []);
    input.value = '';
    void addFiles(list);
  };

  const summary = importSummary(rows);
  const ready = rows.filter(isSendable).length;
  const failures = rows.filter((r) => r.state === 'failed' && !r.skip);

  return (
    <Stack>
      <Anchor component={Link} to="/tracks">
        Retour au catalogue
      </Anchor>
      <Title order={2}>Importer des musiques</Title>
      <Paper
        withBorder
        p="xl"
        radius="md"
        data-testid="drop-zone"
        style={{ borderStyle: 'dashed' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void droppedFiles(e.dataTransfer).then(addFiles);
        }}
      >
        <Stack align="center" gap="xs">
          <Text ta="center">
            Déposez ici le dossier de sortie de track-prep, ou des fichiers MP3 avec leurs pochettes
            (JPEG, PNG) et leur manifest.json.
          </Text>
          <Group>
            <Button variant="light" disabled={busy} onClick={() => folderRef.current?.click()}>
              Choisir un dossier
            </Button>
            <Button variant="light" disabled={busy} onClick={() => filesRef.current?.click()}>
              Choisir des fichiers
            </Button>
          </Group>
        </Stack>
        <input
          ref={filesRef}
          data-testid="files-input"
          type="file"
          multiple
          accept=".mp3,.jpg,.jpeg,.png,.json"
          hidden
          onChange={(e) => pick(e.currentTarget)}
        />
        <input
          ref={folderRef}
          data-testid="folder-input"
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.currentTarget)}
        />
      </Paper>

      {reading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">
            Lecture des fichiers… {reading.done} / {reading.total}
          </Text>
        </Group>
      )}
      {readError && <Alert color="red">{readError}</Alert>}
      {manifestInvalid && (
        <Alert color="orange">
          manifest.json illisible : le tableau est pré-rempli depuis les tags et les noms de
          fichiers.
        </Alert>
      )}
      {ignored.length > 0 && (
        <Text size="sm" c="dimmed">
          Fichiers ignorés : {ignored.join(', ')}
        </Text>
      )}
      {check === 'error' && (
        <Alert color="red" title="Vérification des doublons impossible">
          <Stack gap="xs">
            <Text size="sm">{apiErrorMessage(checkError, 'Réessayez dans un instant.')}</Text>
            <Group>
              <Button size="xs" variant="light" onClick={() => void runCheck(rowsRef.current)}>
                Vérifier à nouveau
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Fichier</Table.Th>
                <Table.Th>Titre</Table.Th>
                <Table.Th>Artiste</Table.Th>
                <Table.Th>Danse</Table.Th>
                <Table.Th>MPM</Table.Th>
                <Table.Th>Pochette</Table.Th>
                <Table.Th>Ignorer</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const locked = running || row.state === 'done';
                return (
                  <Table.Tr key={row.key}>
                    <Table.Td>
                      <RowStatus row={row} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{row.key}</Text>
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Titre — ${row.key}`}
                        value={row.title}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { title: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Artiste — ${row.key}`}
                        value={row.artist}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { artist: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={`Danse — ${row.key}`}
                        data={STYLE_OPTIONS}
                        value={row.style || null}
                        clearable
                        disabled={locked}
                        onChange={(v) =>
                          setRows((current) =>
                            current.map((r) =>
                              r.key === row.key ? withStyle(r, (v ?? '') as StyleOption | '') : r,
                            ),
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`MPM — ${row.key}`}
                        placeholder="auto"
                        min={1}
                        max={400}
                        allowDecimal={false}
                        w={90}
                        value={row.mpm}
                        disabled={locked}
                        onChange={(v) =>
                          patchRow(row.key, {
                            mpm: typeof v === 'number' ? v : '',
                            mpmTouched: true,
                          })
                        }
                      />
                    </Table.Td>
                    <Table.Td>{row.artwork ? 'Oui' : '—'}</Table.Td>
                    <Table.Td>
                      <Checkbox
                        aria-label={`Ignorer ${row.key}`}
                        checked={row.skip}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { skip: e.currentTarget.checked })}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          <Group>
            <Button
              disabled={busy || check !== 'ok' || ready === 0}
              loading={running}
              onClick={() => void send(rowsRef.current.filter(isSendable))}
            >
              Importer
            </Button>
            <Text size="sm" c="dimmed">
              {ready} musique{ready > 1 ? 's' : ''} prête{ready > 1 ? 's' : ''} à importer
            </Text>
          </Group>
          {progress && (
            <Stack gap={4}>
              <Progress
                value={(progress.done / progress.total) * 100}
                aria-label="Progression de l'import"
              />
              <Text size="sm">
                Envoi : {progress.done} / {progress.total}
              </Text>
            </Stack>
          )}
          {finished && (
            <Alert color={summary.failed > 0 ? 'orange' : 'green'} title={summaryText(summary)}>
              <Stack gap="xs">
                {failures.length > 0 && (
                  <>
                    <List size="sm">
                      {failures.map((r) => (
                        <List.Item key={r.key}>
                          {r.key} : {r.error}
                        </List.Item>
                      ))}
                    </List>
                    <Group>
                      <Button
                        size="xs"
                        onClick={() =>
                          void send(
                            rowsRef.current.filter((r) => r.state === 'failed' && isSendable(r)),
                          )
                        }
                      >
                        Réessayer les échecs
                      </Button>
                    </Group>
                  </>
                )}
                <Anchor component={Link} to="/tracks" size="sm">
                  Voir le catalogue
                </Anchor>
              </Stack>
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
```

In `apps/admin/src/router.tsx`, import `TrackImportPage` and insert before `{ path: 'tracks/:id', element: <TrackDetailPage /> },`:

```tsx
      { path: 'tracks/import', element: <TrackImportPage /> },
```

Run: `pnpm --filter admin exec vitest run src/lib src/pages/TrackImportPage.test.tsx --testTimeout=60000`
Expected: PASS.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin exec vitest run --testTimeout=60000
git diff --quiet -- apps/admin/package.json && echo "no new dependency"
git add apps/admin/src
git commit -m "feat(admin): bulk track import from a track-prep folder or plain MP3 files

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

Expected: `no new dependency` is printed.

---

### Task 8: « Musiques » menu entry, runbook and full verification

**Files:**

- Modify: `apps/admin/src/components/AppLayout.tsx` (navbar, l. 47-50), `apps/admin/src/components/AppLayout.test.tsx` (first test, l. 40-49)
- Modify: `docs/exploitation/backoffice-admin.md` (Objet l. 8-29, new section between « Modération » and « Hébergement » l. 161-216, « Journal d'audit » l. 422-462, « Coût » l. 463-498)

**Interfaces:**

- Consumes: the `/tracks` route (Task 6).
- Produces: navbar order « Utilisateurs », « Clubs », « Musiques », « Modération », « Journal d'audit »; French runbook.

- [ ] **Step 1: Write the failing menu test**

In `apps/admin/src/components/AppLayout.test.tsx`, in the test "lists the sections of the back-office, without a "new user" shortcut", insert after the `Clubs` assertion:

```tsx
expect(screen.getByRole('link', { name: 'Musiques' })).toHaveAttribute('href', '/tracks');
const order = screen.getAllByRole('link').map((link) => link.textContent);
expect(order.indexOf('Musiques')).toBe(order.indexOf('Clubs') + 1);
```

Run: `pnpm --filter admin exec vitest run src/components/AppLayout.test.tsx --testTimeout=60000`
Expected: FAIL (no « Musiques » link).

- [ ] **Step 2: Add the entry**

In `apps/admin/src/components/AppLayout.tsx`, insert after `<NavLink component={RouterLink} to="/clubs" label="Clubs" />`:

```tsx
<NavLink component={RouterLink} to="/tracks" label="Musiques" />
```

Run: `pnpm --filter admin exec vitest run src/components/AppLayout.test.tsx --testTimeout=60000`
Expected: PASS (the badge and no-polling tests unchanged).

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
git add apps/admin/src/components/AppLayout.tsx apps/admin/src/components/AppLayout.test.tsx
git commit -m "feat(admin): Musiques entry in the back-office menu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

- [ ] **Step 3: Runbook (French)**

In `docs/exploitation/backoffice-admin.md`:

1. In **Objet**, replace `plateforme. Lots 1, 1b, 1c et 2 :` with `plateforme. Lots 1, 1b, 1c, 2 et 3 :`, and insert before the line `- journal d'audit de toutes les écritures admin.`:

```markdown
- catalogue des musiques (toutes, y compris blacklistées, en attente, en
  erreur et d'ambiance) : écoute, correction, clashs paso, masquage du titre,
  blacklist, suppression ; import en lot depuis la sortie de track-prep ou
  depuis de simples fichiers MP3 ;
```

2. Insert a new section between the end of **Modération** and `## Hébergement`:

```markdown
## Musiques

Écran « Musiques » : le catalogue complet de la bibliothèque et l'import en
lot. L'import remplace `track-prep sync --apply` (écriture directe dans la base
et le blob de staging depuis le poste admin) ; track-prep reste l'outil local
de téléchargement et de préparation.

- **Routes**, toutes réservées au rôle `ADMIN` :
  - `GET /admin/tracks` (filtres `q`, `status`, `blacklisted`, `titleMasked`,
    `style`, `ambiance`) et `GET /admin/tracks/:id` : sans le filtre
    « bibliothèque » de l'app ;
  - `POST /admin/tracks/check` (doublons, 200 éléments au plus) et
    `POST /admin/tracks` (import, un fichier par requête, multipart) ;
  - modification et suppression : `PATCH /tracks/:id` et `DELETE /tracks/:id`,
    les mêmes routes que l'app mobile, avec le même effet et le même journal.
- **Liste** : recherche (titre ou artiste, 2 caractères au moins), statut
  (« Prêtes », « En attente », « En erreur »), « Blacklistées »,
  « Titre masqué », « Ambiance », danse. Les filtres sont dans l'URL.
- **Fiche** :
  - lecteur et pochette (`<API>/uploads/<fichier>`, comme l'app) ;
  - titre, artiste, danse, MPM. Changer la danse affiche le MPM recalculé
    depuis le tempo brut, avec la règle du serveur ; un MPM saisi à la main
    l'emporte ;
  - clashs paso (même éditeur que la modération) ;
  - « Masquer le titre » et « Blacklister », chacun avec une confirmation :
    une musique blacklistée disparaît de la bibliothèque de l'app ;
  - lien vers ses propositions de correction dans « Modération » et
    historique admin.
- **Suppression** (« Zone dangereuse ») : définitive, confirmée en recopiant
  le titre. **Refusée (409) tant que des propositions de correction sont en
  attente** sur la musique : les traiter dans « Modération », ou blacklister
  la musique à la place. La ligne et sa trace d'audit sont écrites ensemble ;
  le fichier audio et la pochette sont ensuite supprimés au mieux. Un échec
  laisse une ligne `Track file deletion failed for "<fichier>" — manual
cleanup required` dans les logs : supprimer ce blob du conteneur `tracks`
  à la main.
- **Statut « En erreur »** : tempo non détecté à l'import et aucun MPM fourni.
  La musique est hors bibliothèque ; saisir son MPM sur la fiche et
  enregistrer la publie (statut « Prête »).
- **Import** (« Importer des musiques », `/tracks/import`) :
  1. déposer le dossier de sortie de track-prep (ou des MP3 avec leurs
     pochettes JPEG / PNG et `manifest.json`), ou utiliser « Choisir un
     dossier » / « Choisir des fichiers » ;
  2. pré-remplissage **dans le navigateur, rien n'est envoyé** : le
     `manifest.json` s'il liste le fichier (titre, artiste, danse, BPM brut,
     MPM, source, pochette) ; sinon les tags ID3 (titre, artiste, genre =
     danse, pochette intégrée) complétés par le nom de fichier track-prep
     `NN-DANSE ｜ Artiste - Titre (52 MPM).mp3` ; sinon le nom du fichier
     devient le titre. L'empreinte SHA-256 de chaque MP3 est calculée dans le
     navigateur ;
  3. vérification des doublons auprès du serveur (même source ou même
     fichier), plus les doublons à l'intérieur du lot ;
  4. tableau de revue, modifiable : ✅ prête ; ⚠️ titre, artiste ou danse
     manquant (« Ambiance » fait partie des danses) : la ligne n'est pas
     envoyée tant que ce n'est pas corrigé ; ⛔ doublon, ou fichier de plus de
     20 Mo ; case « Ignorer » ;
  5. « Importer » : un fichier par requête, 2 en parallèle au plus, état par
     ligne ; bilan « N importées, D doublons, E échecs » avec la raison de
     chaque échec, puis « Réessayer les échecs ».
- **Contrôles du serveur** à l'import :
  - MP3 reconnu par son **contenu** (jamais par l'extension ni le type
    annoncé), 20 Mo au plus ; pochette JPEG ou PNG, 2 Mo au plus ;
  - empreinte SHA-256 recalculée : une différence est refusée (400) ;
  - doublon (même `sourceKey` ou même empreinte, colonne `Track.contentHash`)
    : refus 409 avec la musique existante ;
  - noms de stockage générés par le serveur (`<uuid>.mp3`,
    `<uuid>.jpg|png`) dans le conteneur `tracks`, jamais le nom envoyé ; si la
    ligne ne peut pas être créée, les fichiers déposés sont supprimés ;
  - tempo : BPM brut du manifest, sinon analyse ffmpeg sur le serveur ; MPM :
    celui fourni, sinon calculé selon la danse, sinon le BPM brut arrondi ;
  - `jobId = admin-import`, `submittedById` = l'admin.
- **Limite de taille** : propre à la route d'import (multer, 20 Mo par
  fichier, 2 fichiers) ; aucune autre limite de corps de requête n'a changé.
- **Disponibilité du stockage** : l'envoi vers le blob passe par le
  disjoncteur `azure-blob-write` (30 s par fichier). Si le stockage est
  indisponible, les lignes concernées passent en échec (503) : réessayer plus
  tard avec « Réessayer les échecs ».
- **Pochettes : CSP et CORS.** La CSP du back-office autorise `img-src` sur les
  deux API ; l'image est chargée en mode CORS (`crossorigin="anonymous"`),
  pour la même raison que l'audio (voir « Modération »).
- **Lecture des tags** : lecteur ID3 interne (`apps/admin/src/lib/id3.ts`,
  ID3v2.3 et v2.4 : titre, artiste, genre, pochette), sans dépendance. Un tag
  illisible n'empêche rien : le nom de fichier prend le relais.
- **Droits** : l'admin qui importe est responsable des droits sur les fichiers
  envoyés ; le serveur ne télécharge jamais rien depuis une plateforme.
```

3. In **Journal d'audit**, replace

```markdown
- `action` : `USER_UPDATE`, `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`,
  `USER_DELETE`, `INVITATION_RESEND`, `CLUB_CREATE`, `CLUB_UPDATE`,
  `CLUB_DISABLE`, `CLUB_ENABLE`, `CLUB_DELETE`, `TRACK_CORRECTION_APPROVE`,
  `TRACK_CORRECTION_REJECT` (`CLUB_ACCOUNT_CREATE` reste lisible pour les
  lignes du lot 1) ;
- `targetType` / `targetId` : l'objet modifié (`USER`, `CLUB`, ou
  `TRACK_CORRECTION` avec l'identifiant de la proposition) ;
```

with

```markdown
- `action` : `USER_UPDATE`, `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`,
  `USER_DELETE`, `INVITATION_RESEND`, `CLUB_CREATE`, `CLUB_UPDATE`,
  `CLUB_DISABLE`, `CLUB_ENABLE`, `CLUB_DELETE`, `TRACK_CORRECTION_APPROVE`,
  `TRACK_CORRECTION_REJECT`, `TRACK_CREATE`, `TRACK_UPDATE`, `TRACK_DELETE`
  (`CLUB_ACCOUNT_CREATE` reste lisible pour les lignes du lot 1) ;
- `targetType` / `targetId` : l'objet modifié (`USER`, `CLUB`,
  `TRACK_CORRECTION` avec l'identifiant de la proposition, ou `TRACK` avec
  l'identifiant de la musique) ;
- musiques, **modifiées sur le web ou sur mobile** : `TRACK_CREATE` (import :
  titre, artiste, danse, MPM, source, statut), `TRACK_UPDATE` (champs
  réellement modifiés parmi titre, artiste, danse, MPM, titre masqué,
  blacklist, clashs et statut, relus dans la transaction : un MPM recalculé
  par un changement de danse y figure ; aucune ligne si rien ne change),
  `TRACK_DELETE` (titre, artiste, source, fichier). Une validation de
  proposition n'écrit que sa ligne `TRACK_CORRECTION_APPROVE`, pas de
  `TRACK_UPDATE` en double. Métadonnées de la musique uniquement, jamais de
  texte libre ;
```

and in the bullet `- Consultation : écran « Journal d'audit » du back-office (filtres par admin et par cible) et historique sur la fiche de chaque utilisateur.` (as it reads after lot 2), replace `et historique sur la fiche de chaque utilisateur` with `et historique sur la fiche de chaque utilisateur, club et musique`.

4. In **Coût**, insert after the **Modération** bullet (before `- **Logs :**`):

```markdown
- **Musiques :** aucun coût nouveau (ni service, ni job, ni polling). Le
  stockage reste le conteneur blob `tracks` existant (quelques Mo par
  musique). Les requêtes n'ont lieu que pendant un import ou une édition ; un
  import réveille `backend-staging` comme toute session admin, et l'analyse du
  tempo (ffmpeg) ne tourne que pour les fichiers sans BPM brut.
```

Run: `pnpm exec prettier --check docs/exploitation/backoffice-admin.md` — expected: PASS (run `--write` if not, then re-check).

```bash
git add docs/exploitation/backoffice-admin.md
git commit -m "docs(admin): track catalogue and import runbook for the back-office

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MKDz7abPk4VsUPmwi8Dkkv"
```

- [ ] **Step 4: Full verification**

```bash
pnpm --filter client exec jest src/features/player src/features/track-corrections
cd apps/backend && pnpm exec jest --config "${TMPDIR:-/tmp}/jest-e2e-nodb.json" --runInBand --forceExit admin.e2e-spec tracks.e2e-spec tracks-additional.e2e-spec && cd ../..
bash -c 'cd apps/backend && source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh && pnpm exec jest --config test/jest-integration.json --runInBand --forceExit tracks.integration-spec track-corrections.integration-spec admin.integration-spec'
pnpm preflight
```

Expected: all green — mobile player and moderation tests unchanged (library untouched), mocked e2e, real-DB integration, then `pnpm preflight` (typecheck + lint + format + tests + audit). If `jest-e2e-nodb.json` is missing in `$TMPDIR`, recreate it with the command of "How to run tests".

---

## Final verification (after Task 8)

- [ ] `pnpm preflight` green; mocked e2e and real-DB integration green (Task 8 Step 4).
- [ ] `test-verifier`, then `code-reviewer` + `security-reviewer` in parallel on the branch diff (upload trust boundary, multer limit, ADMIN-only routes, audit content with no free text, CSP change, cross-origin artwork, blob cleanup are in scope).
- [ ] Manual smoke on a local stack (`docker compose --profile infra up -d`; `CORS_ORIGINS=http://localhost:5173 pnpm --filter backend start:dev`; `VITE_API_URL=http://localhost:3000/api/v1 pnpm --filter admin dev`), without Azure storage (files land in `apps/backend/uploads/`): open « Musiques », filter on « Ambiance » and on a status; open a track, play it, see its artwork, change its dance and check the MPM preview against the saved value; blacklist it and check it disappears from the mobile library; import a copy of `/Users/gabin/Development/track-prep/prepared-tracks` (40 tracks, manifest present): the table must be pre-filled; give a dance to any ⚠️ row (manifest entries whose style is null), then the import must end with « 40 importées, 0 doublons, 0 échecs », and a second import of the same folder must show 40 ⛔ « Doublon » rows and leave « Importer » disabled; import one plain MP3 without tags and fix its dance; read the rows in « Journal d'audit ». Delete the test tracks from the catalogue afterwards.
- [ ] Ask the user before pushing `feature/admin-lot3-tracks` and opening the PR to `develop`. Order: the backend (migration + routes) must be deployed before the SPA uses the new routes; the migration is additive, so a backend rollback stays safe.

---

## Self-review

**Spec coverage**

| Spec                                                                                         | Task        |
| -------------------------------------------------------------------------------------------- | ----------- |
| §1 every track visible, edit, mask, blacklist, delete, bulk add; audit of every write        | 2-8         |
| §2 upload from the browser, no URL import, manifest or ID3 + file name, one request per file | 4, 7        |
| §2 audit target `TRACK` written in `TracksService` inside the transaction (mobile too)       | 2           |
| §3 existing behaviour kept (`PATCH` rules, `bpmForPatch`, `GET /tracks` library filter)      | 2, 3        |
| §4.1 drop zone (folder or files), pre-fill in the browser, SHA-256 by Web Crypto             | 7           |
| §4.1 review table (editable title, artist, dance, MPM; ✅ / ⚠️ / ⛔; skip)                   | 7           |
| §4.1 duplicate check before import, batch duplicates                                         | 4, 7        |
| §4.1 « Importer », 2 in parallel, progress per row, summary, retry                           | 7           |
| §4.2 `POST /admin/tracks/check` (≤ 200 items, per-item answer)                               | 4           |
| §4.2 `POST /admin/tracks` multipart: parts, fields, bounds                                   | 4           |
| §4.2 magic bytes, sizes, server hash (400), dedup 409 with `trackId`                         | 2, 4        |
| §4.2 server-generated names, upload before the row, cleanup on failure                       | 1, 4        |
| §4.2 tempo (BpmService, MPM from the dance, ERROR), `contentHash`, `jobId`, `submittedById`  | 1, 4        |
| §4.2 `TRACK_CREATE`, body limit raised for this route only, no yt-dlp                        | 4           |
| §5.1 list `/tracks` filters in the URL, table columns, title link, import button             | 6           |
| §5.1 detail: player, artwork, edit, MPM preview, clash editor, switches with confirmation    | 6           |
| §5.1 save with before → after confirmation through `PATCH /tracks/:id`                       | 6           |
| §5.1 « Zone dangereuse », typed title, 409 → blacklist suggestion                            | 2, 6        |
| §5.1 links to the track's proposals and audit history; shared error; no polling              | 3, 6        |
| §5.2 `GET /admin/tracks` (no library filter, filters, `take` ≤ 100, DTO) and `/:id` 404      | 3           |
| §5.2 `DELETE /tracks/:id` 409 with PENDING corrections, then both files best-effort          | 2           |
| §6 `TRACK_CREATE` / `TRACK_UPDATE` / `TRACK_DELETE` contents, no double row on approval      | 2, 4        |
| §6 `GET /admin/audit-log?targetType=TRACK`, link to `/tracks/:id`                            | 2, 5        |
| §7 backend unit, real-DB integration, mocked e2e (403, oversized, wrong type), SPA tests     | 1-8         |
| §7 mobile tests green, thresholds unchanged                                                  | 5, 8        |
| §8 ADMIN-only, content validation, generated names, metadata-only audit                      | 2, 3, 4     |
| §9 cost: none                                                                                | 8 (runbook) |
| Canonical dance list, shared with the SPA                                                    | 3, 5, 6     |
| Swagger regeneration + both clients                                                          | 5           |
| Runbook                                                                                      | 8           |

**Decisions taken where the spec was silent or ambiguous:**

- **"Fixable in the catalogue" for an `ERROR` track.** `PATCH /tracks/:id` has no `status`; without a rule an `ERROR` track could never reach the library. An admin `PATCH` that sets an MPM > 0 on an `ERROR` track moves it to `READY` (audited as a `status` change; the confirmation shows it).
- **Analysis failure with an MPM given.** The spec's `ERROR` targets a track without a usable tempo. When `rawBpm` is missing and the analysis fails but the admin sent an `mpm`, the track is created `READY` with `bpm = mpm`, `rawBpm = 0`; `ERROR` only when no tempo is known at all.
- **409 body of a duplicate.** The key is `existingTrackId` (mirrors `existingClubId`) and is whitelisted in the global filter, as is `pendingCorrections` for the delete refusal.
- **Dance labels.** The backend had no exported list: `TRACK_DANCE_LABELS` (same labels and order as the mobile editor's `DANCE_GROUPS` and track-prep's `STYLE_LABELS`) is created, validated by `@IsIn` on the import only (`PATCH` keeps its free-text `style` for the mobile app), exposed as an OpenAPI enum, and pinned in the SPA by a `Record` over the generated union.
- **⚠️ rows.** A row with a missing title, artist or dance is not sent (the API requires the artist; a track without a dance would get a raw-BPM MPM in the library); the admin fixes it in the table or skips it.
- **TBPM.** Ignored: track-prep's MPM is in the file name, and a third-party MP3's TBPM is a BPM. A file-name MPM is dropped when the admin changes the dance of a row without raw tempo (the server then analyses and converts).
- **"Progress per row".** A per-row state (« Envoi… », « ✅ Importée », « ⛔ Échec ») plus an overall counter and bar; `fetch` gives no upload progress and the files are at most 20 MB.
- **Links to the proposals.** `GET /track-corrections` gains an additive `trackId` filter and the moderation URL a `track` parameter, so the link opens exactly that track's proposals.
- **Delete confirmation.** The typed title is checked in the SPA only (case and spaces ignored): `DELETE /tracks/:id` stays body-less for the mobile app.
- **Blob uploads.** A dedicated `azure-blob-write` breaker (45 s) with a 30 s `withTimeout`, so a 20 MB upload does not share the 10 s budget of the `/uploads` reads; local-disk fallback (`<cwd>/uploads`) when blob storage is not configured, matching `ServeStaticModule` (the former delete path used `__dirname/../../uploads`).
- **Drops.** Folders are walked with `webkitGetAsEntry` (sub-folders included); the picker offers « Choisir un dossier » (`webkitdirectory`) and « Choisir des fichiers ». Hidden files are ignored silently, other files are listed as ignored. A new drop replaces the table.
- **Manifest matching.** File names are compared in NFC (macOS may hand decomposed names); MP3 rows are sorted by name.
- **Race window of the delete refusal.** The count and the delete share a transaction in READ COMMITTED: a correction created in between would be cascaded with the track. Accepted (two admin actions within milliseconds); a serialisable transaction would add retries for no practical gain.

**Placeholder scan:** no TBD/TODO; every code step carries the code; every run step names the command and the expected result.

**Type consistency:** `TrackFilesService.save` / `remove` (Task 1) are the ones mocked in Tasks 2 and 4 and overridden in the integration spec. `trackAuditSelect` / `trackUpdateTargetSelect` / `trackDeletionSelect` (Task 2), `adminTrackSelect` (Task 3) and `trackDuplicateSelect` (Task 4) are defined before use and asserted by name in the specs. `TracksService(prisma, bpmService, files, audit)` (Task 2) matches the constructions in `track-corrections.service.spec.ts` (Task 2) and `track-import.service.spec.ts` (Task 4). `updateTrack(…, tx, { skipAudit: true })` (Task 2) matches the three corrections assertions. `TRACK_STYLE_OPTIONS` (Task 3) feeds `ImportTrackDto.style` and the OpenAPI enum (Task 4), hence `AdminTracksControllerCreateData['body']['style']` (Task 5), hence `StyleOption` / `STYLE_OPTIONS` (Task 6) used by `canonicalStyle`, `withStyle` and the import table (Task 7). `AdminTrackDto` (Task 3) is the generated type of `tracksQuery` / `trackQuery` and of `lib/tracks.ts` (Task 6). `ModerationUrlState.trackId` (Task 6) maps to `ListTrackCorrectionsQueryDto.trackId` (Task 3). `calculateMpm` / `normalizeDance` / `DanceKey` (Task 6) are consumed by `lib/trackImport.ts` (Task 7). `readBytes` (Task 7 Step 2) is used by `readId3` (Step 4); `sha256Hex` / `readId3` are the `RowSources` of the page (Step 8). The fixture `mpm-cases.json` (Task 4) is imported by `mpm.test.ts` (Task 6).

**Review Focus check:** each item has its pinning test in the task that owns the code — audit exactly once (Task 2 unit, real-`TracksService` corrections test, real-DB tests), query-string booleans and the Ambiance NULL trap (Task 3 DTO, mocked e2e, real-DB), upload trust boundary (Task 4 service unit + mocked e2e, Task 2 filter test), MPM parity (Task 4 `mpm-parity.spec.ts`, Task 6 `mpm.test.ts` + detail preview test, Task 7 `withStyle` tests), cross-origin artwork (Task 6 CSP test + detail `<img>` test).
