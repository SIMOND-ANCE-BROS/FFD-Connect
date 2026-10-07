# Admin back-office — design

- **Date:** 2026-10-07
- **Status:** draft, pending review
- **Scope of this spec:** overall vision (6 lots) + detailed design of **lot 1 (foundation)**. Lots 2-6 each get their own spec when they start.

## 1. Goal

Give FFD platform administrators a web back-office to:

- see who signed up and correct user data by hand (club, category, age group, levels…);
- create "Club" accounts;
- moderate track correction requests and suggestions, including paso doble clash timecodes;
- add tracks through the existing track-prep tooling and edit the catalogue;
- follow usage statistics of the mobile app (iOS + Android), both database figures and real usage (sessions, screens, plays);
- perform the other admin actions (impersonation, roles…).

Success for lot 1: an admin can log in on `admin.ffd.gabin-simond.fr`, find any user, fix their profile fields, create a Club account whose manager receives an invitation, and every write is traceable in an audit log.

## 2. Decisions taken during brainstorming

| Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users of the back-office | `ADMIN` role only, full rights. A restricted `STAFF` access may come later.                                                                                                                                                                                                                                                                                            |
| Stack                    | New `apps/admin`: Vite + React 19 + TypeScript strict, Mantine, TanStack Query, React Router, generated OpenAPI client.                                                                                                                                                                                                                                                |
| Rejected                 | Refine / react-admin (CRUD framework fights the custom screens of lots 3 and 5); AdminJS on Prisma (bypasses business services, adds admin UI to the prod image).                                                                                                                                                                                                      |
| Hosting                  | Azure Static Web Apps, Free tier, `admin.ffd.gabin-simond.fr`. GitHub Pages is already used by the landing (one site per repo).                                                                                                                                                                                                                                        |
| Writes                   | Always through the NestJS API, never direct DB access.                                                                                                                                                                                                                                                                                                                 |
| Usage analytics (lot 5)  | No third-party or self-hosted analytics server (Umami/Plausible/PostHog would add ~10-40 EUR/month of always-on infra). First-party anonymous events sent in batches to our backend; no user id, random per-launch session id, aggregated and purged after a few months → CNIL audience-measurement exemption, no consent banner; one paragraph in the privacy policy. |

## 3. Delivery lots

Each lot = its own spec (if needed), plan and PR(s), in this order:

1. **Foundation** — admin web app, admin login, user list, user edit, Club account creation, audit log. _(this spec)_
2. **Moderation** — track correction requests & suggestions, clash timecodes (reuses the existing `track-corrections` admin endpoints).
3. **Tracks** — add tracks via track-prep, edit the catalogue.
4. **Database stats** — sign-ups, licenses, clubs, corrections over time.
5. **Usage analytics** — anonymous first-party events + dashboards.
6. **Other admin actions** — impersonation, account deletion, password reset, email change, license management…

## 4. Lot 1 — architecture

### 4.1 Components

- **`apps/admin`** (new workspace app)
  - Vite + React 19 + TS strict, Mantine (tables, forms), TanStack Query (server cache), React Router.
  - API calls through a client generated from `swagger.json`, wired into `pnpm api:sync` like the mobile client.
  - No third-party scripts, no analytics on the back-office itself.
- **Backend module `src/admin/`**
  - Controllers under the `/admin` prefix, with `@Roles(UserRole.ADMIN)` + `RolesGuard` **at class level**, so a new route cannot be left unprotected by mistake.
  - Split per repo convention: `AdminUsersQueryService` (reads), `AdminUsersService` (writes), `AdminClubAccountsService`, `AdminAuditService`.
  - Reuses existing services where they own the logic (email sending, password-reset tokens).
  - Prisma: `select` constants from `src/utils/prisma-selects.ts`, `take` on every list.
