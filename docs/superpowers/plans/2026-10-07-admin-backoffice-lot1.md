# Admin back-office — Lot 1 (foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an admin-only web back-office on `admin.ffd.gabin-simond.fr` where an admin lists users, edits their profile fields, creates Club accounts with an email invitation, and every write lands in an audit log.

**Architecture:** A new NestJS module `src/admin/` exposes `/api/v1/admin/*` routes guarded at class level by `JwtAuthGuard + RolesGuard + @Roles(ADMIN)`; writes go through dedicated services that write the change and an `AdminAuditLog` row in one Prisma transaction. A new Vite + React SPA `apps/admin` consumes them through a client generated from `swagger.json` (`@hey-api/openapi-ts`, same as the mobile app) and is deployed as static files to Azure Static Web Apps (Free).

**Tech Stack:** NestJS 11, Prisma 7 / PostgreSQL 15, Jest; React 19 (workspace override `19.2.3`), Vite 8, TypeScript (workspace override `^5.6.0`), Mantine 8, TanStack Query 5, React Router 7, Zustand 5, Vitest 3 + Testing Library; Azure Static Web Apps; GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-07-admin-backoffice-design.md`

**Worktree:** `/Users/gabin/Development/FFD-Connect-admin`, branch `feat/admin-backoffice` (from `origin/develop`). All paths below are relative to it.

## Global Constraints

- Every `/admin/*` route is `ADMIN`-only: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` on the **controller class**, never per method.
- Pagination follows the repo convention `skip` / `take` (`PaginationParamsDto`, `take` ≤ 100) and returns `PaginatedResponse<T>` via `createPaginatedResponse`. (The spec wrote `page`/`pageSize`; this plan deliberately uses the existing convention.)
- Prisma: `select` constants from `src/utils/prisma-selects.ts` (no inline selects in services), `take` on every `findMany`.
- No `any` (eslint error), no `process.env` in backend code (use `ConfigService`), no new React Context (session state = Zustand).
- Migrations are additive only (single-revision deploy with automatic rollback).
- Audit `before`/`after` never contain `password`, tokens or hashes.
- Invitation token expiry: **7 days** (168 h). Password-reset expiry stays 1 h.
- Admin web host: exactly `admin.ffd.gabin-simond.fr`.
- The admin app talks to **staging** for now (`https://api-staging.ffd.gabin-simond.fr/api/v1`): the beta runs on `backend-staging` and `backend-prod` is stopped. The API URL is a build-time variable `VITE_API_URL`.
- Code, comments, commits in English; user-facing copy (admin UI, emails) in French; `docs/exploitation/` in French.
- Conventional commits; never `--no-verify`. Each commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- No push and no PR without the user's explicit go.

## Review Focus

1. **Legacy values outside the reference lists** — real users already have `category = "Latine"` (the mobile app uses both "Latin" and "Latine") or free-text `ageGroup`. Editing _another_ field of such a user must succeed and leave the legacy value untouched; the form must display the legacy value instead of a blank select. Covered in Task 5 (backend test) and Task 10 (front test).
2. **Clearing a field vs. not sending it** — `null` must clear (`clubId: null` clears club and `clubName`; `nationalRanking: null` clears the ranking) while an omitted key must not change anything. Covered in Task 5.
3. **Email case and whitespace on Club account creation** — `" Club@Example.FR "` must be stored as `club@example.fr` and collide (409) with an existing `club@example.fr`. Covered in Task 6.
4. **Expired/stale session in the SPA** — a 401 whose refresh fails must clear the session and land on `/login` instead of looping or showing an empty table. Covered in Task 8.
5. **Cold start** — the first request after idle can take 60-120 s; the login screen must show the wake-up state and not report "wrong password" on a timeout. Covered in Task 8.

---

## File Structure

**Backend (`apps/backend`)**

| File                                                                      | Responsibility                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| `prisma/schema/admin.prisma` (create)                                     | `AdminAuditLog` model                            |
| `prisma/schema/user.prisma` (modify)                                      | `lastLoginAt`, back-relation `adminAuditActions` |
| `prisma/schema/migrations/<ts>_admin_audit_log/migration.sql` (generated) | additive migration                               |
| `src/common/user-categories.ts` (create)                                  | `USER_CATEGORIES` constant                       |
| `src/utils/prisma-selects.ts` (modify)                                    | admin select constants                           |
| `src/auth/auth.service.ts` (modify)                                       | set `lastLoginAt` on login                       |
| `src/auth/auth-password.service.ts` (modify)                              | `issuePasswordToken(userId, expiryHours)`        |
| `src/auth/email.service.ts` (modify)                                      | `sendInvitationEmail` + template                 |
| `src/auth/auth.module.ts` (modify)                                        | export `EmailService`                            |
| `src/admin/admin.module.ts`                                               | module wiring                                    |
| `src/admin/admin-audit.util.ts`                                           | `diffFields`                                     |
| `src/admin/admin-audit.service.ts`                                        | `record(tx, entry)`, `list(query)`               |
| `src/admin/admin-users.query-service.ts`                                  | list + detail reads                              |
| `src/admin/admin-users.service.ts`                                        | `update`                                         |
| `src/admin/admin-club-accounts.service.ts`                                | `create`, `resendInvitation`                     |
| `src/admin/admin-reference.service.ts`                                    | reference data + clubs list                      |
| `src/admin/admin.controller.ts`                                           | all `/admin` routes                              |
| `src/admin/dto/*.ts`                                                      | request/response DTOs                            |
| `src/admin/*.spec.ts`                                                     | unit tests                                       |
| `src/users/users.service.ts` (modify)                                     | purge audit rows targeting a deleted user        |
| `test/admin.e2e-spec.ts`                                                  | role matrix e2e                                  |
| `test/admin.integration-spec.ts`                                          | real-DB transaction tests                        |
| `jest.config.js` (modify)                                                 | admin coverage threshold                         |

**Admin web (`apps/admin`, all created)**

| File                                                                                                                                           | Responsibility                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `index.html`, `openapi-ts.config.ts`, `.env.example` | tooling                                        |
| `public/staticwebapp.config.json`                                                                                                              | SPA fallback, CSP, headers                     |
| `src/main.tsx`, `src/App.tsx`, `src/router.tsx`                                                                                                | bootstrap + routes                             |
| `src/config.ts`                                                                                                                                | `API_URL`                                      |
| `src/api/client.ts`                                                                                                                            | generated client wiring (auth header, refresh) |
| `src/api/queries.ts`                                                                                                                           | React Query options shared by pages            |
| `src/api/generated/**`                                                                                                                         | generated, never edited                        |
| `src/session/sessionStore.ts`                                                                                                                  | Zustand session (memory + sessionStorage)      |
| `src/session/refresh.ts`                                                                                                                       | single-flight refresh                          |
| `src/session/RequireAdmin.tsx`                                                                                                                 | route guard                                    |
| `src/pages/LoginPage.tsx`                                                                                                                      | login + wake-up state                          |
| `src/pages/UsersPage.tsx`                                                                                                                      | users table                                    |
| `src/pages/UserDetailPage.tsx`                                                                                                                 | detail/edit + history                          |
| `src/pages/NewClubAccountPage.tsx`                                                                                                             | Club account form                              |
| `src/pages/AuditLogPage.tsx`                                                                                                                   | audit list                                     |
| `src/components/AppLayout.tsx`                                                                                                                 | shell + nav                                    |
| `src/components/ChangeSummary.tsx`                                                                                                             | before → after table                           |
| `src/lib/diff.ts`                                                                                                                              | front diff + legacy select options             |
| `src/**/*.test.ts(x)`                                                                                                                          | Vitest tests                                   |

**Repo-level:** `package.json` (scripts), `.github/workflows/ci.yml`, `.github/workflows/deploy-admin.yml`, CORS config of `backend-staging`, `infra/terraform/admin-swa.tf`, `infra/terraform/outputs.tf`, `infra/terraform/dns.tf` (comment), both Dockerfiles, `docs/exploitation/backoffice-admin.md`, `docs/legal/politique-confidentialite.md`, `CLAUDE.md`.

---

### Task 1: Schema — `AdminAuditLog` and `User.lastLoginAt`

**Files:**

- Create: `apps/backend/prisma/schema/admin.prisma`
- Modify: `apps/backend/prisma/schema/user.prisma` (model `User`)
- Generated: `apps/backend/prisma/schema/migrations/<timestamp>_admin_audit_log/migration.sql`
- Modify: `apps/backend/src/auth/auth.service.ts` (`login`, ~line 341)
- Test: `apps/backend/src/auth/auth.service.spec.ts`

**Interfaces:**

- Produces: Prisma model `AdminAuditLog { id, actorId?, action, targetType, targetId, before?, after?, createdAt }`, `prisma.adminAuditLog`; `User.lastLoginAt: Date | null`.

- [ ] **Step 1: Write the schema**

`apps/backend/prisma/schema/admin.prisma`:

```prisma
/// Journal des actions du back-office admin (lot 1). Une ligne par écriture
/// admin, insérée dans la même transaction que l'écriture. `before`/`after`
/// ne contiennent que les champs modifiés, jamais de secret.
model AdminAuditLog {
  id         String   @id @default(uuid())
  actorId    String?
  action     String
  targetType String
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

In `user.prisma`, inside `model User`, add after `updatedAt`:

```prisma
  lastLoginAt          DateTime?      // Dernière connexion réussie (back-office : « renvoyer l'invitation » tant que null)
```

and in the relations block, after `trackCorrectionsReviewed`:

```prisma
  adminAuditActions    AdminAuditLog[] @relation("AdminAuditActor")
```

- [ ] **Step 2: Generate the migration**

Run (Postgres up: `docker compose --profile infra up -d`):

```bash
pnpm --filter backend exec prisma migrate dev --name admin_audit_log
```

Expected: a new folder `..._admin_audit_log` whose `migration.sql` contains only `CREATE TABLE "AdminAuditLog"`, three `CREATE INDEX`, one `ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3)` and one `ADD CONSTRAINT ... ON DELETE SET NULL`. If it contains any `DROP` or `ALTER COLUMN`, stop and investigate — the migration must be additive.

- [ ] **Step 3: Write the failing test for `lastLoginAt`**

In `apps/backend/src/auth/auth.service.spec.ts`, inside the existing `describe("login"...)` block (create one if absent, reusing the file's existing `prisma` mock and a valid-user fixture already defined in the file):

```ts
it('records lastLoginAt on successful login', async () => {
  prisma.user.update.mockResolvedValue({} as never);

  await service.login(mockUser);

  expect(prisma.user.update).toHaveBeenCalledWith({
    where: { id: mockUser.id },
    data: { lastLoginAt: expect.any(Date) },
    select: { id: true },
  });
});
```

(Use the fixture name the file already uses for a valid user; if it is not `mockUser`, rename in the test.)

- [ ] **Step 4: Run it — expect FAIL**

Run: `pnpm --filter backend exec jest src/auth/auth.service.spec.ts -t "lastLoginAt"`
Expected: FAIL, `prisma.user.update` not called.

- [ ] **Step 5: Implement**

In `AuthService.login`, before `const refreshToken = ...`:

```ts
await this.prisma.user.update({
  where: { id: user.id },
  data: { lastLoginAt: new Date() },
  select: { id: true },
});
```

(`AuthService` injects `PrismaService`; check the constructor and use its actual field name.)

- [ ] **Step 6: Run the auth suite — expect PASS**

Run: `pnpm --filter backend exec jest src/auth`
Expected: PASS. Other `login` tests may need `prisma.user.update.mockResolvedValue({} as never)` in their `beforeEach`; add it there rather than per test.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/prisma/schema apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.service.spec.ts
git commit -m "feat(admin): add AdminAuditLog and User.lastLoginAt

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Invitation token and email

**Files:**

- Modify: `apps/backend/src/auth/auth-password.service.ts`
- Modify: `apps/backend/src/auth/email.service.ts`
- Modify: `apps/backend/src/auth/auth.module.ts` (exports)
- Test: `apps/backend/src/auth/auth-password.service.spec.ts`, `apps/backend/src/auth/email.service.spec.ts`

**Interfaces:**

- Produces:
  - `AuthPasswordService.issuePasswordToken(userId: string, expiryHours: number): Promise<string>` — invalidates the user's unused tokens, stores the SHA-256 hash, returns the **plain** token.
  - `EmailService.sendInvitationEmail(email: string, token: string, firstName: string): Promise<void>` — throws on provider error, only logs when Resend is not configured (same contract as `sendPasswordResetEmail`).
  - `AuthModule` exports `EmailService`.

- [ ] **Step 1: Write the failing tests**

In `auth-password.service.spec.ts` (reuse its `prisma` mock and `service`; add `import * as crypto from "crypto";` if missing):

```ts
describe('issuePasswordToken', () => {
  it('invalidates previous tokens, stores only the hash and returns the plain token', async () => {
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.passwordResetToken.create.mockResolvedValue({} as never);
    const before = Date.now();

    const token = await service.issuePasswordToken('user-1', 168);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', used: false },
      data: { used: true, usedAt: expect.any(Date) },
    });
    const created = prisma.passwordResetToken.create.mock.calls[0][0].data;
    expect(created.token).not.toBe(token);
    expect(created.token).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    const expiresAt = (created.expiresAt as Date).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(168 * 3600_000 - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(168 * 3600_000 + 1000);
  });
});
```

In `email.service.spec.ts`, following the file's existing Resend mock pattern for `sendPasswordResetEmail` (`resendSend` = the name the file gives the mocked `resend.emails.send`):

```ts
describe('sendInvitationEmail', () => {
  it('sends the invitation with a reset-password link carrying the token', async () => {
    resendSend.mockResolvedValue({ data: { id: 'm1' }, error: null });

    await service.sendInvitationEmail('club@example.fr', 'tok123', 'Jeanne');

    const arg = resendSend.mock.calls[0][0];
    expect(arg.to).toBe('club@example.fr');
    expect(arg.subject).toBe('Votre accès club FFD Connect');
    expect(arg.html).toContain('/reset-password?token=tok123');
    expect(arg.html).toContain('Bonjour Jeanne');
    expect(arg.html).toContain('7 jours');
  });

  it('strips HTML from the first name', async () => {
    resendSend.mockResolvedValue({ data: { id: 'm1' }, error: null });
    await service.sendInvitationEmail('c@x.fr', 't', '<b>Jo</b>');
    expect(resendSend.mock.calls[0][0].html).toContain('Bonjour bJo/b');
  });

  it('throws when the provider returns an error', async () => {
    resendSend.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      service.sendInvitationEmail('club@example.fr', 'tok123', 'Jeanne'),
    ).rejects.toThrow('Failed to send email: boom');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`issuePasswordToken` / `sendInvitationEmail` not defined)

Run: `pnpm --filter backend exec jest src/auth/auth-password.service.spec.ts src/auth/email.service.spec.ts`

- [ ] **Step 3: Implement `issuePasswordToken` and reuse it in `forgotPassword`**

In `AuthPasswordService`:

```ts
  /**
   * Issues a single-use password token (reset or invitation): previous unused
   * tokens of the user are invalidated, only the SHA-256 hash is stored, and
   * the plain token is returned for the email link.
   */
  async issuePasswordToken(
    userId: string,
    expiryHours: number,
  ): Promise<string> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, used: false },
      data: { used: true, usedAt: new Date() },
    });

    const plainToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + expiryHours * 3600_000);
    await this.prisma.passwordResetToken.create({
      data: { token: this.hashToken(plainToken), userId, expiresAt },
    });
    return plainToken;
  }
