# Admin back-office — Lot 1b (accounts and clubs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create users of any non-admin role, deactivate, reactivate and delete users, and list, edit, deactivate and delete clubs from the back-office, with deactivation enforced server-side on every request and every action written to the audit log.

**Architecture:** Two additive nullable columns (`User.disabledAt`, `Club.disabledAt`) and one pure helper, `accountBlockReason`, applied at login (403), at refresh (401) and in `JwtStrategy.validate` on every authenticated request (401, one indexed lookup). The self-service deletion purge moves into `AccountDeletionService.deleteAccount`, shared by `UsersService.deleteMyAccount` and the admin delete. The admin module grows three services (`AdminUserAccountsService`, `AdminClubsQueryService`, `AdminClubsService`) behind the existing class-guarded `AdminController`; the SPA gets a client regenerated from `swagger.json` and new pages.

**Tech Stack:** NestJS 11, Prisma 7.10 / PostgreSQL 15, Jest 29 + supertest; React 19, Vite 8, Mantine 8, TanStack Query 5, React Router 7, Zustand 5, Vitest 4 + Testing Library; `@hey-api/openapi-ts` 0.99.

**Spec:** `docs/superpowers/specs/2026-10-07-admin-lot1b-accounts-clubs-design.md` (binding). Lot 1 plan, for conventions: `docs/superpowers/plans/2026-10-07-admin-backoffice-lot1.md`.

**Worktree:** `/Users/gabin/Development/FFD-Connect-admin1b`, branch `feature/admin-lot1b` (from `origin/develop`). All paths below are relative to it unless absolute.

## Global Constraints

- Every `/admin/*` route is `ADMIN`-only: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` on the **controller class**, never per method.
- Pagination uses the repo convention `skip` / `take` (`PaginationParamsDto`, `take` ≤ 100) and returns `PaginatedResponse<T>` via `createPaginatedResponse`.
- Prisma: `select` constants from `src/utils/prisma-selects.ts` (no inline selects in services, except the trivial `{ id: true }` already used by lot 1), `take` on every `findMany`.
- No `any` (eslint error), no `process.env` in backend code (use `ConfigService`), no new React Context (session state stays in Zustand).
- The migration is additive only (single-revision deploy with automatic rollback): exactly `User.disabledAt DateTime?` with `@@index([disabledAt])`, and `Club.disabledAt DateTime?`. `null` means active. No default, no `DROP`, no `ALTER COLUMN`.
- One helper decides blocking: `accountBlockReason(user) → null | "USER_DISABLED" | "CLUB_DISABLED"` in `src/auth/account-status.ts`. `CLUB_DISABLED` applies only when `role === CLUB` and `club.disabledAt` is set.
- Login of a blocked account: the password is checked **first**, then **403** with the exact message `Compte désactivé. Contactez la fédération.` A wrong password on a blocked account stays a plain 401.
- Refresh of a blocked account: **401**. `JwtStrategy.validate`: **401** when the account is blocked or missing, using the `accountStatusSelect` constant.
- Audit `before`/`after` never contain `password`, tokens or hashes. The `USER_DELETE` row carries only `after: { role }`.
- Admins create only `LICENSEE`, `CLUB` and `STAFF`, never `ADMIN`. `ADMIN` never receives an invitation.
- Status change and deletion are refused (403) on the admin's own account, and the UI hides both buttons there.
- Invitation token expiry: **7 days** (`INVITATION_EXPIRY_HOURS = 168`). Link: `${FRONTEND_URL}/reset-password?token=…` (`FRONTEND_URL` is `https://ffd.gabin-simond.fr` on staging; the web reset page already exists). Password-reset expiry stays 1 h.
- UI wording: **"Utilisateurs"**, never "Inscrits" (in the app, "inscrit" means registered to a competition).
- Code, comments and commits in English; user-facing copy (admin UI, emails, API messages) in French; `docs/exploitation/` in French.
- Formatting follows each app: backend double quotes, admin SPA single quotes. The snippets in this plan went through the root Prettier config (single quotes everywhere); the pre-commit hook reformats each file to its app's style, so copy the code as is.
- Coverage: the `src/admin` threshold (94 / 75 / 88 / 94) and the `src/auth` thresholds (folder 94 / 75 / 88 / 94, `auth.service.ts` 80 / 85 / 85 / 85), `src/users` (96 / 85 / 100 / 96) and `src/common/filters` (96 / 78 / 96 / 96) stay as they are. Never lower a threshold: add tests.
- Conventional commits; never `--no-verify`. Every commit message ends with exactly these two lines:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS
  ```
- No push and no PR without the user's explicit go.
- The mobile app needs no change (a 401 already returns to login; the login screen shows the server message).

### How to run tests (applies to every task)

- **Backend env file.** Anything that boots `AppModule` (mocked e2e, integration, swagger export) reads `apps/backend/.env`, which is gitignored and absent from a fresh worktree. If it is missing: `cp apps/backend/.env.example apps/backend/.env`. Never commit it.
- **Unit tests:** `pnpm --filter backend exec jest <path>` and `pnpm --filter admin test -- <path>`.
- **Mocked-Prisma e2e (no database).** `test/jest-e2e.json` has a `globalSetup` that runs `prisma db push --accept-data-loss`; it must not run here. Build a copy without it and run the mocked specs with it (needs Redis from `docker compose --profile infra up -d` for BullMQ):
  ```bash
  cd apps/backend
  E2E_NODB="${TMPDIR:-/tmp}/jest-e2e-nodb.json"
  node -e 'const p=require("path");const c=require("./test/jest-e2e.json");delete c.globalSetup;delete c.globalTeardown;c.rootDir=p.resolve("test");require("fs").writeFileSync(process.argv[1],JSON.stringify(c))' "$E2E_NODB"
  pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec auth.e2e-spec auth-additional.e2e-spec
  ```
- **Real-database tests run only on the dedicated test database.** Every real-DB step first sources the controller-provided file, which exports `DATABASE_URL` for the test DB and the Prisma consent variable:
  ```bash
  cd apps/backend
  source "$(git rev-parse --show-toplevel)/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh"
  pnpm exec jest --config test/jest-integration.json --runInBand --forceExit admin.integration-spec
  ```
  Never run `prisma db push`, `prisma migrate dev`, `migrate reset` or the full `test:e2e` / `test:integration` scripts against any other database. The migration in Task 1 is produced **offline** with `prisma migrate diff` (no database involved).
- **Swagger.** `pnpm docs:export` fails from the repo root. Run the steps by hand (Task 8): `cd apps/backend && pnpm run build && node scripts/export-swagger.js`, then copy to `apps/docs/public/swagger.json` and run Prettier on both. Then regenerate the admin client with `pnpm --filter admin exec openapi-ts` (the generated folder is gitignored).

## Review Focus

1. **A `CLUB` account whose club is disabled** — login gets 403, refresh 401, a live access token 401, while the licensees of the same club keep working; the user page explains why the account cannot log in. Covered by Task 1 (helper + strategy + login tests), Task 3 (`clubDisabledAt` in the detail), Task 7 (integration: club disabled, CLUB account refused, licensee accepted) and Task 11 (orange banner test).
2. **Email case and whitespace in the delete confirmation** — typing `" JEANNE@x.fr "` for `jeanne@x.fr` must confirm, both in the API and in the UI button state. Covered by Task 4 (service test) and Task 11 (page test).
3. **Club rename collisions and stale copies** — renaming onto an existing name is a 409 that changes nothing; users of _other_ clubs whose `clubName` happens to match are not touched, while legacy members (`clubId` null, `clubName` = old name) are renamed. Covered by Task 7 (unit `where` assertions + real-DB cascade and collision tests).
4. **Deleting a club that still owns partnerships or solo teams** — the schema cascades both on club deletion, so a club with no members but old couples would silently delete them. The delete answers 409 with `partnershipCount` / `soloTeamCount` too, and the 409 counts survive the global exception filter. Covered by Task 6 (`clubUsage`), Task 7 (service + filter tests) and Task 13 (UI shows server counts).
5. **Repeated status changes (double click, two admins)** — asking for the state already in place writes nothing, adds no audit row and returns the current detail with 200. Covered by Task 3 (user) and Task 7 (club).

---

## File Structure

**Backend (`apps/backend`)**

| File                                                                                       | Responsibility                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `prisma/schema/user.prisma`, `prisma/schema/club.prisma` (modify)                          | `disabledAt` columns + `User` index                                     |
| `prisma/schema/migrations/<ts>_account_status/migration.sql` (generated)                   | additive migration                                                      |
| `src/auth/account-status.ts` (create)                                                      | `accountBlockReason`, `ACCOUNT_DISABLED_MESSAGE`, `AccountStatusFields` |
| `src/auth/auth.service.ts` (modify)                                                        | 403 at login after the password check                                   |
| `src/auth/auth-token.service.ts` (modify)                                                  | 401 at refresh                                                          |
| `src/auth/jwt.strategy.ts` (modify)                                                        | per-request status lookup                                               |
| `src/auth/email.service.ts` (modify)                                                       | role-specific invitation wording                                        |
| `src/users/account-deletion.service.ts` (create)                                           | shared hard-deletion core                                               |
| `src/users/users.service.ts`, `src/users/users.module.ts` (modify)                         | delegate to the core, export it                                         |
| `src/utils/prisma-selects.ts` (modify)                                                     | status, club and member select constants                                |
| `src/common/filters/http-exception.filter.ts` (modify)                                     | keep club-usage counts on a 409                                         |
| `src/admin/admin-users.query-service.ts` (modify)                                          | status filter, `disabledAt`, `clubDisabledAt`                           |
| `src/admin/admin-users.service.ts` (modify)                                                | `setStatus`, `delete`                                                   |
| `src/admin/admin-user-accounts.service.ts` (renamed from `admin-club-accounts.service.ts`) | create any non-admin user, resend invitation                            |
| `src/admin/admin-club-usage.ts` (create)                                                   | `clubUsage`, `isClubEmpty`                                              |
| `src/admin/admin-clubs.query-service.ts` (create)                                          | clubs list, options, detail                                             |
| `src/admin/admin-clubs.service.ts` (create)                                                | club update (rename cascade), status, delete                            |
| `src/admin/admin-audit.service.ts` (modify)                                                | `recordOp` for array-form transactions                                  |
| `src/admin/admin-reference.service.ts` (modify)                                            | reference data only (clubs move out)                                    |
| `src/admin/admin.controller.ts`, `src/admin/admin.module.ts` (modify)                      | new routes, wiring                                                      |
| `src/admin/dto/admin-actions.dto.ts` (create)                                              | `SetActiveDto`, `DeleteAdminUserDto`                                    |
| `src/admin/dto/admin-user-accounts.dto.ts` (renamed from `club-account.dto.ts`)            | `CreateAdminUserDto`, `AdminUserCreatedDto`, `InvitationResultDto`      |
| `src/admin/dto/admin-clubs.dto.ts` (create)                                                | clubs query/response/update DTOs                                        |
| `src/admin/dto/admin-users.dto.ts`, `src/admin/dto/admin-audit.dto.ts` (modify)            | status filter + fields, new audit actions                               |
| `test/admin.e2e-spec.ts`, `test/admin.integration-spec.ts` (modify)                        | role matrix, real-DB scenarios                                          |
| `test/auth.e2e-spec.ts`, `test/auth-additional.e2e-spec.ts` (modify)                       | mocks for the new status lookup, disabled-account cases                 |
| `swagger.json` + `apps/docs/public/swagger.json` (regenerated)                             | API contract                                                            |

**Admin SPA (`apps/admin/src`)**

| File                                                            | Responsibility                                            |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `api/queries.ts` (modify)                                       | `clubOptionsQuery`, `clubsQuery`, `clubQuery`, `ensureOk` |
| `lib/labels.ts` (create)                                        | role, registration-mode and status-filter labels          |
| `lib/apiError.ts` (create)                                      | message of a parsed API error body                        |
| `lib/auditLabels.ts`, `components/ChangeSummary.tsx` (modify)   | new action labels, club field labels                      |
| `components/AppLayout.tsx`, `router.tsx` (modify)               | nav "Utilisateurs / Nouvel utilisateur / Clubs", routes   |
| `pages/NewUserPage.tsx` (renamed from `NewClubAccountPage.tsx`) | create any non-admin user                                 |
| `pages/UsersPage.tsx` (modify)                                  | wording, status badge and filter                          |
| `pages/UserDetailPage.tsx` (modify)                             | status toggle, delete modal, invitation for any role      |
| `pages/ClubsPage.tsx` (create)                                  | clubs list                                                |
| `pages/ClubDetailPage.tsx` (create)                             | club edit, status, danger zone, members                   |
| `pages/AuditLogPage.tsx` (modify)                               | club targets, deleted targets                             |
| `**/*.test.ts(x)`                                               | Vitest tests next to each file                            |

**Docs:** `docs/exploitation/backoffice-admin.md` (French), `CLAUDE.md` (sensitive areas line).

---

### Task 1: Account status — schema, helper and enforcement

**Files:**

- Modify: `apps/backend/prisma/schema/user.prisma` (model `User`), `apps/backend/prisma/schema/club.prisma` (model `Club`)
- Generated: `apps/backend/prisma/schema/migrations/<timestamp>_account_status/migration.sql`
- Create: `apps/backend/src/auth/account-status.ts`, `apps/backend/src/auth/account-status.spec.ts`
- Modify: `apps/backend/src/utils/prisma-selects.ts` (append `accountStatusSelect`)
- Modify: `apps/backend/src/auth/auth.service.ts` (`validateUser`), `apps/backend/src/auth/auth.service.spec.ts`
- Modify: `apps/backend/src/auth/auth-token.service.ts` (`refreshAccessToken`), `apps/backend/src/auth/auth-token.service.spec.ts`
- Modify: `apps/backend/src/auth/jwt.strategy.ts`, `apps/backend/src/auth/jwt.strategy.spec.ts`
- Modify: `apps/backend/test/auth.e2e-spec.ts`, `apps/backend/test/auth-additional.e2e-spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  - Prisma: `User.disabledAt: Date | null`, `Club.disabledAt: Date | null`.
  - `src/auth/account-status.ts`: `type AccountBlockReason = "USER_DISABLED" | "CLUB_DISABLED"`; `interface AccountStatusFields { role?: string | null; disabledAt?: Date | null; club?: { disabledAt?: Date | null } | null }`; `function accountBlockReason(user: AccountStatusFields): AccountBlockReason | null`; `const ACCOUNT_DISABLED_MESSAGE = "Compte désactivé. Contactez la fédération."`.
  - `src/utils/prisma-selects.ts`: `accountStatusSelect = { role: true, disabledAt: true, club: { select: { disabledAt: true } } }`.
  - `JwtStrategy` constructor is now `(configService: ConfigService, prisma: PrismaService)`; `validate(payload)` is async.

- [ ] **Step 1: Edit the schema**

In `apps/backend/prisma/schema/user.prisma`, inside `model User`, right after the `lastLoginAt` line:

```prisma
  disabledAt           DateTime?      // Désactivé par un admin (null = actif) : connexion, refresh et requêtes refusés
```

and after `@@index([clubId, role]) // membres d'un club filtrés par rôle`:

```prisma
  @@index([disabledAt])
```

In `apps/backend/prisma/schema/club.prisma`, inside `model Club`, right after the `registrationMode` line:

```prisma
  disabledAt            DateTime?            // Désactivé par un admin (null = actif) : ses comptes CLUB sont bloqués
```

- [ ] **Step 2: Generate the migration offline (no database)**

From the repo root:

```bash
BEFORE=$(mktemp -d)
git archive HEAD apps/backend/prisma/schema | tar -x -C "$BEFORE"
DIR="$PWD/apps/backend/prisma/schema/migrations/$(date -u +%Y%m%d%H%M%S)_account_status"
mkdir -p "$DIR"
(cd apps/backend && pnpm exec prisma migrate diff \
  --from-schema "$BEFORE/apps/backend/prisma/schema" \
  --to-schema prisma/schema --script --output "$DIR/migration.sql")
cat "$DIR/migration.sql"
pnpm --filter backend exec prisma generate
```

Expected `migration.sql` content, and nothing else:

```sql
-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_disabledAt_idx" ON "User"("disabledAt");
```

If it contains any `DROP`, `ALTER COLUMN` or `DEFAULT`, stop and report: the migration must be additive.

- [ ] **Step 3: Write the failing helper test**

`apps/backend/src/auth/account-status.spec.ts`:

```ts
import { UserRole } from '@prisma/client';
import { accountBlockReason } from './account-status';

describe('accountBlockReason', () => {
  const at = new Date('2026-10-07T10:00:00Z');

  it('is null for an active account', () => {
    expect(
      accountBlockReason({
        role: UserRole.LICENSEE,
        disabledAt: null,
        club: null,
      }),
    ).toBeNull();
  });

  it('blocks a disabled user, whatever the role', () => {
    expect(accountBlockReason({ role: UserRole.ADMIN, disabledAt: at, club: null })).toBe(
      'USER_DISABLED',
    );
  });

  it('blocks a CLUB account whose club is disabled', () => {
    expect(
      accountBlockReason({
        role: UserRole.CLUB,
        disabledAt: null,
        club: { disabledAt: at },
      }),
    ).toBe('CLUB_DISABLED');
  });

  it('does not block a licensee of a disabled club', () => {
    expect(
      accountBlockReason({
        role: UserRole.LICENSEE,
        disabledAt: null,
        club: { disabledAt: at },
      }),
    ).toBeNull();
  });

  it("reports the user's own deactivation first", () => {
    expect(
      accountBlockReason({
        role: UserRole.CLUB,
        disabledAt: at,
        club: { disabledAt: at },
      }),
    ).toBe('USER_DISABLED');
  });

  it('treats missing fields (legacy fallback select, partial mocks) as active', () => {
    expect(accountBlockReason({})).toBeNull();
  });
});
```

Run: `pnpm --filter backend exec jest src/auth/account-status.spec.ts`
Expected: FAIL, `Cannot find module './account-status'`.

- [ ] **Step 4: Implement the helper and the select constant**

`apps/backend/src/auth/account-status.ts`:

```ts
import { UserRole } from '@prisma/client';

export type AccountBlockReason = 'USER_DISABLED' | 'CLUB_DISABLED';

/** Shown by the mobile login screen and the back-office as is. */
export const ACCOUNT_DISABLED_MESSAGE = 'Compte désactivé. Contactez la fédération.';

/**
 * The fields the decision needs. All optional: the legacy fallback select of
 * login and partial test mocks do not carry them, and "unknown" means active.
 */
export interface AccountStatusFields {
  role?: string | null;
  disabledAt?: Date | null;
  club?: { disabledAt?: Date | null } | null;
}

/**
 * Single source of truth for "may this account act?", used at login,
 * at refresh and on every authenticated request (JwtStrategy).
 * A disabled club blocks only its CLUB accounts, never its licensees.
 */
export function accountBlockReason(user: AccountStatusFields): AccountBlockReason | null {
  if (user.disabledAt) return 'USER_DISABLED';
  if (user.role === UserRole.CLUB && user.club?.disabledAt) {
    return 'CLUB_DISABLED';
  }
  return null;
}
```

Append to `apps/backend/src/utils/prisma-selects.ts`:

```ts
/**
 * Account status, read at login, at refresh and on every authenticated
 * request (JwtStrategy). Indexed lookup by primary key, three columns.
 */
export const accountStatusSelect = {
  role: true,
  disabledAt: true,
  club: { select: { disabledAt: true } },
} as const;
```

Run: `pnpm --filter backend exec jest src/auth/account-status.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing login tests**

In `apps/backend/src/auth/auth.service.spec.ts` (`UserRole` and `ForbiddenException` are already imported), append inside `describe("validateUser", ...)`:

```ts
it('throws 403 with the federation message once the password is valid on a disabled account', async () => {
  mockPrismaService.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'test@example.com',
    password: 'hashedpassword',
    role: UserRole.LICENSEE,
    disabledAt: new Date('2026-10-07T10:00:00Z'),
    club: null,
  });
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  await expect(service.validateUser('test@example.com', 'password')).rejects.toThrow(
    new ForbiddenException('Compte désactivé. Contactez la fédération.'),
  );
});

it('throws 403 for a CLUB account whose club is disabled', async () => {
  mockPrismaService.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'club@example.com',
    password: 'hashedpassword',
    role: UserRole.CLUB,
    disabledAt: null,
    club: { disabledAt: new Date('2026-10-07T10:00:00Z') },
  });
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);

  await expect(service.validateUser('club@example.com', 'password')).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});

it('does not reveal the status when the password is wrong', async () => {
  mockPrismaService.user.findUnique.mockResolvedValue({
    id: 'u1',
    password: 'hashedpassword',
    role: UserRole.LICENSEE,
    disabledAt: new Date(),
    club: null,
  });
  (bcrypt.compare as jest.Mock).mockResolvedValue(false);

  await expect(service.validateUser('test@example.com', 'wrong')).resolves.toBeNull();
});

it('reads the account status and strips the club relation from the result', async () => {
  mockPrismaService.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'test@example.com',
    password: 'hashedpassword',
    role: UserRole.LICENSEE,
    disabledAt: null,
    club: { disabledAt: null },
  });
  (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  (bcrypt.getRounds as jest.Mock).mockReturnValue(12);

  const result = await service.validateUser('test@example.com', 'pw');

  expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({
        disabledAt: true,
        club: { select: { disabledAt: true } },
      }) as unknown,
    }),
  );
  expect(result).not.toHaveProperty('club');
  expect(result).not.toHaveProperty('password');
});
```

Run: `pnpm --filter backend exec jest src/auth/auth.service.spec.ts -t "validateUser"`
Expected: FAIL on the three new status tests (no 403, no `disabledAt` in the select, `club` present).

- [ ] **Step 6: Enforce at login**

In `apps/backend/src/auth/auth.service.ts`:

Imports — add:

```ts
import { accountStatusSelect } from '../utils/prisma-selects';
import {
  ACCOUNT_DISABLED_MESSAGE,
  AccountStatusFields,
  accountBlockReason,
} from './account-status';
```

(merge `accountStatusSelect` into the existing `import { licenseIdSelect } from "../utils/prisma-selects";` line).

In `validateUser`, make `fullSelect` start with the status fields:

```ts
    const fullSelect = {
      ...accountStatusSelect,
      id: true,
      email: true,
      password: true,
      firstName: true,
      lastName: true,
      role: true,
      // …(the existing keys, unchanged)
```

Change the declaration of `user`:

```ts
let user: (AccountStatusFields & { password: string; [k: string]: unknown }) | null = null;
```

Replace the block that starts with `if (user && (await bcrypt.compare(pass, user.password))) {` down to its `return result as Omit<User, "password">;` with:

```ts
if (user && (await bcrypt.compare(pass, user.password))) {
  // Status only after the password: a stranger learns nothing about the
  // account, its owner learns why they cannot get in.
  if (accountBlockReason(user)) {
    throw new ForbiddenException(ACCOUNT_DISABLED_MESSAGE);
  }
  // Rehash silencieux si le hash existant a été généré avec < 12 rounds
  const currentRounds = bcrypt.getRounds(user.password);
  if (currentRounds < BCRYPT_ROUNDS) {
    bcrypt
      .hash(pass, BCRYPT_ROUNDS)
      .then((newHash) =>
        this.prisma.user.update({
          where: { id: user.id as string },
          data: { password: newHash },
        }),
      )
      .catch((err: unknown) => {
        this.logger.warn(
          { err, userId: user.id },
          'Silent bcrypt rehash failed — login not affected',
        );
      });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, club, ...result } = user;
  return result as Omit<User, 'password'>;
}
```

Run: `pnpm --filter backend exec jest src/auth/auth.service.spec.ts`
Expected: PASS (all, including the existing rehash and fallback tests).

- [ ] **Step 7: Write the failing refresh tests**

In `apps/backend/src/auth/auth-token.service.spec.ts`, add `import { UnauthorizedException } from "@nestjs/common";` as the first import, and append inside `describe("refreshAccessToken", ...)`:

```ts
it('refuses a disabled account with 401 and rotates nothing', async () => {
  mockPrismaService.refreshToken.findUnique.mockResolvedValue({
    id: 'tok-1',
    revoked: false,
    expiresAt: new Date(Date.now() + 86400000),
    user: {
      id: 'u1',
      email: 'u@test.com',
      role: UserRole.LICENSEE,
      disabledAt: new Date(),
      club: null,
    },
  });

  await expect(service.refreshAccessToken('plain')).rejects.toThrow(
    new UnauthorizedException('Compte désactivé. Contactez la fédération.'),
  );
  expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
});

it('refuses a CLUB account whose club is disabled', async () => {
  mockPrismaService.refreshToken.findUnique.mockResolvedValue({
    id: 'tok-1',
    revoked: false,
    expiresAt: new Date(Date.now() + 86400000),
    user: {
      id: 'u1',
      email: 'c@test.com',
      role: UserRole.CLUB,
      disabledAt: null,
      club: { disabledAt: new Date() },
    },
  });

  await expect(service.refreshAccessToken('plain')).rejects.toBeInstanceOf(UnauthorizedException);
});

it('reads the account status together with the token', async () => {
  mockPrismaService.refreshToken.findUnique.mockResolvedValue(null);
  await expect(service.refreshAccessToken('x')).rejects.toThrow();
  expect(mockPrismaService.refreshToken.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({
      include: {
        user: {
          select: expect.objectContaining({
            disabledAt: true,
            club: { select: { disabledAt: true } },
          }) as unknown,
        },
      },
    }),
  );
});
```

Run: `pnpm --filter backend exec jest src/auth/auth-token.service.spec.ts`
Expected: FAIL on the three new tests.

- [ ] **Step 8: Enforce at refresh**

In `apps/backend/src/auth/auth-token.service.ts`:

```ts
import { accountStatusSelect } from '../utils/prisma-selects';
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from './account-status';
```

In `refreshAccessToken`, the user select becomes:

```ts
        user: {
          select: {
            ...accountStatusSelect,
            id: true,
            email: true,
            // …(the existing keys, unchanged)
```

After the existing `throw new UnauthorizedException("Invalid or expired refresh token");` block and `const user = tokenRecord.user;`, insert:

```ts
// A disabled account's session is over, whatever the token says.
if (accountBlockReason(user)) {
  throw new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE);
}
```