- **Hosting & CI**
  - `deploy-admin.yml`: builds `apps/admin` and deploys to Azure SWA; triggered only on `apps/admin/**` changes (+ manual).
  - `admin.ffd.gabin-simond.fr` added to `CORS_ORIGINS` (staging + prod).
  - SWA config (`staticwebapp.config.json`): SPA fallback, strict CSP (`default-src 'self'; script-src 'self'; connect-src 'self' <api origins>`), `X-Frame-Options: DENY`, `noindex`.
  - SWA resource declared in Terraform (by `infra-azure`).
  - DNS: `admin.ffd.gabin-simond.fr` CNAME to the SWA hostname, added by hand in Cloudflare (DNS-only, like the other records — see `infra/terraform/dns.tf`); custom domain + certificate bound on the SWA side.
  - CI: `apps/admin` joins `typecheck` and `lint-format`, and gets a unit-test step (existing job or a new small one — decided in the plan, with its cost stated).

### 4.2 Authentication

- Reuses `POST /auth/login` and `POST /auth/refresh` unchanged (60 min access token, rotating 30-day refresh token).
- Tokens kept in memory + `sessionStorage` (lost when the tab closes — intended for an admin tool). httpOnly cookies rejected: they would require auth changes and cross-site cookie handling for a handful of users.
- If the login response role is not `ADMIN`, the app shows "access reserved to administrators" and discards the tokens. This is UX only; the backend guard is the real barrier.
- 401 after a failed refresh → back to login. 403 → "access denied" page.
- Cold start: the backend scales to zero, so the first request can take 60-120 s. The login screen shows a "waking up the server…" state until `/health` responds.

### 4.3 Audit log

New additive migration:

```prisma
model AdminAuditLog {
  id         String   @id @default(uuid())
  actorId    String?  // admin user; SetNull if the admin account is deleted
  action     String   // e.g. USER_UPDATE, CLUB_ACCOUNT_CREATE, INVITATION_RESEND
  targetType String   // e.g. USER, CLUB
  targetId   String
  before     Json?
  after      Json?
  createdAt  DateTime @default(now())

  actor User? @relation("AdminAuditActor", fields: [actorId], references: [id], onDelete: SetNull)

  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
  @@index([createdAt])
}
```

- Every admin write inserts one row **in the same transaction** as the write.
- `before` / `after` contain only the changed fields; never passwords or tokens.
- Also additive: `User.lastLoginAt DateTime?`, set by `AuthService` on successful login. It drives "Resend invitation" (shown while null) and feeds the lot 4 stats.
- Retention: rows targeting a user are purged when that account is deleted (RGPD); `actorId` is set null when the admin account is deleted.

## 5. Lot 1 — screens

1. **Login** — email + password, wake-up state, non-admin message.
2. **Users** — server-side paginated table (50/page).
   - Search by name or email; filters: role, club, category, sign-up date range; default sort: newest first.
   - Columns: name, email, role, club, category, age group, license status, sign-up date.
   - "New Club account" button.
3. **User detail / edit**
   - Editable: first name, last name, club (select), category (Latin / Standard / Ten Dance), age group, passport level Latin, passport level Standard, competition level, national ranking, role.
   - Read-only: email, license, WDSF info, dates, and this user's admin history (from the audit log).
   - Saving shows a "before → after" summary to confirm.
   - "Resend invitation" button while `lastLoginAt` is null.
4. **New Club account** — email, manager first/last name, club: pick an existing one or type a new name. If the typed name already exists, the form says so and offers to select it.
5. **Audit log** — global list, filters by admin and by target, paginated.

## 6. Lot 1 — API

All under `/admin`, `ADMIN` only, documented in Swagger (Swagger UI stays hidden in production).

