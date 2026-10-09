# Admin back-office — lot 2: moderation — design

- **Date:** 2026-10-09
- **Status:** draft, pending review
- **Builds on:** `2026-10-07-admin-backoffice-design.md` (lot 1), lots 1b and 1c (merged)
- **Next:** lot 3 (tracks catalogue)

## 1. Goal

Moderate track correction proposals from the web back-office, with audio, instead of the mobile review screen only.

Success: an admin opens « Modération (n) », filters by reason or searches a track, listens to the track, adjusts the proposed values (including placing paso clashes by ear), approves or rejects with a comment, and moves to the next pending proposal. The proposer is notified as today, and every decision — web or mobile — is in the audit log.

## 2. Decisions (taken with the user)

| Topic           | Decision                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Scope           | The moderation queue with audio and clash placement. The track catalogue (list, mask, blacklist, edit) stays in lot 3.      |
| Extras          | Menu badge with the pending count, filter by reason, search by track, reply templates.                                      |
| API approach    | Extend the existing `track-corrections` endpoints, shared with the mobile app. No duplicate `/admin/moderation` controller. |
| Audit           | Written in the service, so web and mobile decisions are both audited.                                                       |
| Reply templates | A constant list in the SPA, editable before sending. No table, no management screen.                                        |
| Badge refresh   | On page load and after each decision. No polling (scale-to-zero backend).                                                   |

## 3. Existing behaviour kept

- `GET /track-corrections?status&skip&take` (ADMIN): pending sorted oldest first, decided newest first; each item carries the proposed values, a snapshot of the current track, `resultingBpm`, proposer and reviewer.
- `POST /track-corrections/:id/approve` (ADMIN): optional overrides `title`, `artist`, `style`, `bpm`, `clashTimecodes`, plus `comment`; applies the values to the track in the same transaction; 409 if already decided.
- `POST /track-corrections/:id/reject` (ADMIN): `comment`; 409 if already decided.
- `GET /track-corrections/pending-count` (ADMIN).
- The proposer gets `TRACK_CORRECTION_DECISION` (best effort). Value rules unchanged: at most 3 clash timecodes, each 0–3600 s; MPM 1–400.
- `Track.clashTimecodes` are the paso doble call moments, in seconds; an empty list is a valid proposal ("no clash").

## 4. API changes

- `GET /track-corrections` gains two optional query params:
  - `reason`: one or more `TrackCorrectionReason` values (repeatable or comma-separated), validated against the enum.
  - `q`: trimmed, 2–100 characters, case-insensitive `contains` on the track's `title` OR `artist`.
  - Without them, the response is identical to today. `take` stays bounded (max 100).
- New `GET /track-corrections/:id` (ADMIN): the same admin DTO as a list item, 404 if absent.
- Audit, in `approve` and `reject`, inside the existing transaction:
  - actions `TRACK_CORRECTION_APPROVE` and `TRACK_CORRECTION_REJECT`, target type `TRACK_CORRECTION`, target id = the correction id;
  - `before` / `after`: the track fields actually changed by an approval (title, artist, style, bpm, clashTimecodes), plus `trackId`; for a rejection, `after: { trackId }`;
  - never the proposer's message nor the review comment (free text that may contain personal data);
  - no audit row when the decision fails (409, 404).
  - `targetType` is a string column: no migration.
- `GET /admin/audit-log` accepts `targetType=TRACK_CORRECTION` (add it to the allowed list).
- Admin SPA CSP (`apps/admin/public/staticwebapp.config.json`): add `media-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr` so `<audio>` can play `${API}/uploads/<filename>`.

## 5. Back-office UI

- **Menu:** « Modération » with a badge (pending count), refreshed on navigation and after a decision.
- **List `/moderation`:**
  - filters: status (« À traiter » default, « Approuvées », « Refusées »), reason (multi: Titre, Artiste, Danse, MPM, Clashes paso, Autre), search (debounced); all kept in the URL;
  - paginated table: track (title respecting `titleMasked` for display), reason, proposer, date, short summary of the proposed changes; a row opens the detail.
  - Error state: alert only, shared « Serveur injoignable » message (lot 1b pattern).
- **Detail `/moderation/:id`:**
  - audio player (`<audio controls>`) on the track URL, with seek;
  - current vs proposed comparison per field, plus the proposer's message;
  - pending: editable proposed fields (overrides), clash editor, comment with templates, « Approuver » / « Refuser » with a before → after confirmation;
  - clash editor: up to 3 chips in `m:ss`; « Marquer ici » adds the player's current time (rounded to 0.1 s); a chip can be edited, removed, or played (seek 3 s before it); a 4th is refused; an empty list is allowed and sent as "no clash";
  - templates — reject: « Déjà corrigé », « Valeur incorrecte », « Doublon d'une autre proposition »; approve: « Merci, c'est corrigé » — inserted in the comment, still editable;
  - 409: message « Déjà traitée » and reload of the proposal;
  - decided: read-only with reviewer, date, comment;
  - after a decision: « Proposition suivante » opens the oldest pending proposal matching the current filters (one `GET` with `take=1`), or returns to the list when there is none.

## 6. Testing

- Backend unit: `reason` / `q` filters (and no-filter output unchanged), `GET :id` 200/404, audit row per decision with the exact before/after, none on 409, no message or comment in the row, `TRACK_CORRECTION` accepted by the audit-log filter.
- Real-DB integration (dedicated test DB): `q` case-insensitive on title and artist combined with `reason`.
- Mocked e2e: non-admin gets 403 on `GET :id` and on the filtered list.
- Admin SPA: list filters and URL state, badge, detail (approve with overrides, reject with a template, « Marquer ici » from the player time, 4th clash refused, empty clash list, 409, read-only), « Proposition suivante ».
- Mobile: existing review tests stay green.
- Coverage thresholds unchanged.

## 7. Security and RGPD

- All new and changed endpoints stay ADMIN-only.
- Audit rows hold track metadata only, never free text.
- Audio is served by the existing public `/uploads` route; the CSP change only lets the SPA load it.

## 8. Cost

None: no infra, no job, no polling. The badge reuses the existing count endpoint on navigation.

## 9. Out of scope

Track catalogue and direct track edits (lot 3), bulk decisions, reopening a decided proposal, waveform display, server-stored reply templates, stats (lot 4).