```

and replace the body of `forgotPassword` after the `if (!user)` guard with:

```ts
const plainToken = await this.issuePasswordToken(user.id, this.PASSWORD_RESET_TOKEN_EXPIRY_HOURS);
// Send plain token via email (DB only stores hash)
await this.emailService.sendPasswordResetEmail(email, plainToken);

return { success: true };
```

- [ ] **Step 4: Implement `sendInvitationEmail`**

In `EmailService`, next to `sendPasswordResetEmail`:

```ts
  /** Invitation of a Club account created from the admin back-office. */
  async sendInvitationEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const url = `${
      this.configService.get<string>("FRONTEND_URL") ?? "http://localhost:3000"
    }/reset-password?token=${token}`;

    if (!this.resend) {
      this.logger.log(
        `Invitation email for ${email} (no Resend config, URL not sent)`,
      );
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.fromEmail,
      to: email,
      subject: "Votre accès club FFD Connect",
      html: this.getInvitationEmailTemplate(url, firstName),
    });
    if (error) {
      this.logger.error(`Failed to send invitation email: ${error.message}`);
      throw new Error(`Failed to send email: ${error.message}`);
    }
    this.logger.log(`Invitation email sent to ${email} (ID: ${data.id})`);
  }

  private getInvitationEmailTemplate(url: string, firstName: string): string {
    const safeName = firstName.replace(/[<>&"']/g, "");
    return `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Votre accès club FFD Connect</title></head>
        <body style="font-family: Arial, sans-serif; color: #222; max-width: 560px; margin: auto;">
          <p>Bonjour ${safeName},</p>
          <p>Un compte club vient d'être créé pour vous sur FFD Connect.</p>
          <p>Pour l'activer, choisissez votre mot de passe :</p>
          <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#1d4ed8;color:#fff;border-radius:6px;text-decoration:none;">Définir mon mot de passe</a></p>
          <p>Ce lien est valable 7 jours et ne peut servir qu'une fois.</p>
          <p>Si vous n'attendiez pas cet email, ignorez-le.</p>
        </body>
      </html>`;
  }
```

In `auth.module.ts`: `exports: [AuthService, AuthTokenService, AuthPasswordService, EmailService]`.

- [ ] **Step 5: Run the auth suite — expect PASS**

Run: `pnpm --filter backend exec jest src/auth`
Expected: PASS (existing `forgotPassword` tests still pass: the observable calls are unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/auth
git commit -m "feat(auth): issue reusable password tokens and send club invitations

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Admin module skeleton — audit service, reference data, clubs, role matrix

**Files:**

- Create: `apps/backend/src/common/user-categories.ts`
- Create: `apps/backend/src/admin/admin.module.ts`, `admin.controller.ts`, `admin-audit.util.ts`, `admin-audit.service.ts`, `admin-reference.service.ts`, `dto/admin-audit.dto.ts`, `dto/admin-reference.dto.ts`
- Modify: `apps/backend/src/app.module.ts` (imports), `apps/backend/src/utils/prisma-selects.ts`
- Test: `src/admin/admin-audit.util.spec.ts`, `src/admin/admin-audit.service.spec.ts`, `src/admin/admin-reference.service.spec.ts`, `test/admin.e2e-spec.ts`

**Interfaces:**

- Produces:
  - `USER_CATEGORIES = ["Latin", "Standard", "Ten Dance"] as const`
  - `AUDIT_ACTIONS`, `type AuditAction = "USER_UPDATE" | "CLUB_ACCOUNT_CREATE" | "INVITATION_RESEND"`, `AUDIT_TARGET_TYPES`, `type AuditTargetType = "USER" | "CLUB"`
  - `interface AuditEntry { actorId: string; action: AuditAction; targetType: AuditTargetType; targetId: string; before?: Record<string, unknown>; after?: Record<string, unknown> }`
  - `diffFields(before: Record<string, unknown>, after: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } | null` — keys of `after` only, compared by `JSON.stringify` (Dates compare by instant), `null` when nothing changed.
  - `AdminAuditService.record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void>`
  - `AdminAuditService.list(query: ListAuditLogQueryDto): Promise<AuditLogPageDto>`
  - `AdminReferenceService.referenceData(): AdminReferenceDataDto`, `AdminReferenceService.clubs(): Promise<AdminClubOptionDto[]>`
  - Controller class `AdminController` at `@Controller("admin")`; later tasks add routes to this class.
  - `adminAuditLogSelect` in `prisma-selects.ts`.

- [ ] **Step 1: Write the failing util + service tests**

`src/admin/admin-audit.util.spec.ts`:

```ts
import { diffFields } from './admin-audit.util';

describe('diffFields', () => {
  it('keeps only the keys whose value changed', () => {
    expect(
      diffFields(
        { firstName: 'A', lastName: 'B', clubId: null },
        { firstName: 'A', lastName: 'C', clubId: 'c1' },
      ),
    ).toEqual({
      before: { lastName: 'B', clubId: null },
      after: { lastName: 'C', clubId: 'c1' },
    });
  });

  it('returns null when nothing changed', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('treats undefined in before as null', () => {
    expect(diffFields({}, { nationalRanking: 3 })).toEqual({
      before: { nationalRanking: null },
      after: { nationalRanking: 3 },
    });
  });
});
```

`src/admin/admin-audit.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { adminAuditLogSelect } from '../utils/prisma-selects';
import { AdminAuditService } from './admin-audit.service';

describe('AdminAuditService', () => {
  let service: AdminAuditService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [AdminAuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminAuditService);
  });

  it('records an entry through the given transaction client', async () => {
    await service.record(prisma, {
      actorId: 'admin-1',
      action: 'USER_UPDATE',
      targetType: 'USER',
      targetId: 'u1',
      before: { lastName: 'B' },
      after: { lastName: 'C' },
    });

    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: 'USER_UPDATE',
        targetType: 'USER',
        targetId: 'u1',
        before: { lastName: 'B' },
        after: { lastName: 'C' },
      },
      select: { id: true },
    });
  });

  it('lists newest first with filters and maps the author name', async () => {
    prisma.adminAuditLog.count.mockResolvedValue(1);
    prisma.adminAuditLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        action: 'USER_UPDATE',
        targetType: 'USER',
        targetId: 'u1',
        before: { lastName: 'B' },
        after: { lastName: 'C' },
        createdAt: new Date('2026-10-07T10:00:00Z'),
        actor: { id: 'admin-1', firstName: 'Gabin', lastName: 'S' },
      },
    ] as never);

    const page = await service.list({
      skip: 0,
      take: 20,
      targetType: 'USER',
      targetId: 'u1',
    });

    expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
      where: { targetType: 'USER', targetId: 'u1' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
      select: adminAuditLogSelect,
    });
    expect(page.meta.total).toBe(1);
    expect(page.data[0].actorName).toBe('Gabin S');
  });

  it('reports a deleted author as null', async () => {
    prisma.adminAuditLog.count.mockResolvedValue(1);
    prisma.adminAuditLog.findMany.mockResolvedValue([
      {
        id: 'l1',
        action: 'USER_UPDATE',
        targetType: 'USER',
        targetId: 'u1',
        before: null,
        after: null,
        createdAt: new Date(),
        actor: null,
      },
    ] as never);
    const page = await service.list({});
    expect(page.data[0]).toMatchObject({ actorId: null, actorName: null });
  });
});
```

`src/admin/admin-reference.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { adminClubOptionSelect } from '../utils/prisma-selects';
import { AdminReferenceService } from './admin-reference.service';

describe('AdminReferenceService', () => {
  let service: AdminReferenceService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [AdminReferenceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminReferenceService);
  });

  it('exposes the backend constants', () => {
    const data = service.referenceData();
    expect(data.categories).toEqual(['Latin', 'Standard', 'Ten Dance']);
    expect(data.ageGroups).toContain('Junior I');
    expect(data.ageGroups).toContain('Solo Adulte');
    expect(data.competitionLevels).toContain('Débutant');
    expect(data.passportLevels[0]).toBe('BLANC');
    expect(data.roles).toEqual(['LICENSEE', 'CLUB', 'STAFF', 'ADMIN']);
  });

  it('lists clubs by name with a bound', async () => {
    prisma.club.findMany.mockResolvedValue([{ id: 'c1', name: 'A' }] as never);
    await expect(service.clubs()).resolves.toEqual([{ id: 'c1', name: 'A' }]);
    expect(prisma.club.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
      take: 1000,
      select: adminClubOptionSelect,
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (modules not found)

Run: `pnpm --filter backend exec jest src/admin`

- [ ] **Step 3: Implement constants, selects, util, services, DTOs**

`src/common/user-categories.ts`:

```ts
/** Disciplines a licensee can be registered in (User.category). */
export const USER_CATEGORIES = ['Latin', 'Standard', 'Ten Dance'] as const;
export type UserCategory = (typeof USER_CATEGORIES)[number];
```

`src/utils/prisma-selects.ts` — append:

```ts
/** Back-office: one audit row with its author's name. */
export const adminAuditLogSelect = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  before: true,
  after: true,
  createdAt: true,
  actor: { select: userNameSelect },
} as const;

/** Back-office: club options for selects (id + name only). */
export const adminClubOptionSelect = { id: true, name: true } as const;
```

(If an identical `{ id: true, name: true }` club select already exists in the file, e.g. `clubIdNameSelect`, alias it — `export const adminClubOptionSelect = clubIdNameSelect;` — rather than duplicating.)

`src/admin/admin-audit.util.ts`:

```ts
/**
 * Field-level diff for the audit log: only keys present in `after` are
 * compared; values are compared by JSON form so Dates compare by instant.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
```

`src/admin/dto/admin-audit.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationParamsDto } from '../../common/dto/pagination-params.dto';

export const AUDIT_ACTIONS = ['USER_UPDATE', 'CLUB_ACCOUNT_CREATE', 'INVITATION_RESEND'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = ['USER', 'CLUB'] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export class ListAuditLogQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ enum: AUDIT_TARGET_TYPES })
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES)
  targetType?: AuditTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetId?: string;
}

export class AuditLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AUDIT_ACTIONS }) action!: AuditAction;
  @ApiProperty({ enum: AUDIT_TARGET_TYPES }) targetType!: AuditTargetType;
  @ApiProperty() targetId!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  before!: Record<string, unknown> | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  after!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) actorId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class AdminPageMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() skip!: number;
  @ApiProperty() take!: number;
  @ApiProperty() hasMore!: boolean;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogEntryDto] }) data!: AuditLogEntryDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
```

(If `src/common/dto/` or `track-correction-response.dto.ts` already defines a reusable page-meta DTO class, import it instead of declaring `AdminPageMetaDto`.)

`src/admin/admin-audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { adminAuditLogSelect } from '../utils/prisma-selects';
import {
  AuditAction,
  AuditEntry,
  AuditLogEntryDto,
  AuditLogPageDto,
  AuditTargetType,
  ListAuditLogQueryDto,
} from './dto/admin-audit.dto';

const DEFAULT_TAKE = 20;

type AuditRow = Prisma.AdminAuditLogGetPayload<{
  select: typeof adminAuditLogSelect;
}>;

function toDto(row: AuditRow): AuditLogEntryDto {
  return {
    id: row.id,
    action: row.action as AuditAction,
    targetType: row.targetType as AuditTargetType,
    targetId: row.targetId,
    before: (row.before as Record<string, unknown> | null) ?? null,
    after: (row.after as Record<string, unknown> | null) ?? null,
    actorId: row.actor?.id ?? null,
    actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}` : null,
    createdAt: row.createdAt,
  };
}

/** Back-office audit trail: written inside each admin write's transaction. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Must be called with the transaction client of the audited write. */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.adminAuditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before as Prisma.InputJsonValue | undefined,
        after: entry.after as Prisma.InputJsonValue | undefined,
      },
      select: { id: true },
    });
  }

  async list(query: ListAuditLogQueryDto): Promise<AuditLogPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminAuditLogSelect,
      }),
    ]);
    return createPaginatedResponse(rows.map(toDto), total, skip, take);
  }
}
```

`src/admin/dto/admin-reference.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class AdminReferenceDataDto {
  @ApiProperty({ type: [String] }) categories!: string[];
  @ApiProperty({ type: [String] }) ageGroups!: string[];
  @ApiProperty({ type: [String] }) competitionLevels!: string[];
  @ApiProperty({ type: [String] }) passportLevels!: string[];
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class AdminClubOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
```

`src/admin/admin-reference.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PassportLevel, UserRole } from '@prisma/client';
import { COMPETITION_LEVELS, COUPLE_AGE_GROUPS, SOLO_AGE_GROUPS } from '../common/age-group';
import { USER_CATEGORIES } from '../common/user-categories';
import { PrismaService } from '../prisma/prisma.service';
import { adminClubOptionSelect } from '../utils/prisma-selects';
import { AdminClubOptionDto, AdminReferenceDataDto } from './dto/admin-reference.dto';

/** Clubs are a small, federation-wide list; 1000 is a safety bound. */
const MAX_CLUBS = 1000;

@Injectable()
export class AdminReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  referenceData(): AdminReferenceDataDto {
    return {
      categories: [...USER_CATEGORIES],
      ageGroups: [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS],
      competitionLevels: [...COMPETITION_LEVELS],
      passportLevels: Object.values(PassportLevel),
      roles: Object.values(UserRole),
    };
  }

  clubs(): Promise<AdminClubOptionDto[]> {
    return this.prisma.club.findMany({
      orderBy: { name: 'asc' },
      take: MAX_CLUBS,
      select: adminClubOptionSelect,
    });
  }
}
```

- [ ] **Step 4: Controller + module**

`src/admin/admin.controller.ts` (first version — Tasks 4-6 add routes and constructor dependencies to this same class):

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiCommonErrorResponses } from '../common/decorators/api-error-responses.decorator';
import { AdminAuditService } from './admin-audit.service';
import { AdminReferenceService } from './admin-reference.service';
import { AuditLogPageDto, ListAuditLogQueryDto } from './dto/admin-audit.dto';
import { AdminClubOptionDto, AdminReferenceDataDto } from './dto/admin-reference.dto';

/**
 * Admin back-office API. Guards and role are set on the CLASS so that no
 * route of this controller can be exposed to a non-admin by omission.
 */
@ApiTags('admin')
@ApiCommonErrorResponses()
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly reference: AdminReferenceService,
  ) {}

  @Get('reference-data')
  @ApiOperation({ summary: 'Listes de valeurs du back-office' })
  @ApiResponse({ status: 200, type: AdminReferenceDataDto })
  referenceData(): AdminReferenceDataDto {
    return this.reference.referenceData();
  }

  @Get('clubs')
  @ApiOperation({ summary: 'Clubs (id + nom) pour les listes déroulantes' })
  @ApiResponse({ status: 200, type: [AdminClubOptionDto] })
  clubs(): Promise<AdminClubOptionDto[]> {
    return this.reference.clubs();
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Journal des actions admin' })
  @ApiResponse({ status: 200, type: AuditLogPageDto })
  auditLog(@Query() query: ListAuditLogQueryDto): Promise<AuditLogPageDto> {
    return this.audit.list(query);
  }
}
```

`src/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminReferenceService } from './admin-reference.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminAuditService, AdminReferenceService],
})
export class AdminModule {}
```

(Check how other modules get Prisma — if `PrismaModule` is `@Global()`, drop it from `imports`.) Add `AdminModule` to the `imports` array of `src/app.module.ts`.

- [ ] **Step 5: Role-matrix e2e**

`test/admin.e2e-spec.ts` — built like `test/tracks.e2e-spec.ts` (mocked `JwtAuthGuard`, real `RolesGuard`, `PrismaService` mocked so no DB is needed):

