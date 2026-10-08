# Admin back-office — Lot 1c (multi-profile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one account hold several roles with cumulative server-side rights, editable from the back-office, and let the mobile app switch between role "spaces" while still offering every role's actions in any space.

**Architecture:** One additive column `User.extraRoles UserRole[]`. One pure module, `src/auth/roles.ts`, owns every multi-role rule (`rolesOf`, `hasRole`, `withRole`, `normalizeExtraRoles`); every role comparison in the backend goes through it. `JwtStrategy` already reads the account on each request, so it computes `req.user.roles` from the database. The admin `PATCH /admin/users/:id` gains `extraRoles`, audited through the existing `USER_UPDATE` diff. In the app, the persisted `role` becomes the active space (so every screen keeps working unchanged), and a new `roles` list drives action buttons.

**Tech Stack:** NestJS 11, Prisma 7 / PostgreSQL 15, Jest 29; React 19 + Mantine 8 + TanStack Query 5 + Vitest 4 (admin SPA); React Native 0.86 / Expo SDK 57 + Zustand + jest-expo (client).

**Spec:** `docs/superpowers/specs/2026-10-08-admin-lot1c-multi-profile-design.md` (binding). Lot 1b plan, for conventions: `docs/superpowers/plans/2026-10-07-admin-lot1b-accounts-clubs.md`.

**Worktree:** `/Users/gabin/Development/FFD-Connect-admin1c`, branch `feature/admin-lot1c` (from `origin/develop` at 70036b3). Paths below are relative to it. The worktree has no `node_modules` yet: run `pnpm install --frozen-lockfile` once before Task 1, and `cp apps/backend/.env.example apps/backend/.env` (gitignored, never commit it).

## Global Constraints

- Migration is additive only: exactly `extraRoles UserRole[] @default([])` on `User`. No index, no `DROP`, no `ALTER COLUMN`.
- `User.role` stays the **main role**. `extraRoles` never contains the main role and never a duplicate; `normalizeExtraRoles` is the only writer.
- Rights are cumulative: a request is allowed if **any** effective role allows it. Effective roles = `rolesOf(user)`: main role + extra roles, minus an **extra** `CLUB` while `club.disabledAt` is set.
- A disabled club blocks the account only when `CLUB` is the main role (lot 1b behaviour unchanged). Club deactivation revokes sessions of main-role `CLUB` accounts only (`admin-clubs.service.ts:159` keeps `role: UserRole.CLUB`).
- Never compare `.role` directly in new or touched backend code; use `hasRole` / `withRole`. Intentional main-role uses stay as they are and are listed in Task 4.
- Prisma: selects come from `src/utils/prisma-selects.ts`; `take` on every `findMany`. When a `where` already has `OR`, put `withRole(...)` inside `AND: [...]`, never spread it next to the existing `OR`.
- Self-edit on `PATCH /admin/users/:id`: main role locked (existing 403). `extraRoles` may change, but the resulting `rolesOf` must contain `ADMIN`, otherwise **403** `Un administrateur ne peut pas retirer son propre rôle Admin`.
- `CLUB` in `extraRoles` requires a `clubId` (after the update): otherwise **400** `Un rôle Club supplémentaire nécessite un club`.
- API responses keep `role` unchanged and add `roles: UserRole[]` (main first, then extras in enum order). Old app versions must keep working.
- Client: `AuthConfig.role` is the active space. New fields `roles?: UserRole[]`, `mainRole?: UserRole`. Missing `roles` falls back to `[role]`.
- No `any`, no `process.env` in backend code, no new React Context.
- Code, comments, commits in English; user-facing copy in French. Backend double quotes, admin SPA single quotes, client double quotes (pre-commit Prettier reformats).
- Coverage thresholds stay as they are (`src/auth` folder 94 / 75 / 88 / 94, `src/admin` 94 / 75 / 88 / 94). Never lower one: add tests.
- Conventional commits, never `--no-verify`. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```
- No push and no PR without the user's explicit go.

### How to run tests (applies to every task)

- Backend unit: `pnpm --filter backend exec jest <path>`.
- Admin SPA: `pnpm --filter admin test -- <path>`. Client: `pnpm --filter client exec jest <path>`.
- Mocked e2e (no DB): same recipe as lot 1b (copy `test/jest-e2e.json` without `globalSetup`, run with `--runInBand --forceExit`).
- **Real-DB tests only on the dedicated test database**, through the lot 1b helper (user-approved 2026-10-07):
  ```bash
  cd apps/backend
  source /Users/gabin/Development/FFD-Connect-admin1b/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh
  pnpm exec prisma migrate deploy   # applies the new migration to ffd_connect_admin_test only
  pnpm exec jest --config test/jest-integration.json --runInBand --forceExit multi-role.integration-spec
  ```
  Never run `db push`, `migrate dev`, `migrate reset` or the full `test:e2e` / `test:integration` scripts against any other database (the shared `ffd_connect` dev DB has no migration history).

## Review Focus

1. **Old app, new backend:** a logged-in app that never reads `roles` must behave exactly as before (login, refresh and `/users/me` still return `role` = main role). Pinned in Task 5.
2. **Main role changed onto an existing extra role:** `LICENSEE + [CLUB]` set to main `CLUB` must store `extraRoles = []`, not `[CLUB]`. Pinned in Task 6.
3. **Club disabled while CLUB is only an extra role:** the dancer still logs in, `/clubs/me/*` refuses, and the unguarded `GET /users/members` (service check only) refuses too. Pinned in Tasks 2 and 3.
4. **`withRole` next to an existing `OR`:** a filter like `partnership-query` members (`OR: [club conditions]`) must keep both conditions. Pinned by the real-DB test in Task 4.
5. **Space removed while the app is closed:** an app whose stored space is `CLUB` restores a profile without `CLUB` and falls back to the main role instead of showing club tabs that the server refuses. Pinned in Task 9.

---

### Task 1: Column, migration and the roles module

**Files:**

- Modify: `apps/backend/prisma/schema/user.prisma` (model `User`)
- Create: `apps/backend/prisma/schema/migrations/<timestamp>_user_extra_roles/migration.sql`
- Create: `apps/backend/src/auth/roles.ts`
- Test: `apps/backend/src/auth/roles.spec.ts`

**Interfaces:**

- Produces:
  - `type RoleFields = { role: UserRole | string; extraRoles?: readonly (UserRole | string)[] | null; club?: { disabledAt?: Date | null } | null }`
  - `type RoleSubject = RoleFields | { roles: readonly (UserRole | string)[] }`
  - `rolesOf(user: RoleSubject): UserRole[]` — main first, extras in enum order, unknown strings dropped, extra `CLUB` dropped while `club.disabledAt` is set.
  - `hasRole(user: RoleSubject | null | undefined, role: UserRole): boolean`
  - `withRole(role: UserRole): Prisma.UserWhereInput` → `{ OR: [{ role }, { extraRoles: { has: role } }] }`
  - `normalizeExtraRoles(main: UserRole, extras: readonly UserRole[]): UserRole[]`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/auth/roles.spec.ts
import { UserRole } from '@prisma/client';
import { hasRole, normalizeExtraRoles, rolesOf, withRole } from './roles';

describe('roles', () => {
  describe('rolesOf', () => {
    it('returns the main role alone when there is no extra role', () => {
      expect(rolesOf({ role: UserRole.LICENSEE })).toEqual([UserRole.LICENSEE]);
      expect(rolesOf({ role: UserRole.LICENSEE, extraRoles: null })).toEqual([UserRole.LICENSEE]);
    });

    it('puts the main role first, then extras in enum order, without duplicates', () => {
      expect(
        rolesOf({
          role: UserRole.ADMIN,
          extraRoles: [UserRole.STAFF, UserRole.LICENSEE, UserRole.ADMIN],
        }),
      ).toEqual([UserRole.ADMIN, UserRole.LICENSEE, UserRole.STAFF]);
    });

    it('drops unknown strings', () => {
      expect(rolesOf({ role: 'LICENSEE', extraRoles: ['ROOT'] })).toEqual([UserRole.LICENSEE]);
    });

    it('drops an extra CLUB while the club is disabled, but keeps a main CLUB', () => {
      const disabled = { disabledAt: new Date() };
      expect(
        rolesOf({
          role: UserRole.LICENSEE,
          extraRoles: [UserRole.CLUB],
          club: disabled,
        }),
      ).toEqual([UserRole.LICENSEE]);
      expect(rolesOf({ role: UserRole.CLUB, club: disabled })).toEqual([UserRole.CLUB]);
    });

    it('returns precomputed roles as is (req.user)', () => {
      expect(rolesOf({ roles: [UserRole.LICENSEE, UserRole.ADMIN] })).toEqual([
        UserRole.LICENSEE,
        UserRole.ADMIN,
      ]);
    });
  });

  it('hasRole looks at every role and is false for a missing user', () => {
    const u = { role: UserRole.LICENSEE, extraRoles: [UserRole.ADMIN] };
    expect(hasRole(u, UserRole.ADMIN)).toBe(true);
    expect(hasRole(u, UserRole.CLUB)).toBe(false);
    expect(hasRole(null, UserRole.ADMIN)).toBe(false);
  });

  it('withRole matches the main role or the extra roles', () => {
    expect(withRole(UserRole.CLUB)).toEqual({
      OR: [{ role: UserRole.CLUB }, { extraRoles: { has: UserRole.CLUB } }],
    });
  });

  it('normalizeExtraRoles removes the main role and duplicates, in enum order', () => {
    expect(
      normalizeExtraRoles(UserRole.CLUB, [
        UserRole.STAFF,
        UserRole.CLUB,
        UserRole.LICENSEE,
        UserRole.STAFF,
      ]),
    ).toEqual([UserRole.LICENSEE, UserRole.STAFF]);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter backend exec jest src/auth/roles.spec.ts`
Expected: FAIL, `Cannot find module './roles'`.

- [ ] **Step 3: Add the column**

In `apps/backend/prisma/schema/user.prisma`, model `User`, right after the `role` line:

```prisma
  extraRoles           UserRole[]     @default([]) // Rôles supplémentaires (multi-profil, lot 1c) ; jamais le rôle principal
```

- [ ] **Step 4: Generate the migration offline (no database)**

From the repo root:

```bash
BEFORE=$(mktemp -d)
git archive HEAD apps/backend/prisma/schema | tar -x -C "$BEFORE"
DIR="$PWD/apps/backend/prisma/schema/migrations/$(date -u +%Y%m%d%H%M%S)_user_extra_roles"
mkdir -p "$DIR"
(cd apps/backend && pnpm exec prisma migrate diff \
  --from-schema "$BEFORE/apps/backend/prisma/schema" \
  --to-schema prisma/schema --script --output "$DIR/migration.sql")
cat "$DIR/migration.sql"
pnpm --filter backend exec prisma generate
```

Expected `migration.sql`, and nothing else:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraRoles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
```

If anything else appears, stop: the schema has drifted, report it.

- [ ] **Step 5: Write the module**

```ts
// apps/backend/src/auth/roles.ts
import { Prisma, UserRole } from '@prisma/client';

/**
 * Multi-profile (lot 1c): one account = a main `role` + `extraRoles`.
 * Every role decision in the backend goes through this module.
 */
