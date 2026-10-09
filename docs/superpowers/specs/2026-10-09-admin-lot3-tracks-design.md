# Admin back-office — lot 3: tracks catalogue and bulk import — design

- **Date:** 2026-10-09
- **Status:** draft, pending review
- **Builds on:** lot 1 (`2026-10-07-admin-backoffice-design.md`), lot 2 (`2026-10-09-admin-lot2-moderation-design.md`)
- **Next:** lot 4 (database stats)

## 1. Goal

Manage the track library from the web back-office: see every track (including blacklisted, pending, failed and ambiance ones), edit, mask, blacklist and delete them, and add tracks in bulk from the output of the local track-prep tool or from plain MP3 files.

Success: the admin drops a track-prep output folder, checks the pre-filled table, imports; tracks appear in the app library; any later edit, mask, blacklist or delete is in the audit log.

## 2. Decisions (taken with the user)

| Topic         | Decision                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding tracks | Upload of audio files from the browser. No server-side download from a URL.                                                                                                                                                                                           |
| URL import    | Rejected after a feasibility test (2026-10-09): from the staging Container App, YouTube answers "Sign in to confirm you're not a bot" for every video, even a simple one. Cookies (fragile, account ban, terms) and a residential proxy (cost, budget) were rejected. |
| Bulk source   | Both: a track-prep `manifest.json` when present, otherwise ID3 tags and the file name.                                                                                                                                                                                |
| Transport     | One multipart request per file to the backend (option A). Direct-to-blob SAS upload rejected (CORS on storage, signatures, re-download for tempo analysis — no gain at this volume).                                                                                  |
| track-prep    | Stays local for download/preparation. The back-office import replaces `track-prep sync --apply` (direct staging DB/blob writes from the admin PC). Removing `sync` from track-prep is outside this repo.                                                              |
| Catalogue     | Admin list without the library filter, edit, clash editor, mask/blacklist, delete, audit.                                                                                                                                                                             |
| Audit         | New target `TRACK`, written in `TracksService` inside the write transaction, so mobile edits are audited too.                                                                                                                                                         |

## 3. Existing behaviour kept

- `Track`: `title`, `artist`, `filename`, `artwork?`, `style?` (free text; "Ambiance" is a convention on style/artist), `bpm` (MPM), `rawBpm`, `clashTimecodes Float[]`, `titleMasked`, `blacklisted`, `status` (PENDING, READY, ERROR), `jobId?`, `sourceKey?` (unique), `submittedById?`, `createdAt`.
- `PATCH /tracks/:id` (ADMIN, `UpdateTrackDto`): title, artist, style, bpm (0–400), titleMasked, blacklisted, clashTimecodes (max 3). A style change recomputes the MPM from `rawBpm` (`bpmForPatch`).
- `DELETE /tracks/:id` (ADMIN): deletes the row, then the blob best-effort.
- `GET /tracks` keeps `LIBRARY_TRACK_WHERE` (READY, not blacklisted, not Ambiance) for the app library.
- Audio is served at `/uploads/<filename>` (public), from the `tracks` blob container with a local-disk fallback.
- `BpmService` already detects the raw tempo with ffmpeg (present in the image).

## 4. Bulk import

### 4.1 Back-office page `/tracks/import`

1. **Drop zone**: drag-and-drop or picker (folder or multiple files). Accepted: `.mp3`, artwork `.jpg` / `.jpeg` / `.png`, and one `manifest.json`.
2. **Pre-fill, in the browser, nothing sent yet**:
   - manifest present (`{ version: 1, tracks: [ManifestTrack] }`) and listing the MP3 by `filename`: title, artist, style, `rawBpm`, `mpm`, `sourceKey`, artwork file name;
   - otherwise ID3 tags (title, artist, embedded picture), completed by the track-prep file name pattern `NN-DANSE ｜ Artiste - Titre (52 MPM).mp3`; if nothing matches, the file name without extension becomes the title.
   - The browser computes each MP3's SHA-256 (Web Crypto).