```ts
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { createMockPrismaService } from './mocks/prisma.mock';
import { applyE2EOverrides, configureTestApp } from './test-app.factory';

/** Every admin route; extended by later tasks. */
const ADMIN_ROUTES: Array<[method: 'get' | 'patch' | 'post', path: string]> = [
  ['get', '/api/v1/admin/reference-data'],
  ['get', '/api/v1/admin/clubs'],
  ['get', '/api/v1/admin/audit-log'],
];

describe('Admin routes (e2e) — role matrix', () => {
  let app: INestApplication;
  let currentRole: UserRole | null = UserRole.ADMIN;

  beforeAll(async () => {
    const prisma = createMockPrismaService();
    const moduleRef = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            if (currentRole === null) return false;
            const req = ctx
              .switchToHttp()
              .getRequest<{ user?: { userId: string; role: UserRole } }>();
            req.user = { userId: 'caller-id', role: currentRole };
            return true;
          },
        }),
    ).compile();
    app = moduleRef.createNestApplication();
    await configureTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  describe.each([UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF])('as %s', (role) => {
    it.each(ADMIN_ROUTES)('%s %s → 403', async (method, path) => {
      currentRole = role;
      await request(server())[method](path).send({}).expect(403);
    });
  });

  it.each(ADMIN_ROUTES)('unauthenticated %s %s → 401/403', async (method, path) => {
    currentRole = null;
    const res = await request(server())[method](path).send({});
    expect([401, 403]).toContain(res.status);
  });
});
```

If `AppModule` needs the same `overrideProvider(RedisService)` block as `tracks.e2e-spec.ts` to boot, copy it verbatim.

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm --filter backend exec jest src/admin
pnpm --filter backend test:e2e -- admin.e2e-spec
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/admin apps/backend/src/common/user-categories.ts apps/backend/src/utils/prisma-selects.ts apps/backend/src/app.module.ts apps/backend/test/admin.e2e-spec.ts
git commit -m "feat(admin): admin module with audit log, reference data and clubs

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Users list and detail (reads)

**Files:**

- Create: `src/admin/admin-users.query-service.ts`, `src/admin/dto/admin-users.dto.ts`
- Modify: `src/admin/admin.controller.ts`, `src/admin/admin.module.ts`, `src/utils/prisma-selects.ts`, `test/admin.e2e-spec.ts`
- Test: `src/admin/admin-users.query-service.spec.ts`

**Interfaces:**

- Consumes: `AdminPageMetaDto` (Task 3).
- Produces:
  - `ListAdminUsersQueryDto extends PaginationParamsDto { search?: string; role?: UserRole; clubId?: string; category?: string; createdFrom?: string; createdTo?: string }` (dates `YYYY-MM-DD`, both inclusive)
  - `AdminUserListItemDto { id; email; firstName; lastName; role: UserRole; clubId: string|null; clubName: string|null; category: string|null; ageGroup: string|null; licenseStatus: "ACTIVE"|"EXPIRED"|null; createdAt: Date }`
  - `AdminUserDetailDto extends AdminUserListItemDto { birthDate; nationalRanking; passportLevelLatin; passportLevelStandard; competitionLevel; wdsfMin; wdsfExpiresOn; licenseNumber; licenseValidUntil; lastLoginAt; updatedAt }` (all nullable except `updatedAt`)
  - `AdminUsersPageDto { data: AdminUserListItemDto[]; meta: AdminPageMetaDto }`
  - `AdminUsersQueryService.list(q): Promise<AdminUsersPageDto>`, `.detail(id): Promise<AdminUserDetailDto>` (404 if absent)
  - `licenseStatus(license: { validUntil: Date } | null, now: Date): "ACTIVE" | "EXPIRED" | null`
  - `adminUserListSelect`, `adminUserDetailSelect` in `prisma-selects.ts`.

- [ ] **Step 1: Write the failing tests**

`src/admin/admin-users.query-service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { adminUserDetailSelect, adminUserListSelect } from '../utils/prisma-selects';
import { AdminUsersQueryService, licenseStatus } from './admin-users.query-service';

const row = {
  id: 'u1',
  email: 'a@b.fr',
  firstName: 'Jeanne',
  lastName: 'Martin',
  role: UserRole.LICENSEE,
  clubId: 'c1',
  clubName: 'Club A',
  category: 'Latin',
  ageGroup: 'Adulte',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  license: { number: 'L1', validUntil: new Date('2999-08-31T00:00:00Z') },
};

describe('AdminUsersQueryService', () => {
  let service: AdminUsersQueryService;
  let prisma: MockPrismaService;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    const moduleRef = await Test.createTestingModule({
      providers: [AdminUsersQueryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AdminUsersQueryService);
  });

  it('builds the where clause from every filter', async () => {
    prisma.user.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);

    await service.list({
      skip: 50,
      take: 50,
      search: '  mar ',
      role: UserRole.CLUB,
      clubId: 'c1',
      category: 'Latin',
      createdFrom: '2026-09-01',
      createdTo: '2026-09-30',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { contains: 'mar', mode: 'insensitive' } },
          { firstName: { contains: 'mar', mode: 'insensitive' } },
          { lastName: { contains: 'mar', mode: 'insensitive' } },
        ],
        role: UserRole.CLUB,
        clubId: 'c1',
        category: 'Latin',
        createdAt: {
          gte: new Date('2026-09-01T00:00:00.000Z'),
          lt: new Date('2026-10-01T00:00:00.000Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: 50,
      take: 50,
      select: adminUserListSelect,
    });
  });

  it('ignores a blank search, defaults to 50 and maps license status', async () => {
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findMany.mockResolvedValue([row] as never);

    const page = await service.list({ search: '   ' });

    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args?.where).toEqual({});
    expect(args?.take).toBe(50);
    expect(page.data[0]).toMatchObject({ id: 'u1', licenseStatus: 'ACTIVE' });
    expect(page.data[0]).not.toHaveProperty('license');
  });

  it('detail flattens the license', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...row,
      birthDate: null,
      nationalRanking: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      wdsfMin: null,
      wdsfExpiresOn: null,
      lastLoginAt: null,
      updatedAt: new Date(),
    } as never);
    const d = await service.detail('u1');
    expect(d).toMatchObject({
      licenseNumber: 'L1',
      licenseStatus: 'ACTIVE',
      lastLoginAt: null,
    });
    expect(d).not.toHaveProperty('license');
  });

  it('detail throws 404 for an unknown id', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.detail('nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'nope' },
      select: adminUserDetailSelect,
    });
  });
});

describe('licenseStatus', () => {
  const now = new Date('2026-10-07T00:00:00Z');
  it('is null without license', () => expect(licenseStatus(null, now)).toBeNull());
  it('is EXPIRED before now', () =>
    expect(licenseStatus({ validUntil: new Date('2026-10-06T00:00:00Z') }, now)).toBe('EXPIRED'));
  it('is ACTIVE on or after now', () =>
    expect(licenseStatus({ validUntil: now }, now)).toBe('ACTIVE'));
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter backend exec jest src/admin/admin-users.query-service.spec.ts`

- [ ] **Step 3: Selects**

Append to `src/utils/prisma-selects.ts`:

```ts
/** Back-office users table. Never select password. */
export const adminUserListSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  clubId: true,
  clubName: true,
  category: true,
  ageGroup: true,
  createdAt: true,
  license: { select: { number: true, validUntil: true } },
} as const;

/** Back-office user page. Never select password. */
export const adminUserDetailSelect = {
  ...adminUserListSelect,
  birthDate: true,
  nationalRanking: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  competitionLevel: true,
  wdsfMin: true,
  wdsfExpiresOn: true,
  lastLoginAt: true,
  updatedAt: true,
} as const;
```

- [ ] **Step 4: DTOs**

`src/admin/dto/admin-users.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PassportLevel, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationParamsDto } from '../../common/dto/pagination-params.dto';
import { AdminPageMetaDto } from './admin-audit.dto';

export const LICENSE_STATUSES = ['ACTIVE', 'EXPIRED'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export class ListAdminUsersQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: 'Nom, prénom ou email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: 'Inclus, AAAA-MM-JJ' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Inclus, AAAA-MM-JJ' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}

export class AdminUserListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: UserRole, enumName: 'UserRole' }) role!: UserRole;
  @ApiProperty({ nullable: true, type: String }) clubId!: string | null;
  @ApiProperty({ nullable: true, type: String }) clubName!: string | null;
  @ApiProperty({ nullable: true, type: String }) category!: string | null;
  @ApiProperty({ nullable: true, type: String }) ageGroup!: string | null;
  @ApiProperty({ enum: LICENSE_STATUSES, nullable: true })
  licenseStatus!: LicenseStatus | null;
  @ApiProperty() createdAt!: Date;
}

export class AdminUserDetailDto extends AdminUserListItemDto {
  @ApiProperty({ nullable: true, type: Date }) birthDate!: Date | null;
  @ApiProperty({ nullable: true, type: Number }) nationalRanking!: number | null;
  @ApiProperty({
    enum: PassportLevel,
    enumName: 'PassportLevel',
    nullable: true,
  })
  passportLevelLatin!: PassportLevel | null;
  @ApiProperty({
    enum: PassportLevel,
    enumName: 'PassportLevel',
    nullable: true,
  })
  passportLevelStandard!: PassportLevel | null;
  @ApiProperty({ nullable: true, type: String }) competitionLevel!: string | null;
  @ApiProperty({ nullable: true, type: String }) wdsfMin!: string | null;
  @ApiProperty({ nullable: true, type: Date }) wdsfExpiresOn!: Date | null;
  @ApiProperty({ nullable: true, type: String }) licenseNumber!: string | null;
  @ApiProperty({ nullable: true, type: Date }) licenseValidUntil!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) lastLoginAt!: Date | null;
  @ApiProperty() updatedAt!: Date;
}

export class AdminUsersPageDto {
  @ApiProperty({ type: [AdminUserListItemDto] }) data!: AdminUserListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
```

- [ ] **Step 5: Query service**

`src/admin/admin-users.query-service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { adminUserDetailSelect, adminUserListSelect } from '../utils/prisma-selects';
import {
  AdminUserDetailDto,
  AdminUserListItemDto,
  AdminUsersPageDto,
  LicenseStatus,
  ListAdminUsersQueryDto,
} from './dto/admin-users.dto';

const DEFAULT_TAKE = 50;
const DAY_MS = 86_400_000;

type ListRow = Prisma.UserGetPayload<{ select: typeof adminUserListSelect }>;

export function licenseStatus(
  license: { validUntil: Date } | null,
  now: Date,
): LicenseStatus | null {
  if (!license) return null;
  return license.validUntil.getTime() >= now.getTime() ? 'ACTIVE' : 'EXPIRED';
}

function toListItem(row: ListRow, now: Date): AdminUserListItemDto {
  const { license, ...rest } = row;
  return { ...rest, licenseStatus: licenseStatus(license, now) };
}

/** Back-office reads of users (list + detail). */
@Injectable()
export class AdminUsersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListAdminUsersQueryDto): Promise<AdminUsersPageDto> {
    const skip = q.skip ?? 0;
    const take = q.take ?? DEFAULT_TAKE;
    const search = q.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(q.role && { role: q.role }),
      ...(q.clubId && { clubId: q.clubId }),
      ...(q.category && { category: q.category }),
      ...((q.createdFrom || q.createdTo) && {
        createdAt: {
          ...(q.createdFrom && { gte: new Date(q.createdFrom) }),
          // createdTo is inclusive: strictly before the next day.
          ...(q.createdTo && {
            lt: new Date(new Date(q.createdTo).getTime() + DAY_MS),
          }),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminUserListSelect,
      }),
    ]);
    const now = new Date();
    return createPaginatedResponse(
      rows.map((r) => toListItem(r, now)),
      total,
      skip,
      take,
    );
  }

  async detail(id: string): Promise<AdminUserDetailDto> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: adminUserDetailSelect,
    });
    if (!row) throw new NotFoundException('Utilisateur introuvable');
    const { license, ...rest } = row;
    return {
      ...rest,
      licenseStatus: licenseStatus(license, new Date()),
      licenseNumber: license?.number ?? null,
      licenseValidUntil: license?.validUntil ?? null,
    };
  }
}
```

- [ ] **Step 6: Routes**

In `AdminController`, add `private readonly usersQuery: AdminUsersQueryService` to the constructor and:

```ts
  @Get("users")
  @ApiOperation({ summary: "Liste paginée des inscrits" })
  @ApiResponse({ status: 200, type: AdminUsersPageDto })
  listUsers(
    @Query() query: ListAdminUsersQueryDto,
  ): Promise<AdminUsersPageDto> {
    return this.usersQuery.list(query);
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Fiche d'un inscrit" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  getUser(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<AdminUserDetailDto> {
    return this.usersQuery.detail(id);
  }
```

(imports: `Param`, `ParseUUIDPipe` from `@nestjs/common`, `ApiParam` from `@nestjs/swagger`, the DTOs.) Add `AdminUsersQueryService` to the module `providers`. Add to `ADMIN_ROUTES` in `test/admin.e2e-spec.ts`:

```ts
  ["get", "/api/v1/admin/users"],
  ["get", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
```

- [ ] **Step 7: Run — expect PASS**

```bash
pnpm --filter backend exec jest src/admin
pnpm --filter backend test:e2e -- admin.e2e-spec
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts
git commit -m "feat(admin): list and read users from the back-office

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Edit a user (`PATCH /admin/users/:id`)

**Files:**

- Create: `src/admin/admin-users.service.ts`, `src/admin/dto/update-admin-user.dto.ts`
- Modify: `src/admin/admin.controller.ts`, `src/admin/admin.module.ts`, `src/utils/prisma-selects.ts`, `test/admin.e2e-spec.ts`
- Test: `src/admin/admin-users.service.spec.ts`, `test/admin.integration-spec.ts` (create)

**Interfaces:**

- Consumes: `AdminAuditService.record`, `diffFields`, `AdminUsersQueryService.detail`, `USER_CATEGORIES`, age-group constants, `adminClubOptionSelect`.
- Produces:
  - `UpdateAdminUserDto` — all optional: `firstName`, `lastName` (string 1-100), `clubId` (uuid | null), `category` (in `USER_CATEGORIES` | null), `ageGroup` (in age groups | null), `passportLevelLatin` / `passportLevelStandard` (`PassportLevel` | null), `competitionLevel` (in `COMPETITION_LEVELS` | null), `nationalRanking` (int 1-100000 | null), `role` (`UserRole`).
  - `AdminUsersService.update(actorId: string, userId: string, dto: UpdateAdminUserDto): Promise<AdminUserDetailDto>`
  - `adminUserEditableSelect` in `prisma-selects.ts`.

- [ ] **Step 1: Write the failing unit tests**

`src/admin/admin-users.service.spec.ts`:

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminUsersQueryService } from './admin-users.query-service';
import { AdminUsersService } from './admin-users.service';

const current = {
  id: 'u1',
  firstName: 'Jeanne',
  lastName: 'Martin',
  clubId: 'c1',
  clubName: 'Club A',
  category: 'Latine', // legacy value outside USER_CATEGORIES
  ageGroup: 'Adulte',
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  nationalRanking: 12,
  role: UserRole.LICENSEE,
};

describe('AdminUsersService.update', () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(current as never);
    prisma.user.update.mockResolvedValue({} as never);
    audit = { record: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: 'u1' }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it('updates only sent fields and audits the diff, keeping a legacy category', async () => {
    await service.update('admin-1', 'u1', { lastName: 'Durand' });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastName: 'Durand' },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: 'admin-1',
      action: 'USER_UPDATE',
      targetType: 'USER',
      targetId: 'u1',
      before: { lastName: 'Martin' },
      after: { lastName: 'Durand' },
    });
    expect(query.detail).toHaveBeenCalledWith('u1');
  });

  it('syncs clubName when clubId changes', async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: 'c2',
      name: 'Club B',
    } as never);

    await service.update('admin-1', 'u1', { clubId: 'c2' });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: 'c2',
      clubName: 'Club B',
    });
  });

  it('clears club and clubName on clubId null, and clears a ranking on null', async () => {
    await service.update('admin-1', 'u1', {
      clubId: null,
      nationalRanking: null,
    });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: null,
      clubName: null,
      nationalRanking: null,
    });
  });

  it('rejects an unknown club with 400', async () => {
    prisma.club.findUnique.mockResolvedValue(null);
    await expect(service.update('admin-1', 'u1', { clubId: 'c9' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses an admin changing their own role', async () => {
    await expect(service.update('u1', 'u1', { role: UserRole.LICENSEE })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an admin to edit their own other fields', async () => {
    await service.update('u1', 'u1', { firstName: 'Gabin' });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('404s on unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('admin-1', 'nope', { lastName: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('writes nothing and audits nothing when values are unchanged', async () => {
    await service.update('admin-1', 'u1', { lastName: 'Martin' });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(query.detail).toHaveBeenCalledWith('u1');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter backend exec jest src/admin/admin-users.service.spec.ts`