export interface RoleFields {
  role: UserRole | string;
  extraRoles?: readonly (UserRole | string)[] | null;
  club?: { disabledAt?: Date | null } | null;
}

/** An account row, or `req.user` whose `roles` are already computed. */
export type RoleSubject = RoleFields | { roles: readonly (UserRole | string)[] };

const ROLE_ORDER = Object.values(UserRole);

const isRole = (r: unknown): r is UserRole => ROLE_ORDER.includes(r as UserRole);

const inEnumOrder = (roles: Iterable<UserRole>): UserRole[] => {
  const set = new Set(roles);
  return ROLE_ORDER.filter((r) => set.has(r));
};

/**
 * Effective roles: main first, then extras in enum order. An extra CLUB is
 * dropped while its club is disabled (a main CLUB is blocked at the account
 * level instead, see accountBlockReason).
 */
export function rolesOf(user: RoleSubject): UserRole[] {
  if ('roles' in user) return user.roles.filter(isRole);
  const main = isRole(user.role) ? [user.role] : [];
  const extras = (user.extraRoles ?? [])
    .filter(isRole)
    .filter((r) => !main.includes(r))
    .filter((r) => !(r === UserRole.CLUB && user.club?.disabledAt));
  return [...main, ...inEnumOrder(extras)];
}

export function hasRole(user: RoleSubject | null | undefined, role: UserRole): boolean {
  return user ? rolesOf(user).includes(role) : false;
}

/** Prisma filter: the account holds `role` as main or extra role. */
export function withRole(role: UserRole): Prisma.UserWhereInput {
  return { OR: [{ role }, { extraRoles: { has: role } }] };
}