3. **Review table**, one row per MP3: editable title, artist, dance (list of the backend's canonical dance labels plus « Ambiance »), MPM; status per row — ✅ ready, ⚠️ missing dance or artist, ⛔ duplicate; a checkbox to skip a row.
4. **Duplicate check** before import: `POST /admin/tracks/check` with every `{ sourceKey?, sha256 }`; duplicates within the batch are flagged too.
5. **« Importer »**: files sent one by one, at most 2 in parallel; progress per row; final summary « N importées, D doublons, E échecs » with the reason per failure and « Réessayer les échecs ».

### 4.2 API

- `POST /admin/tracks/check` (ADMIN): body `{ items: { sourceKey?: string, sha256: string }[] }`, at most 200 items; answers per item `{ exists: boolean, trackId?: string }`.
- `POST /admin/tracks` (ADMIN), multipart:
  - parts: `audio` (required), `artwork` (optional), and fields `title` (1–200), `artist` (1–200), `style` (optional, canonical label or « Ambiance »), `mpm` (optional, 1–400), `rawBpm` (optional, 1–400), `sourceKey` (optional, ≤ 100), `sha256` (required, 64 hex).
  - validation: audio MP3 by magic bytes (`ID3` or an MPEG frame sync), ≤ 20 MB; artwork JPEG/PNG by magic bytes, ≤ 2 MB; the server recomputes the SHA-256 and refuses a mismatch (400).
  - duplicates: same `sourceKey` or same content hash → 409 with the existing `trackId`.
  - storage: server-generated names (never the client file name) — `<uuid>.mp3`, `<uuid>.<jpg|png>` — uploaded to the `tracks` container before the row is created; if the row creation fails, the uploaded blobs are deleted.
  - tempo: if `rawBpm` is missing, `BpmService` analyses the file; MPM from the dance when known, else the raw tempo. If the analysis fails, the track is created with status `ERROR` (fixable in the catalogue); otherwise `READY`.
  - the content hash is stored to detect duplicates (additive column `Track.contentHash String? @unique`, migration additive only).
  - `jobId = "admin-import"`, `submittedById` = the admin.
  - audit `TRACK_CREATE` (§ 6).
  - Body size limit raised only for this route.
- Nothing downloads from a URL; `yt-dlp` is not added.

## 5. Catalogue

### 5.1 Back-office

- **List `/tracks`**: filters in the URL — search (title/artist, 2–100 characters), status (Prêtes / En attente / En erreur), « Blacklistées », « Titre masqué », dance, « Ambiance »; paginated table: title (+ « Titre masqué » badge), artist, dance, MPM, status, added date; the title is a link; a « Importer des musiques » button.
- **Detail `/tracks/:id`**: audio player and artwork (lot 2 pattern), editable title, artist, dance, MPM — changing the dance previews the MPM recomputed from `rawBpm`, matching the server; clash editor (lot 2 component); « Masquer le titre » and « Blacklister » switches, each with a confirmation (blacklisting removes the track from the app library); save with a before → after confirmation through `PATCH /tracks/:id`; « Zone dangereuse » delete, confirmed by typing the title, refused (409) while pending correction proposals exist — the UI then suggests blacklisting; links to the track's proposals in Modération and its audit history.
- Errors: shared « Serveur injoignable » pattern; no polling, no refetch on focus.

### 5.2 API

- `GET /admin/tracks` (ADMIN): without `LIBRARY_TRACK_WHERE`; filters `q`, `status`, `blacklisted`, `titleMasked`, `style`, `ambiance`; `skip` / `take` (≤ 100); newest first; DTO with `id`, `title`, `artist`, `style`, `bpm`, `rawBpm`, `clashTimecodes`, `titleMasked`, `blacklisted`, `status`, `sourceKey`, `filename`, `artwork`, `createdAt`, `pendingCorrections`.
- `GET /admin/tracks/:id` (ADMIN): the same DTO, 404 if absent.
- `DELETE /tracks/:id` becomes: 409 when the track has PENDING corrections; otherwise row deleted, then audio and artwork blobs best-effort.

## 6. Audit

- Target type `TRACK` (string column, no migration for it); actions:
  - `TRACK_CREATE`: `after` = `{ title, artist, style, bpm, sourceKey, status }`;
  - `TRACK_UPDATE`: the fields actually applied, read back before and after the update inside the transaction (`diffFields`), including `titleMasked`, `blacklisted`, `clashTimecodes`;
  - `TRACK_DELETE`: `before` = `{ title, artist, sourceKey, filename }`.
- Written inside the same transaction as the write, in `TracksService`, so `PATCH` / `DELETE` from the mobile app are audited.
- An approval of a correction proposal already writes `TRACK_CORRECTION_APPROVE`: `updateTrack` gets an option to skip its own `TRACK_UPDATE` row in that path (no double row).
- No free text beyond track metadata.
- `GET /admin/audit-log` accepts `targetType=TRACK`; the audit log links `TRACK` rows to `/tracks/:id`.

## 7. Testing

- Backend unit: list filters and the absence of the library filter; check endpoint (limit, per-item answer); upload — magic bytes, size limits, hash mismatch, duplicate 409 (sourceKey and hash), server-generated names, blob cleanup when the row fails, ffmpeg failure → `ERROR`, MPM from the dance; delete refused with pending corrections; every audit action, none on failure, none doubled on approval.
- Real-DB integration (dedicated test DB): list filters, import then duplicate by hash and by `sourceKey`.
- Mocked e2e: 403 for non-admins on every new route; oversized and wrong-type uploads refused.
- Admin SPA: manifest parsing, ID3 and file-name parsing, review table (statuses, edits, skip), sequential send with failures and retry, catalogue filters in the URL, detail edit with the MPM preview, switches with confirmation, delete flow (typed title, 409 → blacklist suggestion).
- Mobile: existing tests stay green (library unchanged).
- Coverage thresholds unchanged.

## 8. Security and RGPD

- All new routes ADMIN-only; uploads validated by content, not by extension or client name; server-generated storage names (no path traversal).
- Audit rows hold track metadata only.
- Rights on uploaded audio remain the uploader's responsibility; the server never downloads from third-party platforms.

## 9. Cost

No new service. Storage in the existing blob container (a few MB per track). Requests only while an admin imports or edits; no polling.

## 10. Out of scope

Server-side URL import, removing `sync` from track-prep (private repo), soft delete, bulk edit/blacklist, waveform display, stats (lot 4).