Run: `pnpm --filter backend exec jest src/auth/auth-token.service.spec.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing JwtStrategy tests**

Replace `apps/backend/src/auth/jwt.strategy.spec.ts` with:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { accountStatusSelect } from '../utils/prisma-selects';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let prisma: MockPrismaService;
  let strategy: JwtStrategy;
  const payload = {
    sub: 'user-1',
    email: 'test@example.com',
    role: 'LICENSEE',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-secret-32-chars-minimum!!!!!'),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(configService, prisma as unknown as PrismaService);
  });

  it('maps the payload of an active account, after one status lookup', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: 'user-1',
      email: 'test@example.com',
      role: 'LICENSEE',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: accountStatusSelect,
    });
  });

  it('keeps the impersonation claim', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ ...payload, impersonatedBy: 'admin-1' }),
    ).resolves.toMatchObject({ impersonatedBy: 'admin-1' });
  });

  it('rejects a disabled account with 401', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: new Date(),
      club: null,
    } as never);
    await expect(strategy.validate(payload)).rejects.toThrow(
      new UnauthorizedException('Compte désactivé. Contactez la fédération.'),
    );
  });

  it('rejects a CLUB account whose club is disabled', async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.CLUB,
      disabledAt: null,
      club: { disabledAt: new Date() },
    } as never);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose account no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

Run: `pnpm --filter backend exec jest src/auth/jwt.strategy.spec.ts`
Expected: FAIL (constructor takes one argument, `validate` is synchronous and never rejects).

- [ ] **Step 10: Look up the status on every request**

Replace `apps/backend/src/auth/jwt.strategy.ts` with:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { accountStatusSelect } from '../utils/prisma-selects';
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from './account-status';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Runs on every authenticated request. The account status comes from the
   * database (one primary-key lookup) so a deactivation cuts live access
   * tokens at once instead of when they expire (up to 60 minutes).
   */
  async validate(payload: JwtPayload) {
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: accountStatusSelect,
    });
    if (!account) throw new UnauthorizedException();
    if (accountBlockReason(account)) {
      throw new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE);
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      impersonatedBy: payload.impersonatedBy,
    };
  }
}
```

Run: `pnpm --filter backend exec jest src/auth`
Expected: PASS (whole auth folder).

- [ ] **Step 11: Give the mocked e2e their new mocks, and cover the disabled cases**

Planning-time grep: the only e2e specs that override `PrismaService` with a hand-written mock **without** overriding `JwtAuthGuard` are `test/auth.e2e-spec.ts`, `test/auth-additional.e2e-spec.ts` and `test/health.e2e-spec.ts` (public routes only). The specs that sign tokens (`competitions.e2e-spec.ts`, `volunteer-checkin.e2e-spec.ts`, the `*.integration-spec.ts`) create real users in the real test DB, so the lookup finds them. Re-run the check and treat any new hit like the two files below:

```bash
cd apps/backend
grep -l "overrideProvider(PrismaService)" test/*.e2e-spec.ts | xargs grep -L "overrideGuard(JwtAuthGuard)"
```

`apps/backend/test/auth.e2e-spec.ts`:

1. Add `import { JwtService } from "@nestjs/jwt";` and `let jwtService: JwtService;` next to `let prismaService: PrismaService;`; after `prismaService = moduleFixture.get<PrismaService>(PrismaService);` add `jwtService = moduleFixture.get<JwtService>(JwtService);`.
2. In `mockPrisma`, add:
   ```ts
      impersonationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
   ```
3. In every `mockUser` literal (the three login tests), add `disabledAt: null, club: null,`.
4. Append these tests at the end of the `describe`:

```ts
it('/api/v1/auth/login (POST) - refuses a disabled account with 403 after a valid password', async () => {
  const password = 'password123';
  const hashedPassword = await bcrypt.hash(password, 10);
  (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'test-uuid',
    email: 'test@example.com',
    password: hashedPassword,
    firstName: 'John',
    lastName: 'Doe',
    role: 'LICENSEE',
    disabledAt: new Date(),
    club: null,
    license: null,
  });

  const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/v1/auth/login')
    .send({ username: 'test@example.com', password })
    .expect(403);
  expect(res.body.message).toBe('Compte désactivé. Contactez la fédération.');
});

it('/api/v1/auth/login (POST) - a disabled account with a wrong password stays a plain 401', async () => {
  const hashedPassword = await bcrypt.hash('password123', 10);
  (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
    id: 'test-uuid',
    email: 'test@example.com',
    password: hashedPassword,
    role: 'LICENSEE',
    disabledAt: new Date(),
    club: null,
  });

  const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/v1/auth/login')
    .send({ username: 'test@example.com', password: 'wrongpassword' })
    .expect(401);
  expect(JSON.stringify(res.body)).not.toContain('désactivé');
});

it('rejects a live access token once the account is disabled (JwtStrategy)', async () => {
  const token = jwtService.sign({
    sub: 'test-uuid',
    email: 'test@example.com',
    role: 'LICENSEE',
  });
  (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
    role: 'LICENSEE',
    disabledAt: new Date(),
    club: null,
  });

  await request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/v1/auth/impersonate/stop')
    .set('Authorization', `Bearer ${token}`)
    .expect(401);
});

it('lets a live access token of an active account through (JwtStrategy)', async () => {
  const token = jwtService.sign({
    sub: 'test-uuid',
    email: 'test@example.com',
    role: 'LICENSEE',
  });
  (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
    role: 'LICENSEE',
    disabledAt: null,
    club: null,
  });

  await request(app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/v1/auth/impersonate/stop')
    .set('Authorization', `Bearer ${token}`)
    .expect(201);
});
```

`apps/backend/test/auth-additional.e2e-spec.ts`:

1. In the `mockUser` of "should handle multiple failed login attempts", add `disabledAt: null, club: null,`.
2. Append a new `describe` before the last closing `});`:

```ts
describe('Disabled accounts', () => {
  it('never tells a wrong-password caller that the account is disabled', async () => {
    const hashedPassword = await bcrypt.hash('password123', 10);
    (prismaService.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'test-uuid',
      email: 'test@example.com',
      password: hashedPassword,
      role: 'CLUB',
      disabledAt: null,
      club: { disabledAt: new Date() },
    });

    for (let i = 0; i < 3; i++) {
      const res = await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post('/api/v1/auth/login')
        .send({ username: 'test@example.com', password: 'wrongpassword' })
        .expect(401);
      expect(JSON.stringify(res.body)).not.toContain('désactivé');
    }
  });
});
```

Run the mocked e2e (see "How to run tests"):

```bash
cd apps/backend
pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec auth.e2e-spec auth-additional.e2e-spec
```

Expected: PASS.

- [ ] **Step 12: Typecheck, lint, auth coverage**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/auth src/utils test/auth.e2e-spec.ts test/auth-additional.e2e-spec.ts
pnpm --filter backend exec jest --coverage --silent
```

Expected: no errors; the whole unit suite passes with every threshold met, in particular `src/auth` and `auth.service.ts`. (A coverage run on a subset fails on the path thresholds of folders it did not load, so always run the full suite.)

- [ ] **Step 13: Commit**

```bash
git add apps/backend/prisma/schema apps/backend/src/auth apps/backend/src/utils/prisma-selects.ts apps/backend/test/auth.e2e-spec.ts apps/backend/test/auth-additional.e2e-spec.ts
git commit -m "feat(auth): block disabled accounts at login, refresh and on every request

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 2: Shared account deletion core

**Files:**

- Create: `apps/backend/src/users/account-deletion.service.ts`, `apps/backend/src/users/account-deletion.service.spec.ts`
- Modify: `apps/backend/src/users/users.service.ts` (`deleteMyAccount` ~line 473, constructor ~line 108, imports, `MAX_RENEWAL_DOCUMENTS_TO_PURGE`)
- Modify: `apps/backend/src/users/users.module.ts`
- Modify: `apps/backend/src/users/users.service.spec.ts` (imports and providers only)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces:
  - `AccountDeletionService.deleteAccount(userId: string, alsoInTransaction?: Prisma.PrismaPromise<unknown>[]): Promise<void>` — no authorisation check inside; the extra operations run in the same array transaction **after** the user row is deleted (used by Task 4 for the `USER_DELETE` audit row).
  - `MAX_RENEWAL_DOCUMENTS_TO_PURGE` now exported from `src/users/account-deletion.service.ts`.
  - `UsersModule` exports `AccountDeletionService`.

- [ ] **Step 1: Write the failing test**

`apps/backend/src/users/account-deletion.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { mockDeep, MockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { RenewalDocumentFileCleaner } from '../storage/renewal-document-file-cleaner.service';
import { AccountDeletionService } from './account-deletion.service';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let prisma: MockProxy<PrismaClient>;
  let files: { deleteFiles: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockResolvedValue([] as never);
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([]);
    files = { deleteFiles: jest.fn().mockResolvedValue(new Set()) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: RenewalDocumentFileCleaner, useValue: files },
      ],
    }).compile();
    service = moduleRef.get(AccountDeletionService);
  });

  it("runs the caller's operations after the user deletion, in the same transaction", async () => {
    const marker = (op: string) => ({ op }) as never;
    prisma.adminAuditLog.deleteMany.mockReturnValue(marker('auditPurge'));
    prisma.user.delete.mockReturnValue(marker('user'));

    await service.deleteAccount('u1', [marker('adminAudit')]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = (
      prisma.$transaction.mock.calls[0][0] as unknown as Array<{ op?: string } | undefined>
    )
      .map((o) => o?.op)
      .filter(Boolean);
    expect(ops).toEqual(['auditPurge', 'user', 'adminAudit']);
  });

  it("checks no password: authorising the deletion is the caller's job", async () => {
    await service.deleteAccount('u1');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('purges the renewal files after the transaction', async () => {
    prisma.licenseRenewalDocument.findMany.mockResolvedValue([{ filePath: 'doc.pdf' }] as never);
    await service.deleteAccount('u1');
    expect(files.deleteFiles).toHaveBeenCalledWith(['doc.pdf'], 'account-deletion');
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      files.deleteFiles.mock.invocationCallOrder[0],
    );
  });
});
```

Run: `pnpm --filter backend exec jest src/users/account-deletion.service.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Create the service (moved code, unchanged behaviour)**

`apps/backend/src/users/account-deletion.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RenewalDocumentFileCleaner } from '../storage/renewal-document-file-cleaner.service';
import { licenseRenewalDocumentFileSelect } from '../utils/prisma-selects';

/**
 * Borne de la lecture des documents de renouvellement à purger : un brouillon
 * porte au plus un document par type, quelques demandes par saison.
 */
export const MAX_RENEWAL_DOCUMENTS_TO_PURGE = 200;

/**
 * Droit à l'oubli (RGPD art. 17) : cœur de la suppression définitive d'un
 * compte, partagé par la suppression in-app (Apple 5.1.1(v)) et par la
 * suppression depuis le back-office admin. Aucune vérification d'autorisation
 * ici : l'appelant a déjà vérifié le mot de passe (self-service) ou le rôle
 * ADMIN + l'email recopié (back-office).
 *
 * Cascades Prisma (schéma) : refreshTokens, passwordResetTokens,
 * deviceTokens, notificationPrefs, partnerships, soloTeamMemberships,
 * licenseRenewalRequests (et leurs licenseRenewalDocuments).
 * SetNull : licence (reste propriété fédération), tracks soumis,
 * propositions de correction de musiques (auteur ET relecteur).
 * Propositions de correction de l'utilisateur : commentaire libre effacé
 * explicitement (texte potentiellement identifiant) ; les valeurs proposées
 * (titre, MPM…) portent sur la musique, pas sur la personne, et restent.
 * Inscriptions d'autrui en tant que partenaire : anonymisées explicitement
 * (partnerUserId ET partnerName, copie du nom complet → null ; null est
 * déjà géré partout à l'affichage).
 * Suppressions explicites (FK sans onDelete → RESTRICT) : registrations,
 * seatBookings, notifications ; bugReports (userId sans FK) ; lignes du
 * journal admin qui visent l'utilisateur.
 * ImpersonationLog est conservé (piste d'audit).
 *
 * Fichiers des documents de renouvellement (certificat médical — donnée de
 * santé, RGPD art. 9 — et certificat de licence) : leurs références sont
 * lues AVANT la transaction (la cascade efface les lignes), puis les
 * fichiers sont supprimés APRÈS son succès (en parallèle). Cette purge est
 * best-effort : un échec n'annule pas la suppression du compte (déjà
 * effective en base) ; il est remonté en erreur + Sentry (référence du
 * fichier uniquement) pour nettoyage manuel (RenewalDocumentFileCleaner).
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renewalDocumentFiles: RenewalDocumentFileCleaner,
  ) {}

  /**
   * @param alsoInTransaction operations appended to the same transaction,
   *   after the user row is deleted (the admin path adds its audit row here,
   *   so it survives the purge of rows that target the user).
   */
  async deleteAccount(
    userId: string,
    alsoInTransaction: Prisma.PrismaPromise<unknown>[] = [],
  ): Promise<void> {
    const documents = await this.prisma.licenseRenewalDocument.findMany({
      where: { request: { userId } },
      select: licenseRenewalDocumentFileSelect,
      take: MAX_RENEWAL_DOCUMENTS_TO_PURGE,
    });
    if (documents.length === MAX_RENEWAL_DOCUMENTS_TO_PURGE) {
      // Plafond atteint : des fichiers au-delà resteraient orphelins en
      // stockage. Pas d'identifiant utilisateur dans le log.
      this.logger.warn(
        `Account deletion: renewal document read hit the ${MAX_RENEWAL_DOCUMENTS_TO_PURGE} cap — remaining files may be orphaned, run scripts/list-orphan-renewal-blobs.ts`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.seatBooking.deleteMany({ where: { userId } }),
      this.prisma.registration.deleteMany({ where: { userId } }),
      // Inscriptions d'autrui où l'utilisateur est partenaire : la FK passerait
      // en SetNull, mais partnerName garde une copie de son nom complet.
      this.prisma.registration.updateMany({
        where: { partnerUserId: userId },
        data: { partnerUserId: null, partnerName: null },
      }),
      // Le SetNull de proposedById laisserait le commentaire libre, qui peut
      // identifier son auteur : il est effacé avant la suppression du compte.
      this.prisma.trackCorrection.updateMany({
        where: { proposedById: userId },
        data: { message: null },
      }),
      // BugReport.userId n'a pas de FK (report.prisma) : suppression explicite.
      this.prisma.bugReport.deleteMany({ where: { userId } }),
      // Back-office audit rows about this person would outlive the account.
      // Rows the user authored as an admin stay (actorId -> SetNull).
      this.prisma.adminAuditLog.deleteMany({
        where: { targetType: 'USER', targetId: userId },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
      ...alsoInTransaction,
    ]);
    await this.renewalDocumentFiles.deleteFiles(
      documents.map((d) => d.filePath),
      'account-deletion',
    );
  }
}
```

- [ ] **Step 3: Delegate from `UsersService` and wire the module**

In `apps/backend/src/users/users.service.ts`:

1. Remove `Logger` from the `@nestjs/common` import, the `RenewalDocumentFileCleaner` import, `licenseRenewalDocumentFileSelect` from the `prisma-selects` import, the `MAX_RENEWAL_DOCUMENTS_TO_PURGE` constant and its comment (lines ~22-26), and the `private readonly logger = new Logger(UsersService.name);` field.
2. Add `import { AccountDeletionService } from "./account-deletion.service";`.
3. Constructor:
   ```ts
     constructor(
       private prisma: PrismaService,
       private accountDeletion: AccountDeletionService,
     ) {}
   ```
4. Replace the JSDoc and body of `deleteMyAccount` with:

```ts
  /**
   * Droit à l'oubli (RGPD art. 17) + exigence Apple 5.1.1(v) : suppression
   * de compte in-app. Le mot de passe courant est vérifié (un token volé ne
   * suffit pas), puis le cœur partagé efface tout (AccountDeletionService).
   */
  async deleteMyAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Mot de passe incorrect");
    }
    await this.accountDeletion.deleteAccount(userId);
  }
```

`apps/backend/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, AccountDeletionService],
  exports: [UsersService, AccountDeletionService],
})
export class UsersModule {}
```

In `apps/backend/src/users/users.service.spec.ts` (behaviour assertions unchanged):

1. Replace `import { MAX_RENEWAL_DOCUMENTS_TO_PURGE, UsersService } from "./users.service";` with:
   ```ts
   import {
     AccountDeletionService,
     MAX_RENEWAL_DOCUMENTS_TO_PURGE,
   } from './account-deletion.service';
   import { UsersService } from './users.service';
   ```
2. In the `providers` array of the suite's `Test.createTestingModule`, add `AccountDeletionService,` right after `UsersService,` (the real service, fed by the same mocked `PrismaService` and `RenewalDocumentFileCleaner`, so every existing `deleteMyAccount` assertion still runs against the real purge).

- [ ] **Step 4: Run the users suite**

Run: `pnpm --filter backend exec jest src/users`
Expected: PASS — the new spec and every existing `deleteMyAccount` test (transaction order, partner anonymisation, files after the transaction, cap warning) unchanged.

- [ ] **Step 5: Typecheck, lint, users coverage**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/users
pnpm --filter backend exec jest --coverage --silent
```

Expected: no errors; `src/users` stays at 96 / 85 / 100 / 96.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/users
git commit -m "refactor(users): extract the account deletion core into AccountDeletionService

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 3: Admin users — status filter and activate / deactivate

**Files:**

- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminUserListSelect`, `adminUserDetailSelect`, new `adminUserStatusSelect`)
- Modify: `apps/backend/src/admin/dto/admin-audit.dto.ts` (`AUDIT_ACTIONS`)
- Modify: `apps/backend/src/admin/dto/admin-users.dto.ts` (status filter, `disabledAt`, `clubDisabledAt`)
- Create: `apps/backend/src/admin/dto/admin-actions.dto.ts` (`SetActiveDto`)
- Modify: `apps/backend/src/admin/admin-users.query-service.ts`, `apps/backend/src/admin/admin-users.query-service.spec.ts`
- Modify: `apps/backend/src/admin/admin-users.service.ts`, `apps/backend/src/admin/admin-users.service.spec.ts`
- Modify: `apps/backend/src/admin/admin.controller.ts`, `apps/backend/src/admin/admin.controller.spec.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts`, `apps/backend/test/admin.integration-spec.ts`

**Interfaces:**

- Consumes: `User.disabledAt`, `Club.disabledAt`, `ACCOUNT_DISABLED_MESSAGE` (Task 1).
- Produces:
  - `AUDIT_ACTIONS` gains `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`, `USER_DELETE`, `CLUB_UPDATE`, `CLUB_DISABLE`, `CLUB_ENABLE`, `CLUB_DELETE` (all eight now; later tasks only use them).
  - `ACCOUNT_STATUSES = ["active", "disabled"] as const`, `type AccountStatusFilter` (in `dto/admin-users.dto.ts`, reused by Task 6).
  - `ListAdminUsersQueryDto.status?: AccountStatusFilter`; `AdminUserListItemDto.disabledAt: Date | null`; `AdminUserDetailDto.clubDisabledAt: Date | null`.
  - `SetActiveDto { active: boolean }` (in `dto/admin-actions.dto.ts`, reused by Task 7).
  - `AdminUsersService.setStatus(actorId: string, userId: string, active: boolean): Promise<AdminUserDetailDto>`.
  - Route `POST /admin/users/:id/status` → controller method `setUserStatus` (SDK name `adminControllerSetUserStatus`).

- [ ] **Step 1: Selects, DTOs and audit actions**

`apps/backend/src/utils/prisma-selects.ts`:

- In `adminUserListSelect`, add `disabledAt: true,` after `createdAt: true,`.
- In `adminUserDetailSelect`, add after `updatedAt: true,`:
  ```ts
    // Why a CLUB account may be blocked although the account itself is active.
    club: { select: { disabledAt: true } },
  ```
- Append:
  ```ts
  /** Back-office status toggle: current state only. */
  export const adminUserStatusSelect = { id: true, disabledAt: true } as const;
  ```

`apps/backend/src/admin/dto/admin-audit.dto.ts` — replace `AUDIT_ACTIONS`:

```ts
export const AUDIT_ACTIONS = [
  'USER_UPDATE',
  // Lot 1 rows only; accounts created since lot 1b are logged as USER_CREATE.
  'CLUB_ACCOUNT_CREATE',
  'INVITATION_RESEND',
  'USER_CREATE',
  'USER_DISABLE',
  'USER_ENABLE',
  'USER_DELETE',
  'CLUB_UPDATE',
  'CLUB_DISABLE',
  'CLUB_ENABLE',
  'CLUB_DELETE',
] as const;
```

`apps/backend/src/admin/dto/admin-users.dto.ts`:

- Add `IsIn` to the `class-validator` import.
- After `export type LicenseStatus = ...;` add:
  ```ts
  export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;
  export type AccountStatusFilter = (typeof ACCOUNT_STATUSES)[number];
  ```
- In `ListAdminUsersQueryDto`, after `category`:
  ```ts
    @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
    @IsOptional()
    @IsIn(ACCOUNT_STATUSES)
    status?: AccountStatusFilter;
  ```
- In `AdminUserListItemDto`, after `createdAt`:
  ```ts
    @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
  ```
- In `AdminUserDetailDto`, after `lastLoginAt`:
  ```ts
    @ApiProperty({
      nullable: true,
      type: Date,
      description: "Désactivation du club rattaché (bloque un compte CLUB)",
    })
    clubDisabledAt!: Date | null;
  ```

`apps/backend/src/admin/dto/admin-actions.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Activate (true) or deactivate (false) a user or a club. */
export class SetActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}
```

- [ ] **Step 2: Failing tests for the list filter and the detail**

In `apps/backend/src/admin/admin-users.query-service.spec.ts`, append inside `describe("AdminUsersQueryService", ...)`:

```ts
it.each([
  ['active', { disabledAt: null }],
  ['disabled', { disabledAt: { not: null } }],
] as const)('filters on status %s', async (status, where) => {
  prisma.user.count.mockResolvedValue(0);
  prisma.user.findMany.mockResolvedValue([]);
  await service.list({ status });
  expect(prisma.user.findMany.mock.calls[0][0]?.where).toEqual(where);
});