/** The only shape `extraRoles` is ever written in. */
export function normalizeExtraRoles(main: UserRole, extras: readonly UserRole[]): UserRole[] {
  return inEnumOrder(extras.filter((r) => r !== main));
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter backend exec jest src/auth/roles.spec.ts`
Expected: PASS (7 tests). Then `pnpm --filter backend exec tsc --noEmit -p tsconfig.json`: no error.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/prisma/schema apps/backend/src/auth/roles.ts apps/backend/src/auth/roles.spec.ts
git commit -m "feat(auth): add extra roles column and the roles module

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Request roles — account status, JwtStrategy, RolesGuard

**Files:**

- Modify: `apps/backend/src/utils/prisma-selects.ts` (`accountStatusSelect`)
- Modify: `apps/backend/src/auth/account-status.ts`
- Modify: `apps/backend/src/auth/jwt.strategy.ts`
- Modify: `apps/backend/src/auth/interfaces/jwt-payload.interface.ts` (`RequestWithUser`)
- Modify: `apps/backend/src/auth/guards/roles.guard.ts`
- Test: `apps/backend/src/auth/account-status.spec.ts`, `apps/backend/src/auth/jwt.strategy.spec.ts`, `apps/backend/src/auth/guards/roles.guard.spec.ts`

**Interfaces:**

- Consumes: `rolesOf`, `hasRole` (Task 1).
- Produces: `req.user.roles: UserRole[]` on every authenticated request (`RequestWithUser.user.roles`). `role` stays the main role.

- [ ] **Step 1: Write the failing tests**

Append to `account-status.spec.ts`:

```ts
it('does not block an account whose CLUB role is only an extra role', () => {
  expect(
    accountBlockReason({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
      club: { disabledAt: new Date() },
    }),
  ).toBeNull();
});
```

Append to `roles.guard.spec.ts` (reuse the file's existing context helper; if it builds the request as `{ user: { role } }`, add `roles`):

```ts
it('allows a user whose extra role is required', () => {
  reflector.getAllAndOverride = jest.fn().mockReturnValue([UserRole.CLUB]);
  const ctx = contextWithUser({
    role: UserRole.LICENSEE,
    roles: [UserRole.LICENSEE, UserRole.CLUB],
  });
  expect(guard.canActivate(ctx)).toBe(true);
});

it('falls back to the main role when roles are absent', () => {
  reflector.getAllAndOverride = jest.fn().mockReturnValue([UserRole.ADMIN]);
  const ctx = contextWithUser({ role: UserRole.ADMIN });
  expect(guard.canActivate(ctx)).toBe(true);
});
```

If a helper named `contextWithUser` does not exist in `roles.guard.spec.ts`, add it at the top of the file:

```ts
const contextWithUser = (user: object) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;
```

Append to `jwt.strategy.spec.ts` (same mocking style as the file: `prisma.user.findUnique` mocked per call):

```ts
it('returns every effective role from the database', async () => {
  prisma.user.findUnique.mockResolvedValueOnce({
    role: UserRole.ADMIN,
    extraRoles: [UserRole.LICENSEE],
    disabledAt: null,
    club: null,
  });
  await expect(
    strategy.validate({ sub: 'u1', email: 'a@x.fr', role: 'ADMIN' }),
  ).resolves.toMatchObject({
    role: UserRole.ADMIN,
    roles: [UserRole.ADMIN, UserRole.LICENSEE],
  });
});

it('accepts an impersonator whose ADMIN role is an extra role', async () => {
  prisma.user.findUnique
    .mockResolvedValueOnce({
      role: UserRole.LICENSEE,
      extraRoles: [],
      disabledAt: null,
      club: null,
    })
    .mockResolvedValueOnce({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.ADMIN],
      disabledAt: null,
      club: null,
    });
  await expect(
    strategy.validate({ sub: 't1', email: 't@x.fr', role: 'LICENSEE', impersonatedBy: 'a1' }),
  ).resolves.toMatchObject({ userId: 't1', impersonatedBy: 'a1' });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter backend exec jest src/auth/account-status.spec.ts src/auth/guards/roles.guard.spec.ts src/auth/jwt.strategy.spec.ts`
Expected: the new tests FAIL (`roles` missing, extra-role guard refused).

- [ ] **Step 3: Implement**

`prisma-selects.ts`:

```ts
export const accountStatusSelect = {
  role: true,
  extraRoles: true,
  disabledAt: true,
  club: { select: { disabledAt: true } },
} as const;
```

`account-status.ts`: add `extraRoles?: readonly string[] | null;` to `AccountStatusFields` and update the doc comment of `accountBlockReason`:

```ts
 * A disabled club blocks only accounts whose MAIN role is CLUB. An extra CLUB
 * role is dropped by rolesOf instead (the dancer behind it keeps their access).
```

(The condition `user.role === UserRole.CLUB && user.club?.disabledAt` stays: it is the main-role rule.)

`jwt.strategy.ts`: import `{ hasRole, rolesOf }` from `./roles`, replace `impersonator.role !== UserRole.ADMIN` with `!hasRole(impersonator, UserRole.ADMIN)`, and return:

```ts
return {
  userId: payload.sub,
  email: payload.email,
  // The database roles, not the (possibly stale) token claim.
  role: account.role,
  roles: rolesOf(account),
  impersonatedBy: payload.impersonatedBy,
};
```

`jwt-payload.interface.ts`, inside `RequestWithUser.user`, after `role`:

```ts
    /** Every effective role, read from the database on each request (lot 1c). */
    roles: UserRole[];
```

(import `UserRole` from `@prisma/client`). Fix every spec that builds a `RequestWithUser` and now fails to compile by adding `roles: [<its role>]`.

`roles.guard.ts`:

```ts
import { rolesOf } from '../roles';
// …
const { user } = context
  .switchToHttp()
  .getRequest<{ user?: { role: UserRole; roles?: UserRole[] } }>();
if (!user) {
  return false;
}

const roles = user.roles ?? rolesOf({ role: user.role });
const hasRole = requiredRoles.some((r) => roles.includes(r));
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter backend exec jest src/auth`
Expected: PASS, including the existing suites. Then `pnpm --filter backend exec tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src
git commit -m "feat(auth): compute every effective role on each request

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Club-representative checks in services

Every service that loads the caller and checks `role !== CLUB` moves to one select and `hasRole`. The select carries `club.disabledAt`, so an extra CLUB of a disabled club is refused here too (some routes, like `GET /users/members` and `GET /clubs/me/registration-mode`, have no `RolesGuard`).

**Files:**

- Modify: `apps/backend/src/utils/prisma-selects.ts` (add `userRolesClubSelect`)
- Modify: `apps/backend/src/clubs/clubs.service.ts:20-25`
- Modify: `apps/backend/src/clubs/clubs-helloasso.service.ts` (3 sites: ~32, ~105, ~144)
- Modify: `apps/backend/src/clubs/partnership-query.service.ts:55-61`
- Modify: `apps/backend/src/competitions/services/competition-query.service.ts` (~140-150 and ~330-335)
- Modify: `apps/backend/src/competitions/services/competition-registration.service.ts` (~338-344 and ~496-502)
- Modify: `apps/backend/src/users/users.service.ts:128-135`
- Test: the matching `*.spec.ts` of each file

**Interfaces:**

- Consumes: `hasRole` (Task 1).
- Produces: `userRolesClubSelect = { role: true, extraRoles: true, clubId: true, clubName: true, club: { select: { disabledAt: true } } } as const`.

- [ ] **Step 1: Write the failing tests**

In `clubs.service.spec.ts`:

```ts
it('accepts a licensee whose CLUB role is an extra role', async () => {
  prisma.user.findUnique.mockResolvedValue({
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.CLUB],
    clubId: 'c1',
    clubName: 'Club A',
    club: { disabledAt: null },
  });
  await expect(service.getClubIdForOrganizer('u1')).resolves.toBe('c1');
});

it('refuses an extra CLUB role while the club is disabled', async () => {
  prisma.user.findUnique.mockResolvedValue({
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.CLUB],
    clubId: 'c1',
    clubName: 'Club A',
    club: { disabledAt: new Date() },
  });
  await expect(service.getClubIdForOrganizer('u1')).rejects.toThrow(
    'Only club role can manage club data',
  );
});
```

Add the same pair (extra CLUB accepted; extra CLUB of a disabled club refused with the file's existing error) to the specs of `clubs-helloasso.service` (`getMyClubHelloAssoStatus`), `partnership-query.service` (`getMembersForPartnership`), `competition-query.service` (`getPendingRegistrationsForClub`: accepted returns the pending list, refused returns `[]`), `competition-registration.service` (the confirm method at ~342: refused throws `ForbiddenException`) and `users.service` (`findClubMembers`: refused throws `NotFoundException`). Copy each file's existing mock setup for the happy path and change only the user row.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter backend exec jest src/clubs src/competitions/services src/users/users.service.spec.ts`
Expected: the "accepts … extra role" tests FAIL.

- [ ] **Step 3: Implement**

Add to `prisma-selects.ts`:

```ts
/** Caller of a club-representative action: roles, club, club status (lot 1c). */
export const userRolesClubSelect = {
  role: true,
  extraRoles: true,
  clubId: true,
  clubName: true,
  club: { select: { disabledAt: true } },
} as const;
```

At each site, replace the inline `select: { role: true, clubId: true, clubName: true }` with `select: userRolesClubSelect`, and the check with `hasRole`. Example (`clubs.service.ts`):

```ts
const user = await this.prisma.user.findUnique({
  where: { id: organizerUserId },
  select: userRolesClubSelect,
});
if (!user) throw new NotFoundException('User not found');
if (!hasRole(user, UserRole.CLUB)) {
  throw new BadRequestException('Only club role can manage club data');
}
```

Optional-chained sites become `if (!organizer || !hasRole(organizer, UserRole.CLUB))` with the same error or `return []` as before. In `competition-query.service.ts:~145` the select also has `category` and `ageGroup`: keep them and spread the constant (`select: { ...userRolesClubSelect, category: true, ageGroup: true }`), then use `hasRole(user, UserRole.CLUB)` in place of `user?.role === "CLUB"` (guard `user &&` first). Keep each file's existing error messages.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter backend exec jest src/clubs src/competitions src/users`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src
git commit -m "feat(clubs): let an extra CLUB role act for its club

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Role filters, admin-only views, notifications and impersonation

**Files:**

- Modify (filters → `withRole`):
  - `apps/backend/src/career/career.service.ts:~33-41` (search members: LICENSEE)
  - `apps/backend/src/clubs/partnership-query.service.ts:~82-86` (club members: LICENSEE, has an `OR`)
  - `apps/backend/src/clubs/partnership.service.ts:~372-380` (club organizers: CLUB, has an `OR`)
  - `apps/backend/src/users/users.service.ts:~148-158` (club members: LICENSEE, two sites)
  - `apps/backend/src/competitions/services/registration-notification.service.ts:~239` (CLUB)
  - `apps/backend/src/competitions/services/competition-event-notification.service.ts:~90` (LICENSEE)
  - `apps/backend/src/track-corrections/track-corrections.service.ts:~544` (ADMIN)
- Modify (`req.user.role === "ADMIN"` → `hasRole(req.user, UserRole.ADMIN)`):
  - `apps/backend/src/tracks/tracks.controller.ts` (5 sites)
  - `apps/backend/src/track-corrections/track-report.controller.ts:~74`
  - `apps/backend/src/track-corrections/track-corrections.controller.ts:~91`
- Modify (notification preferences by roles): `apps/backend/src/notifications/notification-catalog.ts`, `notification-preferences.query-service.ts`, `notification-preferences.service.ts`, `notifications.controller.ts:~135,~168`
- Modify (impersonation): `apps/backend/src/auth/auth.controller.ts:~399`, `apps/backend/src/auth/auth.service.ts:~410-470`
- Create: `apps/backend/test/multi-role.integration-spec.ts`
- Test: the matching `*.spec.ts`

**Interfaces:**

- Consumes: `withRole`, `hasRole`, `rolesOf` (Task 1), `req.user.roles` (Task 2).
- Produces:
  - `isApplicableToRoles(type: NotificationType, roles: readonly string[]): boolean` and `configurableTypesForRoles(roles: readonly string[]): readonly NotificationType[]` (replace the single-role versions; the single-role names are removed).
  - `AuthService.impersonate(actorId: string, actorRoles: readonly UserRole[], target, reason?, ip?)` — second parameter becomes the roles list.

**Main-role uses that stay as they are (do not change):** `auth.service.ts:275` (registration creates a LICENSEE), `ImpersonationLog.actorRole` (`actor.role`, ~481), the log line ~501, `admin-clubs.service.ts:159` (session revoke on club disable: main-role CLUB only, see Global Constraints), `admin-user-accounts.service.ts:181-196` (creation validates the main role of the new account), `auth.service.ts:362/388` and `auth-token.service.ts:113/128` (`role` claim and response field = main role; `roles` is added in Task 5).

- [ ] **Step 1: Write the failing unit tests**

`notification-catalog.spec.ts`:

```ts
it('offers the switches of every role the account holds', () => {
  const types = configurableTypesForRoles([UserRole.LICENSEE, UserRole.ADMIN]);
  expect(types).toEqual(
    expect.arrayContaining([
      ...configurableTypesForRoles([UserRole.LICENSEE]),
      ...configurableTypesForRoles([UserRole.ADMIN]),
    ]),
  );
});
```

`tracks.controller.spec.ts`:

```ts
it('shows hidden tracks to an account whose ADMIN role is an extra role', async () => {
  await controller.findAll(pagination, {
    user: {
      userId: 'u1',
      email: 'a@x.fr',
      role: 'LICENSEE',
      roles: [UserRole.LICENSEE, UserRole.ADMIN],
    },
  } as RequestWithUser);
  expect(tracksService.findAll).toHaveBeenCalledWith(pagination, true);
});
```

(Use the file's existing `pagination` / request fixtures and method signature.)

`auth.service.spec.ts` (impersonation block):

```ts
it('refuses to impersonate an account whose ADMIN role is an extra role', async () => {
  prisma.user.findUnique.mockResolvedValueOnce({
    ...targetRow,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.ADMIN],
  });
  await expect(service.impersonate('admin-1', [UserRole.ADMIN], { userId: 't1' })).rejects.toThrow(
    "Impossible d'impersonner un administrateur.",
  );
});

it('refuses a staff actor targeting an account with an extra STAFF role', async () => {
  prisma.user.findUnique.mockResolvedValueOnce({
    ...targetRow,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.STAFF],
  });
  await expect(
    service.impersonate('staff-1', [UserRole.STAFF], { userId: 't1' }, 'support'),
  ).rejects.toThrow("Un staff ne peut cibler qu'un licencié ou un club.");
});

it('applies the admin rules to an actor holding ADMIN and STAFF', async () => {
  prisma.user.findUnique.mockResolvedValueOnce({
    ...targetRow,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.STAFF],
  });
  await expect(
    service.impersonate('a1', [UserRole.STAFF, UserRole.ADMIN], { userId: 't1' }),
  ).resolves.toHaveProperty('access_token');
});
```

(`targetRow` = the file's existing happy-path target fixture. Update the existing impersonation tests to pass `[UserRole.ADMIN]` / `[UserRole.STAFF]` instead of the role string.)

- [ ] **Step 2: Write the failing real-DB test**

```ts
// apps/backend/test/multi-role.integration-spec.ts
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { withRole } from '../src/auth/roles';
import { PartnershipQueryService } from '../src/clubs/partnership-query.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildServiceModule } from './integration-app.builder';

describe('Multi-role (integration, real DB)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let partnerships: PartnershipQueryService;
  const userIds: string[] = [];
  const clubIds: string[] = [];

  const user = async (o: { role: UserRole; extraRoles?: UserRole[]; clubId?: string }) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: 'x',
        firstName: 'Test',
        lastName: 'User',
        role: o.role,
        extraRoles: o.extraRoles ?? [],
        ...(o.clubId && { clubId: o.clubId }),
      },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    partnerships = moduleRef.get(PartnershipQueryService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    userIds.length = 0;
    clubIds.length = 0;
  });

  afterAll(() => moduleRef.close());

  it('withRole matches main and extra roles in Postgres', async () => {
    const main = await user({ role: UserRole.CLUB });
    const extra = await user({ role: UserRole.LICENSEE, extraRoles: [UserRole.CLUB] });
    const neither = await user({ role: UserRole.LICENSEE });
    const found = await prisma.user.findMany({
      where: { AND: [withRole(UserRole.CLUB), { id: { in: [main, extra, neither] } }] },
      select: { id: true },
      take: 10,
    });
    expect(found.map((u) => u.id).sort()).toEqual([main, extra].sort());
  });

  it("a licensee with an extra CLUB role lists their club's dancers, themselves included", async () => {
    const club = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
      select: { id: true },
    });
    clubIds.push(club.id);
    const other = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
      select: { id: true },
    });
    clubIds.push(other.id);
    const rep = await user({
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
      clubId: club.id,
    });
    const dancer = await user({ role: UserRole.LICENSEE, clubId: club.id });
    const clubMainWithDancer = await user({
      role: UserRole.CLUB,
      extraRoles: [UserRole.LICENSEE],
      clubId: club.id,
    });
    const elsewhere = await user({ role: UserRole.LICENSEE, clubId: other.id });

    const members = await partnerships.getMembersForPartnership(rep);
    const ids = members.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([rep, dancer, clubMainWithDancer]));
    expect(ids).not.toContain(elsewhere);
  });
});
```

If `Club.create` needs more required fields than `name`, copy them from `admin.integration-spec.ts`. If `getMembersForPartnership` returns a different shape, adapt the `map` to it (read the method first).

- [ ] **Step 3: Run them and see them fail**

Unit: `pnpm --filter backend exec jest src/notifications src/tracks src/track-corrections src/auth/auth.service.spec.ts` → new tests FAIL.
Real DB (see "How to run tests"; `prisma migrate deploy` first): `pnpm exec jest --config test/jest-integration.json --runInBand --forceExit multi-role.integration-spec` → the members test FAILS (`clubMainWithDancer` missing, since the filter is still `role: LICENSEE`).

- [ ] **Step 4: Implement**

Filters. A `where` without `OR` spreads the filter:

```ts
// competition-event-notification.service.ts
      const licensees = await this.prisma.user.findMany({
        where: withRole(UserRole.LICENSEE),
```

```ts
// track-corrections.service.ts
        where: withRole(UserRole.ADMIN),
```

```ts
// registration-notification.service.ts
      where: { AND: [withRole(UserRole.CLUB), sameClubCondition] },
```

A `where` with `OR` wraps both in `AND`:

```ts
// partnership-query.service.ts
    const members = await this.prisma.user.findMany({
      where: {
        AND: [withRole(UserRole.LICENSEE), { OR: orConditions }],
      },
```

```ts
// partnership.service.ts (~374): replace `role: "CLUB" as const,` and the sibling `OR: [...]`
      where: {
        AND: [withRole(UserRole.CLUB), { OR: [ /* the existing club conditions, unchanged */ ] }],
      },
```

```ts
// career.service.ts
      where: {
        AND: [
          withRole(UserRole.LICENSEE),
          {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
            ],
          },
        ],
      },
```

`users.service.ts:~151,~157`: replace each `role: UserRole.LICENSEE,` with `...withRole(UserRole.LICENSEE),` **only if** that object has no other `OR`; otherwise use the `AND` form above. Read both sites before editing.

Admin-only views: in the three controllers, replace `req.user.role === "ADMIN"` / `req.user.role === UserRole.ADMIN` with `hasRole(req.user, UserRole.ADMIN)`.

Notification preferences (`notification-catalog.ts`):

```ts
/** Does this type address at least one of the caller's roles? Unknown roles match nothing. */
export const isApplicableToRoles = (type: NotificationType, roles: readonly string[]): boolean =>
  roles.some((role) => (NOTIFICATION_CATALOG[type].roles as readonly string[]).includes(role));

export const configurableTypesForRoles = (roles: readonly string[]): readonly NotificationType[] =>
  CONFIGURABLE_NOTIFICATION_TYPES.filter((type) => isApplicableToRoles(type, roles));
```

Keep the existing French doc comment above them (adapted to "rôles"). Update the comments at catalog lines ~105/118/130/139 from `where: { role: X }` to `withRole(X)`. Rename the `role: string` parameter of `getCatalogForUser` and `setPreference` to `roles: readonly string[]`, call the new helpers, and pass `req.user.roles` from `notifications.controller.ts`. Update their specs (pass `[role]`).

Impersonation (`auth.service.ts`), signature and checks:

```ts
  async impersonate(
    actorId: string,
    actorRoles: readonly UserRole[],
    // … unchanged
  ) {
    const actorIsAdmin = actorRoles.includes(UserRole.ADMIN);
    if (!actorIsAdmin && !actorRoles.includes(UserRole.STAFF)) {
      // keep the existing exception and message
    }
    // target lookup: add `extraRoles: true` to its select
    // …
    if (hasRole(targetUser, UserRole.ADMIN)) {
      throw new ForbiddenException(
        "Impossible d'impersonner un administrateur.",
      );
    }
    if (!actorIsAdmin) {
      if (hasRole(targetUser, UserRole.STAFF)) {
        throw new ForbiddenException(
          "Un staff ne peut cibler qu'un licencié ou un club.",
        );
      }
      if (!reason?.trim()) {
        throw new BadRequestException(
          "Une raison est obligatoire pour le staff.",
        );
      }
    }
```

The log line uses `actorRoles.join("+")`. `auth.controller.ts` passes `req.user.roles`. If the target select is a shared constant, add `extraRoles: true` to it there.

- [ ] **Step 5: Run the tests**

Unit: `pnpm --filter backend exec jest src` → PASS. Real DB: the integration spec → PASS. `tsc --noEmit` clean. Then a last grep, which must print only the intentional main-role sites listed above:

```bash
grep -rnE "\.role ?(===|!==)|role: ?UserRole\.|role: ?\"(ADMIN|CLUB|STAFF|LICENSEE)\"" apps/backend/src | grep -vE "\.spec\.|dto\.ts"
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src apps/backend/test/multi-role.integration-spec.ts
git commit -m "feat(auth): apply extra roles to filters, notifications and impersonation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `roles` in login, refresh and profile responses

**Files:**

- Modify: `apps/backend/src/auth/auth.service.ts` (`LoginResponse`, `login`, impersonation response `user`)
- Modify: `apps/backend/src/auth/auth-token.service.ts` (refresh select + response)
- Modify: `apps/backend/src/users/users.service.ts` (`USER_BASE_SELECT`, `findOne`)
- Modify: `apps/backend/src/users/users.controller.ts` (Swagger schema of `GET /users/me`: add `roles`)
- Modify: the user lookup feeding `login` (`auth.service.ts` `validateUser` or equivalent): add `extraRoles: true` and `club: { select: { disabledAt: true } }` if absent
- Test: `auth.service.spec.ts`, `auth-token.service.spec.ts`, `users.service.spec.ts`

**Interfaces:**

- Consumes: `rolesOf` (Task 1).
- Produces: `LoginResponse.user.roles: UserRole[]`; `GET /users/me` → `roles: UserRole[]`; refresh response `user.roles`; impersonation response `user.roles`. `role` unchanged everywhere.

- [ ] **Step 1: Write the failing tests**

```ts
// auth.service.spec.ts
it('login returns the main role and every role', async () => {
  const res = await service.login({
    ...loginUser,
    role: UserRole.ADMIN,
    extraRoles: [UserRole.LICENSEE],
  });
  expect(res.user.role).toBe(UserRole.ADMIN);
  expect(res.user.roles).toEqual([UserRole.ADMIN, UserRole.LICENSEE]);
});

it('login of a single-role account returns roles = [role] (old apps unaffected)', async () => {
  const res = await service.login({ ...loginUser, role: UserRole.LICENSEE, extraRoles: [] });
  expect(res.user).toMatchObject({ role: UserRole.LICENSEE, roles: [UserRole.LICENSEE] });
});
```

```ts
// users.service.spec.ts
it('findOne adds roles next to role', async () => {
  prisma.user.findUnique.mockResolvedValue({
    ...profileRow,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.CLUB],
    club: { disabledAt: null },
  });
  await expect(service.findOne('u1')).resolves.toMatchObject({
    role: UserRole.LICENSEE,
    roles: [UserRole.LICENSEE, UserRole.CLUB],
  });
});
```

Same shape for the refresh response in `auth-token.service.spec.ts`. (`loginUser` / `profileRow` = the files' existing fixtures.)

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter backend exec jest src/auth/auth.service.spec.ts src/auth/auth-token.service.spec.ts src/users/users.service.spec.ts` → FAIL (`roles` undefined).

- [ ] **Step 3: Implement**

`LoginResponse.user` gains `roles: UserRole[];`. In `login`, in the refresh response and in the impersonation response `user`: `roles: rolesOf(user),` right after `role: user.role,`. The `login` parameter type gains `extraRoles?: UserRole[]` and `club?: { disabledAt: Date | null } | null`; the refresh select (`tokenRecord.user.select`) gains `extraRoles: true` (it already has `club` for the block check — if not, add `club: { select: { disabledAt: true } }`). `USER_BASE_SELECT` gains `extraRoles: true`; `findOne` selects `club: { select: { disabledAt: true } }` too and returns `{ ...rest, roles: rolesOf(user) }` without the `club` status object (destructure it out so the response shape only gains `extraRoles` and `roles`). In the `GET /users/me` Swagger schema add:

```ts
        roles: {
          type: "array",
          items: { type: "string", enum: ["LICENSEE", "CLUB", "STAFF", "ADMIN"] },
          description: "Rôle principal + rôles supplémentaires (multi-profil)",
        },
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter backend exec jest src/auth src/users` → PASS; then the mocked e2e `auth.e2e-spec auth-additional.e2e-spec` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src
git commit -m "feat(auth): return every role in login, refresh and profile

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Admin API — edit extra roles, list and club counts

**Files:**

- Modify: `apps/backend/src/admin/dto/update-admin-user.dto.ts` (add `extraRoles`)
- Modify: `apps/backend/src/admin/dto/admin-users.dto.ts` (`AdminUserListItemDto`: `extraRoles`, `roles`)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminUserEditableSelect` + the list/detail selects used by `admin-users.query-service.ts`: add `extraRoles: true`)
- Modify: `apps/backend/src/admin/admin-users.service.ts` (`update`)
- Modify: `apps/backend/src/admin/admin-users.query-service.ts` (filter ~53, mapping)
- Modify: `apps/backend/src/admin/admin-clubs.query-service.ts:~110-122` and `apps/backend/src/admin/admin-club-usage.ts:~29-34`
- Test: `update-admin-user.dto.spec.ts`, `admin-users.service.spec.ts`, `admin-users.query-service.spec.ts`, `admin-clubs.query-service.spec.ts`, the spec covering `clubUsage`, `test/admin.integration-spec.ts`

**Interfaces:**

- Consumes: `normalizeExtraRoles`, `rolesOf`, `withRole` (Task 1).
- Produces: `PATCH /admin/users/:id` body `extraRoles?: UserRole[]`; list/detail items `extraRoles: UserRole[]`, `roles: UserRole[]`.

- [ ] **Step 1: Write the failing tests**

DTO:

```ts
it('accepts a list of known roles and rejects an unknown one', async () => {
  expect(await errorsOf({ extraRoles: ['CLUB', 'STAFF'] })).toEqual([]);
  expect(await errorsOf({ extraRoles: ['ROOT'] })).toContain('extraRoles');
  expect(await errorsOf({ extraRoles: 'CLUB' })).toContain('extraRoles');
});
```

Service (`admin-users.service.spec.ts`, using its transaction mock):

```ts
it('stores normalised extra roles and audits them in USER_UPDATE', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    role: UserRole.LICENSEE,
    extraRoles: [],
    clubId: 'c1',
  });
  await service.update('admin-1', 'u1', {
    extraRoles: [UserRole.STAFF, UserRole.LICENSEE, UserRole.CLUB],
  });
  expect(tx.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { extraRoles: [UserRole.CLUB, UserRole.STAFF] } }),
  );
  expect(audit.record).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      action: 'USER_UPDATE',
      before: { extraRoles: [] },
      after: { extraRoles: [UserRole.CLUB, UserRole.STAFF] },
    }),
  );
});