| Method & path                             | Purpose                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/users`                        | Paginated list. Query: `page`, `pageSize` (≤ 100), `search`, `role`, `clubId`, `category`, `createdFrom`, `createdTo`. |
| `GET /admin/users/:id`                    | Detail incl. license summary and `lastLoginAt`.                                                                        |
| `PATCH /admin/users/:id`                  | Update editable fields.                                                                                                |
| `POST /admin/club-accounts`               | Create Club (if new) + `CLUB` user + invitation.                                                                       |
| `POST /admin/users/:id/resend-invitation` | Re-send the invitation email.                                                                                          |
| `GET /admin/clubs`                        | `id` + `name` of clubs, for selects (`take` bound).                                                                    |
| `GET /admin/audit-log`                    | Paginated, filters `actorId`, `targetType`, `targetId`.                                                                |
| `GET /admin/reference-data`               | Age groups, competition levels, categories, passport levels — the front never duplicates the constants.                |

### 6.1 `PATCH /admin/users/:id` rules

- DTO with `whitelist` + `forbidNonWhitelisted`; `@IsIn` against the existing constants (`COUPLE_AGE_GROUPS`, `SOLO_AGE_GROUPS`, `COMPETITION_LEVELS`, `PassportLevel`, categories, `UserRole`).
- Changing `clubId` also updates `clubName` (kept for backward compatibility); `clubId: null` clears both.
- An admin cannot change **their own** role (403) — avoids locking oneself out.
- Unknown user → 404; unknown club → 400.
- Write + audit row in one transaction; the audit row lists only fields that actually changed (no row if nothing changed).

### 6.2 Club account creation

- Body: `email`, `firstName`, `lastName`, and exactly one of `clubId` (existing) or `clubName` (new).
- Email already used → 409. `clubName` already exists → 409 carrying the existing club id so the form can offer it.
- One transaction: create `Club` (if new) + `User { role: CLUB, clubId, clubName }` with a random, unusable password hash + audit row.
- After commit: create an invitation token through the existing password-reset token mechanism (SHA-256 hashed in DB) with a **7-day** expiry instead of the reset default, and send an "invitation" email (new template in `EmailService`, same link format `…/reset-password?token=…`).
- If the email fails, the account stays created; the response carries `invitationSent: false` and the UI shows a warning + "Resend invitation" (graceful degradation).
- `@Throttle` on creation and resend.

**Open point to check during implementation:** the mobile app handles `https://app.ffd-connect.fr/reset-password?token=…` as a universal link (`apps/client/src/navigation/linking.ts`), but the project domain is `ffd.gabin-simond.fr` and the email link is built from the backend `FRONTEND_URL`. Check which host the emails actually point to and that it opens the app. A club manager without the app installed must still be able to set a password: verify what that URL serves without the app and, if needed, add a minimal web page that calls `POST /auth/reset-password`.

## 7. Testing

- **Backend**
  - Unit tests for each admin service: filters, pagination bounds, club change syncs `clubName`, self-role-change refused, audit diff only on changed fields, invitation failure path.
  - e2e: every `/admin/*` route returns 403 for `LICENSEE`, `CLUB` and `STAFF`, and 401 without token.
  - e2e: `PATCH` writes exactly one audit row; Club account creation creates club + user + audit atomically.
  - `admin` module coverage threshold aligned with auth (94%), since it can change roles.
- **apps/admin**
  - Vitest + Testing Library: login guard (non-admin rejected), user edit form (validation, before/after summary), new Club account form (existing-name conflict).
- `swagger.json` regenerated (`backend-build` freshness check).

## 8. Security & RGPD

- Backend authorisation is the only trust boundary; front-end checks are UX.
- No password is ever set or seen by an admin; invitation tokens are hashed.
- Audit log for accountability; no secrets in `before`/`after`.
- The privacy policy gets a sentence about administrators correcting profile data (lot 1) and about anonymous audience measurement (lot 5).
- The diff touches role and token handling → `security-reviewer` runs on the lot 1 PR.

## 9. Cost

- Azure SWA Free: 0 EUR. No new container, no new database.
- The backend wakes only when an admin uses the tool.
- GitHub Actions: `deploy-admin.yml` runs only on `apps/admin/**` changes; the admin test step adds a few minutes to PRs touching `apps/admin`.

## 10. Out of scope for lot 1

Account deletion, password reset by an admin, email change, license management, web impersonation (lot 6); moderation (lot 2); tracks (lot 3); stats (lots 4-5); `STAFF` access.