it('detail exposes the club deactivation and hides the relation', async () => {
  const at = new Date('2026-10-07T10:00:00Z');
  prisma.user.findUnique.mockResolvedValue({
    ...row,
    disabledAt: null,
    club: { disabledAt: at },
    license: null,
  } as never);
  const d = await service.detail('u1');
  expect(d.clubDisabledAt).toEqual(at);
  expect(d).not.toHaveProperty('club');
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-users.query-service.spec.ts`
Expected: FAIL on both (no status in `where`, no `clubDisabledAt`).

- [ ] **Step 3: Implement the filter and the mapping**

In `apps/backend/src/admin/admin-users.query-service.ts`, in `list`, add after the `category` line of `where`:

```ts
      ...(q.status && {
        disabledAt: q.status === "active" ? null : { not: null },
      }),
```

and replace the body of `detail` after the 404 check with:

```ts
const { license, club, ...rest } = row;
return {
  ...rest,
  clubDisabledAt: club?.disabledAt ?? null,
  licenseStatus: licenseStatus(license, new Date()),
  licenseNumber: license?.number ?? null,
  licenseValidUntil: license?.validUntil ?? null,
};
```

Run: `pnpm --filter backend exec jest src/admin/admin-users.query-service.spec.ts`
Expected: PASS.

- [ ] **Step 4: Failing tests for `setStatus`**

In `apps/backend/src/admin/admin-users.service.spec.ts`, append a new top-level `describe` at the end of the file (a sibling of `describe("AdminUsersService.update", ...)`, with its own module setup):

```ts
describe('AdminUsersService.setStatus', () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock; recordOp: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    prisma.user.update.mockResolvedValue({} as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 } as never);
    audit = { record: jest.fn(), recordOp: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: 'u1' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
        { provide: AuthTokenService, useValue: { revokeAllUserTokens: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it('deactivates, revokes every session and audits, in one transaction', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      disabledAt: null,
    } as never);

    await expect(service.setStatus('admin-1', 'u1', false)).resolves.toEqual({
      id: 'u1',
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { disabledAt: expect.any(Date) as unknown },
      select: { id: true },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revoked: false },
      data: { revoked: true, revokedAt: expect.any(Date) as unknown },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: 'admin-1',
      action: 'USER_DISABLE',
      targetType: 'USER',
      targetId: 'u1',
    });
  });

  it('reactivates without touching sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      disabledAt: new Date(),
    } as never);

    await service.setStatus('admin-1', 'u1', true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { disabledAt: null },
      select: { id: true },
    });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'USER_ENABLE' }),
    );
  });

  it.each([
    [false, new Date()],
    [true, null],
  ])(
    'is idempotent: active=%s on an account already in that state writes nothing',
    async (active, disabledAt) => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        disabledAt,
      } as never);

      await expect(service.setStatus('admin-1', 'u1', active)).resolves.toEqual({ id: 'u1' });

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("refuses the admin's own account before reading anything", async () => {
    await expect(service.setStatus('u1', 'u1', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('404s on an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.setStatus('admin-1', 'nope', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Also change the existing `audit` mock of `describe("AdminUsersService.update", ...)` to `{ record: jest.fn(), recordOp: jest.fn() }` and its type to `{ record: jest.Mock; recordOp: jest.Mock }` (Task 4 uses `recordOp`).

Run: `pnpm --filter backend exec jest src/admin/admin-users.service.spec.ts`
Expected: FAIL, `service.setStatus is not a function`.

- [ ] **Step 5: Implement `setStatus`**

In `apps/backend/src/admin/admin-users.service.ts`, add `adminUserStatusSelect` to the `prisma-selects` import and add the method after `update`:

```ts
  /**
   * Reversible measure. Deactivation revokes every refresh token in the same
   * transaction; live access tokens are refused by JwtStrategy right away.
   * Asking for the state already in place writes and audits nothing.
   */
  async setStatus(
    actorId: string,
    userId: string,
    active: boolean,
  ): Promise<AdminUserDetailDto> {
    if (actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas changer le statut de son propre compte",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: adminUserStatusSelect,
      });
      if (!current) throw new NotFoundException("Utilisateur introuvable");
      if ((current.disabledAt === null) === active) return;

      await tx.user.update({
        where: { id: userId },
        data: { disabledAt: active ? null : new Date() },
        select: { id: true },
      });
      if (!active) {
        await tx.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true, revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        actorId,
        action: active ? "USER_ENABLE" : "USER_DISABLE",
        targetType: "USER",
        targetId: userId,
      });
    });
    return this.query.detail(userId);
  }
```

Run: `pnpm --filter backend exec jest src/admin/admin-users.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Route, controller test, role matrix**

`apps/backend/src/admin/admin.controller.ts`:

- Add `import { SetActiveDto } from "./dto/admin-actions.dto";`.
- Rename the user-facing summaries: `"Liste paginée des inscrits"` → `"Liste paginée des utilisateurs"`, `"Fiche d'un inscrit"` → `"Fiche d'un utilisateur"`, `"Modifier la fiche d'un inscrit"` → `"Modifier la fiche d'un utilisateur"`.
- Add after `updateUser`:

```ts
  @Post("users/:id/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Activer ou désactiver un utilisateur" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 403, description: "Son propre compte" })
  setUserStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminUserDetailDto> {
    return this.users.setStatus(req.user.userId, id, dto.active);
  }
```

`apps/backend/src/admin/admin.controller.spec.ts`: change `const users = { update: jest.fn() };` to `const users = { update: jest.fn(), setStatus: jest.fn() };` and add:

```ts
it("passes the acting admin id when changing a user's status", async () => {
  users.setStatus.mockResolvedValue({ id: 'u1' });
  await controller.setUserStatus('u1', { active: false }, req);
  expect(users.setStatus).toHaveBeenCalledWith('admin-1', 'u1', false);
});
```

`apps/backend/test/admin.e2e-spec.ts`: add to `ADMIN_ROUTES`:

```ts
  [
    "post",
    "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/status",
  ],
```

Run:

```bash
pnpm --filter backend exec jest src/admin
cd apps/backend && pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec
```

Expected: PASS.

- [ ] **Step 7: Real-DB integration — deactivation cuts login, refresh and live tokens**

In `apps/backend/test/admin.integration-spec.ts`:

1. Add imports:
   ```ts
   import { UnauthorizedException } from '@nestjs/common';
   import * as bcrypt from 'bcrypt';
   import { AuthService } from '../src/auth/auth.service';
   import { AuthTokenService } from '../src/auth/auth-token.service';
   import { JwtStrategy } from '../src/auth/jwt.strategy';
   ```
2. Replace `userData` with a version later tasks also use:

   ```ts
   const PASSWORD = 'Secret-123!';

   const userData = (o: {
     role?: UserRole;
     lastName?: string;
     password?: string;
     clubId?: string;
     clubName?: string;
   }) => ({
     email: `${randomUUID()}@test.local`,
     password: o.password ?? 'x',
     firstName: 'Test',
     lastName: o.lastName ?? 'User',
     role: o.role ?? UserRole.LICENSEE,
     ...(o.clubId && { clubId: o.clubId }),
     ...(o.clubName && { clubName: o.clubName }),
   });
   ```

3. Declare `let auth: AuthService; let tokens: AuthTokenService; let strategy: JwtStrategy;` and in `beforeAll` add:
   ```ts
   auth = moduleRef.get(AuthService);
   tokens = moduleRef.get(AuthTokenService);
   strategy = moduleRef.get(JwtStrategy);
   ```
4. Append:

```ts
it('a deactivated user cannot log in, refresh or use a live token, until reactivated', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const target = await create({
    password: await bcrypt.hash(PASSWORD, 12),
  });
  const refresh = await tokens.createRefreshToken(target.id);

  await service.setStatus(admin.id, target.id, false);

  await expect(auth.validateUser(target.email, PASSWORD)).rejects.toThrow(
    'Compte désactivé. Contactez la fédération.',
  );
  await expect(tokens.refreshAccessToken(refresh.token)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );
  await expect(
    strategy.validate({
      sub: target.id,
      email: target.email,
      role: target.role,
    }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
  expect(
    await prisma.adminAuditLog.count({
      where: { targetId: target.id, action: 'USER_DISABLE' },
    }),
  ).toBe(1);

  await service.setStatus(admin.id, target.id, true);
  await expect(auth.validateUser(target.email, PASSWORD)).resolves.toMatchObject({ id: target.id });
});
```

Run (real DB, see "How to run tests"):

```bash
cd apps/backend
source "$(git rev-parse --show-toplevel)/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh"
pnpm exec jest --config test/jest-integration.json --runInBand --forceExit admin.integration-spec
```

Expected: PASS (lot 1 tests + the new one).

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/admin src/utils test/admin.e2e-spec.ts test/admin.integration-spec.ts
git add apps/backend/src/admin apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): activate and deactivate users, with a status filter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 4: Admin users — delete

**Files:**

- Modify: `apps/backend/src/admin/admin-audit.service.ts`, `apps/backend/src/admin/admin-audit.service.spec.ts` (`recordOp`)
- Modify: `apps/backend/src/admin/dto/admin-actions.dto.ts` (`DeleteAdminUserDto`)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminUserDeletionTargetSelect`)
- Modify: `apps/backend/src/admin/admin-users.service.ts`, `apps/backend/src/admin/admin-users.service.spec.ts`
- Modify: `apps/backend/src/admin/admin.module.ts` (import `UsersModule`)
- Modify: `apps/backend/src/admin/admin.controller.ts`, `apps/backend/src/admin/admin.controller.spec.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts`, `apps/backend/test/admin.integration-spec.ts`

**Interfaces:**

- Consumes: `AccountDeletionService.deleteAccount(userId, alsoInTransaction)` (Task 2); `AUDIT_ACTIONS` with `USER_DELETE` (Task 3); test helpers `create`, `tokens` in the integration spec (Task 3).
- Produces:
  - `AdminAuditService.recordOp(entry: AuditEntry): Prisma.PrismaPromise<{ id: string }>` — same row as `record`, for array transactions.
  - `DeleteAdminUserDto { confirmEmail: string }`.
  - `AdminUsersService.delete(actorId: string, userId: string, confirmEmail: string): Promise<void>`.
  - Route `DELETE /admin/users/:id` (204) → controller method `deleteUser` (SDK `adminControllerDeleteUser`).

- [ ] **Step 1: Failing test for `recordOp`**

In `apps/backend/src/admin/admin-audit.service.spec.ts`, append:

```ts
it('builds the same row as an operation for array transactions', () => {
  prisma.adminAuditLog.create.mockReturnValue('create-op' as never);

  const op = service.recordOp({
    actorId: 'admin-1',
    action: 'USER_DELETE',
    targetType: 'USER',
    targetId: 'u1',
    after: { role: 'LICENSEE' },
  });

  expect(op).toBe('create-op');
  expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
    data: {
      actorId: 'admin-1',
      action: 'USER_DELETE',
      targetType: 'USER',
      targetId: 'u1',
      before: undefined,
      after: { role: 'LICENSEE' },
    },
    select: { id: true },
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-audit.service.spec.ts`
Expected: FAIL, `service.recordOp is not a function`.

- [ ] **Step 2: Implement `recordOp`**

In `apps/backend/src/admin/admin-audit.service.ts`, add above the class:

```ts
function toCreateData(entry: AuditEntry): Prisma.AdminAuditLogUncheckedCreateInput {
  return {
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before as Prisma.InputJsonValue | undefined,
    after: entry.after as Prisma.InputJsonValue | undefined,
  };
}
```

and replace `record` with:

```ts
  /** Must be called with the transaction client of the audited write. */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.adminAuditLog.create({
      data: toCreateData(entry),
      select: { id: true },
    });
  }

  /** Same row, as an operation for an array-form `$transaction([...])`. */
  recordOp(entry: AuditEntry): Prisma.PrismaPromise<{ id: string }> {
    return this.prisma.adminAuditLog.create({
      data: toCreateData(entry),
      select: { id: true },
    });
  }
```

Run: `pnpm --filter backend exec jest src/admin/admin-audit.service.spec.ts`
Expected: PASS (the existing `record` test is unchanged).

- [ ] **Step 3: DTO and select**

Append to `apps/backend/src/admin/dto/admin-actions.dto.ts` (`ApiProperty` is already imported there):

```ts
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/** The admin re-types the account's email to confirm a final deletion. */
export class DeleteAdminUserDto {
  @ApiProperty({ description: 'Email du compte, recopié pour confirmer' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  confirmEmail!: string;
}
```

(Merge the imports with the existing ones at the top of the file: `import { IsBoolean, IsEmail } from "class-validator";`.)

Append to `apps/backend/src/utils/prisma-selects.ts`:

```ts
/** Back-office deletion: what the confirmation and the audit row need. */
export const adminUserDeletionTargetSelect = {
  id: true,
  email: true,
  role: true,
} as const;
```

- [ ] **Step 4: Failing tests for `delete`**

In `apps/backend/src/admin/admin-users.service.spec.ts`:

1. Add `import { AccountDeletionService } from "../users/account-deletion.service";`.
2. In **both** existing `beforeEach` blocks, add the provider `{ provide: AccountDeletionService, useValue: deletion },` and declare `let deletion: { deleteAccount: jest.Mock };` with `deletion = { deleteAccount: jest.fn().mockResolvedValue(undefined) };` before `Test.createTestingModule`.
3. Append a sibling `describe`:

```ts
describe('AdminUsersService.delete', () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock; recordOp: jest.Mock };
  let deletion: { deleteAccount: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'jeanne@x.fr',
      role: UserRole.LICENSEE,
    } as never);
    audit = { record: jest.fn(), recordOp: jest.fn().mockReturnValue('audit-op') };
    deletion = { deleteAccount: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: { detail: jest.fn() } },
        { provide: AuthTokenService, useValue: { revokeAllUserTokens: jest.fn() } },
        { provide: AccountDeletionService, useValue: deletion },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it('deletes through the shared core, with a role-only audit row in the same transaction', async () => {
    await service.delete('admin-1', 'u1', 'jeanne@x.fr');

    expect(audit.recordOp).toHaveBeenCalledWith({
      actorId: 'admin-1',
      action: 'USER_DELETE',
      targetType: 'USER',
      targetId: 'u1',
      after: { role: UserRole.LICENSEE },
    });
    expect(deletion.deleteAccount).toHaveBeenCalledWith('u1', ['audit-op']);
  });

  it('accepts the email whatever its case and surrounding spaces', async () => {
    await service.delete('admin-1', 'u1', '  JEANNE@X.fr ');
    expect(deletion.deleteAccount).toHaveBeenCalled();
  });

  it('400s when the typed email does not match, deleting nothing', async () => {
    await expect(service.delete('admin-1', 'u1', 'paul@x.fr')).rejects.toThrow(
      new BadRequestException("L'email saisi ne correspond pas au compte"),
    );
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses the admin's own account before reading anything", async () => {
    await expect(service.delete('u1', 'u1', 'jeanne@x.fr')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('404s on an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.delete('admin-1', 'nope', 'a@b.fr')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-users.service.spec.ts`
Expected: FAIL (`AccountDeletionService` not injected / `service.delete is not a function`).

- [ ] **Step 5: Implement `delete` and wire the module**

In `apps/backend/src/admin/admin-users.service.ts`:

- Add imports: `import { AccountDeletionService } from "../users/account-deletion.service";` and `adminUserDeletionTargetSelect` in the `prisma-selects` import.
- Constructor gains a fifth parameter: `private readonly deletion: AccountDeletionService,`.
- Add the method after `setStatus`:

```ts
  /**
   * Final RGPD deletion, same core as the in-app self-service deletion.
   * The admin re-types the email; the audit row keeps only the role and is
   * written in the same transaction, after the purge of rows about the user.
   */
  async delete(
    actorId: string,
    userId: string,
    confirmEmail: string,
  ): Promise<void> {
    if (actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas supprimer son propre compte",
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminUserDeletionTargetSelect,
    });
    if (!target) throw new NotFoundException("Utilisateur introuvable");
    if (target.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw new BadRequestException(
        "L'email saisi ne correspond pas au compte",
      );
    }
    await this.deletion.deleteAccount(userId, [
      this.audit.recordOp({
        actorId,
        action: "USER_DELETE",
        targetType: "USER",
        targetId: userId,
        after: { role: target.role },
      }),
    ]);
  }
```

`apps/backend/src/admin/admin.module.ts`: add `import { UsersModule } from "../users/users.module";` and set `imports: [AuthModule, UsersModule],`.

Run: `pnpm --filter backend exec jest src/admin`
Expected: PASS.

- [ ] **Step 6: Route, controller test, role matrix**

`apps/backend/src/admin/admin.controller.ts`: add `Delete` to the `@nestjs/common` import, `DeleteAdminUserDto` to the `./dto/admin-actions.dto` import, and after `setUserStatus`:

```ts
  @Delete("users/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Supprimer définitivement un utilisateur (RGPD)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 204, description: "Compte supprimé" })
  @ApiResponse({ status: 400, description: "L'email saisi ne correspond pas" })
  @ApiResponse({ status: 403, description: "Son propre compte" })
  deleteUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DeleteAdminUserDto,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.users.delete(req.user.userId, id, dto.confirmEmail);
  }
```

`admin.controller.spec.ts`: `const users = { update: jest.fn(), setStatus: jest.fn(), delete: jest.fn() };` and:

```ts
it('passes the acting admin id and the typed email when deleting a user', async () => {
  users.delete.mockResolvedValue(undefined);
  await controller.deleteUser('u1', { confirmEmail: 'j@x.fr' }, req);
  expect(users.delete).toHaveBeenCalledWith('admin-1', 'u1', 'j@x.fr');
});
```

`test/admin.e2e-spec.ts`: widen the tuple type to `"get" | "patch" | "post" | "delete"` and add:

```ts
  ["delete", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
```

Run: `pnpm --filter backend exec jest src/admin` and the mocked `admin.e2e-spec` (see "How to run tests").
Expected: PASS.

- [ ] **Step 7: Real-DB integration — deletion through the shared core**

Append to `apps/backend/test/admin.integration-spec.ts`:

```ts
it('admin deletion goes through the shared core and keeps one role-only audit row', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const target = await create({ lastName: 'Martin' });
  // An earlier audit row about the target: the core must purge it.
  await service.update(admin.id, target.id, { lastName: 'Durand' });
  await tokens.createRefreshToken(target.id);

  await service.delete(admin.id, target.id, ` ${target.email.toUpperCase()} `);

  expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
  expect(await prisma.refreshToken.count({ where: { userId: target.id } })).toBe(0);
  const rows = await prisma.adminAuditLog.findMany({
    where: { targetId: target.id },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'USER_DELETE',
    actorId: admin.id,
    before: null,
    after: { role: 'LICENSEE' },
  });
});
```

Run the real-DB command (source `test-db.sh` first, see "How to run tests").
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/admin src/utils test/admin.e2e-spec.ts test/admin.integration-spec.ts
git add apps/backend/src/admin apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): delete a user through the shared RGPD deletion core

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 5: Create users of any non-admin role, role-specific invitations

**Files:**

- Modify: `apps/backend/src/auth/email.service.ts`, `apps/backend/src/auth/email.service.spec.ts`
- Rename + rewrite: `apps/backend/src/admin/dto/club-account.dto.ts` → `apps/backend/src/admin/dto/admin-user-accounts.dto.ts`
- Create: `apps/backend/src/admin/dto/admin-user-accounts.dto.spec.ts`
- Rename + rewrite: `apps/backend/src/admin/admin-club-accounts.service.ts` → `apps/backend/src/admin/admin-user-accounts.service.ts`, and its spec → `admin-user-accounts.service.spec.ts`
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminInvitationTargetSelect`)
- Modify: `apps/backend/src/admin/admin.controller.ts`, `apps/backend/src/admin/admin.controller.spec.ts`, `apps/backend/src/admin/admin.module.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts`, `apps/backend/test/admin.integration-spec.ts`

**Interfaces:**

- Consumes: `AUDIT_ACTIONS` with `USER_CREATE` (Task 3); `UpdateAdminUserDto` validators (lot 1); integration helpers `create`, `createdUserIds`, `createdClubIds` (lot 1 / Task 3).
- Produces:
  - `type InvitationRole = Exclude<UserRole, "ADMIN">` (in `src/auth/email.service.ts`).
  - `EmailService.sendInvitationEmail(email: string, token: string, firstName: string, role: InvitationRole): Promise<void>`.
  - `INVITABLE_ROLES: readonly InvitationRole[]`, `CreateAdminUserDto` (`email, firstName, lastName, role, clubId?, clubName?` + optional `category, ageGroup, passportLevelLatin, passportLevelStandard, competitionLevel, nationalRanking`), `AdminUserCreatedDto { userId: string; clubId: string | null; invitationSent: boolean }`, `InvitationResultDto` (unchanged).
  - `AdminUserAccountsService.create(actorId, dto): Promise<AdminUserCreatedDto>`, `.resendInvitation(actorId, userId): Promise<InvitationResultDto>`; `INVITATION_EXPIRY_HOURS = 168` exported from `admin-user-accounts.service.ts`.
  - Route `POST /admin/users` → controller method `createUser` (SDK `adminControllerCreateUser`). `POST /admin/club-accounts` no longer exists.

- [ ] **Step 1: Failing email tests**

In `apps/backend/src/auth/email.service.spec.ts`:

- In `describe("sendInvitationEmail without Resend")`, change the call to `service.sendInvitationEmail("c@x.fr", "tok", "Jo", "CLUB")`.
- In the "with Resend configured" `beforeEach`, make the config mock also answer `FRONTEND_URL`:
  ```ts
  if (key === 'FRONTEND_URL') return 'https://ffd.gabin-simond.fr';
  ```
- Replace the body of `describe("sendInvitationEmail", ...)` with:

```ts
it('sends a club invitation whose link opens the web reset page with the token', async () => {
  await service.sendInvitationEmail('club@example.fr', 'tok123', 'Jeanne', 'CLUB');

  const arg = mockSend.mock.calls[0][0];
  expect(arg.to).toBe('club@example.fr');
  expect(arg.subject).toBe('Votre accès club FFD Connect');
  expect(arg.html).toContain('https://ffd.gabin-simond.fr/reset-password?token=tok123');
  expect(arg.html).toContain('Bonjour Jeanne');
  expect(arg.html).toContain('7 jours');
});

it.each([
  ['LICENSEE', 'Votre compte FFD Connect', 'Un compte licencié'],
  ['CLUB', 'Votre accès club FFD Connect', 'Un compte club'],
  ['STAFF', 'Votre accès staff FFD Connect', 'Un compte staff'],
] as const)('words the %s invitation for that role', async (role, subject, intro) => {
  await service.sendInvitationEmail('a@x.fr', 't', 'Jo', role);
  const arg = mockSend.mock.calls[0][0];
  expect(arg.subject).toBe(subject);
  expect(arg.html).toContain(intro);
});

it('strips HTML from the first name', async () => {
  await service.sendInvitationEmail('c@x.fr', 't', '<b>Jo</b>', 'CLUB');
  expect(mockSend.mock.calls[0][0].html).toContain('Bonjour bJo/b');
});

it('throws when the provider returns an error', async () => {
  mockSend.mockResolvedValue({ data: null, error: { message: 'boom' } });
  await expect(
    service.sendInvitationEmail('club@example.fr', 'tok123', 'Jeanne', 'LICENSEE'),
  ).rejects.toThrow('Failed to send email: boom');
});
```

Run: `pnpm --filter backend exec jest src/auth/email.service.spec.ts`
Expected: FAIL (fourth argument ignored, subjects identical).

- [ ] **Step 2: Role-specific invitation**

In `apps/backend/src/auth/email.service.ts`, add `import { UserRole } from "@prisma/client";` and above the class:

```ts
/** Roles an admin can create and invite. ADMIN is granted afterwards, never invited. */
export type InvitationRole = Exclude<UserRole, 'ADMIN'>;

const INVITATION_COPY: Record<InvitationRole, { subject: string; intro: string; next: string }> = {
  LICENSEE: {
    subject: 'Votre compte FFD Connect',
    intro: "Un compte licencié vient d'être créé pour vous sur FFD Connect.",
    next: "Vous pourrez ensuite vous connecter à l'application avec cet email.",
  },
  CLUB: {
    subject: 'Votre accès club FFD Connect',
    intro: "Un compte club vient d'être créé pour vous sur FFD Connect.",
    next: "Vous pourrez ensuite gérer votre club depuis l'application.",
  },
  STAFF: {
    subject: 'Votre accès staff FFD Connect',
    intro: "Un compte staff vient d'être créé pour vous sur FFD Connect.",
    next: "Vous pourrez ensuite accéder aux outils de la fédération dans l'application.",
  },
};
```

Replace `sendInvitationEmail` and `getInvitationEmailTemplate` with:

```ts
  /** Invitation of an account created from the admin back-office. */
  async sendInvitationEmail(
    email: string,
    token: string,
    firstName: string,
    role: InvitationRole,
  ): Promise<void> {
    const url = `${
      this.configService.get<string>("FRONTEND_URL") ?? "http://localhost:3000"
    }/reset-password?token=${token}`;
    const copy = INVITATION_COPY[role];

    if (!this.resend) {
      this.logger.log(
        `Invitation email for ${email} (no Resend config, URL not sent)`,
      );
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: copy.subject,
      html: this.getInvitationEmailTemplate(url, firstName, copy),
    });
    if (error) {
      this.logger.error(`Failed to send invitation email: ${error.message}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }
    this.logger.log(`Invitation email sent to ${email} (ID: ${data.id})`);
  }

  private getInvitationEmailTemplate(
    url: string,
    firstName: string,
    copy: { subject: string; intro: string; next: string },
  ): string {
    const safeName = firstName.replace(/[<>&"']/g, "");
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>${copy.subject}</title></head>
        <body style="font-family: Arial, sans-serif; color: #222; max-width: 560px; margin: auto;">
          <p>Bonjour ${safeName},</p>
          <p>${copy.intro}</p>
          <p>Pour l'activer, choisissez votre mot de passe :</p>
          <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;">Définir mon mot de passe</a></p>
          <p>Ce lien est valable 7 jours et ne peut servir qu'une fois.</p>
          <p>${copy.next}</p>
          <p>Si vous n'attendiez pas cet email, ignorez-le.</p>
        </body>
      </html>`;
  }
```

Run: `pnpm --filter backend exec jest src/auth/email.service.spec.ts`
Expected: PASS.

- [ ] **Step 3: Rename the files and write the DTO**

```bash
cd apps/backend/src/admin
git mv dto/club-account.dto.ts dto/admin-user-accounts.dto.ts
git mv admin-club-accounts.service.ts admin-user-accounts.service.ts
git mv admin-club-accounts.service.spec.ts admin-user-accounts.service.spec.ts
```

Replace `apps/backend/src/admin/dto/admin-user-accounts.dto.ts` with:

```ts
import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { InvitationRole } from '../../auth/email.service';
import { UpdateAdminUserDto } from './update-admin-user.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** ADMIN is never created here: it is granted afterwards from the user page. */
export const INVITABLE_ROLES: readonly InvitationRole[] = [
  UserRole.LICENSEE,
  UserRole.CLUB,
  UserRole.STAFF,
];

/** Optional profile fields reuse the PATCH validation (reference lists). */
export class CreateAdminUserDto extends PickType(UpdateAdminUserDto, [
  'category',
  'ageGroup',
  'passportLevelLatin',
  'passportLevelStandard',
  'competitionLevel',
  'nationalRanking',
] as const) {
  @ApiProperty()
  @Transform(trim)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName!: string;

  @ApiProperty({ enum: [...INVITABLE_ROLES] })
  @IsIn([...INVITABLE_ROLES])
  role!: InvitationRole;

  @ApiPropertyOptional({
    description: 'Club existant (exclusif avec clubName)',
  })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({
    description: 'Nouveau club, uniquement pour un compte Club (exclusif avec clubId)',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  clubName?: string;
}

export class AdminUserCreatedDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ nullable: true, type: String }) clubId!: string | null;
  @ApiProperty() invitationSent!: boolean;
}

export class InvitationResultDto {
  @ApiProperty() invitationSent!: boolean;
}
```

`apps/backend/src/admin/dto/admin-user-accounts.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAdminUserDto } from './admin-user-accounts.dto';

describe('CreateAdminUserDto', () => {
  const base = { email: 'a@b.fr', firstName: 'A', lastName: 'B' };
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(CreateAdminUserDto, body))).map((e) => e.property);

  it.each(['LICENSEE', 'CLUB', 'STAFF'])('accepts role %s', async (role) => {
    expect(await errorsOf({ ...base, role })).toEqual([]);
  });

  it('never accepts ADMIN', async () => {
    expect(await errorsOf({ ...base, role: 'ADMIN' })).toEqual(['role']);
  });

  it('validates optional profile fields against the reference lists', async () => {
    expect(
      await errorsOf({
        ...base,
        role: 'LICENSEE',
        category: 'Latin',
        nationalRanking: 12,
      }),
    ).toEqual([]);
    expect(await errorsOf({ ...base, role: 'LICENSEE', category: 'Latine' })).toEqual(['category']);
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/dto`
Expected: PASS (the DTO compiles on its own; the service still imports the old names and fails typecheck until Step 5 — do not run `typecheck` yet).

- [ ] **Step 4: Rewrite the service spec (failing)**

Replace `apps/backend/src/admin/admin-user-accounts.service.spec.ts` with:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { AuthPasswordService } from '../auth/auth-password.service';
import { EmailService } from '../auth/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminUserAccountsService, INVITATION_EXPIRY_HOURS } from './admin-user-accounts.service';
import type { CreateAdminUserDto } from './dto/admin-user-accounts.dto';

describe('AdminUserAccountsService', () => {
  let service: AdminUserAccountsService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let passwords: { issuePasswordToken: jest.Mock };
  let email: { sendInvitationEmail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.club.findUnique.mockResolvedValue(null);
    prisma.club.create.mockResolvedValue({
      id: 'c-new',
      name: 'Club Neuf',
    } as never);
    prisma.user.create.mockResolvedValue({ id: 'u-new' } as never);
    audit = { record: jest.fn() };
    passwords = { issuePasswordToken: jest.fn().mockResolvedValue('plain') };
    email = { sendInvitationEmail: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUserAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AuthPasswordService, useValue: passwords },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(AdminUserAccountsService);
  });

  const base = {
    email: ' Jeanne@Example.FR ',
    firstName: 'Jeanne',
    lastName: 'Martin',
  };
  const dto = (o: Partial<CreateAdminUserDto>): CreateAdminUserDto =>
    ({ ...base, role: UserRole.LICENSEE, ...o }) as CreateAdminUserDto;

  it('creates a CLUB account with a new club, audits USER_CREATE, then invites', async () => {
    const res = await service.create(
      'admin-1',
      dto({ role: UserRole.CLUB, clubName: ' Club Neuf ' }),
    );

    expect(prisma.club.create).toHaveBeenCalledWith({
      data: { name: 'Club Neuf' },
      select: { id: true, name: true },
    });
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      email: 'jeanne@example.fr',
      firstName: 'Jeanne',
      lastName: 'Martin',
      role: UserRole.CLUB,
      clubId: 'c-new',
      clubName: 'Club Neuf',
    });
    expect(userData.password).toMatch(/^\$2[aby]\$/);
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: 'admin-1',
      action: 'USER_CREATE',
      targetType: 'USER',
      targetId: 'u-new',
      after: {
        email: 'jeanne@example.fr',
        role: 'CLUB',
        clubId: 'c-new',
        clubName: 'Club Neuf',
      },
    });
    expect(passwords.issuePasswordToken).toHaveBeenCalledWith('u-new', INVITATION_EXPIRY_HOURS);
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      'jeanne@example.fr',
      'plain',
      'Jeanne',
      UserRole.CLUB,
    );
    expect(res).toEqual({
      userId: 'u-new',
      clubId: 'c-new',
      invitationSent: true,
    });
  });

  it('creates a licensee without club, with the profile fields it was given', async () => {
    const res = await service.create(
      'admin-1',
      dto({ category: 'Latin', nationalRanking: 12, ageGroup: null }),
    );

    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      role: UserRole.LICENSEE,
      clubId: null,
      clubName: null,
      category: 'Latin',
      nationalRanking: 12,
    });
    expect(userData.ageGroup).toBeUndefined();
    expect(audit.record.mock.calls[0][1].after).toEqual({
      email: 'jeanne@example.fr',
      role: 'LICENSEE',
      category: 'Latin',
      nationalRanking: 12,
    });
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      'jeanne@example.fr',
      'plain',
      'Jeanne',
      UserRole.LICENSEE,
    );
    expect(res.clubId).toBeNull();
  });

  it('attaches a STAFF account to an existing club by id', async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Club A',
    } as never);
    await service.create('admin-1', dto({ role: UserRole.STAFF, clubId: 'c1' }));
    expect(prisma.club.create).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      role: UserRole.STAFF,
      clubId: 'c1',
      clubName: 'Club A',
    });
  });

  it.each([
    ['a new club for a non-Club role', { clubName: 'Club Neuf' }],
    ['a Club account without club', { role: UserRole.CLUB }],
    ['both clubId and clubName', { role: UserRole.CLUB, clubId: 'c1', clubName: 'A' }],
  ] as const)('400s on %s, writing nothing', async (_label, o) => {
    await expect(service.create('admin-1', dto(o))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('400s on an unknown club id', async () => {
    await expect(service.create('admin-1', dto({ clubId: 'c9' }))).rejects.toThrow(
      new BadRequestException('Club introuvable'),
    );
  });

  it('409s on an email already used, looked up in normalised form', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'x' } as never);
    await expect(service.create('admin-1', dto({}))).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'jeanne@example.fr' },
      select: { id: true },
    });
  });

  it('409s with the existing club id when the new club name exists', async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Club A',
    } as never);
    await expect(
      service.create('admin-1', dto({ role: UserRole.CLUB, clubName: 'Club A' })),
    ).rejects.toMatchObject({ response: { existingClubId: 'c1' } });
  });

  it('keeps the account and reports invitationSent=false when the email fails', async () => {
    email.sendInvitationEmail.mockRejectedValue(new Error('down'));
    const res = await service.create('admin-1', dto({}));
    expect(res.invitationSent).toBe(false);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  describe('concurrent duplicates (P2002)', () => {
    const p2002 = (target: string[]) =>
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target },
      });

    it('maps an email race to a 409', async () => {
      prisma.user.create.mockRejectedValue(p2002(['email']));
      await expect(service.create('admin-1', dto({}))).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          message: 'Cet email est déjà utilisé',
        }),
      });
    });

    it('maps a club-name race to a 409 carrying existingClubId', async () => {
      prisma.club.create.mockRejectedValue(p2002(['name']));
      prisma.club.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'c9', name: 'Club Neuf' } as never);
      await expect(
        service.create('admin-1', dto({ role: UserRole.CLUB, clubName: 'Club Neuf' })),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          message: 'Un club porte déjà ce nom',
          existingClubId: 'c9',
        },
      });
    });

    it('rethrows anything that is not a P2002', async () => {
      const boom = new Error('db down');
      prisma.user.create.mockRejectedValue(boom);
      await expect(service.create('admin-1', dto({}))).rejects.toBe(boom);
    });
  });

  describe('resendInvitation', () => {
    const target = {
      id: 'u1',
      email: 'j@x.fr',
      firstName: 'J',
      role: UserRole.LICENSEE,
      lastLoginAt: null,
      disabledAt: null,
    };

    it("re-issues a token for any non-admin role, with that role's wording, and audits", async () => {
      prisma.user.findUnique.mockResolvedValue(target as never);
      const res = await service.resendInvitation('admin-1', 'u1');
      expect(passwords.issuePasswordToken).toHaveBeenCalledWith('u1', INVITATION_EXPIRY_HOURS);
      expect(email.sendInvitationEmail).toHaveBeenCalledWith(
        'j@x.fr',
        'plain',
        'J',
        UserRole.LICENSEE,
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'INVITATION_RESEND', targetId: 'u1' }),
      );
      expect(res).toEqual({ invitationSent: true });
    });

    it.each([
      [
        'an ADMIN account',
        { role: UserRole.ADMIN },
        "Un compte administrateur ne reçoit pas d'invitation",
      ],
      [
        'an account that has logged in',
        { lastLoginAt: new Date() },
        "Ce compte s'est déjà connecté",
      ],
      ['a disabled account', { disabledAt: new Date() }, 'Ce compte est désactivé'],
    ])('400s for %s, without auditing or mailing', async (_l, o, message) => {
      prisma.user.findUnique.mockResolvedValue({ ...target, ...o } as never);
      await expect(service.resendInvitation('admin-1', 'u1')).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(passwords.issuePasswordToken).not.toHaveBeenCalled();
    });

    it('404s on an unknown user', async () => {
      await expect(service.resendInvitation('admin-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-user-accounts.service.spec.ts`
Expected: FAIL (`AdminUserAccountsService` is not exported yet).

- [ ] **Step 5: Rewrite the service**

In `apps/backend/src/utils/prisma-selects.ts`, add `disabledAt: true,` to `adminInvitationTargetSelect` (after `lastLoginAt: true,`).

Replace `apps/backend/src/admin/admin-user-accounts.service.ts` with:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthPasswordService } from '../auth/auth-password.service';
import { EmailService, InvitationRole } from '../auth/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { adminClubOptionSelect, adminInvitationTargetSelect } from '../utils/prisma-selects';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminUserCreatedDto,
  CreateAdminUserDto,
  InvitationResultDto,
} from './dto/admin-user-accounts.dto';

export const INVITATION_EXPIRY_HOURS = 168;
const BCRYPT_ROUNDS = 12;

/** Profile fields the admin filled; null and absent both mean "not set". */
function profileOf(dto: CreateAdminUserDto) {
  return {
    category: dto.category ?? undefined,
    ageGroup: dto.ageGroup ?? undefined,
    passportLevelLatin: dto.passportLevelLatin ?? undefined,
    passportLevelStandard: dto.passportLevelStandard ?? undefined,
    competitionLevel: dto.competitionLevel ?? undefined,
    nationalRanking: dto.nationalRanking ?? undefined,
  };
}

const definedOnly = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Accounts created by an admin; the person sets the password by email. */
@Injectable()
export class AdminUserAccountsService {
  private readonly logger = new Logger(AdminUserAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly passwords: AuthPasswordService,
    private readonly email: EmailService,
  ) {}

  async create(actorId: string, dto: CreateAdminUserDto): Promise<AdminUserCreatedDto> {
    this.checkClubChoice(dto);
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const profile = profileOf(dto);
    // Unusable secret: the person sets the real password via the invitation.
    const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

    let created: {
      userId: string;
      club: { id: string; name: string } | null;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const taken = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (taken) throw new ConflictException('Cet email est déjà utilisé');

        const club = await this.resolveClub(tx, dto);
        const user = await tx.user.create({
          data: {
            email,
            password,
            firstName,
            lastName,
            role: dto.role,
            clubId: club?.id ?? null,
            clubName: club?.name ?? null,
            ...profile,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId,
          action: 'USER_CREATE',
          targetType: 'USER',
          targetId: user.id,
          after: {
            email,
            role: dto.role,
            ...(club && { clubId: club.id, clubName: club.name }),
            ...definedOnly(profile),
          },
        });
        return { userId: user.id, club };
      });
    } catch (err) {
      throw await this.mapUniqueViolation(err, dto);
    }

    const invitationSent = await this.sendInvitation(created.userId, email, firstName, dto.role);
    return {
      userId: created.userId,
      clubId: created.club?.id ?? null,
      invitationSent,
    };
  }

  async resendInvitation(actorId: string, userId: string): Promise<InvitationResultDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminInvitationTargetSelect,
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException("Un compte administrateur ne reçoit pas d'invitation");
    }
    if (user.lastLoginAt) {
      throw new BadRequestException("Ce compte s'est déjà connecté");
    }
    if (user.disabledAt) {
      throw new BadRequestException('Ce compte est désactivé');
    }
    const role: InvitationRole = user.role;
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId,
        action: 'INVITATION_RESEND',
        targetType: 'USER',
        targetId: user.id,
      });
    });
    const invitationSent = await this.sendInvitation(user.id, user.email, user.firstName, role);
    return { invitationSent };
  }

  /** A new club only for a CLUB account; a CLUB account always has a club. */
  private checkClubChoice(dto: CreateAdminUserDto): void {
    if (dto.clubId && dto.clubName) {
      throw new BadRequestException(
        "Indiquer soit un club existant, soit le nom d'un nouveau club",
      );
    }
    if (dto.clubName && dto.role !== UserRole.CLUB) {
      throw new BadRequestException('Seul un compte Club peut créer un nouveau club');
    }
    if (dto.role === UserRole.CLUB && !dto.clubId && !dto.clubName) {
      throw new BadRequestException('Un compte Club doit être rattaché à un club');
    }
  }

  private async resolveClub(
    tx: Prisma.TransactionClient,
    dto: CreateAdminUserDto,
  ): Promise<{ id: string; name: string } | null> {
    if (dto.clubId) {
      const existing = await tx.club.findUnique({
        where: { id: dto.clubId },
        select: adminClubOptionSelect,
      });
      if (!existing) throw new BadRequestException('Club introuvable');
      return existing;
    }
    if (!dto.clubName) return null;
    const name = dto.clubName.trim();
    const existing = await tx.club.findUnique({
      where: { name },
      select: adminClubOptionSelect,
    });
    if (existing) {
      throw new ConflictException({
        message: 'Un club porte déjà ce nom',
        existingClubId: existing.id,
      });
    }
    return tx.club.create({ data: { name }, select: adminClubOptionSelect });
  }

  /**
   * Lost a race against a concurrent create: the pre-checks passed but the
   * unique constraint fired. Surface it as the same 409 the checks produce.
   */
  private async mapUniqueViolation(err: unknown, dto: CreateAdminUserDto): Promise<unknown> {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      return err;
    }
    const target = JSON.stringify(err.meta?.target ?? '').toLowerCase();
    if (target.includes('email')) {
      return new ConflictException('Cet email est déjà utilisé');
    }
    if (dto.clubName && target.includes('name')) {
      const existing = await this.prisma.club.findUnique({
        where: { name: dto.clubName.trim() },
        select: adminClubOptionSelect,
      });
      return new ConflictException({
        message: 'Un club porte déjà ce nom',
        ...(existing ? { existingClubId: existing.id } : {}),
      });
    }
    return err;
  }

  /** Graceful degradation: a mail failure never rolls back the account. */
  private async sendInvitation(
    userId: string,
    email: string,
    firstName: string,
    role: InvitationRole,
  ): Promise<boolean> {
    try {
      const token = await this.passwords.issuePasswordToken(userId, INVITATION_EXPIRY_HOURS);
      await this.email.sendInvitationEmail(email, token, firstName, role);
      return true;
    } catch (error) {
      this.logger.warn(`Invitation not sent for user ${userId}: ${(error as Error).message}`);
      return false;
    }
  }
}
```

Run: `pnpm --filter backend exec jest src/admin/admin-user-accounts.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Controller, module, controller test**