it('drops an extra role that becomes the main role', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.CLUB],
    clubId: 'c1',
  });
  await service.update('admin-1', 'u1', { role: UserRole.CLUB });
  expect(tx.user.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { role: UserRole.CLUB, extraRoles: [] } }),
  );
});

it('lets an admin add an extra role to their own account', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    id: 'admin-1',
    role: UserRole.ADMIN,
    extraRoles: [],
  });
  await expect(
    service.update('admin-1', 'admin-1', { extraRoles: [UserRole.LICENSEE] }),
  ).resolves.toBeDefined();
});

it('refuses an admin removing their own ADMIN extra role', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    id: 'admin-1',
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.ADMIN],
  });
  await expect(service.update('admin-1', 'admin-1', { extraRoles: [] })).rejects.toThrow(
    'Un administrateur ne peut pas retirer son propre rôle Admin',
  );
});

it('refuses an extra CLUB role without a club', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    role: UserRole.LICENSEE,
    extraRoles: [],
    clubId: null,
  });
  await expect(service.update('admin-1', 'u1', { extraRoles: [UserRole.CLUB] })).rejects.toThrow(
    'Un rôle Club supplémentaire nécessite un club',
  );
});

it('refuses removing the club of an account that keeps an extra CLUB role', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.CLUB],
    clubId: 'c1',
  });
  await expect(service.update('admin-1', 'u1', { clubId: null })).rejects.toThrow(
    'Un rôle Club supplémentaire nécessite un club',
  );
});