- [ ] **Step 3: DTO**

`src/admin/dto/update-admin-user.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PassportLevel, UserRole } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { COMPETITION_LEVELS, COUPLE_AGE_GROUPS, SOLO_AGE_GROUPS } from '../../common/age-group';
import { USER_CATEGORIES } from '../../common/user-categories';

const AGE_GROUPS = [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS];
/** `null` clears the field; an absent key leaves it unchanged. */
const notNull = (_: object, v: unknown) => v !== null;

export class UpdateAdminUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @ValidateIf(notNull)
  @IsOptional()
  @IsUUID()
  clubId?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: USER_CATEGORIES })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(USER_CATEGORIES)
  category?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: AGE_GROUPS })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(AGE_GROUPS)
  ageGroup?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PassportLevel,
    enumName: 'PassportLevel',
  })
  @ValidateIf(notNull)
  @IsOptional()
  @IsEnum(PassportLevel)
  passportLevelLatin?: PassportLevel | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PassportLevel,
    enumName: 'PassportLevel',
  })
  @ValidateIf(notNull)
  @IsOptional()
  @IsEnum(PassportLevel)
  passportLevelStandard?: PassportLevel | null;

  @ApiPropertyOptional({ nullable: true, enum: COMPETITION_LEVELS })
  @ValidateIf(notNull)
  @IsOptional()
  @IsIn(COMPETITION_LEVELS)
  competitionLevel?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @ValidateIf(notNull)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  nationalRanking?: number | null;

  @ApiPropertyOptional({ enum: UserRole, enumName: 'UserRole' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
```

Add a DTO validation test in the same spec file or a new `update-admin-user.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

describe('UpdateAdminUserDto', () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(UpdateAdminUserDto, body))).map((e) => e.property);

  it('accepts null to clear nullable fields', async () => {
    expect(await errorsOf({ clubId: null, category: null, nationalRanking: null })).toEqual([]);
  });
  it('rejects values outside the reference lists', async () => {
    expect(await errorsOf({ category: 'Latine', ageGroup: 'Vieux', role: 'ROOT' })).toEqual([
      'category',
      'ageGroup',
      'role',
    ]);
  });
});
```

- [ ] **Step 4: Service**

Append to `prisma-selects.ts`:

```ts
/** Back-office: the editable fields of a user, for the audit diff. */
export const adminUserEditableSelect = {
  id: true,
  firstName: true,
  lastName: true,
  clubId: true,
  clubName: true,
  category: true,
  ageGroup: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  competitionLevel: true,
  nationalRanking: true,
  role: true,
} as const;
```

`src/admin/admin-users.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { adminClubOptionSelect, adminUserEditableSelect } from '../utils/prisma-selects';
import { AdminAuditService } from './admin-audit.service';
import { diffFields } from './admin-audit.util';
import { AdminUsersQueryService } from './admin-users.query-service';
import { AdminUserDetailDto } from './dto/admin-users.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

/** Back-office writes on users. Every change is audited in the same tx. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminUsersQueryService,
  ) {}

  async update(
    actorId: string,
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserDetailDto> {
    if (dto.role !== undefined && actorId === userId) {
      throw new ForbiddenException('Un administrateur ne peut pas modifier son propre rôle');
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: adminUserEditableSelect,
      });
      if (!current) throw new NotFoundException('Utilisateur introuvable');

      // Only keys actually present in the body (null = clear).
      const requested: Record<string, unknown> = Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      );

      if (dto.clubId !== undefined) {
        if (dto.clubId === null) {
          requested.clubName = null;
        } else {
          const club = await tx.club.findUnique({
            where: { id: dto.clubId },
            select: adminClubOptionSelect,
          });
          if (!club) throw new BadRequestException('Club introuvable');
          requested.clubName = club.name;
        }
      }

      const diff = diffFields(current, requested);
      if (!diff) return;

      await tx.user.update({
        where: { id: userId },
        data: diff.after,
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorId,
        action: 'USER_UPDATE',
        targetType: 'USER',
        targetId: userId,
        before: diff.before,
        after: diff.after,
      });
    });

    return this.query.detail(userId);
  }
}
```

The unit test mocks `$transaction` to call the callback with `prisma` itself, so `tx.user.findUnique` is `prisma.user.findUnique`. If `tsc` rejects `data: diff.after` (it is `Record<string, unknown>`), cast it as `data: diff.after as Prisma.UserUncheckedUpdateInput` — the DTO validation already restricts the keys and values.

- [ ] **Step 5: Route**

In `AdminController`, add `private readonly users: AdminUsersService` to the constructor and:

```ts
  @Patch("users/:id")
  @ApiOperation({ summary: "Modifier la fiche d'un inscrit" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  updateUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminUserDetailDto> {
    return this.users.update(req.user.userId, id, dto);
  }
```

(imports: `Body`, `Patch`, `Req` from `@nestjs/common`; `import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";`.) Add `AdminUsersService` to module providers. Add to `ADMIN_ROUTES`:

```ts
  ["patch", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000"],
```

- [ ] **Step 6: Real-DB integration test**

Create `test/admin.integration-spec.ts`, set up exactly like an existing integration spec (read `test/career.integration-spec.ts` and `test/integration-app.builder.ts` for how the app and the real `PrismaService` are obtained, and how data is cleaned). Content:

```ts
import { randomUUID } from 'crypto';
import { UserRole } from '@prisma/client';
// + the app/prisma bootstrap imports used by career.integration-spec.ts
import { AdminUsersService } from '../src/admin/admin-users.service';

const userData = (o: { role?: UserRole; lastName?: string }) => ({
  email: `${randomUUID()}@test.local`,
  password: 'x',
  firstName: 'Test',
  lastName: o.lastName ?? 'User',
  role: o.role ?? UserRole.LICENSEE,
});

describe('Admin (integration, real DB)', () => {
  // let app / prisma = ... (same bootstrap as career.integration-spec.ts)
  let service: AdminUsersService;
  const createdUserIds: string[] = [];

  // beforeAll: build app, service = app.get(AdminUsersService)
  afterEach(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  const create = async (o: Parameters<typeof userData>[0]) => {
    const u = await prisma.user.create({ data: userData(o) });
    createdUserIds.push(u.id);
    return u;
  };

  it('PATCH writes the user and exactly one audit row', async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({ lastName: 'Martin' });

    await service.update(admin.id, target.id, { lastName: 'Durand' });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetId: target.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ lastName: 'Martin' });
    expect(rows[0].after).toEqual({ lastName: 'Durand' });
  });

  it('PATCH with an unknown club changes nothing', async () => {
    const admin = await create({ role: UserRole.ADMIN });
    const target = await create({ lastName: 'Martin' });

    await expect(
      service.update(admin.id, target.id, {
        lastName: 'X',
        clubId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('Club introuvable');

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(after.lastName).toBe('Martin');
    expect(await prisma.adminAuditLog.count({ where: { targetId: target.id } })).toBe(0);
  });
});
```

Replace the commented bootstrap lines with the real ones from `career.integration-spec.ts` (do not leave comments in place of code).

- [ ] **Step 7: Run — expect PASS**

```bash
pnpm --filter backend exec jest src/admin
pnpm --filter backend test:e2e -- admin.e2e-spec
pnpm --filter backend exec jest --config test/jest-integration.json admin.integration-spec
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin apps/backend/src/utils/prisma-selects.ts apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): edit user profile fields with audit trail

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Club accounts — create and resend invitation

**Files:**

- Create: `src/admin/admin-club-accounts.service.ts`, `src/admin/dto/club-account.dto.ts`
- Modify: `src/admin/admin.controller.ts`, `src/admin/admin.module.ts`, `test/admin.e2e-spec.ts`, `test/admin.integration-spec.ts`
- Test: `src/admin/admin-club-accounts.service.spec.ts`

**Interfaces:**

- Consumes: `AuthPasswordService.issuePasswordToken`, `EmailService.sendInvitationEmail` (Task 2), `AdminAuditService.record`, `adminClubOptionSelect`.
- Produces:
  - `CreateClubAccountDto { email: string; firstName: string; lastName: string; clubId?: string; clubName?: string }` — exactly one of `clubId` / `clubName`.
  - `ClubAccountCreatedDto { userId: string; clubId: string; invitationSent: boolean }`
  - `InvitationResultDto { invitationSent: boolean }`
  - `AdminClubAccountsService.create(actorId, dto): Promise<ClubAccountCreatedDto>`
  - `AdminClubAccountsService.resendInvitation(actorId, userId): Promise<InvitationResultDto>`
  - `INVITATION_EXPIRY_HOURS = 168`
  - 409 response body for a taken club name: `{ message: "Un club porte déjà ce nom", existingClubId: string }`.

- [ ] **Step 1: Write the failing unit tests**

`src/admin/admin-club-accounts.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { createMockPrismaService, MockPrismaService } from '../../test/mocks/prisma.mock';
import { AuthPasswordService } from '../auth/auth-password.service';
import { EmailService } from '../auth/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminClubAccountsService, INVITATION_EXPIRY_HOURS } from './admin-club-accounts.service';

describe('AdminClubAccountsService', () => {
  let service: AdminClubAccountsService;
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
        AdminClubAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AuthPasswordService, useValue: passwords },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(AdminClubAccountsService);
  });

  const base = {
    email: ' Club@Example.FR ',
    firstName: 'Jeanne',
    lastName: 'Martin',
  };

  it('creates a new club + CLUB user with a normalised email, audits, then invites', async () => {
    const res = await service.create('admin-1', {
      ...base,
      clubName: ' Club Neuf ',
    });

    expect(prisma.club.create).toHaveBeenCalledWith({
      data: { name: 'Club Neuf' },
      select: { id: true, name: true },
    });
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      email: 'club@example.fr',
      firstName: 'Jeanne',
      lastName: 'Martin',
      role: UserRole.CLUB,
      clubId: 'c-new',
      clubName: 'Club Neuf',
    });
    expect(userData.password).toMatch(/^\$2[aby]\$/);
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: 'CLUB_ACCOUNT_CREATE',
        targetType: 'USER',
        targetId: 'u-new',
        after: {
          email: 'club@example.fr',
          clubId: 'c-new',
          clubName: 'Club Neuf',
          role: 'CLUB',
        },
      }),
    );
    expect(passwords.issuePasswordToken).toHaveBeenCalledWith('u-new', INVITATION_EXPIRY_HOURS);
    expect(email.sendInvitationEmail).toHaveBeenCalledWith('club@example.fr', 'plain', 'Jeanne');
    expect(res).toEqual({
      userId: 'u-new',
      clubId: 'c-new',
      invitationSent: true,
    });
  });

  it('attaches to an existing club by id', async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Club A',
    } as never);
    await service.create('admin-1', { ...base, clubId: 'c1' });
    expect(prisma.club.create).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      clubId: 'c1',
      clubName: 'Club A',
    });
  });

  it('409s on an email already used, looked up in normalised form', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'x' } as never);
    await expect(service.create('admin-1', { ...base, clubName: 'Z' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'club@example.fr' },
      select: { id: true },
    });
  });

  it('409s with the existing club id when the new club name exists', async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Club A',
    } as never);
    await expect(service.create('admin-1', { ...base, clubName: 'Club A' })).rejects.toMatchObject({
      response: { existingClubId: 'c1' },
    });
  });

  it('400s when both or neither of clubId / clubName are given', async () => {
    await expect(service.create('admin-1', { ...base })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create('admin-1', { ...base, clubId: 'c1', clubName: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the account and reports invitationSent=false when the email fails', async () => {
    email.sendInvitationEmail.mockRejectedValue(new Error('down'));
    const res = await service.create('admin-1', {
      ...base,
      clubName: 'Club Neuf',
    });
    expect(res.invitationSent).toBe(false);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  describe('resendInvitation', () => {
    const clubUser = {
      id: 'u1',
      email: 'c@x.fr',
      firstName: 'J',
      role: UserRole.CLUB,
    };

    it('re-issues a token and audits', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...clubUser,
        lastLoginAt: null,
      } as never);
      const res = await service.resendInvitation('admin-1', 'u1');
      expect(passwords.issuePasswordToken).toHaveBeenCalledWith('u1', INVITATION_EXPIRY_HOURS);
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          action: 'INVITATION_RESEND',
          targetId: 'u1',
        }),
      );
      expect(res).toEqual({ invitationSent: true });
    });

    it('400s once the user has logged in', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...clubUser,
        lastLoginAt: new Date(),
      } as never);
      await expect(service.resendInvitation('admin-1', 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter backend exec jest src/admin/admin-club-accounts.service.spec.ts`

- [ ] **Step 3: DTOs**

`src/admin/dto/club-account.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateClubAccountDto {
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

  @ApiPropertyOptional({ description: 'Club existant (exclusif avec clubName)' })
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional({ description: 'Nouveau club (exclusif avec clubId)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  clubName?: string;
}

export class ClubAccountCreatedDto {
  @ApiProperty() userId!: string;
  @ApiProperty() clubId!: string;
  @ApiProperty() invitationSent!: boolean;
}

export class InvitationResultDto {
  @ApiProperty() invitationSent!: boolean;
}
```

- [ ] **Step 4: Service**

`src/admin/admin-club-accounts.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthPasswordService } from '../auth/auth-password.service';
import { EmailService } from '../auth/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { adminClubOptionSelect } from '../utils/prisma-selects';
import { AdminAuditService } from './admin-audit.service';
import {
  ClubAccountCreatedDto,
  CreateClubAccountDto,
  InvitationResultDto,
} from './dto/club-account.dto';

export const INVITATION_EXPIRY_HOURS = 168;
const BCRYPT_ROUNDS = 12;

/** Club accounts created by an admin; the manager sets the password by email. */
@Injectable()
export class AdminClubAccountsService {
  private readonly logger = new Logger(AdminClubAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly passwords: AuthPasswordService,
    private readonly email: EmailService,
  ) {}

  async create(actorId: string, dto: CreateClubAccountDto): Promise<ClubAccountCreatedDto> {
    if (Boolean(dto.clubId) === Boolean(dto.clubName)) {
      throw new BadRequestException(
        "Indiquer soit un club existant, soit le nom d'un nouveau club",
      );
    }
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    // Unusable secret: the manager sets the real password via the invitation.
    const password = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

    const { userId, club } = await this.prisma.$transaction(async (tx) => {
      const taken = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (taken) throw new ConflictException('Cet email est déjà utilisé');

      let club: { id: string; name: string };
      if (dto.clubId) {
        const existing = await tx.club.findUnique({
          where: { id: dto.clubId },
          select: adminClubOptionSelect,
        });
        if (!existing) throw new BadRequestException('Club introuvable');
        club = existing;
      } else {
        const name = (dto.clubName ?? '').trim();
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
        club = await tx.club.create({
          data: { name },
          select: adminClubOptionSelect,
        });
      }

      const user = await tx.user.create({
        data: {
          email,
          password,
          firstName,
          lastName,
          role: UserRole.CLUB,
          clubId: club.id,
          clubName: club.name,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        actorId,
        action: 'CLUB_ACCOUNT_CREATE',
        targetType: 'USER',
        targetId: user.id,
        after: {
          email,
          clubId: club.id,
          clubName: club.name,
          role: UserRole.CLUB,
        },
      });
      return { userId: user.id, club };
    });

    const invitationSent = await this.sendInvitation(userId, email, firstName);
    return { userId, clubId: club.id, invitationSent };
  }

  async resendInvitation(actorId: string, userId: string): Promise<InvitationResultDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        role: true,
        lastLoginAt: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.lastLoginAt) {
      throw new BadRequestException("Ce compte s'est déjà connecté");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId,
        action: 'INVITATION_RESEND',
        targetType: 'USER',
        targetId: user.id,
      });
    });
    const invitationSent = await this.sendInvitation(user.id, user.email, user.firstName);
    return { invitationSent };
  }

  /** Graceful degradation: a mail failure never rolls back the account. */
  private async sendInvitation(userId: string, email: string, firstName: string): Promise<boolean> {
    try {
      const token = await this.passwords.issuePasswordToken(userId, INVITATION_EXPIRY_HOURS);
      await this.email.sendInvitationEmail(email, token, firstName);
      return true;
    } catch (error) {
      this.logger.warn(`Club invitation not sent for user ${userId}: ${(error as Error).message}`);
      return false;
    }
  }
}
```

(Keep `BCRYPT_ROUNDS = 12` — same cost as `auth-password.service.ts`; the ~200 ms in unit tests is acceptable.)

- [ ] **Step 5: Routes**

In `AdminController`, add `private readonly clubAccounts: AdminClubAccountsService` to the constructor and:

```ts
  @Post("club-accounts")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: "Créer un compte Club et envoyer l'invitation" })
  @ApiResponse({ status: 201, type: ClubAccountCreatedDto })
  @ApiResponse({ status: 409, description: "Email ou nom de club déjà utilisé" })
  createClubAccount(
    @Body() dto: CreateClubAccountDto,
    @Req() req: RequestWithUser,
  ): Promise<ClubAccountCreatedDto> {
    return this.clubAccounts.create(req.user.userId, dto);
  }

  @Post("users/:id/resend-invitation")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: "Renvoyer l'invitation d'un compte jamais connecté" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: InvitationResultDto })
  resendInvitation(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<InvitationResultDto> {
    return this.clubAccounts.resendInvitation(req.user.userId, id);
  }
```

(imports: `HttpCode`, `HttpStatus`, `Post` from `@nestjs/common`; `Throttle` from `@nestjs/throttler`.) Add `AdminClubAccountsService` to module providers. Add to `ADMIN_ROUTES`:

```ts
  ["post", "/api/v1/admin/club-accounts"],
  ["post", "/api/v1/admin/users/00000000-0000-4000-8000-000000000000/resend-invitation"],
```

- [ ] **Step 6: Integration tests (real DB)**

Append to `test/admin.integration-spec.ts` (`clubAccounts = app.get(AdminClubAccountsService)` in `beforeAll`; also track created club ids and delete them in `afterEach` after the users):

```ts
it('club account creation is atomic: a duplicate club name leaves no user behind', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const club = await prisma.club.create({
    data: { name: `Club ${randomUUID()}` },
  });
  createdClubIds.push(club.id);
  const email = `${randomUUID()}@test.local`;

  await expect(
    clubAccounts.create(admin.id, {
      email,
      firstName: 'J',
      lastName: 'M',
      clubName: club.name,
    }),
  ).rejects.toThrow('Un club porte déjà ce nom');

  expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
});