`apps/backend/src/admin/admin.module.ts`: replace `AdminClubAccountsService` (import and provider) with `AdminUserAccountsService` from `./admin-user-accounts.service`.

`apps/backend/src/admin/admin.controller.ts`:

- Replace the `./admin-club-accounts.service` import with `import { AdminUserAccountsService } from "./admin-user-accounts.service";` and the `./dto/club-account.dto` import with:
  ```ts
  import {
    AdminUserCreatedDto,
    CreateAdminUserDto,
    InvitationResultDto,
  } from './dto/admin-user-accounts.dto';
  ```
- Constructor: rename `private readonly clubAccounts: AdminClubAccountsService,` to `private readonly userAccounts: AdminUserAccountsService,`.
- Replace the whole `@Post("club-accounts")` method with:

```ts
  @Post("users")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary: "Créer un utilisateur (licencié, club ou staff) et l'inviter",
  })
  @ApiResponse({ status: 201, type: AdminUserCreatedDto })
  @ApiResponse({
    status: 409,
    description: "Email ou nom de club déjà utilisé",
  })
  createUser(
    @Body() dto: CreateAdminUserDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminUserCreatedDto> {
    return this.userAccounts.create(req.user.userId, dto);
  }
```

- In `resendInvitation`, change the summary to `"Renvoyer l'invitation d'un compte jamais connecté (hors administrateurs)"` and the body to `return this.userAccounts.resendInvitation(req.user.userId, id);`.

`apps/backend/src/admin/admin.controller.spec.ts`:

- Replace the `AdminClubAccountsService` import with `import { AdminUserAccountsService } from "./admin-user-accounts.service";` and the `CreateClubAccountDto` type import with `import type { CreateAdminUserDto } from "./dto/admin-user-accounts.dto";`.
- `const clubAccounts = ...` becomes `const userAccounts = { create: jest.fn(), resendInvitation: jest.fn() };` and the constructor argument becomes `userAccounts as unknown as AdminUserAccountsService,`.
- Replace the two tests that used `clubAccounts` with:

```ts
it('passes the acting admin id when creating a user', async () => {
  userAccounts.create.mockResolvedValue({ userId: 'u2' });
  const dto = { email: 'c@test.com', role: 'CLUB' } as CreateAdminUserDto;
  await controller.createUser(dto, req);
  expect(userAccounts.create).toHaveBeenCalledWith('admin-1', dto);
});

it('passes the acting admin id when resending an invitation', async () => {
  userAccounts.resendInvitation.mockResolvedValue({ invitationSent: true });
  await controller.resendInvitation('u1', req);
  expect(userAccounts.resendInvitation).toHaveBeenCalledWith('admin-1', 'u1');
});
```

`apps/backend/test/admin.e2e-spec.ts`: replace `["post", "/api/v1/admin/club-accounts"],` with `["post", "/api/v1/admin/users"],` and append:

```ts
it('the former club-accounts route is gone', async () => {
  currentRole = UserRole.ADMIN;
  await request(server()).post('/api/v1/admin/club-accounts').send({}).expect(404);
});
```

Run: `pnpm --filter backend exec jest src/admin src/auth` and the mocked `admin.e2e-spec`.
Expected: PASS.

- [ ] **Step 7: Real-DB integration**

In `apps/backend/test/admin.integration-spec.ts`:

- Replace `import { AdminClubAccountsService } from "../src/admin/admin-club-accounts.service";` with `import { AdminUserAccountsService } from "../src/admin/admin-user-accounts.service";`, `let clubAccounts: AdminClubAccountsService;` with `let userAccounts: AdminUserAccountsService;` and `clubAccounts = moduleRef.get(AdminClubAccountsService);` with `userAccounts = moduleRef.get(AdminUserAccountsService);`.
- Replace the two lot 1 club-account tests with:

```ts
it('account creation is atomic: a duplicate club name leaves no user behind', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const club = await prisma.club.create({
    data: { name: `Club ${randomUUID()}` },
  });
  createdClubIds.push(club.id);
  const email = `${randomUUID()}@test.local`;

  await expect(
    userAccounts.create(admin.id, {
      email,
      firstName: 'J',
      lastName: 'M',
      role: UserRole.CLUB,
      clubName: club.name,
    }),
  ).rejects.toThrow('Un club porte déjà ce nom');

  expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
});

it('creates club + CLUB account + audit row together', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const res = await userAccounts.create(admin.id, {
    email: `${randomUUID()}@test.local`,
    firstName: 'J',
    lastName: 'M',
    role: UserRole.CLUB,
    clubName: `Club ${randomUUID()}`,
  });
  createdUserIds.push(res.userId);
  if (res.clubId) createdClubIds.push(res.clubId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: res.userId },
  });
  expect(user.role).toBe(UserRole.CLUB);
  expect(user.clubId).toBe(res.clubId);
  expect(
    await prisma.adminAuditLog.count({
      where: { targetId: res.userId, action: 'USER_CREATE' },
    }),
  ).toBe(1);
});

it('creates a licensee without club, with a pending invitation token', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const res = await userAccounts.create(admin.id, {
    email: `${randomUUID()}@test.local`,
    firstName: 'L',
    lastName: 'M',
    role: UserRole.LICENSEE,
    category: 'Latin',
  });
  createdUserIds.push(res.userId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: res.userId },
  });
  expect(user).toMatchObject({
    role: UserRole.LICENSEE,
    clubId: null,
    category: 'Latin',
  });
  expect(res.clubId).toBeNull();
  expect(
    await prisma.passwordResetToken.count({
      where: { userId: res.userId, used: false },
    }),
  ).toBe(1);
});
```

Run the real-DB command (source `test-db.sh` first).
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/admin src/auth src/utils test/admin.e2e-spec.ts test/admin.integration-spec.ts
git add -A apps/backend/src/admin apps/backend/src/auth/email.service.ts apps/backend/src/auth/email.service.spec.ts apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): create licensee, club and staff users with role-specific invitations

POST /admin/users replaces POST /admin/club-accounts (only the admin SPA used
it; both ship together).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 6: Clubs — list, options and detail (reads)

**Files:**