it('writes nothing when the normalised list is unchanged', async () => {
  tx.user.findUnique.mockResolvedValue({
    ...editable,
    role: UserRole.LICENSEE,
    extraRoles: [UserRole.STAFF],
  });
  await service.update('admin-1', 'u1', { extraRoles: [UserRole.STAFF, UserRole.LICENSEE] });
  expect(tx.user.update).not.toHaveBeenCalled();
});
```

Query service:

```ts
it('filters on main and extra roles', async () => {
  await service.list({ role: UserRole.CLUB, skip: 0, take: 20 } as ListAdminUsersQueryDto);
  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([withRole(UserRole.CLUB)]) }),
    }),
  );
});

it('returns extraRoles and roles on each item', async () => {
  prisma.user.findMany.mockResolvedValue([
    { ...row, role: UserRole.LICENSEE, extraRoles: [UserRole.CLUB] },
  ]);
  const page = await service.list({ skip: 0, take: 20 } as ListAdminUsersQueryDto);
  expect(page.data[0]).toMatchObject({
    extraRoles: [UserRole.CLUB],
    roles: [UserRole.LICENSEE, UserRole.CLUB],
  });
});
```

(Use the file's real method names and fixtures; the paginated payload key may be `items` rather than `data` — read the file.)

Club counts: `clubUsage` and the clubs list count an account with `extraRoles: [CLUB]` as a club account, not a member:

```ts
it('counts an extra CLUB role as a club account', async () => {
  db.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
  const usage = await clubUsage(db, { id: 'c1', name: 'Club A' });
  expect(db.user.count).toHaveBeenNthCalledWith(1, {
    where: { clubId: 'c1', NOT: withRole(UserRole.CLUB) },
  });
  expect(db.user.count).toHaveBeenNthCalledWith(2, {
    where: { clubId: 'c1', ...withRole(UserRole.CLUB) },
  });
  expect(usage).toMatchObject({ memberCount: 3, clubAccountCount: 2 });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter backend exec jest src/admin` → new tests FAIL.

- [ ] **Step 3: Implement**

DTO (`update-admin-user.dto.ts`, after `role`; import `IsArray`, `ArrayUnique`):

```ts
  @ApiPropertyOptional({
    enum: UserRole,
    enumName: "UserRole",
    isArray: true,
    description: "Rôles supplémentaires (le rôle principal en est retiré)",
  })
  @ValidateIf(notUndefined)
  @IsArray()
  @ArrayUnique()
  @IsEnum(UserRole, { each: true })
  extraRoles?: UserRole[];
```

`admin-users.dto.ts`, `AdminUserListItemDto`:

```ts
  @ApiProperty({ enum: UserRole, enumName: "UserRole", isArray: true })
  extraRoles!: UserRole[];
  @ApiProperty({ enum: UserRole, enumName: "UserRole", isArray: true, description: "Rôle principal + rôles supplémentaires" })
  roles!: UserRole[];
```

`admin-users.service.ts` `update`, inside the transaction, after the `clubId` block and before `diffFields`:

```ts
const finalRole = (requested.role as UserRole | undefined) ?? current.role;
const finalExtras = normalizeExtraRoles(
  finalRole,
  (requested.extraRoles as UserRole[] | undefined) ?? current.extraRoles,
);
if (dto.extraRoles !== undefined || finalExtras.length !== current.extraRoles.length) {
  requested.extraRoles = finalExtras;
}
const finalClubId = dto.clubId !== undefined ? dto.clubId : current.clubId;
if (finalExtras.includes(UserRole.CLUB) && !finalClubId) {
  throw new BadRequestException('Un rôle Club supplémentaire nécessite un club');
}
if (
  actorId === userId &&
  !rolesOf({ role: finalRole, extraRoles: finalExtras }).includes(UserRole.ADMIN)
) {
  throw new ForbiddenException('Un administrateur ne peut pas retirer son propre rôle Admin');
}
```

`diffFields` compares with `JSON.stringify`, so an unchanged normalised list writes and audits nothing. `roleChanged` stays tied to `role` only (extra roles apply on the next request through `JwtStrategy`, no session revoke). Add `extraRoles: true` to `adminUserEditableSelect`.

`admin-users.query-service.ts`: replace `...(q.role && { role: q.role })` with an `AND` entry `withRole(q.role)` (build `const and: Prisma.UserWhereInput[] = []` and push it next to the existing conditions if the `where` already mixes several filters; keep the other filters as they are). Add `extraRoles: true` to its selects and map `roles: rolesOf(u)` on list items and detail (detail: `rolesOf({ role, extraRoles })` without the club status, so a disabled club still shows the stored extra role in the back-office).

`admin-club-usage.ts`:

```ts
const memberCount = await db.user.count({
  where: { clubId: club.id, NOT: withRole(UserRole.CLUB) },
});
const clubAccountCount = await db.user.count({
  where: { clubId: club.id, ...withRole(UserRole.CLUB) },
});
```

`admin-clubs.query-service.ts`: `groupBy` cannot group on an array membership. Replace the `groupBy` with two `groupBy({ by: ["clubId"], … _count })` calls, one `where: { clubId: { in: ids }, ...withRole(UserRole.CLUB) }` (club accounts) and one `where: { clubId: { in: ids }, NOT: withRole(UserRole.CLUB) }` (members), then fill `counts` from each.

Extend `test/admin.integration-spec.ts` with one real-DB case: create a `LICENSEE` with a club, `service.update(admin, u, { extraRoles: [UserRole.CLUB] })`, then `strategy.validate({ sub: u, … })` returns `roles: [LICENSEE, CLUB]`; then deactivate the club with the lot 1b `AdminClubsService` status method and `validate` again returns `roles: [LICENSEE]` and does not throw.

- [ ] **Step 4: Run the tests**

Unit: `pnpm --filter backend exec jest src/admin` → PASS. Real DB: `admin.integration-spec multi-role.integration-spec` → PASS. Mocked e2e `admin.e2e-spec` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): edit extra roles and count them on club pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Swagger and generated clients

**Files:**

- Modify: `apps/docs/public/swagger.json` (and wherever `pnpm api:sync` writes, e.g. `apps/client/src/api/generated/`)
- Regenerate (gitignored): `apps/admin/src/api/generated/`

- [ ] **Step 1: Export and regenerate**

```bash
cd apps/backend && pnpm run build && node scripts/export-swagger.js && cd ../..
pnpm api:sync
pnpm --filter admin exec openapi-ts
```

If `pnpm api:sync` fails from the root (lot 1b note), copy `apps/backend/swagger.json` to `apps/docs/public/swagger.json` by hand and run Prettier on both, then run the client generator the script calls.

- [ ] **Step 2: Check the diff**

`git diff --stat` shows only swagger files and the client's generated folder. `grep -n "extraRoles" apps/docs/public/swagger.json` lists the update DTO and the list item. `pnpm --filter admin exec tsc --noEmit` and `pnpm --filter client exec tsc --noEmit` pass.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/public/swagger.json apps/backend/swagger.json apps/client/src/api/generated
git commit -m "chore(api): sync swagger for multi-profile

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

(`git add` only the paths that exist and changed.) The `backend-build` CI job checks swagger freshness: this commit must be the last API-shape change, so redo it if a later task touches a DTO.

---

### Task 8: Back-office — extra roles on the user page and in the list

**Files:**

- Modify: `apps/admin/src/lib/diff.ts` (`EditableFields.extraRoles`, array comparison)
- Modify: `apps/admin/src/lib/labels.ts` (`extraRoleLabels`)
- Modify: `apps/admin/src/pages/UserDetailPage.tsx`
- Modify: `apps/admin/src/pages/UsersPage.tsx:~160-170`
- Test: `apps/admin/src/lib/diff.test.ts`, `apps/admin/src/pages/UserDetailPage.test.tsx`, `apps/admin/src/pages/UsersPage.test.tsx`

**Interfaces:**

- Consumes: generated `AdminUserDetailDto.extraRoles`, `.roles`; `adminControllerUpdateUser` body `extraRoles` (Task 7).
- Produces: `EditableFields.extraRoles: string[]`; `extraRoleLabels(extraRoles: readonly UserRole[]): string[]` → `['+ Club', '+ Staff']`.

- [ ] **Step 1: Write the failing tests**

`diff.test.ts`:

```ts
it('treats extra roles as a set compared by value', () => {
  const a = { ...base, extraRoles: ['CLUB'] };
  expect(changedFields(a, { ...a, extraRoles: ['CLUB'] })).toEqual({});
  expect(changedFields(a, { ...a, extraRoles: ['STAFF', 'CLUB'] })).toEqual({
    extraRoles: ['STAFF', 'CLUB'],
  });
  expect(changedFields(a, { ...a, extraRoles: [] })).toEqual({ extraRoles: [] });
});
```

(`base` = the file's existing fixture; add `extraRoles: []` to it.)

`UserDetailPage.test.tsx` (add `extraRoles: []`, `roles: ['LICENSEE']` to `detail`):

```tsx
it('saves extra roles after the confirmation', async () => {
  const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
    data: { ...detail, extraRoles: ['CLUB'], roles: ['LICENSEE', 'CLUB'] },
    error: undefined,
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Club' }));
  await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Rôles supplémentaires');
  await userEvent.click(screen.getByRole('button', { name: /confirmer/i }));
  expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { extraRoles: ['CLUB'] } });
});

