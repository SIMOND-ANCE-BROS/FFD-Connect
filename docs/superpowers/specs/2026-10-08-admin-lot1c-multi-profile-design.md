# Admin back-office — lot 1c: multi-profile — design

- **Date:** 2026-10-08
- **Status:** draft, pending review
- **Builds on:** `2026-10-07-admin-lot1b-accounts-clubs-design.md` (lot 1b, merged as #158)

## 1. Goal

One account can hold several roles with cumulative rights. Real cases, from the user:

- an admin who also dances (the user's own account);
- a dancer who runs their club;
- a dancer who is part of the federation staff.

Any combination is allowed, including all four roles on one account. It stays rare, so the design stays small.

Success: an admin gives a licensee the extra role `CLUB` from the back-office. Without logging out, that person can manage their club's competitions and registrations, and they keep their dancer screens. In the app they switch between a "Danseur" space and a "Club" space. The change is in the audit log.

## 2. Decisions (taken with the user)

| Topic             | Decision                                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data model        | Keep `User.role` as the **main role**. Add `extraRoles UserRole[]`. Additive migration. A replacement `roles[]` column (not additive) and a join table (YAGNI) were rejected.                                                                                                     |
| Combinations      | Any. All four roles on one account is valid.                                                                                                                                                                                                                                      |
| Club              | An account has one `clubId`. A `CLUB` extra role represents that same club. A role per club is out of scope.                                                                                                                                                                      |
| Rights            | Cumulative everywhere on the server: a request is allowed if **any** of the account's roles allows it.                                                                                                                                                                            |
| Mobile navigation | An **active space** selector. The space decides the tabs and which variant of a screen is shown. Merging every role into one tab bar was rejected: it would show 6-7 tabs (max 5 today) and mix screens built for different audiences (e.g. Compétitions for a club vs a dancer). |
| Mobile actions    | Actions follow **all** roles, not the space. In any space, a screen offers the actions of every role the account holds, when the screen has the data they need. Example: in the Danseur space, the Bibliothèque shows "modifier la musique" to an account that is also `ADMIN`.   |
| Active space      | A display preference stored on the device only. Not in the token, never checked by the server.                                                                                                                                                                                    |

## 3. Data model (additive migration)

```prisma
model User { … extraRoles UserRole[] @default([]) … }
```

- `extraRoles` never contains the main `role`, and never contains a role twice. The service normalises the list on every write.
- When the main role changes to a role that is in `extraRoles`, that role is removed from `extraRoles`.
- No index: the table is small, and the `has` filter only appears in a few admin and notification queries.
- The column has a default, so the deploy rollback stays safe (the previous revision simply ignores it).

## 4. Enforcement (backend)

- `accountStatusSelect` also selects `extraRoles`. `JwtStrategy.validate` already reads the account on every request. It returns `roles` (main role + extra roles) next to `role`. A role change applies on the next request, with no new login.
- A shared module `src/auth/roles.ts`:
  - `rolesOf(user)`: main role + extra roles;
  - `hasRole(user, role)`: for checks in code;
  - `withRole(role)`: the Prisma filter `{ OR: [{ role }, { extraRoles: { has: role } }] }`.
- `RolesGuard` allows the request when any of `req.user.roles` is in the required roles.
- Every direct comparison (`.role === X`, `.role !== X`, about 27 sites) and every `where: { role: X }` filter moves to `hasRole` or `withRole`. This includes:
  - "the organizer is a club" (registrations, HelloAsso, partnerships, members);
  - "ADMIN sees hidden tracks" and track-correction review;
  - notifications to licensees, club representatives and admins;
  - the admin club pages (club accounts count, sessions revoked on club deactivation).

  The exceptions are where the main role is the point, for example the role written in `ImpersonationLog.actorRole`.

- **Impersonation:** today's rules, evaluated over all roles.
  - A target holding `ADMIN` in any form cannot be impersonated.
  - An actor holding `ADMIN` (main or extra) follows the admin rules.
  - Otherwise, an actor holding `STAFF` follows the staff rules: a reason is required, and the target must not hold `STAFF`.
  - `JwtStrategy`'s check that the impersonator is still an active admin uses `hasRole(…, ADMIN)`.
- **Disabled club** (`accountBlockReason`):
  - main role `CLUB` and the club disabled: the account is blocked, as today;
  - `CLUB` only as an extra role: the account is not blocked, but `CLUB` is dropped from `roles` for as long as the club stays disabled.

## 5. API

- `PATCH /admin/users/:id` accepts `extraRoles?: UserRole[]`, validated by the DTO (known values only).
  - The service normalises the list (§3).
  - An admin cannot remove `ADMIN` from their own account, as main role or extra role: 400.
  - Adding `CLUB` needs a `clubId` on the account: 400 with a French message.
  - Audit action `user.roles.update`, with the role lists before and after (no personal data).
- `GET /admin/users` and `GET /admin/users/:id` return `extraRoles` and `roles`. The `role` filter of the list matches main and extra roles (`withRole`).
- `/auth/me`, login and refresh return `roles`. `role` is unchanged, so older app versions keep working on the main role.
- `pnpm api:sync` afterwards (Swagger + generated clients).

## 6. Back-office UI

- **User detail page:** a "Rôles supplémentaires" block next to the main role. One checkbox per role other than the main role, then Save.
  - Same confirmation and error patterns as lot 1b (shared "Serveur injoignable" message).
  - Your own `ADMIN` box is disabled on your own account.
- **Utilisateurs list:** the main role, then a small badge per extra role ("+ Club", "+ Staff", …). The role filter also finds extra roles.
- **Club detail page:** the member list and the club accounts count include accounts holding `CLUB` as an extra role.

## 7. Mobile app

- `auth.store` holds `roles: AuthRole[]` next to `role`, from login, `/auth/me` and session restore. If `roles` is missing (older backend), it falls back to `[role]`.
- `auth.store` also holds `activeSpace: AuthRole`, persisted on the device.
  - Default: the main role.
  - If the active space is no longer one of the account's roles (role removed), it falls back to the main role.
- **Space selector:** in Réglages, "Espace" with one option per role ("Danseur", "Club", "Staff", "Admin").
  - Hidden when the account has a single role.
  - Switching remounts the tab navigator (`key` built from the active space), as a role switch does today.
- **Two kinds of checks, kept apart:**
  - _Navigation and screen variant_ use `activeSpace`: which tabs `MainTabs` shows (today's per-role rules, applied to the space), and which variant of a screen is shown (e.g. a club's own competitions vs the dancer's view).
  - _Actions_ use `hasRole(role)` over all roles: action buttons inside a screen (edit a track, review a correction, scan, manage a registration…) appear when the account holds the role and the screen has the data the action needs.
- Purely descriptive uses keep the main role: the impersonation list label, Sentry and log tags.
- No new screen besides the selector.

## 8. Rollout

Compatible in both directions, so no coordinated release:

1. Backend + migration + back-office, in one PR (deployed via staging). Apps already installed see no change and follow the main role.
2. Mobile app in a later EAS build. Until it ships, extra roles work on the backend and back-office only.

## 9. Testing

- **Backend unit tests:**
  - `RolesGuard` with an extra role;
  - `rolesOf`, `hasRole`, `withRole`;
  - normalisation (dedupe, main role removed, main role change);
  - own `ADMIN` removal refused; `CLUB` without a club refused;
  - disabled club with `CLUB` as main role vs extra role;
  - impersonation with `ADMIN` as an extra role (allowed as actor, refused as target), and a staff actor targeting an account with `STAFF` as an extra role (refused);
  - audit row.
- **Real-DB integration tests:**
  - `withRole` against the Postgres array;
  - a licensee with an extra `CLUB` role manages their club's registrations and HelloAsso settings.
- **Admin SPA:** the "Rôles supplémentaires" block (save, error, own-`ADMIN` guardrail); the list badge and filter.
- **Client:**
  - `MainTabs` driven by the active space;
  - the selector (hidden for one role, fallback when a role is removed);
  - an action shown through an extra role in another space (track edit in the Danseur space);
  - the store fallback when `roles` is missing.
- Coverage: auth module stays at or above 94%.

## 10. Security and RGPD

- Rights are computed from the database on every request, so removing a role cuts access immediately.
- The active space is only display. Every right is checked by the server against the account's roles.
- The audit row stores role names only.

## 11. Cost

None. No new infrastructure, no new job, no extra request (the roles come in the account lookup that already runs on every request).

## 12. Out of scope

- A different club per role, or a role per club.
- Per-space notifications: a notification is sent once per account, whatever the space.
- Granting extra roles from the mobile app.