- Create: `apps/backend/src/admin/admin-club-usage.ts`, `apps/backend/src/admin/admin-club-usage.spec.ts`
- Create: `apps/backend/src/admin/dto/admin-clubs.dto.ts`
- Create: `apps/backend/src/admin/admin-clubs.query-service.ts`, `apps/backend/src/admin/admin-clubs.query-service.spec.ts`
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminClubListSelect`, `adminClubMemberSelect`)
- Modify: `apps/backend/src/admin/admin-reference.service.ts`, `apps/backend/src/admin/admin-reference.service.spec.ts` (clubs move out)
- Modify: `apps/backend/src/admin/admin.controller.ts`, `apps/backend/src/admin/admin.controller.spec.ts`, `apps/backend/src/admin/admin.module.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts`

**Interfaces:**

- Consumes: `ACCOUNT_STATUSES`, `AccountStatusFilter` (Task 3); `AdminPageMetaDto` (lot 1); `adminClubOptionSelect` (lot 1).
- Produces:
  - `interface ClubUsage { memberCount; clubAccountCount; competitionCount; partnershipCount; soloTeamCount }` (all `number`); `clubUsage(db: Prisma.TransactionClient, club: { id: string; name: string }): Promise<ClubUsage>`; `isClubEmpty(usage: ClubUsage): boolean` — in `admin-club-usage.ts`, reused by Task 7.
  - DTOs: `ListAdminClubsQueryDto { search?, status?, skip?, take? }`, `ClubOptionsQueryDto { includeId? }`, `AdminClubListItemDto { id, name, registrationMode, disabledAt, memberCount, clubAccountCount, helloAssoConfigured, createdAt }`, `AdminClubsPageDto`, `AdminClubMemberDto { id, firstName, lastName, email, role, disabledAt }`, `AdminClubDetailDto extends AdminClubListItemDto { competitionCount, partnershipCount, soloTeamCount, members }`. Swagger enum name `ClubRegistrationMode`.
  - `AdminClubsQueryService.list(q)`, `.options(includeId?: string)`, `.detail(id)`.
  - Routes (SDK names): `GET /admin/clubs` → `listClubs` (`adminControllerListClubs`), `GET /admin/clubs/options` → `clubOptions` (`adminControllerClubOptions`), `GET /admin/clubs/:id` → `getClub` (`adminControllerGetClub`). `AdminReferenceService.clubs()` is removed.

- [ ] **Step 1: Failing test for `clubUsage`**

`apps/backend/src/admin/admin-club-usage.spec.ts`:

```ts
import { UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { clubUsage, isClubEmpty } from './admin-club-usage';

describe('clubUsage', () => {
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
  });

  it('counts members, club accounts, competitions by name, partnerships and solo teams', async () => {
    prisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    prisma.competition.count.mockResolvedValue(2);
    prisma.partnership.count.mockResolvedValue(4);
    prisma.soloTeam.count.mockResolvedValue(5);

    await expect(clubUsage(prisma, { id: 'c1', name: 'Club A' })).resolves.toEqual({
      memberCount: 3,
      clubAccountCount: 1,
      competitionCount: 2,
      partnershipCount: 4,
      soloTeamCount: 5,
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
      where: { clubId: 'c1', role: { not: UserRole.CLUB } },
    });
    expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
      where: { clubId: 'c1', role: UserRole.CLUB },
    });
    expect(prisma.competition.count).toHaveBeenCalledWith({
      where: { organizer: 'Club A' },
    });
    expect(prisma.partnership.count).toHaveBeenCalledWith({
      where: { clubId: 'c1' },
    });
    expect(prisma.soloTeam.count).toHaveBeenCalledWith({
      where: { clubId: 'c1' },
    });
  });

  it('a club is empty only when every count is zero', () => {
    const zero = {
      memberCount: 0,
      clubAccountCount: 0,
      competitionCount: 0,
      partnershipCount: 0,
      soloTeamCount: 0,
    };
    expect(isClubEmpty(zero)).toBe(true);
    expect(isClubEmpty({ ...zero, partnershipCount: 1 })).toBe(false);
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-club-usage.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 2: Implement `clubUsage`**

`apps/backend/src/admin/admin-club-usage.ts`:

```ts
import { Prisma, UserRole } from '@prisma/client';

/** What still points at a club. A club can be deleted only when all are 0. */
export interface ClubUsage {
  memberCount: number;
  clubAccountCount: number;
  competitionCount: number;
  partnershipCount: number;
  soloTeamCount: number;
}

/**
 * Sequential on purpose: also called inside interactive transactions, which
 * run on one connection. Partnerships and solo teams are counted because the
 * schema deletes them in cascade with the club (couples of former members).
 */
export async function clubUsage(
  db: Prisma.TransactionClient,
  club: { id: string; name: string },
): Promise<ClubUsage> {
  const memberCount = await db.user.count({
    where: { clubId: club.id, role: { not: UserRole.CLUB } },
  });
  const clubAccountCount = await db.user.count({
    where: { clubId: club.id, role: UserRole.CLUB },
  });
  // Competition.organizer holds a copy of the club name, not an id.
  const competitionCount = await db.competition.count({
    where: { organizer: club.name },
  });
  const partnershipCount = await db.partnership.count({
    where: { clubId: club.id },
  });
  const soloTeamCount = await db.soloTeam.count({
    where: { clubId: club.id },
  });
  return {
    memberCount,
    clubAccountCount,
    competitionCount,
    partnershipCount,
    soloTeamCount,
  };
}

export function isClubEmpty(usage: ClubUsage): boolean {
  return Object.values(usage).every((n) => n === 0);
}
```

Run: `pnpm --filter backend exec jest src/admin/admin-club-usage.spec.ts`
Expected: PASS.

- [ ] **Step 3: DTOs and selects**

`apps/backend/src/admin/dto/admin-clubs.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClubRegistrationMode, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationParamsDto } from '../../common/dto/pagination-params.dto';
import { AdminPageMetaDto } from './admin-audit.dto';
import { ACCOUNT_STATUSES, AccountStatusFilter } from './admin-users.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListAdminClubsQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: 'Nom du club' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  search?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;
}

export class ClubOptionsQueryDto {
  @ApiPropertyOptional({
    description: "Club à inclure même s'il est désactivé (valeur actuelle)",
  })
  @IsOptional()
  @IsUUID()
  includeId?: string;
}

export class AdminClubListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ClubRegistrationMode, enumName: 'ClubRegistrationMode' })
  registrationMode!: ClubRegistrationMode;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
  @ApiProperty({ description: 'Membres hors comptes Club' })
  memberCount!: number;
  @ApiProperty() clubAccountCount!: number;
  @ApiProperty({ description: 'Identifiants HelloAsso renseignés (jamais exposés)' })
  helloAssoConfigured!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class AdminClubsPageDto {
  @ApiProperty({ type: [AdminClubListItemDto] }) data!: AdminClubListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}

export class AdminClubMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' }) role!: UserRole;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
}

export class AdminClubDetailDto extends AdminClubListItemDto {
  @ApiProperty({ description: "Compétitions dont l'organisateur porte ce nom" })
  competitionCount!: number;
  @ApiProperty() partnershipCount!: number;
  @ApiProperty() soloTeamCount!: number;
  @ApiProperty({
    type: [AdminClubMemberDto],
    description: '200 premiers membres, triés par nom',
  })
  members!: AdminClubMemberDto[];
}
```

Append to `apps/backend/src/utils/prisma-selects.ts`:

```ts
/** Back-office clubs table. Never select HelloAsso credentials. */
export const adminClubListSelect = {
  id: true,
  name: true,
  registrationMode: true,
  disabledAt: true,
  createdAt: true,
} as const;

/** Back-office club page: one member row. */
export const adminClubMemberSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  disabledAt: true,
} as const;
```

- [ ] **Step 4: Failing tests for the query service**

`apps/backend/src/admin/admin-clubs.query-service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClubRegistrationMode, UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import {
  adminClubListSelect,
  adminClubMemberSelect,
  adminClubOptionSelect,
} from '../utils/prisma-selects';
import { AdminClubsQueryService } from './admin-clubs.query-service';

const club = {
  id: 'c1',
  name: 'Club A',
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  disabledAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AdminClubsQueryService', () => {
  let service: AdminClubsQueryService;
  let prisma: MockPrismaService;
  let groupBy: jest.Mock;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    groupBy = prisma.user.groupBy as unknown as jest.Mock;
    const moduleRef = await Test.createTestingModule({
      providers: [AdminClubsQueryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminClubsQueryService);
  });

  describe('list', () => {
    it('filters, sorts by name and adds counts and the HelloAsso flag without reading secrets', async () => {
      prisma.club.count.mockResolvedValue(2);
      prisma.club.findMany
        .mockResolvedValueOnce([club, { ...club, id: 'c2', name: 'Club B' }] as never)
        .mockResolvedValueOnce([{ id: 'c2' }] as never);
      groupBy.mockResolvedValue([
        { clubId: 'c1', role: UserRole.LICENSEE, _count: { _all: 3 } },
        { clubId: 'c1', role: UserRole.STAFF, _count: { _all: 1 } },
        { clubId: 'c1', role: UserRole.CLUB, _count: { _all: 1 } },
      ]);

      const page = await service.list({
        search: ' club ',
        status: 'active',
        skip: 0,
        take: 50,
      });

      expect(prisma.club.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          name: { contains: 'club', mode: 'insensitive' },
          disabledAt: null,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 50,
        select: adminClubListSelect,
      });
      expect(groupBy).toHaveBeenCalledWith({
        by: ['clubId', 'role'],
        where: { clubId: { in: ['c1', 'c2'] } },
        _count: { _all: true },
      });
      expect(prisma.club.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: { in: ['c1', 'c2'] },
          helloAssoClientId: { not: '' },
          helloAssoClientSecret: { not: '' },
          helloAssoOrgSlug: { not: '' },
        },
        select: { id: true },
        take: 2,
      });
      expect(page.data).toEqual([
        {
          ...club,
          memberCount: 4,
          clubAccountCount: 1,
          helloAssoConfigured: false,
        },
        {
          ...club,
          id: 'c2',
          name: 'Club B',
          memberCount: 0,
          clubAccountCount: 0,
          helloAssoConfigured: true,
        },
      ]);
      expect(page.meta.total).toBe(2);
    });

    it('filters disabled clubs and skips the extra queries on an empty page', async () => {
      prisma.club.count.mockResolvedValue(0);
      prisma.club.findMany.mockResolvedValue([]);

      await service.list({ status: 'disabled' });

      expect(prisma.club.findMany.mock.calls[0][0]?.where).toEqual({
        disabledAt: { not: null },
      });
      expect(prisma.club.findMany.mock.calls[0][0]?.take).toBe(50);
      expect(groupBy).not.toHaveBeenCalled();
      expect(prisma.club.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('options', () => {
    it('lists active clubs only', async () => {
      prisma.club.findMany.mockResolvedValue([]);
      await service.options();
      expect(prisma.club.findMany).toHaveBeenCalledWith({
        where: { disabledAt: null },
        orderBy: { name: 'asc' },
        take: 1000,
        select: adminClubOptionSelect,
      });
    });

    it('keeps the currently selected club even when it is disabled', async () => {
      prisma.club.findMany.mockResolvedValue([]);
      await service.options('c9');
      expect(prisma.club.findMany.mock.calls[0][0]?.where).toEqual({
        OR: [{ disabledAt: null }, { id: 'c9' }],
      });
    });
  });

  describe('detail', () => {
    it('adds every usage count, the HelloAsso flag and the first 200 members', async () => {
      prisma.club.findUnique.mockResolvedValue(club as never);
      prisma.user.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
      prisma.competition.count.mockResolvedValue(2);
      prisma.partnership.count.mockResolvedValue(0);
      prisma.soloTeam.count.mockResolvedValue(0);
      prisma.club.findMany.mockResolvedValue([{ id: 'c1' }] as never);
      const member = {
        id: 'u1',
        firstName: 'Jeanne',
        lastName: 'Martin',
        email: 'j@x.fr',
        role: UserRole.LICENSEE,
        disabledAt: null,
      };
      prisma.user.findMany.mockResolvedValue([member] as never);

      await expect(service.detail('c1')).resolves.toEqual({
        ...club,
        memberCount: 3,
        clubAccountCount: 1,
        competitionCount: 2,
        partnershipCount: 0,
        soloTeamCount: 0,
        helloAssoConfigured: true,
        members: [member],
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { clubId: 'c1' },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        take: 200,
        select: adminClubMemberSelect,
      });
    });

    it('404s on an unknown club', async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(service.detail('nope')).rejects.toThrow(
        new NotFoundException('Club introuvable'),
      );
    });
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-clubs.query-service.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement the query service**

`apps/backend/src/admin/admin-clubs.query-service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  adminClubListSelect,
  adminClubMemberSelect,
  adminClubOptionSelect,
} from '../utils/prisma-selects';
import { clubUsage } from './admin-club-usage';
import {
  AdminClubDetailDto,
  AdminClubsPageDto,
  ListAdminClubsQueryDto,
} from './dto/admin-clubs.dto';
import { AdminClubOptionDto } from './dto/admin-reference.dto';

const DEFAULT_TAKE = 50;
/** Clubs are a small, federation-wide list; 1000 is a safety bound. */
const MAX_CLUBS = 1000;
const MAX_MEMBERS = 200;

interface MemberCounts {
  memberCount: number;
  clubAccountCount: number;
}

/** Back-office reads of clubs (list, select options, detail). */
@Injectable()
export class AdminClubsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListAdminClubsQueryDto): Promise<AdminClubsPageDto> {
    const skip = q.skip ?? 0;
    const take = q.take ?? DEFAULT_TAKE;
    const search = q.search?.trim();
    const where: Prisma.ClubWhereInput = {
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(q.status && {
        disabledAt: q.status === 'active' ? null : { not: null },
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.club.count({ where }),
      this.prisma.club.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: adminClubListSelect,
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const [counts, configured] = await Promise.all([
      this.memberCounts(ids),
      this.helloAssoConfigured(ids),
    ]);
    return createPaginatedResponse(
      rows.map((r) => ({
        ...r,
        ...(counts.get(r.id) ?? { memberCount: 0, clubAccountCount: 0 }),
        helloAssoConfigured: configured.has(r.id),
      })),
      total,
      skip,
      take,
    );
  }

  /** Active clubs for selects, plus `includeId` (the current value). */
  options(includeId?: string): Promise<AdminClubOptionDto[]> {
    return this.prisma.club.findMany({
      where: includeId ? { OR: [{ disabledAt: null }, { id: includeId }] } : { disabledAt: null },
      orderBy: { name: 'asc' },
      take: MAX_CLUBS,
      select: adminClubOptionSelect,
    });
  }

  async detail(id: string): Promise<AdminClubDetailDto> {
    const club = await this.prisma.club.findUnique({
      where: { id },
      select: adminClubListSelect,
    });
    if (!club) throw new NotFoundException('Club introuvable');
    const usage = await clubUsage(this.prisma, club);
    const configured = await this.helloAssoConfigured([id]);
    const members = await this.prisma.user.findMany({
      where: { clubId: id },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      take: MAX_MEMBERS,
      select: adminClubMemberSelect,
    });
    return {
      ...club,
      ...usage,
      helloAssoConfigured: configured.has(id),
      members,
    };
  }

  /** One grouped query for a page of clubs (members vs CLUB accounts). */
  private async memberCounts(ids: string[]): Promise<Map<string, MemberCounts>> {
    const counts = new Map<string, MemberCounts>();
    if (!ids.length) return counts;
    const groups = await this.prisma.user.groupBy({
      by: ['clubId', 'role'],
      where: { clubId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (!g.clubId) continue;
      const c = counts.get(g.clubId) ?? { memberCount: 0, clubAccountCount: 0 };
      if (g.role === UserRole.CLUB) c.clubAccountCount += g._count._all;
      else c.memberCount += g._count._all;
      counts.set(g.clubId, c);
    }
    return counts;
  }

  /**
   * Filtered in the database so the HelloAsso secret is never read. `not: ""`
   * also excludes NULL (SQL `<> ''` is not true for NULL).
   */
  private async helloAssoConfigured(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.club.findMany({
      where: {
        id: { in: ids },
        helloAssoClientId: { not: '' },
        helloAssoClientSecret: { not: '' },
        helloAssoOrgSlug: { not: '' },
      },
      select: { id: true },
      take: ids.length,
    });
    return new Set(rows.map((r) => r.id));
  }
}
```

Run: `pnpm --filter backend exec jest src/admin/admin-clubs.query-service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Move clubs out of the reference service**

`apps/backend/src/admin/admin-reference.service.ts` — remove the `PrismaService`, `adminClubOptionSelect` and `AdminClubOptionDto` imports, the `MAX_CLUBS` constant, the constructor and the `clubs()` method; the class keeps only `referenceData()`.

`apps/backend/src/admin/admin-reference.service.spec.ts` — replace with:

```ts
import { AdminReferenceService } from './admin-reference.service';

describe('AdminReferenceService', () => {
  it('exposes the backend constants', () => {
    const data = new AdminReferenceService().referenceData();
    expect(data.categories).toEqual(['Latin', 'Standard', 'Ten Dance']);
    expect(data.ageGroups).toContain('Junior I');
    expect(data.ageGroups).toContain('Solo Adulte');
    expect(data.competitionLevels).toContain('Débutant');
    expect(data.passportLevels[0]).toBe('BLANC');
    expect(data.roles).toEqual(['LICENSEE', 'CLUB', 'STAFF', 'ADMIN']);
  });
});
```

- [ ] **Step 7: Routes, module, controller test, role matrix**

`apps/backend/src/admin/admin.module.ts`: add `AdminClubsQueryService` (import from `./admin-clubs.query-service`) to `providers`.

`apps/backend/src/admin/admin.controller.ts`:

- Imports:
  ```ts
  import { AdminClubsQueryService } from './admin-clubs.query-service';
  import {
    AdminClubDetailDto,
    AdminClubsPageDto,
    ClubOptionsQueryDto,
    ListAdminClubsQueryDto,
  } from './dto/admin-clubs.dto';
  ```
- Constructor gains a sixth parameter `private readonly clubsQuery: AdminClubsQueryService,`.
- Replace the whole `@Get("clubs")` method (`clubs()`) with these three, **in this order** (`clubs/options` must be declared before `clubs/:id`):

```ts
  @Get("clubs")
  @ApiOperation({ summary: "Liste paginée des clubs" })
  @ApiResponse({ status: 200, type: AdminClubsPageDto })
  listClubs(@Query() query: ListAdminClubsQueryDto): Promise<AdminClubsPageDto> {
    return this.clubsQuery.list(query);
  }

  @Get("clubs/options")
  @ApiOperation({
    summary: "Clubs actifs (id + nom) pour les listes déroulantes",
  })
  @ApiResponse({ status: 200, type: [AdminClubOptionDto] })
  clubOptions(
    @Query() query: ClubOptionsQueryDto,
  ): Promise<AdminClubOptionDto[]> {
    return this.clubsQuery.options(query.includeId);
  }

  @Get("clubs/:id")
  @ApiOperation({ summary: "Fiche d'un club" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminClubDetailDto })
  getClub(@Param("id", ParseUUIDPipe) id: string): Promise<AdminClubDetailDto> {
    return this.clubsQuery.detail(id);
  }
```

`apps/backend/src/admin/admin.controller.spec.ts`:

- `const reference = { referenceData: jest.fn() };`, add `const clubsQuery = { list: jest.fn(), options: jest.fn(), detail: jest.fn() };`, import `AdminClubsQueryService` and pass `clubsQuery as unknown as AdminClubsQueryService,` as the sixth constructor argument.
- Replace the test `"lists clubs"` with:

```ts
it('delegates the clubs list', async () => {
  clubsQuery.list.mockResolvedValue({ data: [] });
  const query = { skip: 0, take: 10 };
  await controller.listClubs(query);
  expect(clubsQuery.list).toHaveBeenCalledWith(query);
});

it('passes the selected club through to the options', async () => {
  clubsQuery.options.mockResolvedValue([{ id: 'c1', name: 'Club' }]);
  await expect(controller.clubOptions({ includeId: 'c1' })).resolves.toEqual([
    { id: 'c1', name: 'Club' },
  ]);
  expect(clubsQuery.options).toHaveBeenCalledWith('c1');
});

it('delegates the club detail', async () => {
  clubsQuery.detail.mockResolvedValue({ id: 'c1' });
  await expect(controller.getClub('c1')).resolves.toEqual({ id: 'c1' });
});
```

`apps/backend/test/admin.e2e-spec.ts`: add to `ADMIN_ROUTES`:

```ts
  ["get", "/api/v1/admin/clubs/options"],
  ["get", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
```

Run: `pnpm --filter backend exec jest src/admin` and the mocked `admin.e2e-spec`.
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/admin src/utils test/admin.e2e-spec.ts
git add apps/backend/src/admin apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts
git commit -m "feat(admin): list clubs with usage counts, club options and club detail

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 7: Clubs — edit with rename cascade, status, delete

**Files:**

- Modify: `apps/backend/src/admin/dto/admin-clubs.dto.ts` (`UpdateAdminClubDto`, `ClubNotEmptyDto`)
- Modify: `apps/backend/src/utils/prisma-selects.ts` (`adminClubEditableSelect`, `adminClubStatusSelect`)
- Create: `apps/backend/src/admin/admin-clubs.service.ts`, `apps/backend/src/admin/admin-clubs.service.spec.ts`
- Modify: `apps/backend/src/common/filters/http-exception.filter.ts`, `apps/backend/src/common/filters/http-exception.filter.spec.ts`
- Modify: `apps/backend/src/admin/admin.controller.ts`, `apps/backend/src/admin/admin.controller.spec.ts`, `apps/backend/src/admin/admin.module.ts`
- Modify: `apps/backend/test/admin.e2e-spec.ts`, `apps/backend/test/admin.integration-spec.ts`

**Interfaces:**

- Consumes: `clubUsage`, `isClubEmpty`, `AdminClubsQueryService.detail` (Task 6); `SetActiveDto` (Task 3); `diffFields`, `AdminAuditService.record` (lot 1); integration helpers `create`, `auth`, `PASSWORD` (Task 3).
- Produces:
  - `UpdateAdminClubDto { name?: string; registrationMode?: ClubRegistrationMode }`, `ClubNotEmptyDto` (409 body: `statusCode, message` + the five `ClubUsage` counts).
  - `AdminClubsService.update(actorId, clubId, dto): Promise<AdminClubDetailDto>`, `.setStatus(actorId, clubId, active): Promise<AdminClubDetailDto>`, `.delete(actorId, clubId): Promise<void>`.
  - Routes (SDK names): `PATCH /admin/clubs/:id` → `updateClub` (`adminControllerUpdateClub`), `POST /admin/clubs/:id/status` → `setClubStatus` (`adminControllerSetClubStatus`), `DELETE /admin/clubs/:id` (204) → `deleteClub` (`adminControllerDeleteClub`).
  - The global filter keeps `memberCount`, `clubAccountCount`, `competitionCount`, `partnershipCount`, `soloTeamCount` (numbers) and `existingClubId` (string) on a 409 body.

- [ ] **Step 1: DTOs and selects**

Append to `apps/backend/src/admin/dto/admin-clubs.dto.ts` (add `IsEnum`, `Length`, `ValidateIf` to the `class-validator` import):

```ts
/** `null` is a 400 (both columns are required); an absent key is unchanged. */
const notUndefined = (_: object, v: unknown) => v !== undefined;

export class UpdateAdminClubDto {
  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({
    enum: ClubRegistrationMode,
    enumName: 'ClubRegistrationMode',
  })
  @ValidateIf(notUndefined)
  @IsEnum(ClubRegistrationMode)
  registrationMode?: ClubRegistrationMode;
}

/** 409 body of DELETE /admin/clubs/:id. */
export class ClubNotEmptyDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() memberCount!: number;
  @ApiProperty() clubAccountCount!: number;
  @ApiProperty() competitionCount!: number;
  @ApiProperty() partnershipCount!: number;
  @ApiProperty() soloTeamCount!: number;
}
```

Append to `apps/backend/src/utils/prisma-selects.ts`:

```ts
/** Back-office club edit: the editable fields, for the audit diff. */
export const adminClubEditableSelect = {
  id: true,
  name: true,
  registrationMode: true,
} as const;

/** Back-office club status toggle: current state only. */
export const adminClubStatusSelect = { id: true, disabledAt: true } as const;
```

- [ ] **Step 2: Failing service tests**

`apps/backend/src/admin/admin-clubs.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClubRegistrationMode, Prisma, UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminClubsQueryService } from './admin-clubs.query-service';
import { AdminClubsService } from './admin-clubs.service';

const current = {
  id: 'c1',
  name: 'Club A',
  registrationMode: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
};

describe('AdminClubsService', () => {
  let service: AdminClubsService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    prisma.club.update.mockResolvedValue({} as never);
    prisma.user.count.mockResolvedValue(0);
    prisma.competition.count.mockResolvedValue(0);
    prisma.partnership.count.mockResolvedValue(0);
    prisma.soloTeam.count.mockResolvedValue(0);
    audit = { record: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: 'c1' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminClubsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminClubsQueryService, useValue: query },
      ],
    }).compile();
    service = moduleRef.get(AdminClubsService);
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.club.findUnique
        .mockResolvedValueOnce(current as never) // current values
        .mockResolvedValueOnce(null); // no other club with the new name
    });

    it('renames, rewrites every copy of the name, and audits the diff', async () => {
      await expect(service.update('admin-1', 'c1', { name: ' Club Z ' })).resolves.toEqual({
        id: 'c1',
      });

      expect(prisma.club.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: 'Club Z' },
        select: { id: true },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ clubId: 'c1' }, { clubId: null, clubName: 'Club A' }],
        },
        data: { clubName: 'Club Z' },
      });
      expect(prisma.license.updateMany).toHaveBeenCalledWith({
        where: { clubName: 'Club A' },
        data: { clubName: 'Club Z' },
      });
      expect(prisma.competition.updateMany).toHaveBeenCalledWith({
        where: { organizer: 'Club A' },
        data: { organizer: 'Club Z' },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: 'admin-1',
        action: 'CLUB_UPDATE',
        targetType: 'CLUB',
        targetId: 'c1',
        before: { name: 'Club A' },
        after: { name: 'Club Z' },
      });
    });

    it('changes the registration mode without any cascade', async () => {
      await service.update('admin-1', 'c1', {
        registrationMode: ClubRegistrationMode.CLUB_ONLY,
      });
      expect(prisma.club.update.mock.calls[0][0].data).toEqual({
        registrationMode: ClubRegistrationMode.CLUB_ONLY,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.license.updateMany).not.toHaveBeenCalled();
      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
    });

    it('writes and audits nothing when the values are unchanged', async () => {
      await service.update('admin-1', 'c1', { name: 'Club A' });
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(query.detail).toHaveBeenCalledWith('c1');
    });

    it('409s with the clashing club id when the new name is taken, changing nothing', async () => {
      prisma.club.findUnique
        .mockReset()
        .mockResolvedValueOnce(current as never)
        .mockResolvedValueOnce({ id: 'c2', name: 'Club B' } as never);

      await expect(service.update('admin-1', 'c1', { name: 'Club B' })).rejects.toMatchObject({
        status: 409,
        response: { message: 'Un club porte déjà ce nom', existingClubId: 'c2' },
      });
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('maps a concurrent rename (P2002) to the same 409', async () => {
      prisma.club.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['name'] },
        }),
      );
      await expect(service.update('admin-1', 'c1', { name: 'Club Z' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('404s on an unknown club', async () => {
      prisma.club.findUnique.mockReset().mockResolvedValue(null);
      await expect(service.update('admin-1', 'nope', { name: 'X Y' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('setStatus', () => {
    it("deactivates, revokes the sessions of the club's CLUB accounts only, and audits", async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: 'c1',
        disabledAt: null,
      } as never);

      await service.setStatus('admin-1', 'c1', false);

      expect(prisma.club.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { disabledAt: expect.any(Date) as unknown },
        select: { id: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { revoked: false, user: { clubId: 'c1', role: UserRole.CLUB } },
        data: { revoked: true, revokedAt: expect.any(Date) as unknown },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: 'admin-1',
        action: 'CLUB_DISABLE',
        targetType: 'CLUB',
        targetId: 'c1',
      });
    });

    it('reactivates without touching sessions', async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: 'c1',
        disabledAt: new Date(),
      } as never);
      await service.setStatus('admin-1', 'c1', true);
      expect(prisma.club.update.mock.calls[0][0].data).toEqual({
        disabledAt: null,
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'CLUB_ENABLE' }),
      );
    });

    it('is idempotent', async () => {
      prisma.club.findUnique.mockResolvedValue({
        id: 'c1',
        disabledAt: new Date(),
      } as never);
      await service.setStatus('admin-1', 'c1', false);
      expect(prisma.club.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('404s on an unknown club', async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(service.setStatus('admin-1', 'nope', false)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      prisma.club.findUnique.mockResolvedValue({
        id: 'c1',
        name: 'Club A',
      } as never);
    });

    it('deletes an empty club and audits its name', async () => {
      await service.delete('admin-1', 'c1');
      expect(prisma.club.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
        select: { id: true },
      });
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: 'admin-1',
        action: 'CLUB_DELETE',
        targetType: 'CLUB',
        targetId: 'c1',
        before: { name: 'Club A' },
      });
    });

    it('409s with every count when something still points at the club', async () => {
      prisma.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      prisma.partnership.count.mockResolvedValue(3);

      await expect(service.delete('admin-1', 'c1')).rejects.toMatchObject({
        status: 409,
        response: {
          message: "Ce club n'est pas vide : désactivez-le plutôt.",
          memberCount: 2,
          clubAccountCount: 1,
          competitionCount: 0,
          partnershipCount: 3,
          soloTeamCount: 0,
        },
      });
      expect(prisma.club.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('404s on an unknown club', async () => {
      prisma.club.findUnique.mockResolvedValue(null);
      await expect(service.delete('admin-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

Run: `pnpm --filter backend exec jest src/admin/admin-clubs.service.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service**

`apps/backend/src/admin/admin-clubs.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  adminClubEditableSelect,
  adminClubOptionSelect,
  adminClubStatusSelect,
} from '../utils/prisma-selects';
import { AdminAuditService } from './admin-audit.service';
import { diffFields } from './admin-audit.util';
import { clubUsage, isClubEmpty } from './admin-club-usage';
import { AdminClubsQueryService } from './admin-clubs.query-service';
import { AdminClubDetailDto, UpdateAdminClubDto } from './dto/admin-clubs.dto';

const NAME_TAKEN = 'Un club porte déjà ce nom';

/** Back-office writes on clubs. Every change is audited in the same tx. */
@Injectable()
export class AdminClubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminClubsQueryService,
  ) {}

  /**
   * Club.name is copied into User.clubName, License.clubName and
   * Competition.organizer: a rename rewrites every copy in the same
   * transaction. Users of another club are never touched; legacy members
   * without clubId are matched on the old name.
   */
  async update(
    actorId: string,
    clubId: string,
    dto: UpdateAdminClubDto,
  ): Promise<AdminClubDetailDto> {
    const requested: Record<string, unknown> = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.registrationMode !== undefined && {
        registrationMode: dto.registrationMode,
      }),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.club.findUnique({
          where: { id: clubId },
          select: adminClubEditableSelect,
        });
        if (!current) throw new NotFoundException('Club introuvable');
        const diff = diffFields(current, requested);
        if (!diff) return;

        const newName = typeof diff.after.name === 'string' ? diff.after.name : undefined;
        if (newName !== undefined) {
          const clash = await tx.club.findUnique({
            where: { name: newName },
            select: adminClubOptionSelect,
          });
          if (clash) {
            throw new ConflictException({
              message: NAME_TAKEN,
              existingClubId: clash.id,
            });
          }
        }

        await tx.club.update({
          where: { id: clubId },
          data: diff.after,
          select: { id: true },
        });
        if (newName !== undefined) {
          await tx.user.updateMany({
            where: {
              OR: [{ clubId }, { clubId: null, clubName: current.name }],
            },
            data: { clubName: newName },
          });
          await tx.license.updateMany({
            where: { clubName: current.name },
            data: { clubName: newName },
          });
          await tx.competition.updateMany({
            where: { organizer: current.name },
            data: { organizer: newName },
          });
        }
        await this.audit.record(tx, {
          actorId,
          action: 'CLUB_UPDATE',
          targetType: 'CLUB',
          targetId: clubId,
          before: diff.before,
          after: diff.after,
        });
      });
    } catch (err) {
      // Lost a race against a concurrent rename onto the same name.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(NAME_TAKEN);
      }
      throw err;
    }
    return this.query.detail(clubId);
  }

  /**
   * Deactivation blocks the club's CLUB accounts (login, refresh, live
   * tokens) and revokes their sessions; its licensees are not affected.
   */
  async setStatus(actorId: string, clubId: string, active: boolean): Promise<AdminClubDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.club.findUnique({
        where: { id: clubId },
        select: adminClubStatusSelect,
      });
      if (!current) throw new NotFoundException('Club introuvable');
      if ((current.disabledAt === null) === active) return;

      await tx.club.update({
        where: { id: clubId },
        data: { disabledAt: active ? null : new Date() },
        select: { id: true },
      });
      if (!active) {
        await tx.refreshToken.updateMany({
          where: { revoked: false, user: { clubId, role: UserRole.CLUB } },
          data: { revoked: true, revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        actorId,
        action: active ? 'CLUB_ENABLE' : 'CLUB_DISABLE',
        targetType: 'CLUB',
        targetId: clubId,
      });
    });
    return this.query.detail(clubId);
  }

  /** Only an empty club can go; otherwise 409 with what still points at it. */
  async delete(actorId: string, clubId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({
        where: { id: clubId },
        select: adminClubOptionSelect,
      });
      if (!club) throw new NotFoundException('Club introuvable');
      const usage = await clubUsage(tx, club);
      if (!isClubEmpty(usage)) {
        throw new ConflictException({
          message: "Ce club n'est pas vide : désactivez-le plutôt.",
          ...usage,
        });
      }
      await tx.club.delete({ where: { id: clubId }, select: { id: true } });
      await this.audit.record(tx, {
        actorId,
        action: 'CLUB_DELETE',
        targetType: 'CLUB',
        targetId: clubId,
        before: { name: club.name },
      });
    });
  }
}
```

Run: `pnpm --filter backend exec jest src/admin/admin-clubs.service.spec.ts`
Expected: PASS.

- [ ] **Step 4: Failing filter tests, then keep the counts on a 409**

Without this, the global filter reduces the 409 body to `{ statusCode, timestamp, path, method, message }` and the UI cannot show the blocking counts.

Append to `apps/backend/src/common/filters/http-exception.filter.spec.ts` (inside the top-level `describe`):

```ts
it('carries the club-usage counts through a 409, and nothing else', () => {
  const exception = new HttpException(
    {
      message: "Ce club n'est pas vide : désactivez-le plutôt.",
      memberCount: 2,
      clubAccountCount: 1,
      competitionCount: 0,
      partnershipCount: 0,
      soloTeamCount: 0,
      internal: 'x',
    },
    HttpStatus.CONFLICT,
  );
  filter.catch(exception, mockArgumentsHost);
  const [body] = mockResponse.json.mock.lastCall as [Record<string, unknown>];
  expect(body).toMatchObject({
    memberCount: 2,
    clubAccountCount: 1,
    competitionCount: 0,
    partnershipCount: 0,
    soloTeamCount: 0,
  });
  expect(body).not.toHaveProperty('internal');
});

it('does not copy those details on other statuses', () => {
  const exception = new HttpException(
    { message: 'x', memberCount: 2, existingClubId: 'c1' },
    HttpStatus.BAD_REQUEST,
  );
  filter.catch(exception, mockArgumentsHost);
  const [body] = mockResponse.json.mock.lastCall as [Record<string, unknown>];
  expect(body).not.toHaveProperty('memberCount');
  expect(body).not.toHaveProperty('existingClubId');
});
```

Run: `pnpm --filter backend exec jest src/common/filters`
Expected: FAIL on the first test (counts dropped).

In `apps/backend/src/common/filters/http-exception.filter.ts`, replace the block from the comment `// Admin club-account 409 hands the clashing club back…` down to the end of `const existingClubId = …;` with:

```ts
// Admin 409s carry details the back-office needs: the clashing club
// (create / rename) or what still points at a club (delete). Whitelisted
// keys and primitive values only.
const body = exception instanceof HttpException ? exception.getResponse() : null;
const conflictDetails: Record<string, string | number> = {};
if (status === HTTP_STATUS_CONFLICT && typeof body === 'object' && body !== null) {
  for (const key of CONFLICT_DETAIL_KEYS) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' || typeof value === 'number') {
      conflictDetails[key] = value;
    }
  }
}
```

add below `const HTTP_STATUS_CONFLICT = 409;`:

```ts
const CONFLICT_DETAIL_KEYS = [
  'existingClubId',
  'memberCount',
  'clubAccountCount',
  'competitionCount',
  'partnershipCount',
  'soloTeamCount',
] as const;
```

and in `errorResponse` replace `...(existingClubId ? { existingClubId } : {}),` with `...conflictDetails,`.

Run: `pnpm --filter backend exec jest src/common/filters`
Expected: PASS (including the existing `existingClubId` test).

- [ ] **Step 5: Routes, module, controller test, role matrix**

`apps/backend/src/admin/admin.module.ts`: add `AdminClubsService` (from `./admin-clubs.service`) to `providers`.

`apps/backend/src/admin/admin.controller.ts`:

- Imports: `import { AdminClubsService } from "./admin-clubs.service";` and add `ClubNotEmptyDto`, `UpdateAdminClubDto` to the `./dto/admin-clubs.dto` import.
- Constructor gains a seventh parameter `private readonly clubs: AdminClubsService,`.
- Add after `getClub`:

```ts
  @Patch("clubs/:id")
  @ApiOperation({
    summary: "Modifier un club (renommage répercuté partout)",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminClubDetailDto })
  @ApiResponse({ status: 409, description: "Nom déjà utilisé" })
  updateClub(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminClubDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminClubDetailDto> {
    return this.clubs.update(req.user.userId, id, dto);
  }

  @Post("clubs/:id/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Activer ou désactiver un club" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminClubDetailDto })
  setClubStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminClubDetailDto> {
    return this.clubs.setStatus(req.user.userId, id, dto.active);
  }

  @Delete("clubs/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Supprimer un club vide" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 204, description: "Club supprimé" })
  @ApiResponse({ status: 409, type: ClubNotEmptyDto })
  deleteClub(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.clubs.delete(req.user.userId, id);
  }
```

`apps/backend/src/admin/admin.controller.spec.ts`: add `const clubs = { update: jest.fn(), setStatus: jest.fn(), delete: jest.fn() };`, import `AdminClubsService`, pass `clubs as unknown as AdminClubsService,` as the seventh constructor argument, and add:

```ts
it('passes the acting admin id to every club write', async () => {
  await controller.updateClub('c1', { name: 'Club Z' }, req);
  expect(clubs.update).toHaveBeenCalledWith('admin-1', 'c1', {
    name: 'Club Z',
  });
  await controller.setClubStatus('c1', { active: false }, req);
  expect(clubs.setStatus).toHaveBeenCalledWith('admin-1', 'c1', false);
  await controller.deleteClub('c1', req);
  expect(clubs.delete).toHaveBeenCalledWith('admin-1', 'c1');
});
```

`apps/backend/test/admin.e2e-spec.ts`: add to `ADMIN_ROUTES`:

```ts
  ["patch", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
  [
    "post",
    "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000/status",
  ],
  ["delete", "/api/v1/admin/clubs/00000000-0000-4000-8000-000000000000"],
```

Run: `pnpm --filter backend exec jest src/admin src/common/filters` and the mocked `admin.e2e-spec`.
Expected: PASS.

- [ ] **Step 6: Real-DB integration — cascade, collision, delete, club deactivation**

In `apps/backend/test/admin.integration-spec.ts`:

1. Add `import { ConflictException } from "@nestjs/common";` (merge with the `UnauthorizedException` import) and `import { AdminClubsService } from "../src/admin/admin-clubs.service";`.
2. Declare `let clubs: AdminClubsService;`, `const createdLicenseIds: string[] = [];`, `const createdCompetitionIds: string[] = [];`; in `beforeAll` add `clubs = moduleRef.get(AdminClubsService);`.
3. Replace `afterEach` with:

```ts
afterEach(async () => {
  await prisma.adminAuditLog.deleteMany({
    where: { targetId: { in: [...createdUserIds, ...createdClubIds] } },
  });
  await prisma.competition.deleteMany({
    where: { id: { in: createdCompetitionIds } },
  });
  await prisma.license.deleteMany({ where: { id: { in: createdLicenseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.club.deleteMany({ where: { id: { in: createdClubIds } } });
  createdUserIds.length = 0;
  createdClubIds.length = 0;
  createdLicenseIds.length = 0;
  createdCompetitionIds.length = 0;
});
```

4. Append:

```ts
const newClub = async () => {
  const club = await prisma.club.create({
    data: { name: `Club ${randomUUID()}` },
  });
  createdClubIds.push(club.id);
  return club;
};

it('renaming a club rewrites every copy of its name, and only those', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const club = await newClub();
  const other = await newClub();
  const newName = `Club ${randomUUID()}`;
  const member = await create({ clubId: club.id, clubName: club.name });
  const legacy = await create({ clubName: club.name });
  // Same text in another club's member: inconsistent data, left alone.
  const stranger = await create({ clubId: other.id, clubName: club.name });
  const license = await prisma.license.create({
    data: {
      number: `L-${randomUUID()}`,
      validUntil: new Date('2027-08-31'),
      category: 'Latin',
      clubName: club.name,
    },
  });
  createdLicenseIds.push(license.id);
  const competition = await prisma.competition.create({
    data: {
      title: 'Gala',
      date: new Date('2027-01-01'),
      location: 'Paris',
      organizer: club.name,
    },
  });
  createdCompetitionIds.push(competition.id);

  await clubs.update(admin.id, club.id, { name: newName });

  const nameOf = async (id: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id } })).clubName;
  expect(await nameOf(member.id)).toBe(newName);
  expect(await nameOf(legacy.id)).toBe(newName);
  expect(await nameOf(stranger.id)).toBe(club.name);
  expect((await prisma.license.findUniqueOrThrow({ where: { id: license.id } })).clubName).toBe(
    newName,
  );
  expect(
    (
      await prisma.competition.findUniqueOrThrow({
        where: { id: competition.id },
      })
    ).organizer,
  ).toBe(newName);
  expect(
    await prisma.adminAuditLog.count({
      where: { targetId: club.id, action: 'CLUB_UPDATE' },
    }),
  ).toBe(1);
});

it('a rename onto an existing name changes nothing', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const club = await newClub();
  const taken = await newClub();
  const member = await create({ clubId: club.id, clubName: club.name });

  await expect(clubs.update(admin.id, club.id, { name: taken.name })).rejects.toBeInstanceOf(
    ConflictException,
  );

  expect((await prisma.club.findUniqueOrThrow({ where: { id: club.id } })).name).toBe(club.name);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).clubName).toBe(
    club.name,
  );
});

it('deletes an empty club and refuses one that still has a member', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const empty = await newClub();
  const busy = await newClub();
  await create({ clubId: busy.id, clubName: busy.name });

  await clubs.delete(admin.id, empty.id);
  expect(await prisma.club.findUnique({ where: { id: empty.id } })).toBeNull();

  await expect(clubs.delete(admin.id, busy.id)).rejects.toMatchObject({
    status: 409,
    response: { memberCount: 1 },
  });
  expect(await prisma.club.findUnique({ where: { id: busy.id } })).not.toBeNull();
});

it('disabling a club blocks its CLUB accounts but not its licensees', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const club = await newClub();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const clubAccount = await create({
    role: UserRole.CLUB,
    clubId: club.id,
    clubName: club.name,
    password: hash,
  });
  const licensee = await create({
    clubId: club.id,
    clubName: club.name,
    password: hash,
  });

  await clubs.setStatus(admin.id, club.id, false);

  await expect(auth.validateUser(clubAccount.email, PASSWORD)).rejects.toThrow(
    'Compte désactivé. Contactez la fédération.',
  );
  await expect(auth.validateUser(licensee.email, PASSWORD)).resolves.toMatchObject({
    id: licensee.id,
  });
});
```

Run the real-DB command (source `test-db.sh` first).
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
pnpm --filter backend typecheck
pnpm --filter backend exec eslint src/admin src/common/filters src/utils test/admin.e2e-spec.ts test/admin.integration-spec.ts
git add apps/backend/src/admin apps/backend/src/common/filters apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): edit, deactivate and delete clubs, with a rename cascade

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 8: Coverage gate, Swagger export and the regenerated admin client

**Files:**

- Modify (generated): `apps/backend/swagger.json`, `apps/docs/public/swagger.json`
- Regenerated, gitignored (not committed): `apps/admin/src/api/generated/**`
- Modify: `apps/admin/src/api/queries.ts`
- Create: `apps/admin/src/lib/labels.ts`
- Modify: `apps/admin/src/lib/auditLabels.ts`
- Modify: `apps/admin/src/components/ChangeSummary.tsx`, `apps/admin/src/components/ChangeSummary.test.tsx`
- Modify: `apps/admin/src/pages/UsersPage.tsx`, `UsersPage.test.tsx`, `UserDetailPage.tsx`, `UserDetailPage.test.tsx`, `NewClubAccountPage.tsx`, `NewClubAccountPage.test.tsx` (compile fixes only)

**Interfaces:**

- Consumes: every backend route of Tasks 3-7.
- Produces (generated SDK, `apps/admin/src/api/generated/sdk.gen.ts`): `adminControllerListUsers`, `adminControllerGetUser`, `adminControllerUpdateUser`, `adminControllerCreateUser`, `adminControllerSetUserStatus`, `adminControllerDeleteUser`, `adminControllerResendInvitation`, `adminControllerListClubs`, `adminControllerClubOptions`, `adminControllerGetClub`, `adminControllerUpdateClub`, `adminControllerSetClubStatus`, `adminControllerDeleteClub`, `adminControllerReferenceData`, `adminControllerAuditLog`. Types (`types.gen.ts`): `ClubRegistrationMode`, `UserRole`, `AdminUserDetailDto` (with `disabledAt`, `clubDisabledAt`), `AdminClubListItemDto`, `AdminClubDetailDto`, `AdminClubMemberDto`, `AuditLogEntryDto['action']` (11 actions), `AdminControllerCreateUserData`, `AdminControllerListClubsData`, `AdminControllerListUsersData`.
- Produces (SPA):
  - `queries.ts`: `clubOptionsQuery(includeId?: string | null)` replaces `clubsQuery` (lot 1 constant), query key `['admin', 'clubs', 'options', includeId ?? null]`.
  - `lib/labels.ts`: `ROLE_LABELS: Record<UserRole, string>`, `REGISTRATION_MODE_LABELS: Record<ClubRegistrationMode, string>`.
  - `ACTION_LABELS` covers the 11 actions; `ChangeSummary` labels `name` / `registrationMode` and shows role and registration-mode values in French.

- [ ] **Step 1: Backend coverage gate and full backend checks**

```bash
pnpm --filter backend typecheck
pnpm --filter backend lint
pnpm --filter backend exec jest --coverage --silent
```

Expected: no errors; every threshold met, in particular `src/admin` (94 / 75 / 88 / 94), `src/auth`, `src/users` and `src/common/filters`. If a threshold fails, add unit tests for the uncovered branches named in the report; never lower a threshold.

- [ ] **Step 2: Export Swagger (from `apps/backend`, not the repo root)**

```bash
cd apps/backend
pnpm run build
node scripts/export-swagger.js
cp swagger.json ../docs/public/swagger.json
pnpm exec prettier --write swagger.json ../docs/public/swagger.json
node -e 'const s=require("./swagger.json");console.log(Object.keys(s.paths).filter((p)=>p.startsWith("/admin")).sort().join("\n"))'
```

Expected output of the last command, exactly:

```
/admin/audit-log
/admin/clubs
/admin/clubs/options
/admin/clubs/{id}
/admin/clubs/{id}/status
/admin/reference-data
/admin/users
/admin/users/{id}
/admin/users/{id}/resend-invitation
/admin/users/{id}/status
```

(`/admin/club-accounts` must be gone.) Also check that `DELETE /admin/users/{id}` has a `requestBody` (`node -e 'console.log(!!require("./swagger.json").paths["/admin/users/{id}"].delete.requestBody)'` prints `true`).

- [ ] **Step 3: Regenerate the admin client and see what breaks**

```bash
pnpm --filter admin exec openapi-ts
pnpm --filter admin typecheck
```

Expected: FAIL, with errors limited to: `adminControllerClubs` and `adminControllerCreateClubAccount` no longer exported (in `queries.ts` and `NewClubAccountPage.tsx`), and `ACTION_LABELS` missing the eight new actions.

- [ ] **Step 4: Fix the API layer**

In `apps/admin/src/api/queries.ts`, replace `adminControllerClubs` with `adminControllerClubOptions` in the SDK import and replace the `clubsQuery` constant with:

```ts
/** Active clubs for selects, plus `includeId` (the current value) even if disabled. */
export const clubOptionsQuery = (includeId?: string | null) =>
  queryOptions({
    queryKey: ['admin', 'clubs', 'options', includeId ?? null],
    queryFn: () =>
      unwrap(adminControllerClubOptions(includeId ? { query: { includeId } } : undefined)),
    staleTime: 5 * 60_000,
  });
```

- [ ] **Step 5: Labels — failing test first**

Append to `apps/admin/src/components/ChangeSummary.test.tsx` (inside the `describe`):

```tsx
it('labels club fields and shows registration modes and roles in French', () => {
  render(
    <MantineProvider>
      <ChangeSummary
        before={{ name: 'Club A', registrationMode: 'CLUB_ONLY', role: 'LICENSEE' }}
        after={{ name: 'Club Z', registrationMode: 'MEMBERS_AUTO_CONFIRM', role: 'STAFF' }}
      />
    </MantineProvider>,
  );
  expect(screen.getByText('Nom du club')).toBeInTheDocument();
  expect(screen.getByText("Mode d'inscription")).toBeInTheDocument();
  expect(screen.getByText('Le club seul inscrit ses licenciés')).toBeInTheDocument();
  expect(screen.getByText('Licenciés, validation automatique')).toBeInTheDocument();
  expect(screen.getByText('Licencié')).toBeInTheDocument();
  expect(screen.getByText('Staff')).toBeInTheDocument();
});
```

Run: `pnpm --filter admin test -- src/components/ChangeSummary.test.tsx`
Expected: FAIL (raw keys and enum values).

`apps/admin/src/lib/labels.ts`:

```ts
import type { ClubRegistrationMode, UserRole } from '../api/generated/types.gen';

export const ROLE_LABELS: Record<UserRole, string> = {
  LICENSEE: 'Licencié',
  CLUB: 'Club',
  STAFF: 'Staff',
  ADMIN: 'Admin',
};

export const REGISTRATION_MODE_LABELS: Record<ClubRegistrationMode, string> = {
  CLUB_AND_MEMBERS_PENDING: 'Licenciés et club, validation par le club',
  CLUB_ONLY: 'Le club seul inscrit ses licenciés',
  MEMBERS_AUTO_CONFIRM: 'Licenciés, validation automatique',
};
```

In `apps/admin/src/components/ChangeSummary.tsx`:

- Add `import { REGISTRATION_MODE_LABELS, ROLE_LABELS } from '../lib/labels';`.
- In `LABELS`, add `name: 'Nom du club',` and `registrationMode: "Mode d'inscription",`.
- Add above the component:

```tsx
const VALUE_LABELS: Record<string, Record<string, string>> = {
  role: ROLE_LABELS,
  registrationMode: REGISTRATION_MODE_LABELS,
};

function display(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const text = String(value);
  return VALUE_LABELS[key]?.[text] ?? text;
}
```

- Replace `{String(before[k] ?? '—')}` with `{display(k, before[k])}` and `{String(after[k] ?? '—')}` with `{display(k, after[k])}`.

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
  CLUB_UPDATE: 'Modification de club',
  CLUB_DISABLE: 'Désactivation de club',
  CLUB_ENABLE: 'Réactivation de club',
  CLUB_DELETE: 'Suppression de club',
};
```

Run: `pnpm --filter admin test -- src/components/ChangeSummary.test.tsx`
Expected: PASS.

- [ ] **Step 6: Compile fixes in the three pages (behaviour unchanged)**

- `apps/admin/src/pages/UsersPage.tsx`: import `clubOptionsQuery` instead of `clubsQuery`; `const clubs = useQuery(clubOptionsQuery(clubId));` (declare it after `clubId`'s `useState`).
- `apps/admin/src/pages/UserDetailPage.tsx`: import `clubOptionsQuery` instead of `clubsQuery`; `const clubs = useQuery(clubOptionsQuery(user.data?.clubId));`.
- `apps/admin/src/pages/NewClubAccountPage.tsx`: import `clubOptionsQuery` and use `useQuery(clubOptionsQuery())`; replace the `adminControllerCreateClubAccount` import and call with `adminControllerCreateUser`, and add `role: 'CLUB' as const,` to `body` after `lastName`. (Task 9 replaces this page.)
- In `UsersPage.test.tsx`, `UserDetailPage.test.tsx` and `NewClubAccountPage.test.tsx`, replace every `'adminControllerClubs'` spy with `'adminControllerClubOptions'`; in `NewClubAccountPage.test.tsx` replace every `'adminControllerCreateClubAccount'` with `'adminControllerCreateUser'` and add `role: 'CLUB',` after `lastName: 'Martin',` in the expected body of "creates the account and opens the user page".

- [ ] **Step 7: Run the admin checks**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/swagger.json apps/docs/public/swagger.json apps/admin/src
git commit -m "chore(admin): export the lot 1b API contract and adapt the back-office client

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 9: "Nouvel utilisateur" page

**Files:**

- Rename + rewrite: `apps/admin/src/pages/NewClubAccountPage.tsx` → `apps/admin/src/pages/NewUserPage.tsx`, and its test → `NewUserPage.test.tsx`
- Create: `apps/admin/src/lib/apiError.ts`, `apps/admin/src/lib/apiError.test.ts`
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/AppLayout.tsx`, `apps/admin/src/pages/UsersPage.tsx` (header button)

**Interfaces:**

- Consumes: `adminControllerCreateUser`, `AdminControllerCreateUserData` (Task 8 regen); `clubOptionsQuery`, `referenceQuery`, `ROLE_LABELS` (Task 8).
- Produces: `apiErrorMessage(body: unknown, fallback: string): string` (`lib/apiError.ts`, reused by Tasks 11 and 13); route `/users/new` → `NewUserPage`; route `/club-accounts/new` removed.

- [ ] **Step 1: `apiErrorMessage` — test, then code**

`apps/admin/src/lib/apiError.test.ts`:

```ts
import { apiErrorMessage } from './apiError';

describe('apiErrorMessage', () => {
  it('returns a string message', () => {
    expect(apiErrorMessage({ message: 'Email déjà utilisé' }, 'x')).toBe('Email déjà utilisé');
  });
  it('joins a validation array', () => {
    expect(apiErrorMessage({ message: ['a', 'b'] }, 'x')).toBe('a, b');
  });
  it('falls back on anything else', () => {
    expect(apiErrorMessage(null, 'Création impossible')).toBe('Création impossible');
    expect(apiErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
    expect(apiErrorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('Failed to fetch');
  });
});
```

Run: `pnpm --filter admin test -- src/lib/apiError.test.ts` → FAIL (module missing).

`apps/admin/src/lib/apiError.ts`:

```ts
/** Message of a parsed NestJS error body (string or validation array), or the fallback. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) return fallback;
  const { message } = body as { message?: unknown };
  const text = Array.isArray(message)
    ? message.filter((m): m is string => typeof m === 'string').join(', ')
    : message;
  return typeof text === 'string' && text ? text : fallback;
}
```

Run again → PASS.

- [ ] **Step 2: Rename and write the failing page tests**

```bash
cd apps/admin/src/pages
git mv NewClubAccountPage.tsx NewUserPage.tsx
git mv NewClubAccountPage.test.tsx NewUserPage.test.tsx
```

Replace `apps/admin/src/pages/NewUserPage.test.tsx` with:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewUserPage } from './NewUserPage';

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users/new']}>
          <Routes>
            <Route path="/users/new" element={<NewUserPage />} />
            <Route path="/users/:id" element={<p>user page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillIdentity() {
  await userEvent.type(await screen.findByLabelText(/^Email/), 'jeanne@x.fr');
  await userEvent.type(screen.getByLabelText(/^Prénom/), 'Jeanne');
  await userEvent.type(screen.getByLabelText(/^Nom de famille/), 'Martin');
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /créer l'utilisateur/i }));

describe('NewUserPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin'],
        ageGroups: ['Adulte'],
        competitionLevels: ['Débutant'],
        passportLevels: ['BLANC'],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
  });