it('creates club + user + audit row together', async () => {
  const admin = await create({ role: UserRole.ADMIN });
  const email = `${randomUUID()}@test.local`;

  const res = await clubAccounts.create(admin.id, {
    email,
    firstName: 'J',
    lastName: 'M',
    clubName: `Club ${randomUUID()}`,
  });
  createdUserIds.push(res.userId);
  createdClubIds.push(res.clubId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: res.userId },
  });
  expect(user.role).toBe(UserRole.CLUB);
  expect(user.clubId).toBe(res.clubId);
  expect(await prisma.adminAuditLog.count({ where: { targetId: res.userId } })).toBe(1);
});
```

(Without Resend configured, `EmailService` only logs, so `invitationSent` is `true`.)

- [ ] **Step 7: Run — expect PASS**

```bash
pnpm --filter backend exec jest src/admin src/auth
pnpm --filter backend test:e2e -- admin.e2e-spec
pnpm --filter backend exec jest --config test/jest-integration.json admin.integration-spec
```

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/admin apps/backend/test/admin.e2e-spec.ts apps/backend/test/admin.integration-spec.ts
git commit -m "feat(admin): create Club accounts with an email invitation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: RGPD purge, coverage gate and Swagger export

**Files:**

- Modify: `apps/backend/src/users/users.service.ts` (`deleteMyAccount` transaction), `apps/backend/src/users/users.service.spec.ts`
- Modify: `apps/backend/jest.config.js` (thresholds)
- Modify (generated): `apps/backend/swagger.json`, `apps/docs/public/swagger.json`

- [ ] **Step 1: Failing test for the purge**

In `users.service.spec.ts`, in the `deleteMyAccount` describe, reuse the existing happy-path arrangement (user found, password valid, no documents) and add:

```ts
it('purges admin audit rows that target the deleted user', async () => {
  await service.deleteMyAccount('user-1', 'correct-password');

  expect(prisma.adminAuditLog.deleteMany).toHaveBeenCalledWith({
    where: { targetType: 'USER', targetId: 'user-1' },
  });
});
```

(Use the user id and password the existing happy-path test uses.) Run: `pnpm --filter backend exec jest src/users/users.service.spec.ts -t "audit"` → FAIL.

- [ ] **Step 2: Implement**

In the `$transaction([...])` array of `deleteMyAccount`, before `this.prisma.user.delete(...)`:

```ts
      // Back-office audit rows about this person would outlive the account.
      // Rows the user authored as an admin stay (actorId → SetNull).
      this.prisma.adminAuditLog.deleteMany({
        where: { targetType: "USER", targetId: userId },
      }),
```

Run the users suite → PASS.

- [ ] **Step 3: Coverage threshold for the admin module**

In `apps/backend/jest.config.js`, inside `coverageThreshold`, after the `srcDir("auth")` entry:

```js
    // Admin back-office can change roles and create accounts: same bar as auth.
    [srcDir("admin")]: {
      statements: 94,
      branches: 75,
      functions: 88,
      lines: 94,
    },
```

Run: `pnpm --filter backend exec jest --coverage` → PASS with the admin threshold met. If it fails, add unit tests for the uncovered branches (do not lower the threshold).

- [ ] **Step 4: Export Swagger**

```bash
pnpm docs:export
```

Expected: `grep -c '"/api/v1/admin' apps/backend/swagger.json` prints at least `7`.

- [ ] **Step 5: Full backend check**

```bash
pnpm --filter backend typecheck && pnpm --filter backend lint && pnpm --filter backend test
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/users apps/backend/jest.config.js apps/backend/swagger.json apps/docs/public/swagger.json
git commit -m "feat(admin): purge audit rows on account deletion and gate admin coverage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `apps/admin` scaffold — client, session, login

**Files:**

- Create: `apps/admin/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.setup.ts`, `eslint.config.js`, `index.html`, `openapi-ts.config.ts`, `.env.example`, `public/staticwebapp.config.json`
- Create: `src/main.tsx`, `src/App.tsx`, `src/router.tsx`, `src/config.ts`, `src/vite-env.d.ts`, `src/api/client.ts`, `src/session/sessionStore.ts`, `src/session/refresh.ts`, `src/session/RequireAdmin.tsx`, `src/pages/LoginPage.tsx`, `src/components/AppLayout.tsx`
- Generated: `src/api/generated/**`
- Modify: root `package.json` (`typecheck`, `lint`, `api:generate`)
- Test: `src/session/sessionStore.test.ts`, `src/session/refresh.test.ts`, `src/session/RequireAdmin.test.tsx`, `src/pages/LoginPage.test.tsx`

**Interfaces:**

- Produces:
  - `useSession` (Zustand): `{ accessToken: string|null; refreshToken: string|null; user: SessionUser|null; setSession(s: { accessToken: string; refreshToken: string; user: SessionUser }): void; clear(): void }`, `SessionUser = { id: string; email: string; firstName: string; lastName: string; role: string }`; persisted in `sessionStorage` under `ffd-admin-session`.
  - `refreshSession(): Promise<string | null>` — single-flight; on failure calls `useSession.getState().clear()` and returns `null`.
  - `RequireAdmin` — renders children only if `user?.role === "ADMIN"`, else `<Navigate to="/login" replace />`.
  - `API_URL: string`.
  - Generated SDK functions (names produced by `@hey-api/openapi-ts` from Nest's default operationIds, as in `apps/client`, e.g. `trackCorrectionsControllerList`): `authControllerLogin`, `authControllerRefresh`, `healthControllerCheck`, `adminControllerListUsers`, `adminControllerGetUser`, `adminControllerUpdateUser`, `adminControllerCreateClubAccount`, `adminControllerResendInvitation`, `adminControllerClubs`, `adminControllerReferenceData`, `adminControllerAuditLog`. **After generation, list the real names** with `grep -o "export const \w*" apps/admin/src/api/generated/sdk.gen.ts` and use them in Tasks 8-12 if any differ (e.g. the health controller method name).

- [ ] **Step 1: Package + tooling files**

`apps/admin/package.json`:

```json
{
  "name": "admin",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@mantine/core": "^8.3.0",
    "@mantine/dates": "^8.3.0",
    "@mantine/form": "^8.3.0",
    "@mantine/hooks": "^8.3.0",
    "@mantine/notifications": "^8.3.0",
    "@tanstack/react-query": "^5.104.0",
    "dayjs": "^1.11.13",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-router": "^7.9.0",
    "zustand": "^5.0.8"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@hey-api/client-axios": "^0.9.1",
    "@hey-api/openapi-ts": "^0.99.0",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "~19.2.0",
    "@types/react-dom": "~19.2.0",
    "@vitejs/plugin-react": "^6.1.1",
    "eslint": "^10.11.0",
    "eslint-plugin-react": "^7.37.5",
    "jsdom": "^27.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.71.0",
    "vite": "^8.3.1",
    "vitest": "^3.2.4"
  }
}
```

The ranges are floors written on 2026-10-07: install with `pnpm --filter admin add` if a range does not resolve, and keep `vitest` on a major that supports the installed `vite` major.

`apps/admin/tsconfig.json`: copy `apps/landing/tsconfig.json` and add `"types": ["vitest/globals", "@testing-library/jest-dom"]` to `compilerOptions`; `"include": ["src", "vitest.setup.ts"]`.

`apps/admin/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
```

`apps/admin/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
```

`apps/admin/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// Mantine needs matchMedia and ResizeObserver in jsdom.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

`apps/admin/eslint.config.js`: copy `apps/landing/eslint.config.js`, add `'src/api/generated/**'` to `ignores`, and add the rule `'@typescript-eslint/no-explicit-any': 'error'`.

`apps/admin/openapi-ts.config.ts`: identical to `apps/client/openapi-ts.config.ts` (same `input: "../backend/swagger.json"`, `output: "src/api/generated"`, same `client`, `types.enums: "typescript"`).

`apps/admin/.env.example`:

```
# Backend API, /api/v1 included. Staging while backend-prod is stopped.
VITE_API_URL=https://api-staging.ffd.gabin-simond.fr/api/v1
```

`apps/admin/index.html`:

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>FFD Connect — Administration</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/admin/public/staticwebapp.config.json`:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*"]
  },
  "globalHeaders": {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api-staging.ffd.gabin-simond.fr https://api.ffd.gabin-simond.fr; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow"
  }
}
```

(`style-src 'unsafe-inline'` is required by Mantine's runtime style injection; scripts stay `'self'` only.)

Root `package.json` scripts:

```json
"typecheck": "pnpm --filter backend typecheck && pnpm --filter client typecheck && pnpm --filter admin typecheck",
"lint": "pnpm --filter client lint && pnpm --filter backend lint && pnpm --filter landing lint && pnpm --filter admin lint",
"api:generate": "pnpm --filter client exec openapi-ts && pnpm --filter admin exec openapi-ts",
```

Then:

```bash
pnpm install
pnpm --filter admin exec openapi-ts
grep -o "export const \w*" apps/admin/src/api/generated/sdk.gen.ts | grep -iE "admin|authControllerLogin|authControllerRefresh|health"
```

Expected: the admin, login, refresh and health functions are listed.

- [ ] **Step 2: Failing session tests**

`src/session/sessionStore.test.ts`:

```ts
import { useSession } from './sessionStore';

const user = {
  id: 'a1',
  email: 'a@x.fr',
  firstName: 'G',
  lastName: 'S',
  role: 'ADMIN',
};

describe('sessionStore', () => {
  beforeEach(() => useSession.getState().clear());

  it('stores the session in sessionStorage, never localStorage', () => {
    useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user });
    expect(useSession.getState().accessToken).toBe('at');
    expect(sessionStorage.getItem('ffd-admin-session')).toContain('"rt"');
    expect(localStorage.getItem('ffd-admin-session')).toBeNull();
  });

  it('clear() wipes memory and storage', () => {
    useSession.getState().setSession({ accessToken: 'at', refreshToken: 'rt', user });
    useSession.getState().clear();
    expect(useSession.getState().user).toBeNull();
    expect(sessionStorage.getItem('ffd-admin-session')).not.toContain('"rt"');
  });
});
```

`src/session/refresh.test.ts`:

```ts
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { refreshSession } from './refresh';
import { useSession } from './sessionStore';

const user = {
  id: 'a1',
  email: 'a@x.fr',
  firstName: 'G',
  lastName: 'S',
  role: 'ADMIN',
};

