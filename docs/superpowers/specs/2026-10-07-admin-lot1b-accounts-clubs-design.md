# Admin back-office — lot 1b: accounts and clubs — design

- **Date:** 2026-10-07
- **Status:** draft, pending review
- **Builds on:** `2026-10-07-admin-backoffice-design.md` (lot 1, merged as #155)
- **Next:** lot 1c, multi-profile (additional roles, cumulative rights). It gets its own short spec after this one.

## 1. Goal

Requested by the user after the lot 1 release:

- The UI says **"Utilisateurs"**, not "Inscrits". In the app, "inscrit" means _registered to a competition_.
- Admins can **create users** of any non-admin role, not only Club accounts.
- Admins can **activate / deactivate** users and clubs.
- Admins can **delete** users and clubs.
- Admins can **list and edit clubs**.

Success: an admin can create a licensee, deactivate them (access cut immediately), reactivate them, then delete them. An admin can rename a club everywhere at once, and can delete an empty club. Every one of these actions is in the audit log.

## 2. Decisions (taken with the user)

| Topic             | Decision                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deactivated user  | Cannot log in or refresh. Every request with an existing access token is refused right away. All sessions are revoked. Data stays intact and visible (registrations, results, partnerships). Reversible.                    |
| Deactivated club  | Its `CLUB` accounts are blocked as above. Its licensees are unaffected.                                                                                                                                                     |
| Immediate cut-off | `JwtStrategy.validate` reads the account status from the DB on every authenticated request (one indexed lookup). Without this, the access token would stay valid for up to 60 minutes.                                      |
| Delete user       | Same hard deletion as the self-service account deletion (RGPD). The core is factored into a shared method. The admin must type the account's email to confirm. Audit row without personal data.                             |
| Delete club       | Only when the club is empty: no members, no `CLUB` account, no competition organised (`Competition.organizer = club name`). Otherwise the API answers 409 with the counts, and the UI offers "Désactiver à la place".       |
| Create user       | Roles `LICENSEE`, `CLUB`, `STAFF`. Never `ADMIN`: that is granted afterwards from the user page, as today. Optional club and profile fields. Invitation email with a role-specific wording, pointing to the web reset page. |
| Club edit         | `name` and `registrationMode`. HelloAsso credentials are never shown or edited, only "configured: yes/no".                                                                                                                  |
| Club rename       | In one transaction, also updates `User.clubName`, `License.clubName` and `Competition.organizer`, which hold copies of the name.                                                                                            |

## 3. Data model (additive migration)

```prisma
model User { … disabledAt DateTime? … @@index([disabledAt]) }
model Club { … disabledAt DateTime? … }
```

`null` means active. The column is nullable with no default, so the deploy rollback stays safe.

New audit actions:

- `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`, `USER_DELETE`
- `CLUB_UPDATE`, `CLUB_DISABLE`, `CLUB_ENABLE`, `CLUB_DELETE`

`CLUB_ACCOUNT_CREATE` stays readable for rows that already exist.

## 4. Enforcement

A shared helper `accountBlockReason(user) → null | "USER_DISABLED" | "CLUB_DISABLED"` lives in `src/auth/`. `CLUB_DISABLED` applies only when `role === CLUB` and `club.disabledAt` is set.

The helper is used in three places:

- `AuthService.validateUser`, at login. A blocked account gets **403** with `message: "Compte désactivé. Contactez la fédération."`. The password is still checked first, so the response does not reveal whether an account exists.
- The refresh-token flow. A blocked account gets 401: the session is over.
- `JwtStrategy.validate`, on every request. It loads `{ disabledAt, role, club: { disabledAt } }` by `sub` and rejects with 401 when the account is blocked or missing. The query uses a select constant from `prisma-selects.ts`.

On deactivation, all refresh tokens are revoked, either for the user or for every `CLUB` account of the club.

The mobile app needs no change. A 401 already sends the user back to the login screen, and the login screen already shows the server message.

## 5. API (all under `/admin`, ADMIN only, class-level guards)

| Method & path                             | Purpose                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /admin/users`                       | Create a user. Body: `email, firstName, lastName, role ∈ {LICENSEE, CLUB, STAFF}`, plus either `clubId` or `clubName` (new club; only allowed with `CLUB`), plus optional profile fields (the same validation as PATCH). Sends the invitation. Returns `{ userId, clubId?, invitationSent }`. The 409 semantics are the same as the current club-account route. |
| `POST /admin/users/:id/status`            | Body `{ active: boolean }`. Refused on one's own account (403). Idempotent. On deactivation, revokes the user's sessions.                                                                                                                                                                                                                                       |
| `DELETE /admin/users/:id`                 | Body `{ confirmEmail }`. Must match the account's email, case-insensitive (400 otherwise). Refused on one's own account (403). Uses the shared deletion core. Audit row `{ role }` only.                                                                                                                                                                        |
| `POST /admin/users/:id/resend-invitation` | Now allowed for any role except `ADMIN`, while `lastLoginAt` is null.                                                                                                                                                                                                                                                                                           |
| `GET /admin/clubs`                        | Changed from "options" to a paginated list. Query: `search`, `status (active                                                                                                                                                                                                                                                                                    | disabled)`, `skip`, `take`. Items: `id, name, registrationMode, disabledAt, memberCount, clubAccountCount, helloAssoConfigured, createdAt`. |
| `GET /admin/clubs/options`                | The former plain `{id, name}` list, used by selects. Active clubs plus the club currently selected.                                                                                                                                                                                                                                                             |
| `GET /admin/clubs/:id`                    | Detail: the list fields plus `competitionCount` and members (`take` 200, sorted by name).                                                                                                                                                                                                                                                                       |
| `PATCH /admin/clubs/:id`                  | Body: `name?`, `registrationMode?`. A name collision gives 409. A rename cascades as described in §2. Audit diff.                                                                                                                                                                                                                                               |
| `POST /admin/clubs/:id/status`            | Body `{ active }`. On deactivation, revokes the sessions of the club's `CLUB` accounts.                                                                                                                                                                                                                                                                         |
| `DELETE /admin/clubs/:id`                 | Deletes the club only when it is empty. Otherwise 409 `{ message, memberCount, clubAccountCount, competitionCount }`.                                                                                                                                                                                                                                           |

`POST /admin/club-accounts` is **removed**: `POST /admin/users` with `role: CLUB` replaces it. Only the admin SPA used it, and both ship together.

`GET /admin/users` gains a `status` filter, and its items gain `disabledAt`.

## 6. Deletion core

`UsersService.deleteMyAccount(userId, password)` currently checks the password and then runs the purge. The purge is extracted into `AccountDeletionService.deleteAccount(userId)`, which removes:

- notifications, bookings, registrations;
- the partner name in other people's registrations;
- the message text of track-correction requests;
- bug reports;
- admin audit rows that target the user;
- the user;
- and finally the renewal blob files.

Both the self-service path and the admin path call this method. The self-service behaviour does not change, and its existing tests keep passing.

## 7. Back-office UI

- **Navigation:**
  - "Inscrits" becomes "Utilisateurs".
  - "Nouveau compte Club" becomes "Nouvel utilisateur".
  - A new **"Clubs"** entry.
- **Users list:** a status badge ("Désactivé" in red) and a status filter.
- **User page:**
  - a status banner and a "Désactiver / Réactiver" button with a confirmation;
  - a "Supprimer" button in a danger zone, opening a modal where the admin types the email;
  - both buttons are hidden on one's own account;
  - after a deletion, the admin goes back to the list.
- **New user page:**
  - a role select (Licencié / Club / Staff);
  - the club field: existing or new, where "new" is only offered for the Club role;
  - optional profile fields.
- **Clubs list:** search, status filter, the counts, and a "HelloAsso" badge.
- **Club page:**
  - edit the name and the registration mode, confirmed through the before → after summary;
  - a status button;
  - a danger zone with "Supprimer", which shows the blocking counts and offers "Désactiver à la place";
  - the member table, with links to each member.
- **Audit log:** labels for the new actions.

## 8. Testing

- **Unit tests:**
  - `accountBlockReason`;
  - the login, refresh and JwtStrategy rejections;
  - each new service method, covering status changes (with self-protection and token revocation), deletion (email mismatch, self-delete), club rename cascade, club delete when empty or not, and user creation for each role.
- **Mocked e2e:** extend the admin role matrix to the new routes. Auth e2e must keep passing, since JwtStrategy now hits Prisma, so its mocks need the new select.
- **Real-DB integration:** club rename cascade, deactivation followed by a rejected login, and deletion through the shared core.
- **SPA:** page tests for status, delete, create user and the club pages.

## 9. Security and RGPD

- Deactivation is the reversible measure; deletion is final.
- The deletion audit keeps no personal data: only the target id and the role.
- The client is never told whether an email exists. Login checks the password before the account status.
- The deactivation check runs server-side on every request. The UI only displays it.

## 10. Cost

One extra indexed DB read per authenticated request, which is negligible. No new infrastructure.

## 11. Out of scope

Multi-profile (lot 1c), music and moderation (lots 2-3), statistics (lots 4-5), editing HelloAsso credentials, and bulk actions.