  it('creates a licensee without club, with an optional ranking, then opens the user page', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: null, invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.type(await screen.findByLabelText('Classement national'), '12');
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        nationalRanking: 12,
      },
    });
    expect(await screen.findByText('user page')).toBeInTheDocument();
  });

  it('offers a new club only for the Club role, where a club becomes required', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser');
    renderPage();
    await fillIdentity();
    expect(screen.queryByRole('radio', { name: 'Nouveau club' })).toBeNull();
    expect(screen.getByLabelText('Club (facultatif)', { selector: 'input' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    expect(screen.getByRole('radio', { name: 'Nouveau club' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Classement national')).toBeNull();
    await submit();
    expect(await screen.findByText('Choisir un club')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a Club account with a new club', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: 'c-new', invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await userEvent.type(screen.getByLabelText(/^Nom du nouveau club/), 'Club Neuf');
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'CLUB',
        clubName: 'Club Neuf',
      },
    });
  });

  it('offers the existing club when the new club name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await userEvent.type(screen.getByLabelText(/^Nom du nouveau club/), 'Club A');
    await submit();
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /utiliser « club a »/i }));
    expect(screen.getByRole('radio', { name: 'Club existant' })).toBeChecked();
  });

  it('shows a plain error without a club shortcut on an email conflict', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Cet email est déjà utilisé' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillIdentity();
    await submit();
    expect(await screen.findByText('Cet email est déjà utilisé')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /utiliser/i })).not.toBeInTheDocument();
  });

  it('shows the unavailable message on a network failure', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await submit();
    expect(await screen.findByText(/serveur indisponible/i)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin test -- src/pages/NewUserPage.test.tsx`
Expected: FAIL (`NewUserPage` not exported).

- [ ] **Step 3: Write the page**

Replace `apps/admin/src/pages/NewUserPage.tsx` with:

```tsx
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { adminControllerCreateUser } from '../api/generated/sdk.gen';
import type { AdminControllerCreateUserData } from '../api/generated/types.gen';
import { clubOptionsQuery, referenceQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { ROLE_LABELS } from '../lib/labels';

const UNAVAILABLE = 'Serveur indisponible, réessayez dans un instant.';

type CreateBody = AdminControllerCreateUserData['body'];
type Role = CreateBody['role'];
type ClubMode = 'existing' | 'new';

const ROLES: Role[] = ['LICENSEE', 'CLUB', 'STAFF'];

interface FormError {
  message: string;
  existingClubId?: string;
}

function toFormError(body: unknown): FormError {
  const existingClubId =
    typeof body === 'object' && body !== null
      ? (body as { existingClubId?: unknown }).existingClubId
      : undefined;
  return {
    message: apiErrorMessage(body, 'Création impossible'),
    existingClubId: typeof existingClubId === 'string' ? existingClubId : undefined,
  };
}

interface Values {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  clubMode: ClubMode;
  clubId: string | null;
  clubName: string;
  category: string | null;
  ageGroup: string | null;
  competitionLevel: string | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  nationalRanking: number | string;
}

/**
 * The form holds plain strings while the DTO types reference-backed fields as
 * literal unions. Selects only offer reference values and the backend
 * validates them again, so this single widening cast is safe.
 */
function toBody(v: Values): CreateBody {
  const club =
    v.role === 'CLUB'
      ? v.clubMode === 'existing'
        ? { clubId: v.clubId as string }
        : { clubName: v.clubName.trim() }
      : v.clubId
        ? { clubId: v.clubId }
        : {};
  const profile =
    v.role === 'LICENSEE'
      ? Object.fromEntries(
          Object.entries({
            category: v.category,
            ageGroup: v.ageGroup,
            competitionLevel: v.competitionLevel,
            passportLevelLatin: v.passportLevelLatin,
            passportLevelStandard: v.passportLevelStandard,
            nationalRanking: typeof v.nationalRanking === 'number' ? v.nationalRanking : null,
          }).filter(([, value]) => value !== null),
        )
      : {};
  return {
    email: v.email.trim(),
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    role: v.role,
    ...club,
    ...profile,
  } as CreateBody;
}

export function NewUserPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clubs = useQuery(clubOptionsQuery());
  const ref = useQuery(referenceQuery);
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    initialValues: {
      email: '',
      firstName: '',
      lastName: '',
      role: 'LICENSEE',
      clubMode: 'existing',
      clubId: null,
      clubName: '',
      category: null,
      ageGroup: null,
      competitionLevel: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      nationalRanking: '',
    },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Email invalide'),
      firstName: (v) => (v.trim() ? null : 'Obligatoire'),
      lastName: (v) => (v.trim() ? null : 'Obligatoire'),
      clubId: (v, values) =>
        values.role === 'CLUB' && values.clubMode === 'existing' && !v ? 'Choisir un club' : null,
      clubName: (v, values) =>
        values.role === 'CLUB' && values.clubMode === 'new' && v.trim().length < 2
          ? 'Nom trop court'
          : null,
    },
  });
  const { role, clubMode } = form.values;
  const clubData = (clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  const onSubmit = form.onSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await adminControllerCreateUser({
        body: toBody(values),
      });
      if (!data) {
        // The generated client never throws: no response means a network failure.
        setError(response ? toFormError(apiError) : { message: UNAVAILABLE });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['admin'] });
      notifications.show(
        data.invitationSent
          ? { color: 'green', message: 'Utilisateur créé, invitation envoyée' }
          : {
              color: 'orange',
              message:
                "Utilisateur créé, mais l'email n'est pas parti : utilisez « Renvoyer l'invitation »",
            },
      );
      navigate(`/users/${data.userId}`);
    } catch {
      setError({ message: UNAVAILABLE });
    } finally {
      setSubmitting(false);
    }
  });

  const existingName = error?.existingClubId
    ? clubs.data?.find((c) => c.id === error.existingClubId)?.name
    : undefined;

  return (
    <Stack maw={640}>
      <Title order={2}>Nouvel utilisateur</Title>
      {clubs.isError && <Alert color="red">Impossible de charger la liste des clubs.</Alert>}
      {error && (
        <Alert color="red">
          {error.message}
          {error.existingClubId && (
            <Button
              size="xs"
              ml="sm"
              variant="white"
              onClick={() => {
                form.setValues({ clubMode: 'existing', clubId: error.existingClubId ?? null });
                if (!existingName) void clubs.refetch();
                setError(null);
              }}
            >
              {existingName ? `Utiliser « ${existingName} »` : 'Utiliser le club existant'}
            </Button>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack>
          <Radio.Group label="Rôle" withAsterisk {...form.getInputProps('role')}>
            <Group mt="xs">
              {ROLES.map((r) => (
                <Radio key={r} value={r} label={ROLE_LABELS[r]} />
              ))}
            </Group>
          </Radio.Group>
          <TextInput label="Email" type="email" withAsterisk {...form.getInputProps('email')} />
          <TextInput label="Prénom" withAsterisk {...form.getInputProps('firstName')} />
          <TextInput label="Nom de famille" withAsterisk {...form.getInputProps('lastName')} />
          {role === 'CLUB' ? (
            <>
              <Radio.Group label="Club du compte" {...form.getInputProps('clubMode')}>
                <Group mt="xs">
                  <Radio value="existing" label="Club existant" />
                  <Radio value="new" label="Nouveau club" />
                </Group>
              </Radio.Group>
              {clubMode === 'existing' ? (
                <Select
                  label="Club existant"
                  withAsterisk
                  searchable
                  data={clubData}
                  {...form.getInputProps('clubId')}
                />
              ) : (
                <TextInput
                  label="Nom du nouveau club"
                  withAsterisk
                  {...form.getInputProps('clubName')}
                />
              )}
            </>
          ) : (
            <Select
              label="Club (facultatif)"
              clearable
              searchable
              data={clubData}
              {...form.getInputProps('clubId')}
            />
          )}
          {role === 'LICENSEE' && ref.data && (
            <>
              <Title order={4}>Profil (facultatif)</Title>
              <SimpleGrid cols={2}>
                <Select
                  label="Catégorie"
                  clearable
                  data={ref.data.categories}
                  {...form.getInputProps('category')}
                />
                <Select
                  label="Classe d'âge"
                  clearable
                  searchable
                  data={ref.data.ageGroups}
                  {...form.getInputProps('ageGroup')}
                />
                <Select
                  label="Niveau compétition"
                  clearable
                  data={ref.data.competitionLevels}
                  {...form.getInputProps('competitionLevel')}
                />
                <Select
                  label="Passeport Latine"
                  clearable
                  data={ref.data.passportLevels}
                  {...form.getInputProps('passportLevelLatin')}
                />
                <Select
                  label="Passeport Standard"
                  clearable
                  data={ref.data.passportLevels}
                  {...form.getInputProps('passportLevelStandard')}
                />
                <NumberInput
                  label="Classement national"
                  min={1}
                  max={100000}
                  allowDecimal={false}
                  {...form.getInputProps('nationalRanking')}
                />
              </SimpleGrid>
            </>
          )}
          <Button type="submit" loading={submitting}>
            Créer l'utilisateur
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
```

(The club-mode group is labelled "Club du compte" so that the role radio named "Club" stays the only element with that exact name.)

- [ ] **Step 4: Route, nav, list button**

`apps/admin/src/router.tsx`: replace the `NewClubAccountPage` import with `import { NewUserPage } from './pages/NewUserPage';`, remove `{ path: 'club-accounts/new', element: <NewClubAccountPage /> },` and add, right after the `users` route:

```tsx
      { path: 'users/new', element: <NewUserPage /> },
```

`apps/admin/src/components/AppLayout.tsx`: replace the "Nouveau compte Club" `NavLink` with:

```tsx
<NavLink component={RouterLink} to="/users/new" label="Nouvel utilisateur" />
```

`apps/admin/src/pages/UsersPage.tsx`: the header button becomes:

```tsx
<Button component={Link} to="/users/new">
  Nouvel utilisateur
</Button>
```

- [ ] **Step 5: Run the admin checks**

```bash
pnpm --filter admin typecheck
pnpm --filter admin lint
pnpm --filter admin test
```

Expected: PASS. If a Mantine `NumberInput` keeps the typed value as the string `'12'`, the first test fails on `nationalRanking`; in that case parse in `toBody` with `Number(v.nationalRanking)` when it is a non-empty string, and keep the test unchanged.

- [ ] **Step 6: Commit**

```bash
git add -A apps/admin/src
git commit -m "feat(admin): new user page for licensee, club and staff accounts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 10: Users list — "Utilisateurs", status badge and filter

**Files:**

- Modify: `apps/admin/src/lib/labels.ts` (`STATUS_FILTER_OPTIONS`)
- Modify: `apps/admin/src/pages/UsersPage.tsx`, `apps/admin/src/pages/UsersPage.test.tsx`
- Modify: `apps/admin/src/components/AppLayout.tsx`

**Interfaces:**

- Consumes: `UsersFilter['status']`, `AdminUserListItemDto.disabledAt` (Task 8 regen); `ROLE_LABELS` (Task 8).
- Produces: `STATUS_FILTER_OPTIONS: { value: 'all' | 'active' | 'disabled'; label: string }[]` and `type StatusChoice = 'all' | 'active' | 'disabled'` in `lib/labels.ts` (reused by Task 12).

- [ ] **Step 1: Failing tests**

In `apps/admin/src/pages/UsersPage.test.tsx`:

- In `page(n)`, add `disabledAt: null,` to `u1` and `disabledAt: '2026-10-01T00:00:00.000Z',` to `u2`.
- In "lists users with the total count", replace `'2 inscrits'` with `'2 utilisateurs'` and add `expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();`.
- Append:

```tsx
it('flags a disabled user with a red badge', async () => {
  vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(2) as never);
  renderPage();
  const row = (await screen.findByText('paul@x.fr')).closest('tr') as HTMLElement;
  expect(within(row).getByText('Désactivé')).toBeInTheDocument();
  const other = screen.getByText('jeanne@x.fr').closest('tr') as HTMLElement;
  expect(within(other).queryByText('Désactivé')).toBeNull();
});

it('filters on the status, from the first page', async () => {
  const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
  renderPage();
  await screen.findByText('jeanne@x.fr');
  await userEvent.click(screen.getByText('Désactivés'));
  await waitFor(() =>
    expect(spy).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ status: 'disabled', skip: 0 }),
    }),
  );
});
```

Run: `pnpm --filter admin test -- src/pages/UsersPage.test.tsx`
Expected: FAIL (wording, no badge, no filter).

- [ ] **Step 2: Implement**

Append to `apps/admin/src/lib/labels.ts`:

```ts
export type StatusChoice = 'all' | 'active' | 'disabled';

export const STATUS_FILTER_OPTIONS: { value: StatusChoice; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'active', label: 'Actifs' },
  { value: 'disabled', label: 'Désactivés' },
];
```

In `apps/admin/src/pages/UsersPage.tsx`:

- Add `SegmentedControl` to the `@mantine/core` import and `import { ROLE_LABELS, STATUS_FILTER_OPTIONS, type StatusChoice } from '../lib/labels';`.
- State: `const [status, setStatus] = useState<StatusChoice>('all');`.
- In `filters`, add `...(status !== 'all' && { status }),` after the `category` line.
- Title: `<Title order={2}>Utilisateurs</Title>`.
- After the filters `<Group grow>…</Group>`, add:

```tsx
<SegmentedControl
  w="fit-content"
  data={STATUS_FILTER_OPTIONS}
  value={status}
  onChange={(v) => setStatus(v as StatusChoice)}
/>
```

- Error text: `Impossible de charger les utilisateurs.`
- Count: `{total} utilisateur{total > 1 ? 's' : ''}`.
- Name cell:

```tsx
<Table.Td>
  {u.lastName} {u.firstName}
  {u.disabledAt && (
    <Badge color="red" variant="light" ml="xs">
      Désactivé
    </Badge>
  )}
</Table.Td>
```

- Role cell: `<Badge variant="light">{ROLE_LABELS[u.role]}</Badge>`.

`apps/admin/src/components/AppLayout.tsx`: the first `NavLink` label becomes `"Utilisateurs"`.

Run: `pnpm --filter admin test -- src/pages/UsersPage.test.tsx`
Expected: PASS.

- [ ] **Step 3: No "Inscrits" left, checks, commit**

```bash
grep -rniE "inscrits?\b" apps/admin/src --include='*.tsx' --include='*.ts' | grep -v generated
pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin test
git add apps/admin/src
git commit -m "feat(admin): rename Inscrits to Utilisateurs, add the status badge and filter

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

Expected: the `grep` prints nothing; checks PASS.

---

### Task 11: User page — status, deletion, invitation for any role

**Files:**

- Modify: `apps/admin/src/api/queries.ts` (`ensureOk`)
- Modify: `apps/admin/src/pages/UserDetailPage.tsx`, `apps/admin/src/pages/UserDetailPage.test.tsx`

**Interfaces:**

- Consumes: `adminControllerSetUserStatus`, `adminControllerDeleteUser`, `AdminUserDetailDto.disabledAt` / `.clubDisabledAt` (Task 8 regen); `apiErrorMessage` (Task 9); `clubOptionsQuery` (Task 8).
- Produces: `ensureOk(p: Promise<{ error?: unknown; response?: Response }>): Promise<void>` in `queries.ts` (reused by Task 13).

- [ ] **Step 1: `ensureOk`**

Append to `apps/admin/src/api/queries.ts`:

```ts
/** For endpoints answering 204 (no body): rejects with the parsed error body, resolves otherwise. */
export async function ensureOk(
  p: Promise<{ error?: unknown; response?: Response }>,
): Promise<void> {
  const { error, response } = await p;
  if (error !== undefined || !response?.ok) {
    throw error ?? new Error('Requête refusée');
  }
}
```

- [ ] **Step 2: Failing page tests**

In `apps/admin/src/pages/UserDetailPage.test.tsx`:

1. Change the imports to `import { render, screen, within } from '@testing-library/react';`.
2. In `detail`, add `disabledAt: null,` and `clubDisabledAt: null,`.
3. In `renderPage`, add a list route next to the detail route:
   ```tsx
   <Route path="/users" element={<p>users list</p>} />
   ```
4. Replace the test `'hides the resend button for a non-CLUB account'` with:

```tsx
it('offers the invitation to a licensee who never logged in', async () => {
  const resend = vi
    .spyOn(sdk, 'adminControllerResendInvitation')
    .mockResolvedValue({ data: { invitationSent: true }, error: undefined } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
  expect(resend).toHaveBeenCalledWith({ path: { id: 'u1' } });
});

it.each([
  ['an ADMIN account', { role: 'ADMIN' }],
  ['a disabled account', { disabledAt: '2026-10-01T10:00:00.000Z' }],
])('hides the resend button for %s', async (_label, patch) => {
  vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
    data: { ...detail, ...patch },
    error: undefined,
  } as never);
  renderPage();
  expect(await screen.findByText(/Dernière connexion/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /renvoyer l'invitation/i })).toBeNull();
});
```

5. Append:

```tsx
it('deactivates after a confirmation, then shows the banner', async () => {
  const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
    data: { ...detail, disabledAt: '2026-10-07T10:00:00.000Z' },
    error: undefined,
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/déconnecté immédiatement/);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
  expect(setStatus).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { active: false } });
  expect(await screen.findByText('Compte désactivé')).toBeInTheDocument();
});

it('reactivates a disabled account', async () => {
  vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
    data: { ...detail, disabledAt: '2026-10-01T10:00:00.000Z' },
    error: undefined,
  } as never);
  const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
    data: detail,
    error: undefined,
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Réactiver' }));
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Réactiver' }),
  );
  expect(setStatus).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { active: true } });
});