describe('refreshSession', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().setSession({ accessToken: 'old', refreshToken: 'rt', user });
  });

  it('is single-flight and stores the rotated tokens', async () => {
    const spy = vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: { access_token: 'new', refresh_token: 'rt2' },
      error: undefined,
    } as never);

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toBe('new');
    expect(b).toBe('new');
    expect(useSession.getState().refreshToken).toBe('rt2');
  });

  it('clears the session when refresh fails (no loop)', async () => {
    vi.spyOn(sdk, 'authControllerRefresh').mockResolvedValue({
      data: undefined,
      error: { message: 'expired' },
    } as never);

    await expect(refreshSession()).resolves.toBeNull();
    expect(useSession.getState().user).toBeNull();
  });
});
```

`src/session/RequireAdmin.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RequireAdmin } from './RequireAdmin';
import { useSession } from './sessionStore';

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route
          path="/users"
          element={
            <RequireAdmin>
              <p>secret</p>
            </RequireAdmin>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  it('redirects to /login once the session is cleared', () => {
    useSession.getState().clear();
    renderAt();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders children for an ADMIN', () => {
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: '1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'ADMIN' },
    });
    renderAt();
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin test` → FAIL (modules missing).

- [ ] **Step 3: Implement session + client**

`src/config.ts`:

```ts
/** Backend base URL, `/api/v1` included. Set at build time. */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
```

`src/session/sessionStore.ts`:

```ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  setSession: (s: { accessToken: string; refreshToken: string; user: SessionUser }) => void;
  clear: () => void;
}

/**
 * Admin session. sessionStorage on purpose: closing the tab ends the session.
 * Never localStorage (it outlives the browser session).
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: ({ accessToken, refreshToken, user }) => set({ accessToken, refreshToken, user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    {
      name: 'ffd-admin-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ accessToken, refreshToken, user }) => ({
        accessToken,
        refreshToken,
        user,
      }),
    },
  ),
);
```

`src/session/refresh.ts`:

```ts
import { authControllerRefresh } from '../api/generated/sdk.gen';
import { useSession } from './sessionStore';

let inFlight: Promise<string | null> | null = null;

/** Rotates tokens once even if many requests 401 together. */
export function refreshSession(): Promise<string | null> {
  if (!inFlight) {
    inFlight = (async () => {
      const { refreshToken, user } = useSession.getState();
      if (!refreshToken || !user) return null;
      const { data, error } = await authControllerRefresh({
        body: { refresh_token: refreshToken },
      });
      if (error || !data) {
        useSession.getState().clear();
        return null;
      }
      useSession.getState().setSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user,
      });
      return data.access_token;
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
```

(The refresh body field name must match the backend refresh DTO: check `apps/backend/src/auth/dto` and the generated `types.gen.ts`, and use the same name in the code and the test.)

`src/api/client.ts` — same shape as `apps/client/src/api/client.ts`:

```ts
import { API_URL } from '../config';
import { refreshSession } from '../session/refresh';
import { useSession } from '../session/sessionStore';
import { client } from './generated/client.gen';

client.setConfig({ baseUrl: API_URL });

client.interceptors.request.use((request) => {
  const token = useSession.getState().accessToken;
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  return request;
});

// 401 → refresh once; replay only bodyless reads. A failed refresh clears the
// session, and RequireAdmin then redirects to /login.
client.interceptors.response.use(async (response, request) => {
  if (response.status !== 401 || request.url.includes('/auth/')) {
    return response;
  }
  const token = await refreshSession();
  if (!token) return response;
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return response;
  const retried = new Request(request, {});
  retried.headers.set('Authorization', `Bearer ${token}`);
  return fetch(retried);
});

export { client };
```

(The generated client must match the mobile app's: if `apps/admin/src/api/generated/client` exposes different interceptor signatures, mirror exactly what `apps/client/src/api/client.ts` does.)

`src/session/RequireAdmin.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from './sessionStore';

/** UX guard only — the API enforces ADMIN on every /admin route. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const user = useSession((s) => s.user);
  if (user?.role !== 'ADMIN') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Failing login tests**

`src/pages/LoginPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { useSession } from '../session/sessionStore';
import { LoginPage } from './LoginPage';

function renderLogin() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/users" element={<p>users page</p>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

async function submit() {
  await userEvent.type(await screen.findByLabelText(/email/i), 'a@x.fr');
  await userEvent.type(screen.getByLabelText(/mot de passe/i), 'secret');
  await userEvent.click(screen.getByRole('button', { name: /se connecter/i }));
}

const loginOk = (role: string) => ({
  data: {
    access_token: 'at',
    refresh_token: 'rt',
    user: { id: 'a1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role },
  },
  error: undefined,
  response: new Response(null, { status: 200 }),
});

describe('LoginPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().clear();
    vi.spyOn(sdk, 'healthControllerCheck').mockResolvedValue({
      data: {},
      error: undefined,
    } as never);
  });

  it('logs an ADMIN in and goes to /users', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue(loginOk('ADMIN') as never);
    renderLogin();
    await submit();
    expect(await screen.findByText('users page')).toBeInTheDocument();
    expect(useSession.getState().user?.role).toBe('ADMIN');
  });

  it('refuses a non-admin and keeps no session', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue(loginOk('CLUB') as never);
    renderLogin();
    await submit();
    expect(await screen.findByText(/réservé aux administrateurs/i)).toBeInTheDocument();
    expect(useSession.getState().accessToken).toBeNull();
  });

  it('shows invalid credentials on 401', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockResolvedValue({
      data: undefined,
      error: { message: 'Invalid credentials' },
      response: new Response(null, { status: 401 }),
    } as never);
    renderLogin();
    await submit();
    expect(await screen.findByText(/identifiants incorrects/i)).toBeInTheDocument();
  });

  it('reports an unavailable server (not a password error) on network failure', async () => {
    vi.spyOn(sdk, 'authControllerLogin').mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    await submit();
    expect(await screen.findByText(/serveur indisponible/i)).toBeInTheDocument();
    expect(screen.queryByText(/identifiants incorrects/i)).toBeNull();
  });

  it('shows the wake-up state while the server is cold', async () => {
    let wake: () => void = () => {};
    vi.spyOn(sdk, 'healthControllerCheck').mockReturnValue(
      new Promise((resolve) => {
        wake = () => resolve({ data: {}, error: undefined } as never);
      }) as never,
    );
    renderLogin();
    expect(await screen.findByText(/réveil du serveur/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /se connecter/i })).toBeDisabled();
    wake();
    expect(await screen.findByRole('button', { name: /se connecter/i })).toBeEnabled();
  });
});
```

Run: `pnpm --filter admin test` → FAIL.

- [ ] **Step 5: Implement login, layout, router, bootstrap**

`src/pages/LoginPage.tsx`:

```tsx
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { authControllerLogin, healthControllerCheck } from '../api/generated/sdk.gen';
import { useSession } from '../session/sessionStore';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useSession((s) => s.setSession);
  const [awake, setAwake] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '' } });

  // Scale-to-zero backend: wake it before the user submits (60-120 s worst case).
  useEffect(() => {
    let alive = true;
    void healthControllerCheck()
      .catch(() => undefined)
      .finally(() => {
        if (alive) setAwake(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = form.onSubmit(async ({ email, password }) => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, response } = await authControllerLogin({
        body: { username: email.trim(), password },
      });
      if (!data) {
        setError(
          response?.status === 401
            ? 'Identifiants incorrects.'
            : 'Serveur indisponible, réessayez dans un instant.',
        );
        return;
      }
      if (data.user.role !== 'ADMIN') {
        setError('Accès réservé aux administrateurs.');
        return;
      }
      setSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: data.user,
      });
      navigate('/users', { replace: true });
    } catch {
      setError('Serveur indisponible, réessayez dans un instant.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Center h="100vh">
      <Paper w={360} p="xl" withBorder>
        <form onSubmit={onSubmit}>
          <Stack>
            <Title order={2}>FFD Connect — Administration</Title>
            {!awake && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Réveil du serveur… (jusqu'à 2 minutes)
                </Text>
              </Group>
            )}
            {error && <Alert color="red">{error}</Alert>}
            <TextInput label="Email" type="email" required {...form.getInputProps('email')} />
            <PasswordInput label="Mot de passe" required {...form.getInputProps('password')} />
            <Button type="submit" loading={submitting} disabled={!awake}>
              Se connecter
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
```

(The login body field is `username` per `LoginDto`. If the generated `user.role` is a TypeScript enum, compare against the enum member and map `data.user` to `SessionUser` explicitly.)

`src/components/AppLayout.tsx`:

```tsx
import { AppShell, Button, Group, NavLink, Text } from '@mantine/core';
import { NavLink as RouterLink, Outlet, useNavigate } from 'react-router';
import { useSession } from '../session/sessionStore';

export function AppLayout() {
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const navigate = useNavigate();
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
        <NavLink component={RouterLink} to="/users" label="Inscrits" />
        <NavLink component={RouterLink} to="/club-accounts/new" label="Nouveau compte Club" />
        <NavLink component={RouterLink} to="/audit-log" label="Journal d'audit" />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
```

`src/router.tsx` (Tasks 9-12 replace the placeholder and add routes here):

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { RequireAdmin } from './session/RequireAdmin';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAdmin>
        <AppLayout />
      </RequireAdmin>
    ),
    children: [
      { index: true, element: <Navigate to="/users" replace /> },
      { path: 'users', element: <p>Inscrits</p> },
    ],
  },
  { path: '*', element: <Navigate to="/users" replace /> },
]);
```

`src/App.tsx`:

```tsx
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import './api/client';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <MantineProvider>
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Run — expect PASS**

```bash
pnpm --filter admin test && pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin build
```

- [ ] **Step 7: Commit**

```bash
git add apps/admin package.json pnpm-lock.yaml
git commit -m "feat(admin): scaffold the back-office web app with admin login

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Users page

**Files:**

- Create: `apps/admin/src/pages/UsersPage.tsx`, `apps/admin/src/api/queries.ts`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/src/pages/UsersPage.test.tsx`

**Interfaces:**

- Produces in `src/api/queries.ts` (used by Tasks 9-12): `unwrap`, `usersQuery(q)`, `userQuery(id)`, `clubsQuery`, `referenceQuery`, `auditQuery(q)` — React Query `queryOptions` with keys `["admin","users",q]`, `["admin","user",id]`, `["admin","clubs"]`, `["admin","reference"]`, `["admin","audit",q]`.

- [ ] **Step 1: Shared queries**

`src/api/queries.ts`:

```ts
import { queryOptions } from '@tanstack/react-query';
import {
  adminControllerAuditLog,
  adminControllerClubs,
  adminControllerGetUser,
  adminControllerListUsers,
  adminControllerReferenceData,
} from './generated/sdk.gen';
import type {
  AdminControllerAuditLogData,
  AdminControllerListUsersData,
} from './generated/types.gen';

export type UsersFilter = NonNullable<AdminControllerListUsersData['query']>;
export type AuditFilter = NonNullable<AdminControllerAuditLogData['query']>;

/** Throws so React Query surfaces the error state. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error !== undefined || data === undefined) {
    throw error ?? new Error('Réponse vide');
  }
  return data;
}

export const usersQuery = (q: UsersFilter) =>
  queryOptions({
    queryKey: ['admin', 'users', q],
    queryFn: () => unwrap(adminControllerListUsers({ query: q })),
  });

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'user', id],
    queryFn: () => unwrap(adminControllerGetUser({ path: { id } })),
  });

export const clubsQuery = queryOptions({
  queryKey: ['admin', 'clubs'],
  queryFn: () => unwrap(adminControllerClubs()),
  staleTime: 5 * 60_000,
});

export const referenceQuery = queryOptions({
  queryKey: ['admin', 'reference'],
  queryFn: () => unwrap(adminControllerReferenceData()),
  staleTime: Infinity,
});

export const auditQuery = (q: AuditFilter) =>
  queryOptions({
    queryKey: ['admin', 'audit', q],
    queryFn: () => unwrap(adminControllerAuditLog({ query: q })),
  });
```

(`AdminControllerListUsersData` / `AdminControllerAuditLogData` are the per-operation types `@hey-api/openapi-ts` generates; confirm the names in `types.gen.ts`.)

- [ ] **Step 2: Failing test**

`src/pages/UsersPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UsersPage } from './UsersPage';

const page = (n: number) => ({
  data: {
    data: [
      {
        id: 'u1',
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        clubId: 'c1',
        clubName: 'Club A',
        category: 'Latin',
        ageGroup: 'Adulte',
        licenseStatus: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    meta: { total: n, skip: 0, take: 50, hasMore: n > 50 },
  },
  error: undefined,
});

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubs').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin'],
        ageGroups: [],
        competitionLevels: [],
        passportLevels: [],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
  });

  it('lists users with the total count', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage();
    expect(await screen.findByText('jeanne@x.fr')).toBeInTheDocument();
    expect(screen.getByText('1 inscrit')).toBeInTheDocument();
  });

  it('sends the search after debounce, from the first page', async () => {
    const spy = vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue(page(1) as never);
    renderPage();
    await screen.findByText('jeanne@x.fr');
    await userEvent.type(screen.getByPlaceholderText(/nom, prénom ou email/i), 'mar');
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ search: 'mar', skip: 0 }),
      }),
    );
  });

  it('shows an error state when the API fails', async () => {
    vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
      data: undefined,
      error: { message: 'x' },
    } as never);
    renderPage();
    expect(await screen.findByText(/impossible de charger/i)).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter admin test UsersPage` → FAIL.

- [ ] **Step 3: Implement**

`src/pages/UsersPage.tsx`:

```tsx
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { clubsQuery, referenceQuery, usersQuery, type UsersFilter } from '../api/queries';

const PAGE_SIZE = 50;

const LICENSE_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
};

export function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [role, setRole] = useState<string | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [pageIndex, setPageIndex] = useState(1);

  const filters = {
    ...(debounced && { search: debounced }),
    ...(role && { role }),
    ...(clubId && { clubId }),
    ...(category && { category }),
    ...(range[0] && { createdFrom: dayjs(range[0]).format('YYYY-MM-DD') }),
    ...(range[1] && { createdTo: dayjs(range[1]).format('YYYY-MM-DD') }),
  };
  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPageIndex(1);
  }

  const users = useQuery({
    ...usersQuery({
      ...filters,
      skip: (pageIndex - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    } as UsersFilter),
    placeholderData: keepPreviousData,
  });
  const clubs = useQuery(clubsQuery);
  const reference = useQuery(referenceQuery);
  const total = users.data?.meta.total ?? 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Inscrits</Title>
        <Button component={Link} to="/club-accounts/new">
          Nouveau compte Club
        </Button>
      </Group>
      <Group grow>
        <TextInput
          placeholder="Nom, prénom ou email"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          placeholder="Rôle"
          clearable
          data={reference.data?.roles ?? []}
          value={role}
          onChange={setRole}
        />
        <Select
          placeholder="Club"
          clearable
          searchable
          data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={clubId}
          onChange={setClubId}
        />
        <Select
          placeholder="Catégorie"
          clearable
          data={reference.data?.categories ?? []}
          value={category}
          onChange={setCategory}
        />
        <DatePickerInput
          type="range"
          placeholder="Inscription entre…"
          clearable
          value={range}
          onChange={setRange}
        />
      </Group>
      {users.isError && <Alert color="red">Impossible de charger les inscrits.</Alert>}
      {users.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} inscrit{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Rôle</Table.Th>
                <Table.Th>Club</Table.Th>
                <Table.Th>Catégorie</Table.Th>
                <Table.Th>Classe d'âge</Table.Th>
                <Table.Th>Licence</Table.Th>
                <Table.Th>Inscription</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data?.data ?? []).map((u) => (
                <Table.Tr
                  key={u.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/users/${u.id}`)}
                >
                  <Table.Td>
                    {u.lastName} {u.firstName}
                  </Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{u.role}</Badge>
                  </Table.Td>
                  <Table.Td>{u.clubName ?? '—'}</Table.Td>
                  <Table.Td>{u.category ?? '—'}</Table.Td>
                  <Table.Td>{u.ageGroup ?? '—'}</Table.Td>
                  <Table.Td>{u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'}</Table.Td>
                  <Table.Td>{dayjs(u.createdAt).format('DD/MM/YYYY')}</Table.Td>
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

(If `tsc` rejects the `as UsersFilter` cast because `role` is a generated enum, type the `role` state as that enum and drop the cast.) In `router.tsx`, replace `{ path: "users", element: <p>Inscrits</p> }` with `{ path: "users", element: <UsersPage /> }`.

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter admin typecheck && pnpm --filter admin lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): users table with search, filters and pagination

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: User detail / edit page

**Files:**

- Create: `apps/admin/src/pages/UserDetailPage.tsx`, `apps/admin/src/components/ChangeSummary.tsx`, `apps/admin/src/lib/diff.ts`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/src/lib/diff.test.ts`, `apps/admin/src/pages/UserDetailPage.test.tsx`

**Interfaces:**

- Consumes: `userQuery`, `clubsQuery`, `referenceQuery`, `auditQuery`, `unwrap` (Task 9); `adminControllerUpdateUser({ path: { id }, body })`, `adminControllerResendInvitation({ path: { id } })`.
- Produces:
  - `EditableFields = { firstName: string; lastName: string; clubId: string | null; category: string | null; ageGroup: string | null; passportLevelLatin: string | null; passportLevelStandard: string | null; competitionLevel: string | null; nationalRanking: number | null; role: string }`
  - `changedFields(initial: EditableFields, current: EditableFields): Partial<EditableFields>` — only keys whose value differs; `""` and `undefined` are treated as `null`.
  - `withLegacy(options: string[], value: string | null): { value: string; label: string }[]` — appends `value` labelled `"<value> (valeur historique)"` when it is not in `options`.
  - `ChangeSummary({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> })`.

- [ ] **Step 1: Failing tests**

`src/lib/diff.test.ts`:

```ts
import { changedFields, withLegacy } from './diff';

const base = {
  firstName: 'Jeanne',
  lastName: 'Martin',
  clubId: 'c1',
  category: 'Latine',
  ageGroup: 'Adulte',
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  nationalRanking: 12,
  role: 'LICENSEE',
};

describe('changedFields', () => {
  it('returns only changed keys', () => {
    expect(changedFields(base, { ...base, lastName: 'Durand' })).toEqual({
      lastName: 'Durand',
    });
  });
  it('maps cleared values to null', () => {
    expect(changedFields(base, { ...base, clubId: null, nationalRanking: null })).toEqual({
      clubId: null,
      nationalRanking: null,
    });
  });
  it('is empty when nothing changed (legacy value untouched)', () => {
    expect(changedFields(base, { ...base })).toEqual({});
  });
});

describe('withLegacy', () => {
  it('keeps known values as is', () => {
    expect(withLegacy(['Latin', 'Standard'], 'Latin')).toEqual([
      { value: 'Latin', label: 'Latin' },
      { value: 'Standard', label: 'Standard' },
    ]);
  });
  it('appends an unknown current value so the select is not blank', () => {
    expect(withLegacy(['Latin'], 'Latine')).toContainEqual({
      value: 'Latine',
      label: 'Latine (valeur historique)',
    });
  });
});
```

`src/pages/UserDetailPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { useSession } from '../session/sessionStore';
import { UserDetailPage } from './UserDetailPage';

const detail = {
  id: 'u1',
  email: 'jeanne@x.fr',
  firstName: 'Jeanne',
  lastName: 'Martin',
  role: 'LICENSEE',
  clubId: 'c1',
  clubName: 'Club A',
  category: 'Latine',
  ageGroup: 'Adulte',
  licenseStatus: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  birthDate: null,
  nationalRanking: 12,
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  wdsfMin: null,
  wdsfExpiresOn: null,
  licenseNumber: 'L1',
  licenseValidUntil: '2027-08-31T00:00:00.000Z',
  lastLoginAt: null,
};

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users/u1']}>
          <Routes>
            <Route path="/users/:id" element={<UserDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'admin-1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'ADMIN' },
    });
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: detail,
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerClubs').mockResolvedValue({
      data: [
        { id: 'c1', name: 'Club A' },
        { id: 'c2', name: 'Club B' },
      ],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin', 'Standard', 'Ten Dance'],
        ageGroups: ['Adulte'],
        competitionLevels: ['Débutant'],
        passportLevels: ['BLANC'],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } },
      error: undefined,
    } as never);
  });

  it('shows a legacy category instead of a blank select', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Latine (valeur historique)')).toBeInTheDocument();
  });

  it('confirms a before → after summary then PATCHes only the changed field', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, lastName: 'Durand' },
      error: undefined,
    } as never);
    renderPage();
    const lastName = await screen.findByLabelText('Nom');
    await userEvent.clear(lastName);
    await userEvent.type(lastName, 'Durand');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Martin');
    expect(dialog).toHaveTextContent('Durand');
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }));
    expect(patch).toHaveBeenCalledWith({
      path: { id: 'u1' },
      body: { lastName: 'Durand' },
    });
  });

  it("disables the role select on the admin's own account", async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, id: 'admin-1', role: 'ADMIN' },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByLabelText('Rôle')).toBeDisabled();
  });

  it('offers to resend the invitation while lastLoginAt is null', async () => {
    const resend = vi
      .spyOn(sdk, 'adminControllerResendInvitation')
      .mockResolvedValue({ data: { invitationSent: true }, error: undefined } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
    expect(resend).toHaveBeenCalledWith({ path: { id: 'u1' } });
  });
});
```

Run: `pnpm --filter admin test diff UserDetailPage` → FAIL.

- [ ] **Step 2: Implement `src/lib/diff.ts`**

```ts
export interface EditableFields {
  firstName: string;
  lastName: string;
  clubId: string | null;
  category: string | null;
  ageGroup: string | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  competitionLevel: string | null;
  nationalRanking: number | null;
  role: string;
}

const norm = (v: unknown) => (v === '' || v === undefined ? null : v);

/** Keys whose value changed; a cleared input becomes null (= clear). */
export function changedFields(
  initial: EditableFields,
  current: EditableFields,
): Partial<EditableFields> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof EditableFields)[]) {
    if (norm(initial[key]) !== norm(current[key])) out[key] = norm(current[key]);
  }
  return out as Partial<EditableFields>;
}