it('does not offer the main role as an extra role', async () => {
  renderPage();
  await screen.findByRole('checkbox', { name: 'Club' });
  expect(screen.queryByRole('checkbox', { name: 'Licencié' })).not.toBeInTheDocument();
});

it("locks the admin's own ADMIN extra role", async () => {
  vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
    data: {
      ...detail,
      id: 'admin-1',
      role: 'LICENSEE',
      extraRoles: ['ADMIN'],
      roles: ['LICENSEE', 'ADMIN'],
    },
    error: undefined,
  } as never);
  renderPage();
  expect(await screen.findByRole('checkbox', { name: 'Admin' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Club' })).toBeEnabled();
});
```

(The existing tests already set the session user to `admin-1`; check `renderPage` / `beforeEach` and reuse it.)

`UsersPage.test.tsx`:

```tsx
it('shows a badge per extra role', async () => {
  mockList([{ ...row, role: 'LICENSEE', extraRoles: ['CLUB'], roles: ['LICENSEE', 'CLUB'] }]);
  renderPage();
  expect(await screen.findByText('Licencié')).toBeInTheDocument();
  expect(screen.getByText('+ Club')).toBeInTheDocument();
});
```

(`mockList` / `row` = the file's existing list mock and fixture; reuse them.)

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter admin test -- src/lib/diff.test.ts src/pages/UserDetailPage.test.tsx src/pages/UsersPage.test.tsx` → new tests FAIL.

- [ ] **Step 3: Implement**

`diff.ts`: add `extraRoles: string[];` to `EditableFields`, and compare by value:

```ts
const norm = (v: unknown) => (v === '' || v === undefined ? null : v);
const same = (a: unknown, b: unknown) =>
  Array.isArray(a) || Array.isArray(b)
    ? JSON.stringify([...((a as string[]) ?? [])].sort()) ===
      JSON.stringify([...((b as string[]) ?? [])].sort())
    : norm(a) === norm(b);

export function changedFields(
  initial: EditableFields,
  current: EditableFields,
): Partial<EditableFields> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof EditableFields)[]) {
    if (!same(initial[key], current[key])) out[key] = norm(current[key]);
  }
  return out as Partial<EditableFields>;
}
```

`labels.ts`:

```ts
export const extraRoleLabels = (extraRoles: readonly UserRole[]): string[] =>
  extraRoles.map((r) => `+ ${ROLE_LABELS[r]}`);
```

`UserDetailPage.tsx`:

- `initial` and `initialValues` get `extraRoles: u.extraRoles` / `extraRoles: []`.
- After the "Rôle" `Select`, inside the same form (import `Checkbox` from `@mantine/core`, `ROLE_LABELS` from `../lib/labels`, `UserRole` type from the generated types):

```tsx
<Checkbox.Group
  label="Rôles supplémentaires"
  description="Droits cumulés avec le rôle principal"
  {...form.getInputProps('extraRoles')}
>
  <Group mt="xs">
    {(Object.keys(ROLE_LABELS) as UserRole[])
      .filter((r) => r !== form.values.role)
      .map((r) => (
        <Checkbox
          key={r}
          value={r}
          label={ROLE_LABELS[r]}
          disabled={isSelf && r === 'ADMIN' && u.role !== 'ADMIN'}
        />
      ))}
  </Group>
</Checkbox.Group>
```

- When the main role select changes to a role in `extraRoles`, remove it from the list: override the Select's `onChange` after the spread:

```tsx
            {...form.getInputProps('role')}
            onChange={(v) => {
              form.setFieldValue('role', v ?? '');
              form.setFieldValue(
                'extraRoles',
                form.values.extraRoles.filter((r) => r !== v),
              );
            }}
```

- `displayBefore` and the `ChangeSummary` `after` map: for `extraRoles`, render the `ROLE_LABELS` of the list joined by `, ` (empty list → `—`), and show the key as `Rôles supplémentaires` (follow how `ChangeSummary` labels keys; add `extraRoles: 'Rôles supplémentaires'` to its label map if it has one).
- Errors keep the lot 1b handling (the shared unreachable message and the API message via `apiError`).

`UsersPage.tsx`, in place of the single role badge:

```tsx
<Group gap={4}>
  <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>
  {extraRoleLabels(u.extraRoles).map((l) => (
    <Badge key={l} variant="outline" size="sm">
      {l}
    </Badge>
  ))}
</Group>
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter admin test` → PASS; `pnpm --filter admin exec tsc --noEmit`; `pnpm --filter admin lint`; `pnpm --filter admin build`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src
git commit -m "feat(admin): edit extra roles from the user page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Mobile app — roles, space selector, actions across spaces

**Files:**

- Modify: `apps/client/src/features/auth/services/AuthService.ts` (`AuthConfig`, `UserProfile`, `LoginResponse` types, `login`, `register`, `impersonate`, `logout`; add `resolveSpace`, `setActiveSpace`)
- Modify: `apps/client/src/features/auth/hooks/useLoginLogic.ts:~100-112` (biometric restore)
- Modify: `apps/client/src/stores/auth.store.ts`
- Create: `apps/client/src/features/settings/components/SpaceSelector.tsx`
- Modify: `apps/client/src/features/settings/screens/SettingsScreen.tsx` (selector; admin blocks → `hasRole`)
- Modify: `apps/client/src/features/player/screens/LibraryScreen.tsx:59`, `apps/client/src/features/player/screens/AudioPlayerScreen.tsx:53`, `apps/client/src/features/track-corrections/screens/TrackCorrectionsReviewScreen.tsx:60`
- Test: `apps/client/src/stores/__tests__/auth.store.test.ts` (create), `apps/client/src/features/auth/services/__tests__/AuthService.test.ts`, `apps/client/src/features/settings/components/__tests__/SpaceSelector.test.tsx` (create), the existing `LibraryScreen` test file (or create `apps/client/src/features/player/screens/__tests__/LibraryScreen.roles.test.tsx`)

**Interfaces:**

- Consumes: `roles` on login / `/users/me` / impersonation responses (Task 5).
- Produces:
  - `AuthConfig.roles?: UserRole[]`, `AuthConfig.mainRole?: UserRole`; `AuthConfig.role` = active space.
  - `resolveSpace(o: { previousSpace?: UserRole; previousUser?: string; user: string; mainRole: UserRole; roles: UserRole[] }): UserRole`
  - `AuthService.setActiveSpace(space: UserRole): Promise<void>` (no-op if `space` is not in `roles`).
  - `useAuthStore` state: `roles: AuthRole[]`, `mainRole: AuthRole | null`, `hasRole(role: AuthRole): boolean`.
  - `SPACE_LABELS: Record<"LICENSEE" | "CLUB" | "STAFF" | "ADMIN", string>` = `{ LICENSEE: "Danseur", CLUB: "Club", STAFF: "Staff", ADMIN: "Admin" }`.

**Screens deliberately left on `role` (= the space):** `MainTabs`, `CompetitionsScreen`, `CompetitionDetailScreen`, `useCompetitionsLogic`, `useCompetitionDetailLogic`, `useLicenseLogic`, `SettingsProfileSection`, the CLUB / LICENSEE sections of `SettingsScreen`, `useSettingsLogic` (HelloAsso block: shown in the CLUB or ADMIN space as today). Sentry / log tags keep `profile.role` (main role).

- [ ] **Step 1: Write the failing tests**

`AuthService.test.ts`:

```ts
describe('resolveSpace', () => {
  const base = {
    user: 'a@x.fr',
    mainRole: 'ADMIN' as const,
    roles: ['ADMIN', 'LICENSEE'] as UserRole[],
  };

  it('defaults to the main role', () => {
    expect(resolveSpace(base)).toBe('ADMIN');
  });

  it('keeps the previous space of the same account', () => {
    expect(resolveSpace({ ...base, previousUser: 'a@x.fr', previousSpace: 'LICENSEE' })).toBe(
      'LICENSEE',
    );
  });

  it('ignores the previous space of another account', () => {
    expect(resolveSpace({ ...base, previousUser: 'b@x.fr', previousSpace: 'LICENSEE' })).toBe(
      'ADMIN',
    );
  });

  it('falls back to the main role when the space was removed', () => {
    expect(resolveSpace({ ...base, previousUser: 'a@x.fr', previousSpace: 'CLUB' })).toBe('ADMIN');
  });
});

it('login stores every role and the main role, and keeps role = active space', async () => {
  mockedApi.post.mockResolvedValueOnce({
    data: {
      access_token: 't',
      refresh_token: 'r',
      user: { ...loginUser, role: 'ADMIN', roles: ['ADMIN', 'LICENSEE'] },
    },
  });
  await AuthService.login('a@x.fr', 'pw');
  const saved = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]);
  expect(saved).toMatchObject({ role: 'ADMIN', mainRole: 'ADMIN', roles: ['ADMIN', 'LICENSEE'] });
});

it('login against an older backend without roles stores [role]', async () => {
  mockedApi.post.mockResolvedValueOnce({
    data: { access_token: 't', refresh_token: 'r', user: { ...loginUser, role: 'LICENSEE' } },
  });
  await AuthService.login('a@x.fr', 'pw');
  const saved = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)[1]);
  expect(saved).toMatchObject({ role: 'LICENSEE', roles: ['LICENSEE'] });
});
```

(`mockedApi` / `loginUser` = the file's existing mocks; follow how the file inspects the saved config if it differs.)

`auth.store.test.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../auth.store';

describe('auth.store roles', () => {
  it('hydrates roles and answers hasRole across spaces', async () => {
    await AsyncStorage.setItem(
      'auth_config',
      JSON.stringify({
        isLoggedIn: true,
        role: 'LICENSEE',
        mainRole: 'ADMIN',
        roles: ['ADMIN', 'LICENSEE'],
      }),
    );
    await useAuthStore.getState().refreshAuth();
    const s = useAuthStore.getState();
    expect(s.role).toBe('LICENSEE');
    expect(s.hasRole('ADMIN')).toBe(true);
    expect(s.hasRole('CLUB')).toBe(false);
  });

  it('falls back to [role] when roles are missing', async () => {
    await AsyncStorage.setItem('auth_config', JSON.stringify({ isLoggedIn: true, role: 'CLUB' }));
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState().roles).toEqual(['CLUB']);
  });

  it('falls back to the main role when the stored space is no longer held', async () => {
    await AsyncStorage.setItem(
      'auth_config',
      JSON.stringify({ isLoggedIn: true, role: 'CLUB', mainRole: 'LICENSEE', roles: ['LICENSEE'] }),
    );
    await useAuthStore.getState().refreshAuth();
    expect(useAuthStore.getState().role).toBe('LICENSEE');
  });
});
```

`SpaceSelector.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SpaceSelector } from '../SpaceSelector';

describe('SpaceSelector', () => {
  it('renders nothing for a single-role account', () => {
    render(<SpaceSelector roles={['LICENSEE']} space="LICENSEE" onChange={jest.fn()} />);
    expect(screen.queryByText('Espace')).toBeNull();
  });

  it('lists one option per role and reports the choice', () => {
    const onChange = jest.fn();
    render(<SpaceSelector roles={['ADMIN', 'LICENSEE']} space="ADMIN" onChange={onChange} />);
    expect(screen.getByText('Espace')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Danseur' }));
    expect(onChange).toHaveBeenCalledWith('LICENSEE');
  });

  it('marks the active space as selected', () => {
    render(<SpaceSelector roles={['ADMIN', 'LICENSEE']} space="ADMIN" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Admin' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });
});
```

Library (pins the "action across spaces" rule): render `LibraryScreen` with the store set to `{ role: "LICENSEE", roles: ["ADMIN", "LICENSEE"] }` and assert that the admin edit entry point (the element rendered under `isAdmin`; read `LibraryScreen.tsx` around line 59 to find it and its `testID` or label) is present; with `roles: ["LICENSEE"]` it is absent. Reuse the existing `LibraryScreen` test setup (providers, MSW handlers) if there is one.

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter client exec jest src/features/auth src/stores src/features/settings/components src/features/player` → new tests FAIL.

- [ ] **Step 3: Implement**

`AuthService.ts`:

- `AuthConfig`: after `role: UserRole;` add

```ts
  /** Every role of the account (lot 1c). `role` above is the active space. */
  roles?: UserRole[];
  /** Main role of the account, the default space. */
  mainRole?: UserRole;
```

- `UserProfile`, `LoginResponse.user` and the impersonation response type gain `roles?: UserRole[];`.
- Export:

```ts
/** Which space to open: the previous one of the same account if still held, else the main role. */
export function resolveSpace(o: {
  previousSpace?: UserRole;
  previousUser?: string;
  user: string;
  mainRole: UserRole;
  roles: UserRole[];
}): UserRole {
  return o.previousUser === o.user && o.previousSpace && o.roles.includes(o.previousSpace)
    ? o.previousSpace
    : o.mainRole;
}

const rolesFrom = (u: { role: UserRole; roles?: UserRole[] }): UserRole[] =>
  u.roles?.length ? u.roles : [u.role];
```

- In `login` and `register`: `const roles = rolesFrom(user);` then in `newConfig` replace `role: user.role,` with

```ts
        role: resolveSpace({
          previousSpace: currentConfig.role,
          previousUser: currentConfig.username,
          user: user.email,
          mainRole: user.role,
          roles,
        }),
        roles,
        mainRole: user.role,
```

- In `impersonate`: `role: user.role, roles: rolesFrom(user), mainRole: user.role,` (an impersonation always opens on the target's main role).
- In `logout`: next to `role: "LICENSEE",` add `roles: undefined, mainRole: undefined,`. Keep `username` handling as is (the biometric path relies on it).
- Add to the `AuthService` object:

```ts
  /** Switch the active space (display only; the server checks every role). */
  setActiveSpace: async (space: UserRole): Promise<void> => {
    const config = await AuthService.getAuthConfig();
    if (!(config.roles ?? [config.role]).includes(space)) return;
    await AuthService.saveAuthConfig({ ...config, role: space });
  },
```

`useLoginLogic.ts` biometric restore (import `resolveSpace`): replace `role: profile.role,` with

```ts
            role: resolveSpace({
              previousSpace: config.role,
              previousUser: config.username,
              user: profile.email,
              mainRole: profile.role,
              roles: profile.roles?.length ? profile.roles : [profile.role],
            }),
            roles: profile.roles?.length ? profile.roles : [profile.role],
            mainRole: profile.role,
```

`auth.store.ts`:

- State gains `roles: AuthRole[]; mainRole: AuthRole | null; hasRole: (role: AuthRole) => boolean;` initialised to `[]`, `null`, and `hasRole: (r) => get().roles.includes(r)` (switch to `create<AuthState>((set, get) => …)`).
- In `refreshAuth`, parse `roles` / `mainRole` from the config (filter through `KNOWN_ROLES`), then:

```ts
const parsedRoles = (config.roles ?? []).filter((r): r is AuthRole =>
  KNOWN_ROLES.includes(r as AuthRole),
);
const roles: AuthRole[] = parsedRoles.length ? parsedRoles : role ? [role] : [];
const mainRole: AuthRole | null =
  config.mainRole && KNOWN_ROLES.includes(config.mainRole as AuthRole)
    ? (config.mainRole as AuthRole)
    : role;
// A space the account no longer holds falls back to the main role.
const space: AuthRole | null = role && roles.includes(role) ? role : mainRole;
```

and `set({ …, role: space, roles, mainRole, … })` (the config type in `refreshAuth` gains `roles?: string[]; mainRole?: string;`). Every reset branch also sets `roles: []`, `mainRole: null`.

`SpaceSelector.tsx` (match the look of the existing settings rows: reuse the theme hook and the row components `SettingsScreen` already uses; the structure below is the contract the tests rely on):

```tsx
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { AuthRole } from '../../../stores/auth.store';

type SpaceRole = Exclude<AuthRole, 'GUEST'>;

export const SPACE_LABELS: Record<SpaceRole, string> = {
  LICENSEE: 'Danseur',
  CLUB: 'Club',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

interface Props {
  roles: AuthRole[];
  space: AuthRole | null;
  onChange: (space: SpaceRole) => void;
}

/** Réglages → Espace. Hidden for a single-role account. */
export const SpaceSelector = ({ roles, space, onChange }: Props) => {
  const choices = roles.filter((r): r is SpaceRole => r !== 'GUEST');
  if (choices.length < 2) return null;
  return (
    <View>
      <Text accessibilityRole="header">Espace</Text>
      {choices.map((r) => (
        <TouchableOpacity
          key={r}
          accessibilityRole="button"
          accessibilityLabel={SPACE_LABELS[r]}
          accessibilityState={{ selected: r === space }}
          testID={`settings-space-${r}`}
          onPress={() => onChange(r)}
        >
          <Text>{SPACE_LABELS[r]}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};
```

`SettingsScreen.tsx`:

- Read `roles`, `hasRole` and `refreshAuth` from `useAuthStore`; render `<SpaceSelector roles={roles} space={role} onChange={async (s) => { await auth.setActiveSpace(s); await refreshAuth(); }} />` at the top of the account section. `MainTabs` remounts through its existing `key={tabs-${role}…}`, so the tab bar follows.
- Lines ~279, ~388, ~419: `role === "ADMIN"` → `hasRole("ADMIN")` (impersonation and correction review are actions). Leave ~338 (`CLUB`) and ~348 (`LICENSEE`) on `role`: they are the space's profile sections.

`LibraryScreen.tsx:59`, `AudioPlayerScreen.tsx:53`, `TrackCorrectionsReviewScreen.tsx:60`:

```ts
const isAdmin = useAuthStore((s) => s.hasRole('ADMIN'));
```

(keep reading `role` / `isGuest` where the file still needs them).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter client test` → PASS (the `TrackCorrectionsReviewScreen` test is known to be flaky under load; rerun it alone if it fails). `pnpm --filter client exec tsc --noEmit` and `pnpm --filter client lint` pass.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src
git commit -m "feat(client): switch spaces and keep every role's actions

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Docs and full verification

**Files:**

- Modify: the exploitation runbook section on admin user management that lot 1b updated (find it: `grep -rln "Utilisateurs" docs/exploitation`), in French
- Modify: `docs/regles-metier/roles.md` (referenced by `AuthService.ts`; add the multi-profile rules), in French
- Modify: `CLAUDE.md` "What NOT to do": add `- Don't compare user.role directly in the backend — use hasRole / withRole from src/auth/roles.ts (multi-profile, lot 1c)`; and fix the stale `userRoleClubSelect` mention in the Prisma-selects bullet to real constants (`userRolesClubSelect`, …), checking each name exists with grep first

- [ ] **Step 1: Write the docs**

Runbook (French), new subsection "Rôles supplémentaires (multi-profil)":

- où : fiche utilisateur → « Rôles supplémentaires » ;
- effet immédiat (pas de reconnexion), droits cumulés ;
- un rôle Club supplémentaire exige un club, et représente ce même club ;
- club désactivé : bloque les comptes dont Club est le rôle principal ; retire seulement le rôle Club supplémentaire aux autres ;
- un admin peut s'ajouter des rôles mais pas retirer son propre rôle Admin ;
- côté app : sélecteur « Espace » dans Réglages (visible avec 2 rôles ou plus), disponible à partir du build EAS qui embarque le lot 1c ; avant, l'app suit le rôle principal ;
- audit : ligne `USER_UPDATE` avec `extraRoles` avant / après.

`roles.md`: the same rules, framed as business rules (main role, extra roles, spaces vs actions).

- [ ] **Step 2: Full verification**

```bash
pnpm preflight
```

Then the mocked e2e (`admin.e2e-spec auth.e2e-spec auth-additional.e2e-spec`) and the real-DB specs (`admin.integration-spec multi-role.integration-spec auth.integration-spec`) per "How to run tests". Every command must pass; report any failure verbatim instead of working around it.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(admin): document multi-profile roles

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