it('explains that a CLUB account of a disabled club cannot log in', async () => {
  vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
    data: { ...detail, role: 'CLUB', clubDisabledAt: '2026-10-01T10:00:00.000Z' },
    error: undefined,
  } as never);
  renderPage();
  expect(await screen.findByText('Club désactivé')).toBeInTheDocument();
});

it('deletes only once the typed email matches, whatever its case, then returns to the list', async () => {
  const remove = vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
    data: undefined,
    error: undefined,
    response: new Response(null, { status: 204 }),
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
  const dialog = await screen.findByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.f');
  expect(confirm).toBeDisabled();
  await userEvent.clear(within(dialog).getByLabelText(/recopiez l'email/i));
  await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), ' JEANNE@x.fr ');
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  expect(remove).toHaveBeenCalledWith({
    path: { id: 'u1' },
    body: { confirmEmail: 'JEANNE@x.fr' },
  });
  expect(await screen.findByText('users list')).toBeInTheDocument();
});

it('keeps the dialog open with the server message when the deletion is refused', async () => {
  vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
    data: undefined,
    error: { message: "L'email saisi ne correspond pas au compte" },
    response: new Response(null, { status: 400 }),
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
  expect(
    await within(dialog).findByText("L'email saisi ne correspond pas au compte"),
  ).toBeInTheDocument();
});

it("hides the status and delete actions on the admin's own account", async () => {
  vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
    data: { ...detail, id: 'admin-1', role: 'ADMIN' },
    error: undefined,
  } as never);
  renderPage();
  expect(await screen.findByText(/Dernière connexion/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Désactiver' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Supprimer le compte' })).toBeNull();
});
```

Run: `pnpm --filter admin test -- src/pages/UserDetailPage.test.tsx`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

In `apps/admin/src/pages/UserDetailPage.tsx`:

1. Imports (`Alert`, `Card`, `Modal`, `Text` and `TextInput` are already imported): add `useNavigate` to the `react-router` import; add `adminControllerDeleteUser` and `adminControllerSetUserStatus` to the SDK import; add `ensureOk` to the `../api/queries` import; add `import { apiErrorMessage } from '../lib/apiError';`.
2. After `const [pending, setPending] = ...`, add:

```tsx
const navigate = useNavigate();
const [statusOpen, setStatusOpen] = useState(false);
const [deleteOpen, setDeleteOpen] = useState(false);
const [typedEmail, setTypedEmail] = useState('');
```

3. After the `resend` mutation, add:

```tsx
const setStatus = useMutation({
  mutationFn: (active: boolean) =>
    unwrap(adminControllerSetUserStatus({ path: { id }, body: { active } })),
  onSuccess: (updated) => {
    qc.setQueryData(userQuery(id).queryKey, updated);
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    setStatusOpen(false);
    notifications.show({
      color: 'green',
      message: updated.disabledAt ? 'Compte désactivé' : 'Compte réactivé',
    });
  },
  onError: (e) =>
    notifications.show({
      color: 'red',
      message: apiErrorMessage(e, 'Changement de statut impossible'),
    }),
});

const remove = useMutation({
  mutationFn: (confirmEmail: string) =>
    ensureOk(adminControllerDeleteUser({ path: { id }, body: { confirmEmail } })),
  onSuccess: () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    notifications.show({ color: 'green', message: 'Compte supprimé' });
    navigate('/users', { replace: true });
    qc.removeQueries({ queryKey: userQuery(id).queryKey });
  },
});
```

4. After `const isSelf = me?.id === u.id;`, add:

```tsx
const disabled = u.disabledAt !== null;
// lastLoginAt is recorded at login and refresh since lot 1; null = never used.
const canResend = u.role !== 'ADMIN' && u.lastLoginAt === null && !disabled;
const emailMatches = typedEmail.trim().toLowerCase() === u.email.toLowerCase();
const closeDelete = () => {
  setDeleteOpen(false);
  setTypedEmail('');
  remove.reset();
};
```

5. Replace the header `<Group justify="space-between">…</Group>` (title + resend button, including the comment above the button) with:

```tsx
<Group justify="space-between">
  <Title order={2}>
    {u.firstName} {u.lastName}
  </Title>
  <Group>
    {canResend && (
      <Button variant="light" loading={resend.isPending} onClick={() => resend.mutate()}>
        Renvoyer l'invitation
      </Button>
    )}
    {!isSelf && (
      <Button
        variant="light"
        color={disabled ? 'green' : 'red'}
        onClick={() => setStatusOpen(true)}
      >
        {disabled ? 'Réactiver' : 'Désactiver'}
      </Button>
    )}
  </Group>
</Group>;
{
  disabled && (
    <Alert color="red" title="Compte désactivé">
      Désactivé le {dayjs(u.disabledAt).format('DD/MM/YYYY HH:mm')} : connexion et accès refusés.
      Les données restent intactes.
    </Alert>
  );
}
{
  !disabled && u.role === 'CLUB' && u.clubDisabledAt && (
    <Alert color="orange" title="Club désactivé">
      Le club de ce compte est désactivé : la connexion est refusée tant que le club n'est pas
      réactivé.
    </Alert>
  );
}
```

6. Right before `<Title order={4}>Historique admin</Title>`, add the danger zone and the two modals:

```tsx
      {!isSelf && (
        <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
          <Stack gap="xs">
            <Title order={4} c="red">
              Zone dangereuse
            </Title>
            <Text size="sm">
              La suppression efface définitivement le compte et ses données personnelles (droit à
              l'oubli). Pour une mesure réversible, désactivez le compte.
            </Text>
            <Group>
              <Button color="red" variant="outline" onClick={() => setDeleteOpen(true)}>
                Supprimer le compte
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Modal
        opened={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={disabled ? 'Réactiver ce compte' : 'Désactiver ce compte'}
      >
        <Stack>
          <Text size="sm">
            {disabled
              ? "L'utilisateur pourra de nouveau se connecter."
              : "L'utilisateur est déconnecté immédiatement et ne peut plus se connecter. Ses données restent intactes ; la désactivation est réversible."}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setStatusOpen(false)}>
              Annuler
            </Button>
            <Button
              color={disabled ? 'green' : 'red'}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate(disabled)}
            >
              {disabled ? 'Réactiver' : 'Désactiver'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpen} onClose={closeDelete} title="Supprimer définitivement ce compte">
        <Stack>
          <Text size="sm">
            Toutes les données de {u.firstName} {u.lastName} seront effacées : inscriptions,
            réservations, notifications, documents. Cette action est irréversible.
          </Text>
          {remove.isError && (
            <Alert color="red">{apiErrorMessage(remove.error, 'Suppression impossible')}</Alert>
          )}
          <TextInput
            label="Recopiez l'email du compte pour confirmer"
            placeholder={u.email}
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Annuler
            </Button>
            <Button
              color="red"
              disabled={!emailMatches}
              loading={remove.isPending}
              onClick={() => remove.mutate(typedEmail.trim())}
            >
              Supprimer définitivement
            </Button>
          </Group>
        </Stack>
      </Modal>
```

Run: `pnpm --filter admin test -- src/pages/UserDetailPage.test.tsx`
Expected: PASS (the lot 1 tests too).

- [ ] **Step 4: Checks and commit**

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin test
git add apps/admin/src
git commit -m "feat(admin): deactivate, reactivate and delete a user from the user page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

### Task 12: Clubs list page

**Files:**

- Modify: `apps/admin/src/api/queries.ts` (`ClubsFilter`, `clubsQuery`)
- Create: `apps/admin/src/pages/ClubsPage.tsx`, `apps/admin/src/pages/ClubsPage.test.tsx`
- Modify: `apps/admin/src/router.tsx`, `apps/admin/src/components/AppLayout.tsx`

**Interfaces:**

- Consumes: `adminControllerListClubs`, `AdminControllerListClubsData` (Task 8 regen); `REGISTRATION_MODE_LABELS`, `STATUS_FILTER_OPTIONS`, `StatusChoice` (Tasks 8, 10).
- Produces: `type ClubsFilter`, `clubsQuery(q: ClubsFilter)` (key `['admin', 'clubs', 'list', q]`); route `/clubs` → `ClubsPage`; nav entry "Clubs".

- [ ] **Step 1: Query**

In `apps/admin/src/api/queries.ts`, add `adminControllerListClubs` to the SDK import, `AdminControllerListClubsData` to the type import, and:

```ts
export type ClubsFilter = NonNullable<AdminControllerListClubsData['query']>;

export const clubsQuery = (q: ClubsFilter) =>
  queryOptions({
    queryKey: ['admin', 'clubs', 'list', q],
    queryFn: () => unwrap(adminControllerListClubs({ query: q })),
  });
```

- [ ] **Step 2: Failing page tests**

`apps/admin/src/pages/ClubsPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ClubsPage } from './ClubsPage';

const page = {
  data: {
    data: [
      {
        id: 'c1',
        name: 'Club A',
        registrationMode: 'CLUB_ONLY',
        disabledAt: null,
        memberCount: 12,
        clubAccountCount: 1,
        helloAssoConfigured: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'c2',
        name: 'Club B',
        registrationMode: 'MEMBERS_AUTO_CONFIRM',
        disabledAt: '2026-10-01T00:00:00.000Z',
        memberCount: 0,
        clubAccountCount: 0,
        helloAssoConfigured: false,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ],
    meta: { total: 2, skip: 0, take: 50, hasMore: false },
  },
  error: undefined,
};

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <ClubsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('ClubsPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists clubs with their counts, HelloAsso badge, mode and status', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    const rowA = (await screen.findByRole('link', { name: 'Club A' })).closest('tr') as HTMLElement;
    expect(screen.getByRole('link', { name: 'Club A' })).toHaveAttribute('href', '/clubs/c1');
    expect(within(rowA).getByText('12')).toBeInTheDocument();
    expect(within(rowA).getByText('HelloAsso')).toBeInTheDocument();
    expect(within(rowA).getByText('Le club seul inscrit ses licenciés')).toBeInTheDocument();
    const rowB = screen.getByRole('link', { name: 'Club B' }).closest('tr') as HTMLElement;
    expect(within(rowB).getByText('Désactivé')).toBeInTheDocument();
    expect(within(rowB).queryByText('HelloAsso')).toBeNull();
    expect(screen.getByText('2 clubs')).toBeInTheDocument();
  });

  it('searches by name after debounce and filters on the status, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue(page as never);
    renderPage();
    await screen.findByRole('link', { name: 'Club A' });
    await userEvent.type(screen.getByPlaceholderText(/nom du club/i), 'cl');
    await userEvent.click(screen.getByText('Désactivés'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ search: 'cl', status: 'disabled', skip: 0 }),
      }),
    );
  });

  it('shows an error state when the API fails', async () => {
    vi.spyOn(sdk, 'adminControllerListClubs').mockResolvedValue({
      data: undefined,
      error: { message: 'x' },
    } as never);
    renderPage();
    expect(await screen.findByText(/impossible de charger les clubs/i)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin test -- src/pages/ClubsPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the page**

`apps/admin/src/pages/ClubsPage.tsx`:

```tsx
import {
  Alert,
  Anchor,
  Badge,
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
import { useState } from 'react';
import { Link } from 'react-router';
import { clubsQuery, type ClubsFilter } from '../api/queries';
import { REGISTRATION_MODE_LABELS, STATUS_FILTER_OPTIONS, type StatusChoice } from '../lib/labels';

const PAGE_SIZE = 50;

export function ClubsPage() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<StatusChoice>('all');
  const [pageIndex, setPageIndex] = useState(1);

  const filters: ClubsFilter = {
    ...(debounced && { search: debounced }),
    ...(status !== 'all' && { status }),
  };
  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPageIndex(1);
  }

  const clubs = useQuery({
    ...clubsQuery({ ...filters, skip: (pageIndex - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const total = clubs.data?.meta.total ?? 0;

  return (
    <Stack>
      <Title order={2}>Clubs</Title>
      <Group>
        <TextInput
          placeholder="Nom du club"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <SegmentedControl
          data={STATUS_FILTER_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as StatusChoice)}
        />
      </Group>
      {clubs.isError && <Alert color="red">Impossible de charger les clubs.</Alert>}
      {clubs.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} club{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th>
                <Table.Th>Membres</Table.Th>
                <Table.Th>Comptes Club</Table.Th>
                <Table.Th>Paiement</Table.Th>
                <Table.Th>Inscriptions</Table.Th>
                <Table.Th>Création</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(clubs.data?.data ?? []).map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/clubs/${c.id}`}>
                      {c.name}
                    </Anchor>
                    {c.disabledAt && (
                      <Badge color="red" variant="light" ml="xs">
                        Désactivé
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{c.memberCount}</Table.Td>
                  <Table.Td>{c.clubAccountCount}</Table.Td>
                  <Table.Td>
                    {c.helloAssoConfigured ? (
                      <Badge color="green" variant="light">
                        HelloAsso
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>{REGISTRATION_MODE_LABELS[c.registrationMode]}</Table.Td>
                  <Table.Td>{dayjs(c.createdAt).format('DD/MM/YYYY')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {total > PAGE_SIZE && (
            <Pagination
              total={Math.ceil(total / PAGE_SIZE)}
              value={pageIndex}
              onChange={setPageIndex}
            />
          )}
        </>
      )}
    </Stack>
  );
}
```

- [ ] **Step 4: Route and nav**

`apps/admin/src/router.tsx`: `import { ClubsPage } from './pages/ClubsPage';` and add after the `users/:id` route:

```tsx
      { path: 'clubs', element: <ClubsPage /> },
```

`apps/admin/src/components/AppLayout.tsx`: add after the "Nouvel utilisateur" `NavLink`:

```tsx
<NavLink component={RouterLink} to="/clubs" label="Clubs" />
```

- [ ] **Step 5: Checks and commit**

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin test
git add apps/admin/src
git commit -m "feat(admin): clubs list with search, status filter and usage counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

Expected: PASS.

---

### Task 13: Club page — edit, status, danger zone, members

**Files:**

- Modify: `apps/admin/src/api/queries.ts` (`clubQuery`)
- Create: `apps/admin/src/pages/ClubDetailPage.tsx`, `apps/admin/src/pages/ClubDetailPage.test.tsx`
- Modify: `apps/admin/src/router.tsx`
- Modify: `apps/admin/src/pages/AuditLogPage.tsx`, `apps/admin/src/pages/AuditLogPage.test.tsx` (club targets, deleted targets)

**Interfaces:**

- Consumes: `adminControllerGetClub`, `adminControllerUpdateClub`, `adminControllerSetClubStatus`, `adminControllerDeleteClub`, `AdminClubDetailDto`, `ClubRegistrationMode` (Task 8 regen); `ensureOk` (Task 11); `apiErrorMessage` (Task 9); `ChangeSummary`, `REGISTRATION_MODE_LABELS`, `ROLE_LABELS`, `ACTION_LABELS`, `auditQuery` (Task 8 / lot 1).
- Produces: `clubQuery(id: string)` (key `['admin', 'club', id]`); route `/clubs/:id` → `ClubDetailPage`.

- [ ] **Step 1: Query**

In `apps/admin/src/api/queries.ts`, add `adminControllerGetClub` to the SDK import and:

```ts
export const clubQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'club', id],
    queryFn: () => unwrap(adminControllerGetClub({ path: { id } })),
  });
```

- [ ] **Step 2: Failing page tests**

`apps/admin/src/pages/ClubDetailPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ClubDetailPage } from './ClubDetailPage';

const empty = {
  id: 'c1',
  name: 'Club A',
  registrationMode: 'CLUB_ONLY',
  disabledAt: null,
  memberCount: 0,
  clubAccountCount: 0,
  competitionCount: 0,
  partnershipCount: 0,
  soloTeamCount: 0,
  helloAssoConfigured: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [],
};