/** Select options, plus the current value when it predates the reference list. */
export function withLegacy(
  options: string[],
  value: string | null,
): { value: string; label: string }[] {
  const list = options.map((o) => ({ value: o, label: o }));
  if (value && !options.includes(value)) {
    list.push({ value, label: `${value} (valeur historique)` });
  }
  return list;
}
```

- [ ] **Step 3: Implement `src/components/ChangeSummary.tsx`**

```tsx
import { Table } from '@mantine/core';

const LABELS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  clubId: 'Club',
  clubName: 'Club',
  category: 'Catégorie',
  ageGroup: "Classe d'âge",
  passportLevelLatin: 'Passeport Latine',
  passportLevelStandard: 'Passeport Standard',
  competitionLevel: 'Niveau compétition',
  nationalRanking: 'Classement national',
  role: 'Rôle',
  email: 'Email',
};

export function ChangeSummary({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Champ</Table.Th>
          <Table.Th>Avant</Table.Th>
          <Table.Th>Après</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {Object.keys(after).map((k) => (
          <Table.Tr key={k}>
            <Table.Td>{LABELS[k] ?? k}</Table.Td>
            <Table.Td>{String(before[k] ?? '—')}</Table.Td>
            <Table.Td>{String(after[k] ?? '—')}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
```

- [ ] **Step 4: Implement `src/pages/UserDetailPage.tsx`**

```tsx
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  adminControllerResendInvitation,
  adminControllerUpdateUser,
} from '../api/generated/sdk.gen';
import {
  auditQuery,
  clubsQuery,
  referenceQuery,
  unwrap,
  userQuery,
  type AuditFilter,
} from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { changedFields, type EditableFields, withLegacy } from '../lib/diff';
import { useSession } from '../session/sessionStore';

export function UserDetailPage() {
  const { id = '' } = useParams();
  const me = useSession((s) => s.user);
  const qc = useQueryClient();
  const user = useQuery(userQuery(id));
  const clubs = useQuery(clubsQuery);
  const ref = useQuery(referenceQuery);
  const history = useQuery(
    auditQuery({ targetType: 'USER', targetId: id, skip: 0, take: 20 } as AuditFilter),
  );
  const [pending, setPending] = useState<Partial<EditableFields> | null>(null);

  const initial = useMemo<EditableFields | null>(() => {
    const u = user.data;
    if (!u) return null;
    return {
      firstName: u.firstName,
      lastName: u.lastName,
      clubId: u.clubId,
      category: u.category,
      ageGroup: u.ageGroup,
      passportLevelLatin: u.passportLevelLatin ?? null,
      passportLevelStandard: u.passportLevelStandard ?? null,
      competitionLevel: u.competitionLevel,
      nationalRanking: u.nationalRanking,
      role: u.role,
    };
  }, [user.data]);

  const form = useForm<EditableFields>({
    initialValues: {
      firstName: '',
      lastName: '',
      clubId: null,
      category: null,
      ageGroup: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      nationalRanking: null,
      role: '',
    },
  });
  const { setValues } = form;
  useEffect(() => {
    if (initial) setValues(initial);
  }, [initial, setValues]);

  const save = useMutation({
    mutationFn: (body: Partial<EditableFields>) =>
      unwrap(
        adminControllerUpdateUser({
          path: { id },
          body: body as Parameters<typeof adminControllerUpdateUser>[0]['body'],
        }),
      ),
    onSuccess: (updated) => {
      qc.setQueryData(userQuery(id).queryKey, updated);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setPending(null);
      notifications.show({ color: 'green', message: 'Fiche mise à jour' });
    },
    onError: () => notifications.show({ color: 'red', message: "Échec de l'enregistrement" }),
  });

  const resend = useMutation({
    mutationFn: () => unwrap(adminControllerResendInvitation({ path: { id } })),
    onSuccess: (r) =>
      notifications.show(
        r.invitationSent
          ? { color: 'green', message: 'Invitation renvoyée' }
          : {
              color: 'orange',
              message: "Envoi de l'email impossible, réessayez plus tard",
            },
      ),
    onError: () => notifications.show({ color: 'red', message: 'Renvoi impossible' }),
  });

  if (user.isError) {
    return <Alert color="red">Utilisateur introuvable ou erreur serveur.</Alert>;
  }
  if (!user.data || !initial || !ref.data) return <Loader />;
  const u = user.data;
  const isSelf = me?.id === u.id;
  const clubName = (cid: unknown) =>
    clubs.data?.find((c) => c.id === cid)?.name ?? (cid ? String(cid) : null);
  const displayBefore = (k: string): unknown =>
    k === 'clubId' ? u.clubName : initial[k as keyof EditableFields];

  const onSubmit = form.onSubmit((values) => {
    const changes = changedFields(initial, values);
    if (Object.keys(changes).length) setPending(changes);
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>
          {u.firstName} {u.lastName}
        </Title>
        {u.lastLoginAt === null && (
          <Button variant="light" loading={resend.isPending} onClick={() => resend.mutate()}>
            Renvoyer l'invitation
          </Button>
        )}
      </Group>
      <Card withBorder>
        <SimpleGrid cols={3}>
          <Text size="sm">Email : {u.email}</Text>
          <Text size="sm">
            Licence : {u.licenseNumber ?? '—'}
            {u.licenseValidUntil &&
              ` (jusqu'au ${dayjs(u.licenseValidUntil).format('DD/MM/YYYY')})`}
          </Text>
          <Text size="sm">WDSF : {u.wdsfMin ?? '—'}</Text>
          <Text size="sm">Inscription : {dayjs(u.createdAt).format('DD/MM/YYYY')}</Text>
          <Text size="sm">
            Dernière connexion :{' '}
            {u.lastLoginAt ? dayjs(u.lastLoginAt).format('DD/MM/YYYY HH:mm') : 'jamais'}
          </Text>
        </SimpleGrid>
      </Card>
      <form onSubmit={onSubmit}>
        <SimpleGrid cols={2}>
          <TextInput label="Prénom" {...form.getInputProps('firstName')} />
          <TextInput label="Nom" {...form.getInputProps('lastName')} />
          <Select
            label="Club"
            clearable
            searchable
            data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            {...form.getInputProps('clubId')}
          />
          <Select
            label="Catégorie"
            clearable
            data={withLegacy(ref.data.categories, initial.category)}
            {...form.getInputProps('category')}
          />
          <Select
            label="Classe d'âge"
            clearable
            searchable
            data={withLegacy(ref.data.ageGroups, initial.ageGroup)}
            {...form.getInputProps('ageGroup')}
          />
          <Select
            label="Niveau compétition"
            clearable
            data={withLegacy(ref.data.competitionLevels, initial.competitionLevel)}
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
          <Select
            label="Rôle"
            data={ref.data.roles}
            disabled={isSelf}
            description={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle' : undefined}
            {...form.getInputProps('role')}
          />
        </SimpleGrid>
        <Group mt="md">
          <Button type="submit">Enregistrer</Button>
        </Group>
      </form>

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Confirmer les modifications"
      >
        {pending && (
          <Stack>
            <ChangeSummary
              before={Object.fromEntries(Object.keys(pending).map((k) => [k, displayBefore(k)]))}
              after={Object.fromEntries(
                Object.entries(pending).map(([k, v]) => [k, k === 'clubId' ? clubName(v) : v]),
              )}
            />
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

      <Title order={4}>Historique admin</Title>
      {history.data?.data.length ? (
        history.data.data.map((h) => (
          <Card key={h.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(h.createdAt).format('DD/MM/YYYY HH:mm')} — {h.action} par{' '}
              {h.actorName ?? 'admin supprimé'}
            </Text>
            {h.after && <ChangeSummary before={h.before ?? {}} after={h.after} />}
          </Card>
        ))
      ) : (
        <Text size="sm" c="dimmed">
          Aucune modification admin.
        </Text>
      )}
    </Stack>
  );
}
```

Router: add `{ path: "users/:id", element: <UserDetailPage /> }` in the protected children.

- [ ] **Step 5: Run — expect PASS**: `pnpm --filter admin test && pnpm --filter admin typecheck && pnpm --filter admin lint`

- [ ] **Step 6: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): user page with confirmed edits, history and invitation resend

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: New Club account page

**Files:**

- Create: `apps/admin/src/pages/NewClubAccountPage.tsx`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/src/pages/NewClubAccountPage.test.tsx`

**Interfaces:**

- Consumes: `adminControllerCreateClubAccount({ body: { email, firstName, lastName, clubId?, clubName? } })` → `{ userId, clubId, invitationSent }`; 409 error body `{ message, existingClubId? }`; `clubsQuery`.

- [ ] **Step 1: Failing test**

`src/pages/NewClubAccountPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewClubAccountPage } from './NewClubAccountPage';

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/club-accounts/new']}>
          <Routes>
            <Route path="/club-accounts/new" element={<NewClubAccountPage />} />
            <Route path="/users/:id" element={<p>user page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillNewClub(clubName: string) {
  await userEvent.type(screen.getByLabelText('Email'), 'club@x.fr');
  await userEvent.type(screen.getByLabelText('Prénom du responsable'), 'Jeanne');
  await userEvent.type(screen.getByLabelText('Nom du responsable'), 'Martin');
  await userEvent.click(screen.getByRole('radio', { name: /nouveau club/i }));
  await userEvent.type(screen.getByLabelText('Nom du nouveau club'), clubName);
  await userEvent.click(screen.getByRole('button', { name: /créer le compte/i }));
}

describe('NewClubAccountPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubs').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
  });

  it('creates the account and opens the user page', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateClubAccount').mockResolvedValue({
      data: { userId: 'u-new', clubId: 'c-new', invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillNewClub('Club Neuf');
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'club@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        clubName: 'Club Neuf',
      },
    });
    expect(await screen.findByText('user page')).toBeInTheDocument();
  });

  it('offers the existing club when the name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerCreateClubAccount').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
    } as never);
    renderPage();
    await screen.findByLabelText('Email');
    await fillNewClub('Club A');
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /utiliser « club a »/i }));
    expect(screen.getByRole('radio', { name: /club existant/i })).toBeChecked();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`src/pages/NewClubAccountPage.tsx`:

```tsx
import { Alert, Button, Group, Radio, Select, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { adminControllerCreateClubAccount } from '../api/generated/sdk.gen';
import { clubsQuery } from '../api/queries';

type Mode = 'existing' | 'new';

export function NewClubAccountPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clubs = useQuery(clubsQuery);
  const [mode, setMode] = useState<Mode>('existing');
  const [error, setError] = useState<{
    message: string;
    existingClubId?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm({
    initialValues: {
      email: '',
      firstName: '',
      lastName: '',
      clubId: null as string | null,
      clubName: '',
    },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Email invalide'),
      firstName: (v) => (v.trim() ? null : 'Obligatoire'),
      lastName: (v) => (v.trim() ? null : 'Obligatoire'),
      clubId: (v) => (mode === 'existing' && !v ? 'Choisir un club' : null),
      clubName: (v) => (mode === 'new' && v.trim().length < 2 ? 'Nom trop court' : null),
    },
  });

  const onSubmit = form.onSubmit(async (v) => {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        email: v.email.trim(),
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        ...(mode === 'existing' ? { clubId: v.clubId as string } : { clubName: v.clubName.trim() }),
      };
      const { data, error: apiError } = await adminControllerCreateClubAccount({
        body,
      });
      if (!data) {
        const e = (apiError ?? {}) as {
          message?: string;
          existingClubId?: string;
        };
        setError({
          message: e.message ?? 'Création impossible',
          existingClubId: e.existingClubId,
        });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['admin'] });
      notifications.show(
        data.invitationSent
          ? { color: 'green', message: 'Compte créé, invitation envoyée' }
          : {
              color: 'orange',
              message:
                "Compte créé, mais l'email n'est pas parti : utilisez « Renvoyer l'invitation »",
            },
      );
      navigate(`/users/${data.userId}`);
    } catch {
      setError({ message: 'Serveur indisponible, réessayez dans un instant.' });
    } finally {
      setSubmitting(false);
    }
  });

  const existingName = error?.existingClubId
    ? clubs.data?.find((c) => c.id === error.existingClubId)?.name
    : undefined;

  return (
    <Stack maw={520}>
      <Title order={2}>Nouveau compte Club</Title>
      {error && (
        <Alert color="red">
          {error.message}
          {error.existingClubId && existingName && (
            <Button
              size="xs"
              ml="sm"
              variant="white"
              onClick={() => {
                setMode('existing');
                form.setFieldValue('clubId', error.existingClubId ?? null);
                setError(null);
              }}
            >
              Utiliser « {existingName} »
            </Button>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput label="Email" type="email" {...form.getInputProps('email')} />
          <TextInput label="Prénom du responsable" {...form.getInputProps('firstName')} />
          <TextInput label="Nom du responsable" {...form.getInputProps('lastName')} />
          <Radio.Group value={mode} onChange={(m) => setMode(m as Mode)} label="Club">
            <Group mt="xs">
              <Radio value="existing" label="Club existant" />
              <Radio value="new" label="Nouveau club" />
            </Group>
          </Radio.Group>
          {mode === 'existing' ? (
            <Select
              label="Club existant"
              searchable
              data={(clubs.data ?? []).map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              {...form.getInputProps('clubId')}
            />
          ) : (
            <TextInput label="Nom du nouveau club" {...form.getInputProps('clubName')} />
          )}
          <Button type="submit" loading={submitting}>
            Créer le compte
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
```

(The 409 body shape depends on the backend exception filter: check how `ConflictException({ message, existingClubId })` is serialised by the global filter in `apps/backend/src/common` and read `existingClubId` from wherever it lands — top level or nested — in both the page and the test.)

Router: add `{ path: "club-accounts/new", element: <NewClubAccountPage /> }`.

- [ ] **Step 3: Run — expect PASS**; then typecheck + lint.

- [ ] **Step 4: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): create Club accounts from the back-office

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Audit log page

**Files:**

- Create: `apps/admin/src/pages/AuditLogPage.tsx`
- Modify: `apps/admin/src/router.tsx`
- Test: `apps/admin/src/pages/AuditLogPage.test.tsx`

- [ ] **Step 1: Failing test**

`src/pages/AuditLogPage.test.tsx`:

```tsx
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { AuditLogPage } from './AuditLogPage';

describe('AuditLogPage', () => {
  it('lists entries with author, action label and a link to the target user', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: {
        data: [
          {
            id: 'l1',
            action: 'USER_UPDATE',
            targetType: 'USER',
            targetId: 'u1',
            before: { lastName: 'Martin' },
            after: { lastName: 'Durand' },
            actorId: 'a1',
            actorName: 'Gabin S',
            createdAt: '2026-10-07T10:00:00.000Z',
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
    expect(await screen.findByText('Gabin S')).toBeInTheDocument();
    expect(screen.getByText('Modification de fiche')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voir la fiche/i })).toHaveAttribute(
      'href',
      '/users/u1',
    );
    expect(screen.getByText('Durand')).toBeInTheDocument();
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`src/pages/AuditLogPage.tsx`:

```tsx
import { Alert, Anchor, Loader, Pagination, Stack, Table, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router';
import { auditQuery, type AuditFilter } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';

const PAGE_SIZE = 50;
const ACTION_LABELS: Record<string, string> = {
  USER_UPDATE: 'Modification de fiche',
  CLUB_ACCOUNT_CREATE: 'Création de compte Club',
  INVITATION_RESEND: "Renvoi d'invitation",
};

export function AuditLogPage() {
  const [pageIndex, setPageIndex] = useState(1);
  const log = useQuery({
    ...auditQuery({
      skip: (pageIndex - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    } as AuditFilter),
    placeholderData: keepPreviousData,
  });
  if (log.isError) {
    return <Alert color="red">Impossible de charger le journal.</Alert>;
  }
  if (!log.data) return <Loader />;
  const total = log.data.meta.total;
  return (
    <Stack>
      <Title order={2}>Journal d'audit</Title>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Date</Table.Th>
            <Table.Th>Admin</Table.Th>
            <Table.Th>Action</Table.Th>
            <Table.Th>Cible</Table.Th>
            <Table.Th>Détail</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {log.data.data.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{dayjs(e.createdAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
              <Table.Td>{e.actorName ?? 'admin supprimé'}</Table.Td>
              <Table.Td>{ACTION_LABELS[e.action] ?? e.action}</Table.Td>
              <Table.Td>
                {e.targetType === 'USER' ? (
                  <Anchor component={Link} to={`/users/${e.targetId}`}>
                    Voir la fiche
                  </Anchor>
                ) : (
                  e.targetId
                )}
              </Table.Td>
              <Table.Td>
                {e.after && <ChangeSummary before={e.before ?? {}} after={e.after} />}
              </Table.Td>
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
    </Stack>
  );
}
```

Router: add `{ path: "audit-log", element: <AuditLogPage /> }`.

- [ ] **Step 3: Run — expect PASS**; full admin check: `pnpm --filter admin test && pnpm --filter admin typecheck && pnpm --filter admin lint && pnpm --filter admin build`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): audit log page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: CI, hosting, CORS and docs

When executing with subagents, give this task to `infra-azure` (workflows, Terraform) and have `cost-manager` confirm the cost statement; `docs-scribe` can write the runbook.

**Files:**

- Modify: `.github/workflows/ci.yml` (`changes` filter, `lint-format`, `typecheck` condition)
- Create: `.github/workflows/deploy-admin.yml`
- Create: `infra/terraform/admin-swa.tf`; modify `infra/terraform/outputs.tf`, `infra/terraform/dns.tf` (comment only)
- Modify: wherever `CORS_ORIGINS` is set for `backend-staging` (grep first)
- Modify: `apps/backend/Dockerfile`, `Dockerfile` (`COPY apps/admin/package.json ./apps/admin/` next to the landing line)
- Create: `docs/exploitation/backoffice-admin.md` (French runbook)
- Modify: `docs/legal/politique-confidentialite.md`, `CLAUDE.md`

- [ ] **Step 1: CI**

In `ci.yml` `changes` job: add output `admin: ${{ steps.filter.outputs.admin }}` and filter:

```yaml
admin:
  - 'apps/admin/**'
  - 'apps/backend/swagger.json'
  - 'packages/eslint-config/**'
  - 'pnpm-lock.yaml'
  - 'package.json'
```

In `lint-format`, after "Build landing":

```yaml
- name: Admin (lint, typecheck, tests, build)
  if: github.event_name != 'pull_request' || needs.changes.outputs.admin == 'true'
  timeout-minutes: 5
  env:
    VITE_API_URL: https://api-staging.ffd.gabin-simond.fr/api/v1
  run: |
    pnpm --filter admin lint
    pnpm --filter admin typecheck
    pnpm --filter admin test
    pnpm --filter admin build
```

In `typecheck`'s `if:`, add `|| needs.changes.outputs.admin == 'true'`. No new job: the step runs inside an existing job (≈1-2 min, only on PRs touching the admin), so no extra per-job rounding.

- [ ] **Step 2: Hosting**

`infra/terraform/admin-swa.tf`:

```hcl
# Admin back-office (apps/admin) — static SPA, Free tier (0 EUR).
resource "azurerm_static_web_app" "admin" {
  name                = "swa-ffd-admin"
  resource_group_name = azurerm_resource_group.main.name
  location            = "westeurope"
  sku_tier            = "Free"
  sku_size            = "Free"
}

resource "azurerm_static_web_app_custom_domain" "admin" {
  static_web_app_id = azurerm_static_web_app.admin.id
  domain_name       = "admin.ffd.gabin-simond.fr"
  validation_type   = "cname-delegation"
}
```

(Use the resource-group reference the other `.tf` files use.) In `outputs.tf`:

```hcl
output "admin_swa_hostname" {
  value = azurerm_static_web_app.admin.default_host_name
}

output "admin_url" {
  value = "https://admin.ffd.gabin-simond.fr"
}
```

In the header comment of `dns.tf` add the line `#   - admin.ffd.gabin-simond.fr → Azure Static Web App (CNAME to the admin_swa_hostname output, DNS-only)`.

`.github/workflows/deploy-admin.yml`:

```yaml
name: Deploy admin (Static Web App)

on:
  push:
    branches: [staging]
    paths: ['apps/admin/**']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-admin
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 8
    environment: admin
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v6
        with:
          persist-credentials: false
      - name: Setup pnpm & Node
        uses: ./.github/actions/setup-pnpm
      - name: Build
        env:
          VITE_API_URL: https://api-staging.ffd.gabin-simond.fr/api/v1
        run: pnpm --filter admin build
      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_ADMIN }}
          action: upload
          app_location: apps/admin/dist
          skip_app_build: true
          skip_api_build: true
```

Pin `Azure/static-web-apps-deploy` to a full commit SHA (with a `# v1` comment), like every other action in the repo. Deploying from `staging` matches the backend it talks to (`backend-staging`); when `backend-prod` restarts, one PR switches the trigger to `master` and the URL to `api.ffd.gabin-simond.fr`.

- [ ] **Step 3: CORS**

`grep -rn "CORS_ORIGINS" .github infra apps/backend/.env*` and add `https://admin.ffd.gabin-simond.fr` to the staging value (and the prod one, for when it restarts). If the value only lives in the Container App configuration, document the exact `az containerapp update --name backend-staging ... --set-env-vars CORS_ORIGINS=...` command in the runbook; the user applies it.

- [ ] **Step 4: Docs**

`docs/exploitation/backoffice-admin.md` (French), sections: Objet ; Accès (rôle `ADMIN` uniquement, comment promouvoir un compte) ; Hébergement (SWA Free, `admin.ffd.gabin-simond.fr`, CNAME Cloudflare DNS-only, secret `AZURE_STATIC_WEB_APPS_API_TOKEN_ADMIN` dans l'environnement GitHub `admin`) ; Déploiement (`deploy-admin.yml`, branche `staging`) ; API utilisée (staging tant que prod est arrêtée) ; CORS ; Journal d'audit (contenu, purge à la suppression du compte) ; Coût (0 EUR, réveil du backend à l'usage).

`docs/legal/politique-confidentialite.md`: in the section listing who accesses the data, add: « Les administrateurs de la plateforme peuvent consulter et corriger les informations de profil (club, catégorie, classe d'âge, niveaux) ; chaque modification est tracée (auteur, date, valeurs avant/après) et ces traces sont supprimées avec le compte. »

`CLAUDE.md`: add `admin (Vite/React back-office)` to the **Apps** line, `pnpm --filter admin dev` under Key commands, and a row "Admin back-office screen (apps/admin)" → `client-dev` in the subagent routing table.

- [ ] **Step 5: Verify**

```bash
pnpm preflight
```

Expected: all green. Run `actionlint .github/workflows/deploy-admin.yml .github/workflows/ci.yml` if available.

- [ ] **Step 6: Commit**

```bash
git add .github infra apps/backend/Dockerfile Dockerfile docs CLAUDE.md
git commit -m "ci(admin): build, test and deploy the back-office to Azure Static Web Apps

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Invitation link check (spec open point)

**Files:** depends on the finding — at most a new landing page `apps/landing/reset-password/` and the backend `FRONTEND_URL` value.

- [ ] **Step 1: Find the real link host**

```bash
grep -rn "FRONTEND_URL" .github infra apps/backend/.env* docs/exploitation
grep -nE "associatedDomains|intentFilters|ffd-connect.fr|gabin-simond" apps/client/app.config.* apps/client/app.json 2>/dev/null
```

If `FRONTEND_URL` is only set in Azure, ask the user for the `backend-staging` value. Then `curl -sI "https://<host>/reset-password?token=x"` to see what is served without the app.

- [ ] **Step 2: Stop and report to the user**, with one of:
  - **A.** The host opens the app (universal link configured) and serves a usable page without it → nothing to build; record it in `docs/exploitation/backoffice-admin.md`.
  - **B.** It does not → propose a minimal page `ffd.gabin-simond.fr/reset-password?token=…` on the landing (password form calling `POST /api/v1/auth/reset-password` with `{ token, newPassword }`) plus `FRONTEND_URL=https://ffd.gabin-simond.fr` on the backend, as a separate small PR with its own plan.

- [ ] **Step 3: Commit** the runbook note (case A) with a conventional message and the co-author line.

---

## Final verification (after Task 14)

- [ ] `pnpm preflight` green.
- [ ] `test-verifier`, then `code-reviewer` + `security-reviewer` in parallel on the branch diff (auth exports, role changes, tokens, CORS, CSP are in scope).
- [ ] Manual smoke on a local stack: `docker compose --profile infra up -d`, `pnpm --filter backend start:dev`, `VITE_API_URL=http://localhost:3000/api/v1 pnpm --filter admin dev`; log in as an ADMIN, edit a user, create a Club account (email only logged locally), check the audit page.
- [ ] Ask the user before pushing and opening the PR to `develop`. Manual steps for the user after merge: `terraform apply` (SWA), CNAME in Cloudflare, SWA deployment token in the GitHub `admin` environment, CORS on `backend-staging`.