const busy = {
  ...empty,
  memberCount: 2,
  clubAccountCount: 1,
  competitionCount: 1,
  members: [
    {
      id: 'u1',
      firstName: 'Jeanne',
      lastName: 'Martin',
      email: 'j@x.fr',
      role: 'LICENSEE',
      disabledAt: null,
    },
    {
      id: 'u2',
      firstName: 'Paul',
      lastName: 'Durand',
      email: 'p@x.fr',
      role: 'CLUB',
      disabledAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

function renderPage(club: object) {
  vi.spyOn(sdk, 'adminControllerGetClub').mockResolvedValue({
    data: club,
    error: undefined,
  } as never);
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/clubs/c1']}>
          <Routes>
            <Route path="/clubs/:id" element={<ClubDetailPage />} />
            <Route path="/clubs" element={<p>clubs list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('ClubDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } },
      error: undefined,
    } as never);
  });

  it('confirms a rename with a before → after summary, then PATCHes only the name', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateClub').mockResolvedValue({
      data: { ...empty, name: 'Club Z' },
      error: undefined,
    } as never);
    renderPage(empty);
    const name = await screen.findByLabelText(/^Nom du club/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Club Z');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Club A');
    expect(dialog).toHaveTextContent('Club Z');
    expect(dialog).toHaveTextContent(/reporté/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(patch).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { name: 'Club Z' } });
  });

  it('shows the server message when the new name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateClub').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c2' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage(empty);
    const name = await screen.findByLabelText(/^Nom du club/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Club B');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await within(dialog).findByText('Un club porte déjà ce nom')).toBeInTheDocument();
  });

  it('deactivates the club after a confirmation', async () => {
    const setStatus = vi.spyOn(sdk, 'adminControllerSetClubStatus').mockResolvedValue({
      data: { ...empty, disabledAt: '2026-10-07T10:00:00.000Z' },
      error: undefined,
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver le club' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/licenciés ne sont pas affectés/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
    expect(setStatus).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { active: false } });
  });

  it('blocks the deletion of a club in use, lists why, and offers to deactivate instead', async () => {
    renderPage(busy);
    expect(await screen.findByText('2 membres')).toBeInTheDocument();
    expect(screen.getByText('1 compte Club')).toBeInTheDocument();
    expect(screen.getByText('1 compétition organisée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer le club' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Désactiver à la place' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Désactiver ce club');
  });

  it('deletes an empty club after a confirmation and returns to the list', async () => {
    const remove = vi.spyOn(sdk, 'adminControllerDeleteClub').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le club' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Supprimer définitivement',
      }),
    );
    expect(remove).toHaveBeenCalledWith({ path: { id: 'c1' } });
    expect(await screen.findByText('clubs list')).toBeInTheDocument();
  });

  it('shows the counts sent by the server when the club filled up meanwhile', async () => {
    vi.spyOn(sdk, 'adminControllerDeleteClub').mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 409,
        message: "Ce club n'est pas vide : désactivez-le plutôt.",
        memberCount: 1,
        clubAccountCount: 0,
        competitionCount: 0,
        partnershipCount: 2,
        soloTeamCount: 0,
      },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le club' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await within(dialog).findByText('1 membre')).toBeInTheDocument();
    expect(within(dialog).getByText('2 couples rattachés')).toBeInTheDocument();
  });

  it('links each member to their page and flags disabled ones', async () => {
    renderPage(busy);
    expect(await screen.findByRole('link', { name: 'Martin Jeanne' })).toHaveAttribute(
      'href',
      '/users/u1',
    );
    const row = screen.getByRole('link', { name: 'Durand Paul' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Désactivé')).toBeInTheDocument();
    expect(within(row).getByText('Club')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin test -- src/pages/ClubDetailPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Write the page**

`apps/admin/src/pages/ClubDetailPage.tsx`:

```tsx
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  adminControllerDeleteClub,
  adminControllerSetClubStatus,
  adminControllerUpdateClub,
} from '../api/generated/sdk.gen';
import type { AdminClubDetailDto, ClubRegistrationMode } from '../api/generated/types.gen';
import { auditQuery, clubQuery, ensureOk, unwrap } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { apiErrorMessage } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { REGISTRATION_MODE_LABELS, ROLE_LABELS } from '../lib/labels';

interface ClubForm {
  name: string;
  registrationMode: ClubRegistrationMode;
}

type UsageKey =
  | 'memberCount'
  | 'clubAccountCount'
  | 'competitionCount'
  | 'partnershipCount'
  | 'soloTeamCount';

/** [singular, plural] for each thing that blocks a deletion. */
const USAGE_LABELS: Record<UsageKey, [string, string]> = {
  memberCount: ['membre', 'membres'],
  clubAccountCount: ['compte Club', 'comptes Club'],
  competitionCount: ['compétition organisée', 'compétitions organisées'],
  partnershipCount: ['couple rattaché', 'couples rattachés'],
  soloTeamCount: ['équipe solo', 'équipes solo'],
};
const USAGE_KEYS = Object.keys(USAGE_LABELS) as UsageKey[];

/** Non-zero usage lines, from the club detail or from a 409 body. */
function usageLines(source: unknown): string[] {
  if (typeof source !== 'object' || source === null) return [];
  const counts = source as Partial<Record<UsageKey, unknown>>;
  return USAGE_KEYS.flatMap((key) => {
    const n = counts[key];
    if (typeof n !== 'number' || n === 0) return [];
    const [one, many] = USAGE_LABELS[key];
    return [`${n} ${n > 1 ? many : one}`];
  });
}

const MODE_OPTIONS = (Object.keys(REGISTRATION_MODE_LABELS) as ClubRegistrationMode[]).map(
  (value) => ({ value, label: REGISTRATION_MODE_LABELS[value] }),
);

export function ClubDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const club = useQuery(clubQuery(id));
  const history = useQuery(auditQuery({ targetType: 'CLUB', targetId: id, skip: 0, take: 20 }));
  const [pending, setPending] = useState<Partial<ClubForm> | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const form = useForm<ClubForm>({
    initialValues: { name: '', registrationMode: 'MEMBERS_AUTO_CONFIRM' },
    validate: { name: (v) => (v.trim().length >= 2 ? null : 'Nom trop court') },
  });
  const { setValues } = form;
  useEffect(() => {
    if (club.data) {
      setValues({ name: club.data.name, registrationMode: club.data.registrationMode });
    }
  }, [club.data, setValues]);

  const applyUpdate = (updated: AdminClubDetailDto) => {
    qc.setQueryData(clubQuery(id).queryKey, updated);
    void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const save = useMutation({
    mutationFn: (body: Partial<ClubForm>) =>
      unwrap(adminControllerUpdateClub({ path: { id }, body })),
    onSuccess: (updated) => {
      applyUpdate(updated);
      // A rename rewrites the club name on every member.
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'user'] });
      setPending(null);
      notifications.show({ color: 'green', message: 'Club mis à jour' });
    },
  });

  const setStatus = useMutation({
    mutationFn: (active: boolean) =>
      unwrap(adminControllerSetClubStatus({ path: { id }, body: { active } })),
    onSuccess: (updated) => {
      applyUpdate(updated);
      setStatusOpen(false);
      setDeleteOpen(false);
      notifications.show({
        color: 'green',
        message: updated.disabledAt ? 'Club désactivé' : 'Club réactivé',
      });
    },
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, 'Changement de statut impossible'),
      }),
  });

  const remove = useMutation({
    mutationFn: () => ensureOk(adminControllerDeleteClub({ path: { id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      notifications.show({ color: 'green', message: 'Club supprimé' });
      navigate('/clubs', { replace: true });
      qc.removeQueries({ queryKey: clubQuery(id).queryKey });
    },
  });

  if (club.isError) return <Alert color="red">Club introuvable ou erreur serveur.</Alert>;
  if (!club.data) return <Loader />;
  const c = club.data;
  const disabled = c.disabledAt !== null;
  const blocking = usageLines(c);

  const onSubmit = form.onSubmit((v) => {
    const changes: Partial<ClubForm> = {};
    if (v.name.trim() !== c.name) changes.name = v.name.trim();
    if (v.registrationMode !== c.registrationMode) changes.registrationMode = v.registrationMode;
    if (Object.keys(changes).length) {
      save.reset();
      setPending(changes);
    }
  });

  const closeDelete = () => {
    setDeleteOpen(false);
    remove.reset();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{c.name}</Title>
          {disabled && (
            <Badge color="red" variant="light">
              Désactivé
            </Badge>
          )}
        </Group>
        <Button
          variant="light"
          color={disabled ? 'green' : 'red'}
          onClick={() => setStatusOpen(true)}
        >
          {disabled ? 'Réactiver le club' : 'Désactiver le club'}
        </Button>
      </Group>
      {disabled && (
        <Alert color="red" title="Club désactivé">
          Depuis le {dayjs(c.disabledAt).format('DD/MM/YYYY HH:mm')}, ses comptes Club ne peuvent
          plus se connecter. Ses licenciés ne sont pas affectés.
        </Alert>
      )}
      <Card withBorder>
        <SimpleGrid cols={3}>
          <Text size="sm">Création : {dayjs(c.createdAt).format('DD/MM/YYYY')}</Text>
          <Text size="sm">HelloAsso : {c.helloAssoConfigured ? 'configuré' : 'non configuré'}</Text>
          <Text size="sm">
            Membres : {c.memberCount} · comptes Club : {c.clubAccountCount}
          </Text>
        </SimpleGrid>
      </Card>

      <form onSubmit={onSubmit}>
        <SimpleGrid cols={2}>
          <TextInput label="Nom du club" withAsterisk {...form.getInputProps('name')} />
          <Select
            label="Mode d'inscription"
            allowDeselect={false}
            data={MODE_OPTIONS}
            {...form.getInputProps('registrationMode')}
          />
        </SimpleGrid>
        <Group mt="md">
          <Button type="submit">Enregistrer</Button>
        </Group>
      </form>

      <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
        <Stack gap="xs">
          <Title order={4} c="red">
            Zone dangereuse
          </Title>
          {blocking.length ? (
            <>
              <Text size="sm">Ce club ne peut pas être supprimé, il compte encore :</Text>
              <List size="sm">
                {blocking.map((line) => (
                  <List.Item key={line}>{line}</List.Item>
                ))}
              </List>
            </>
          ) : (
            <Text size="sm">Ce club est vide : il peut être supprimé définitivement.</Text>
          )}
          <Group>
            <Button
              color="red"
              variant="outline"
              disabled={blocking.length > 0}
              onClick={() => setDeleteOpen(true)}
            >
              Supprimer le club
            </Button>
            {blocking.length > 0 && !disabled && (
              <Button variant="light" color="red" onClick={() => setStatusOpen(true)}>
                Désactiver à la place
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      <Title order={4}>Membres</Title>
      {c.members.length ? (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Rôle</Table.Th>
              <Table.Th>Statut</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {c.members.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/users/${m.id}`}>
                    {m.lastName} {m.firstName}
                  </Anchor>
                </Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{ROLE_LABELS[m.role]}</Table.Td>
                <Table.Td>
                  {m.disabledAt ? (
                    <Badge color="red" variant="light">
                      Désactivé
                    </Badge>
                  ) : (
                    'Actif'
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">
          Aucun membre.
        </Text>
      )}
      {c.members.length < c.memberCount + c.clubAccountCount && (
        <Text size="xs" c="dimmed">
          Liste limitée aux {c.members.length} premiers membres.
        </Text>
      )}

      <Title order={4}>Historique admin</Title>
      {history.data?.data.length ? (
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
        {pending && (
          <Stack>
            <ChangeSummary
              before={Object.fromEntries(
                Object.keys(pending).map((k) => [k, c[k as keyof ClubForm]]),
              )}
              after={Object.fromEntries(Object.entries(pending))}
            />
            {pending.name !== undefined && (
              <Text size="sm">
                Le nouveau nom sera reporté sur les fiches des membres, leurs licences et les
                compétitions organisées par ce club.
              </Text>
            )}
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

      <Modal
        opened={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={disabled ? 'Réactiver ce club' : 'Désactiver ce club'}
      >
        <Stack>
          <Text size="sm">
            {disabled
              ? 'Les comptes Club de ce club pourront de nouveau se connecter.'
              : 'Les comptes Club de ce club sont déconnectés immédiatement et ne peuvent plus se connecter. Ses licenciés ne sont pas affectés.'}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setStatusOpen(false)}>
              Annuler
            </Button>
            <Button
              color={disabled ? 'green' : 'red'}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate(disabled)}
            >
              {disabled ? 'Réactiver' : 'Désactiver'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpen} onClose={closeDelete} title="Supprimer ce club">
        <Stack>
          <Text size="sm">Le club « {c.name} » sera supprimé définitivement.</Text>
          {remove.isError && (
            <Alert color="red" title={apiErrorMessage(remove.error, 'Suppression impossible')}>
              {usageLines(remove.error).length > 0 && (
                <List size="sm">
                  {usageLines(remove.error).map((line) => (
                    <List.Item key={line}>{line}</List.Item>
                  ))}
                </List>
              )}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Annuler
            </Button>
            {remove.isError && !disabled ? (
              <Button color="red" variant="light" onClick={() => setStatusOpen(true)}>
                Désactiver à la place
              </Button>
            ) : (
              <Button color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
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

- [ ] **Step 4: Route**

`apps/admin/src/router.tsx`: `import { ClubDetailPage } from './pages/ClubDetailPage';` and add after the `clubs` route:

```tsx
      { path: 'clubs/:id', element: <ClubDetailPage /> },
```

Run: `pnpm --filter admin test -- src/pages/ClubDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Audit log — club targets and deleted targets**

Append to `apps/admin/src/pages/AuditLogPage.test.tsx` (inside the `describe`):

```tsx
it('links club targets to the club page and does not link deleted targets', async () => {
  vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
    data: {
      data: [
        {
          id: 'l2',
          action: 'CLUB_UPDATE',
          targetType: 'CLUB',
          targetId: 'c1',
          before: { name: 'Club A' },
          after: { name: 'Club Z' },
          actorId: 'a1',
          actorName: 'Gabin S',
          createdAt: '2026-10-07T10:00:00.000Z',
        },
        {
          id: 'l3',
          action: 'USER_DELETE',
          targetType: 'USER',
          targetId: 'u9',
          before: null,
          after: { role: 'LICENSEE' },
          actorId: 'a1',
          actorName: 'Gabin S',
          createdAt: '2026-10-07T11:00:00.000Z',
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
  expect(await screen.findByRole('link', { name: /voir le club/i })).toHaveAttribute(
    'href',
    '/clubs/c1',
  );
  expect(screen.getByText('Supprimé')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /voir la fiche/i })).toBeNull();
});
```

Run: `pnpm --filter admin test -- src/pages/AuditLogPage.test.tsx` → FAIL.

In `apps/admin/src/pages/AuditLogPage.tsx`, add `Text` to the `@mantine/core` import, `import type { AuditLogEntryDto } from '../api/generated/types.gen';`, and above the component:

```tsx
const DELETIONS: AuditLogEntryDto['action'][] = ['USER_DELETE', 'CLUB_DELETE'];

function Target({ entry }: { entry: AuditLogEntryDto }) {
  if (DELETIONS.includes(entry.action)) {
    return (
      <Text size="sm" c="dimmed">
        Supprimé
      </Text>
    );
  }
  const isUser = entry.targetType === 'USER';
  return (
    <Anchor component={Link} to={`/${isUser ? 'users' : 'clubs'}/${entry.targetId}`}>
      {isUser ? 'Voir la fiche' : 'Voir le club'}
    </Anchor>
  );
}
```

and replace the content of the "Cible" cell (the `e.targetType === 'USER' ? … : e.targetId` expression) with `<Target entry={e} />`.

Run: `pnpm --filter admin test -- src/pages/AuditLogPage.test.tsx` → PASS.

- [ ] **Step 6: Checks and commit**

```bash
pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin test
pnpm --filter admin build
git add apps/admin/src
git commit -m "feat(admin): club page with rename, status, danger zone and members

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

Expected: PASS; the build succeeds.

---

### Task 14: Runbook, CLAUDE.md and final verification

**Files:**

- Modify: `docs/exploitation/backoffice-admin.md` (French)
- Modify: `CLAUDE.md` (one line under "Sensitive areas")

**Interfaces:**

- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Runbook**

In `docs/exploitation/backoffice-admin.md`:

1. In **Objet**, replace "Lot 1 :" and its list with:

```markdown
plateforme. Lots 1 et 1b :

- liste et recherche des utilisateurs, filtres (rôle, club, catégorie, date
  d'inscription, statut actif / désactivé) ;
- correction du profil d'un utilisateur (club, catégorie, classe d'âge, niveaux
  passeport et compétition, classement, rôle) ;
- création d'un utilisateur **licencié, club ou staff** (jamais admin), avec
  envoi d'une invitation adaptée au rôle (lien valable 7 jours) et renvoi de
  l'invitation tant que le compte ne s'est jamais connecté ;
- désactivation / réactivation et suppression définitive d'un utilisateur ;
- liste, modification (nom, mode d'inscription), désactivation et suppression
  des clubs ;
- journal d'audit de toutes les écritures admin.
```

2. In **Accès**, replace the paragraph "**Retirer le rôle `ADMIN` :** …" with:

```markdown
- **Retirer le rôle `ADMIN` :** même écran (par un autre admin). Le rôle étant
  porté par le jeton d'accès, le retrait ne prend effet qu'à l'expiration de
  celui-ci (60 min au plus). **En cas d'urgence, désactiver le compte** : la
  coupure est immédiate (voir ci-dessous).
```

3. Add a new section after **Accès**:

```markdown
## Comptes : création, désactivation, suppression

- **Création** (« Nouvel utilisateur ») : rôles Licencié, Club ou Staff. Le
  rôle `ADMIN` se donne ensuite depuis la fiche. Un compte Club est rattaché à
  un club existant ou crée un nouveau club ; un licencié ou un staff peut être
  rattaché à un club, sans pouvoir en créer. L'email d'invitation dépend du
  rôle et pointe vers `${FRONTEND_URL}/reset-password?token=…`
  (`https://ffd.gabin-simond.fr` sur staging, voir
  [`reinitialisation-mot-de-passe-web.md`](./reinitialisation-mot-de-passe-web.md)).
- **Désactivation** (mesure réversible) : `User.disabledAt` renseigné. Le
  compte ne peut plus se connecter (403 « Compte désactivé. Contactez la
  fédération. », affiché tel quel par l'app), ses sessions sont révoquées et
  chaque requête portant encore un jeton d'accès est refusée (401) : le
  contrôle est fait **côté serveur à chaque requête** (`JwtStrategy`, une
  lecture indexée). Les données restent intactes et visibles (inscriptions,
  résultats, couples). Un admin ne peut pas désactiver son propre compte.
- **Suppression** (définitive, RGPD) : même cœur que la suppression in-app
  (`AccountDeletionService`). L'admin recopie l'email du compte pour
  confirmer. Le journal garde une seule ligne `USER_DELETE` avec le seul rôle
  (aucune donnée personnelle) ; les lignes antérieures qui visaient le compte
  sont effacées. Un admin ne peut pas supprimer son propre compte.

## Clubs

- **Modification** : nom et mode d'inscription. Les identifiants HelloAsso ne
  sont jamais affichés ni modifiables (seulement « configuré oui / non »).
- **Renommage** : le nom est recopié dans `User.clubName`, `License.clubName`
  et `Competition.organizer` ; les trois sont mis à jour dans la même
  transaction (membres du club, licences et compétitions qui portaient l'ancien
  nom). Un nom déjà pris est refusé (409).
- **Désactivation** : les comptes **Club** du club sont bloqués comme un
  compte désactivé (sessions révoquées) ; ses licenciés ne sont pas affectés.
- **Suppression** : seulement si le club est vide : aucun membre, aucun compte
  Club, aucune compétition organisée sous son nom, aucun couple ni équipe solo
  rattachés (le schéma les supprimerait en cascade). Sinon l'API répond 409
  avec les compteurs et l'écran propose « Désactiver à la place ».
```

4. In **Journal d'audit**, replace the `action` bullet with:

```markdown
- `action` : `USER_UPDATE`, `USER_CREATE`, `USER_DISABLE`, `USER_ENABLE`,
  `USER_DELETE`, `INVITATION_RESEND`, `CLUB_UPDATE`, `CLUB_DISABLE`,
  `CLUB_ENABLE`, `CLUB_DELETE` (`CLUB_ACCOUNT_CREATE` reste lisible pour les
  lignes du lot 1) ;
```

5. In **Coût**, add to the **Backend** bullet:

```markdown
Le contrôle de désactivation ajoute une lecture indexée par requête
authentifiée (coût négligeable, aucune infrastructure nouvelle).
```

- [ ] **Step 2: CLAUDE.md**

Under `## Sensitive areas`, add after the `src/auth/` line:

```markdown
- `src/auth/account-status.ts` + `JwtStrategy` — every authenticated request re-reads the account status (disabled user, or `CLUB` account of a disabled club → 401). An e2e that boots the real `JwtStrategy` with a hand-written Prisma mock must mock `user.findUnique` for that lookup.
```

- [ ] **Step 3: Final verification**

```bash
pnpm exec prettier --write docs/exploitation/backoffice-admin.md CLAUDE.md
pnpm preflight
cd apps/backend && pnpm exec jest --config "$E2E_NODB" --runInBand --forceExit admin.e2e-spec auth.e2e-spec auth-additional.e2e-spec
source "$(git rev-parse --show-toplevel)/.superpowers/sdd/2026-10-07-admin-lot1b-accounts-clubs/test-db.sh"
pnpm exec jest --config test/jest-integration.json --runInBand --forceExit admin.integration-spec
```

Expected: all green. (`pnpm preflight` covers typecheck, lint, format, unit tests with coverage thresholds and the dependency audit.)

- [ ] **Step 4: Commit**

```bash
git add docs/exploitation/backoffice-admin.md CLAUDE.md
git commit -m "docs(admin): runbook for accounts and clubs management (lot 1b)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XReVUCtW5gEDVk5JFdbLQS"
```

---

## Final verification (after Task 14)

- [ ] `pnpm preflight` green; mocked e2e and real-DB integration green (commands above).
- [ ] `test-verifier`, then `code-reviewer` + `security-reviewer` in parallel on the branch diff (auth enforcement, JwtStrategy lookup, admin deletion, filter whitelist, invitation link are in scope).
- [ ] Manual smoke on a local stack (`docker compose --profile infra up -d`, `pnpm --filter backend start:dev`, `VITE_API_URL=http://localhost:3000/api/v1 pnpm --filter admin dev`): create a licensee, deactivate it and check that its login is refused with the French message, reactivate, delete it; rename a club and check a member's club name; try to delete a non-empty club; read the audit log.
- [ ] Ask the user before pushing `feature/admin-lot1b` and opening the PR to `develop`. The migration deploys with the backend (additive, rollback-safe); the admin SPA must ship in the same promotion because `POST /admin/club-accounts` is removed.

---

## Self-review

**Spec coverage**

| Spec                                                                                                              | Task                    |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| §1 "Utilisateurs" wording                                                                                         | 9 (nav entry), 10       |
| §2/§3 `User.disabledAt` + index, `Club.disabledAt`, additive                                                      | 1                       |
| §3 eight new audit actions, `CLUB_ACCOUNT_CREATE` still readable                                                  | 3 (backend), 8 (labels) |
| §4 helper, login 403 after password, refresh 401, JwtStrategy 401 with select constant                            | 1                       |
| §4 revoke sessions on deactivation (user / club CLUB accounts)                                                    | 3, 7                    |
| §5 `POST /admin/users` replaces `POST /admin/club-accounts`                                                       | 5                       |
| §5 `POST /admin/users/:id/status` (self 403, idempotent)                                                          | 3                       |
| §5 `DELETE /admin/users/:id` with `confirmEmail` (case-insensitive, self 403, role-only audit)                    | 4                       |
| §5 resend invitation for any non-admin role                                                                       | 5                       |
| §5 `GET /admin/clubs` paginated, `GET /admin/clubs/options`, `GET /admin/clubs/:id`                               | 6                       |
| §5 `PATCH /admin/clubs/:id` with rename cascade, 409 on collision, audit diff                                     | 7                       |
| §5 `POST /admin/clubs/:id/status`, `DELETE /admin/clubs/:id` (409 with counts)                                    | 7                       |
| §5 users list status filter + `disabledAt`                                                                        | 3                       |
| §6 `AccountDeletionService.deleteAccount`, self-service unchanged                                                 | 2, used in 4            |
| §7 users list badge + filter; user page status/delete (hidden on self) + back to list                             | 10, 11                  |
| §7 new user page (role, club existing/new for Club only, profile)                                                 | 9                       |
| §7 clubs list (search, status, counts, HelloAsso badge); club page (edit + summary, status, danger zone, members) | 12, 13                  |
| §7 audit labels                                                                                                   | 8, 13                   |
| §8 unit / mocked e2e / real-DB / SPA tests                                                                        | every task              |
| §9 no email enumeration, server-side check, no personal data in the deletion audit                                | 1, 4                    |
| §10 cost statement                                                                                                | 14 (runbook)            |
| Swagger regen + admin client                                                                                      | 8                       |
| Runbook + CLAUDE.md                                                                                               | 14                      |

**Decisions taken where the spec was silent** (also reported to the controller):

- Club deletion also counts **partnerships and solo teams**, because the schema cascades both on club deletion; the 409 body and the club page carry `partnershipCount` and `soloTeamCount` next to the three spec counts.
- `memberCount` counts users of the club **other than** `CLUB` accounts, so `memberCount` + `clubAccountCount` is every user attached to the club.
- A rename rewrites `User.clubName` for the club's members **and** for legacy users with no `clubId` whose `clubName` equals the old name; users of another club are never touched.
- `GET /admin/clubs/options` takes `includeId` to keep the currently selected club when it is disabled.
- `AdminUserDetailDto` gains `clubDisabledAt` so the user page can explain why a `CLUB` account of a disabled club cannot log in.
- Resending an invitation to a **disabled** account is refused (400).
- Session revocation on deactivation runs inside the status transaction (`refreshToken.updateMany`), so status and revocation cannot diverge.
- The new-user form shows the optional profile fields for the Licencié role only, and uses radios for the three roles.
- Delete routes answer 204; the SPA uses `ensureOk` for them.

**Placeholder scan:** no TBD/TODO; every code step carries the code. One step gives a guarded fallback tied to a library behaviour the plan cannot run (Task 9 Step 5, `NumberInput` value type), with the fallback spelled out.

**Type consistency:** `accountBlockReason` / `ACCOUNT_DISABLED_MESSAGE` / `accountStatusSelect` (Task 1) are used with the same names in Tasks 1, 3, 7. `AccountDeletionService.deleteAccount(userId, alsoInTransaction)` (Task 2) matches the call in Task 4. `recordOp` (Task 4) is mocked in the Task 3 spec setup. `SetActiveDto` (Task 3) is reused in Task 7. `ACCOUNT_STATUSES` (Task 3) is reused in Task 6. `clubUsage` / `isClubEmpty` (Task 6) are used in Task 7. Controller method names (`createUser`, `setUserStatus`, `deleteUser`, `listClubs`, `clubOptions`, `getClub`, `updateClub`, `setClubStatus`, `deleteClub`) produce the SDK names listed in Task 8 and used in Tasks 9-13. `clubOptionsQuery` (Task 8), `apiErrorMessage` (Task 9), `STATUS_FILTER_OPTIONS` / `StatusChoice` (Task 10), `ensureOk` (Task 11), `clubsQuery` (Task 12) and `clubQuery` (Task 13) are each defined before first use.

**Review Focus check:** each of the five lines has its test in the owning task (Task 1/3/7/11 for a disabled club's CLUB account; Task 4/11 for email case; Task 7 for rename collisions and stale copies; Task 6/7/13 for partnerships and solo teams; Task 3/7 for repeated status changes).
