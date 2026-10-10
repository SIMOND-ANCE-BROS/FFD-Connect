# CLAUDE.md — FFD-Connect

## Project overview

FFD-Connect is a monorepo for the French Dance Federation (FFD). It manages competitions, licenses, clubs, partnerships, and music for ballroom/latin dancers.

**Apps:** backend (NestJS 11), client (React Native 0.86 / Expo SDK 57), landing (Vite/React), admin (Vite/React back-office), docs (Astro/Starlight)
**Packages:** @ffd-connect/shared (types), eslint-config, jest-config

## Key commands

```bash
# Development
pnpm start:dev              # Start all apps in dev mode
pnpm --filter backend start:dev   # Backend only (NestJS watch)
pnpm --filter client start        # Client only (Expo Metro)
pnpm --filter admin dev           # Admin back-office only (Vite; API = VITE_API_URL, default localhost:3000)

# Before pushing — run exactly what blocks CI
pnpm preflight              # typecheck + lint + format + tests + audit (single command)

# What pre-push hook runs (subset of preflight)
pnpm typecheck              # TypeScript check (backend + client)
pnpm --filter backend test  # Backend unit tests
pnpm --filter client test   # Client unit tests

# Full CI locally
pnpm lint                   # ESLint across all apps
pnpm format:check           # Prettier check
pnpm test:ci                # All tests (backend + client)

# Single test file (fastest feedback loop)
pnpm --filter backend exec jest <path>   # same with --filter client

# Database
pnpm --filter backend migrate  # Prisma migrate dev (needs running Postgres)
docker compose --profile infra up -d  # Start Postgres + Redis

# API sync (after backend API changes)
pnpm api:sync               # Export Swagger + regenerate client types

# Fresh environment: a plain install just works — the backend generates its
# Prisma client via postinstall
pnpm install --frozen-lockfile
```

## Merge gate (CI blocking jobs)

A PR cannot merge unless these pass (see `docs/exploitation/ci-cd-minimal.md`):

| Job                  | What it checks                        |
| -------------------- | ------------------------------------- |
| `typecheck`          | `tsc --noEmit` on backend + client    |
| `lint-format`        | ESLint + Prettier across all apps     |
| `backend-test`       | Unit + integration + e2e with real DB |
| `backend-build`      | Compile + swagger.json freshness      |
| `client`             | Lint + unit tests                     |
| `docs-build`         | `astro build` on apps/docs            |
| `audit-dependencies` | osv-scanner (OSV DB) — high/critical  |

Informational (non-blocking): `playwright-e2e`, `mutation` (Stryker). Weekly `mutation-nightly.yml` (Sundays) provides full mutation coverage.

## Delivery flow

Branches cascade: `develop` (default, target of feature PRs) → `staging` → `master`. Promotions are merges up the cascade — never cherry-picks, never force-pushes.

**A merged remote branch must be deleted.** Merge feature PRs with `gh pr merge <n> --squash --delete-branch`; if a remote branch is found merged but still present, delete it (`git push origin --delete <branch>`) along with its local branch and worktree. Exception: never delete `develop`, `staging` or `master` — they are the head of promotion PRs, so never pass `--delete-branch` when merging a promotion.

| Branch    | Deploys (after CI passes)                                          |
| --------- | ------------------------------------------------------------------ |
| `staging` | Container App `backend-staging` — TestFlight beta testers hit this |
| `master`  | Container App `backend-prod`                                       |

Backend deploys (`deploy-backend.yml`) are single-revision with a smoke test (`/health` must report `version` == deployed SHA) and automatic rollback — which is why **DB migrations must stay backwards-compatible (additive only)**. Mobile builds ship via EAS (`apps/client/eas.json`): `preview` (internal, staging API), `beta` (TestFlight, staging API), `production`. Promotion to `master` and `eas submit` always require explicit user approval.

## Runtime & costs (Azure scale-to-zero)

The backend runs on Azure Container Apps with `minReplicas=0` (see `docs/exploitation/deploiement-azure.md`). Current state (#681): the beta runs on `backend-staging` only; `backend-prod` is **Stopped** (no users, `master` frozen) and the warm-hours workflow is manual-only (a warm replica bills at the active rate, ~45 EUR/month). Restarting prod = Azure REST `.../containerApps/backend-prod/start` **and** deploying an image tag that still exists in ACR. Consequences everyone must know:

- **Any HTTP request wakes a sleeping app** (~60-120s cold start: image pull + migrations + NestJS boot). A cron, probe, or webhook aimed at the API is a cost and a wake — never schedule high-frequency polling against it.
- The client handles this transparently (`apps/client/src/utils/backendWake.ts` + `WakeOverlay`): silent pre-warm at app launch, wake-and-replay on failed requests. Don't add ad-hoc retry/wake logic in features.
- **Never purge an ACR image a revision references** (active or inactive). A revision whose image is gone sits in `ImagePullBackOff`, and in single-revision mode Azure falls back to re-activating it — failing replicas billed for months (#681). The deploy purge (`.github/scripts/acr-purge.sh`) inventories all revisions first and deletes nothing if that query fails; keep it that way.
- The beta budget is tight (~20-25 EUR/month total infra, ADR-0019). Changes to workflows cadence, replicas, or monitoring must state their cost impact (GitHub Actions minutes bill per job, rounded up).

## Architecture

- **Backend:** NestJS modular architecture. Each domain (auth, competitions, clubs, licenses, tracks, etc.) is a module with controllers + services. Services decomposed by responsibility (QueryService for reads, Service for writes).
- **Client:** Feature-based organization under `src/features/`. State: Zustand stores (player, club, competition, performance) + React Query (server cache) + Context (auth, theme only). Navigation: React Navigation native-stack + bottom tabs.
- **Database:** Prisma 7 + PostgreSQL 15. Schema split in `prisma/schema/` by domain. Migrations auto-run on Docker container start.
- **ADRs:** All architectural decisions documented in `docs/adr/` (18 ADRs).

## Conventions

- **TypeScript strict** everywhere (`noUnusedLocals`, `noImplicitReturns`, `strict: true`)
- **No `any`** — eslint enforces `@typescript-eslint/no-explicit-any` as error
- **Tests required** — coverage thresholds enforced per module (auth 94%, global 65%). Mutation testing (Stryker) on critical modules.
- **Commits:** conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `perf:`, `security:`)
- **Language:** code, comments, commits and PRs in English; `docs/exploitation/`, `docs/adr/` and user-facing copy in French
- **PR « Pour les testeurs » section:** every PR with a user-visible change fills `## Pour les testeurs` (template) in **French, for a tester**: what changes, where, what to check. It becomes the TestFlight "What to Test" and Play release notes of the next beta (`generate-changelog --format testers`). Leave it empty or « Rien » for CI/refactor/infra PRs
- **Prisma queries:** Always use `select` over `include` when possible. Add `take` to unbounded queries. Index frequently queried columns.
- **External services:** Always wrap in circuit breaker (opossum) + timeout (`withTimeout` utility). Graceful degradation required.

## Issue tracking (mandatory)

GitHub issues are the single source of truth for work. Full conventions (titles, description sections, types, labels, milestones, relations, Project): **`docs/guides/gestion-des-issues.md`** — follow it whenever you create, edit or close an issue.

- **Code → issue.** Every PR references at least one issue. No issue yet → create it first, after searching for duplicates. User-visible change → `Refs #N` (card goes « Merged » on merge, « In Beta » when develop is promoted to staging; close the issue by hand once validated on the beta). No visible effect (CI, infra, docs, refactor) → `Closes #N`.
- **Project status follows the work** (Todo → In Progress → In Review → Merged → In Beta → Done): `.github/workflows/project-status.yml` moves cards from PR/issue events; work started without a PR (investigation, device test) is moved to « In Progress » by hand (`.github/scripts/project-status.sh`).
- **Discoveries → issue.** A bug, debt, security/RGPD gap, flaky test or stale doc found while doing something else is never fixed silently nor left in the chat: open an issue (or comment on the existing one) with evidence (`file:line`, PR, output), and mention it in your final report.
- **Every open issue** has an issue type (Bug / Feature / Task, or Epic for a theme), exactly one priority label (`P0`…`P3`) or `icebox`, area labels, a milestone (unless `icebox`), its epic as parent when it belongs to a theme, and sits in the « FFD Connect — Roadmap » Project.
- **Closing** always sets `state_reason` and a one-line comment citing the PR or the reason.
- Issues are public: no secret names, internal costs or personal data.

## Sensitive areas

- `src/auth/` — Security-critical. 94% coverage threshold. Tokens hashed with SHA-256 in DB.
- `src/auth/account-status.ts` + `JwtStrategy` — every authenticated request re-reads the account status (disabled user, or `CLUB` account of a disabled club → 401). An e2e that boots the real `JwtStrategy` with a hand-written Prisma mock must mock `user.findUnique` for that lookup.
- `src/payment/` — HelloAsso webhooks. DTO validation required on all endpoints.
- `src/main.ts` — Swagger hidden in production. CORS_ORIGINS mandatory in production (fatal exit).
- `prisma/schema/` — After schema changes: run `prisma migrate dev`, verify indexes, update Swagger via `pnpm api:sync`.

## What NOT to do

- Don't expose Swagger UI in production
- Don't store tokens in plaintext in the database
- Don't add unbounded `findMany()` without `take`
- Don't use `process.env` directly — use `ConfigService` (NestJS)
- Don't add React Context for new state — use Zustand stores
- Don't skip pre-commit hooks (`--no-verify`)
- Don't add new API calls to `BackendService.ts` — use domain-specific modules in `services/api/` (TrackApi, CareerApi, LicenseApi, NotificationApi, HealthApi). New endpoints should use the generated OpenAPI client (`src/api/generated/`) when available; manual httpGet/httpPost only as fallback.
- Don't inline Prisma `select` objects — use shared constants from `src/utils/prisma-selects.ts` (userRolesClubSelect, userNameSelect, idOnlySelect, etc.)
- Don't compare user.role directly in the backend — use hasRole / withRole / withActiveRole from src/auth/roles.ts (multi-profile, lot 1c)
- Don't schedule high-frequency crons/probes against the API — every request wakes a scale-to-zero app (cost + churn); see "Runtime & costs"

## Subagent routing (.claude/agents/)

The project ships a full agent team. Delegate to them via the Agent tool — they carry their domain's conventions in their prompt and keep noise out of the main context. Reviewers, architect and cost-manager are read-only by construction.

| Request looks like…                                 | Delegate to                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Backend endpoint/service/module, Prisma migration   | `backend-dev`                                                                |
| Mobile screen, feature, store, API integration      | `client-dev`                                                                 |
| Admin back-office screen (apps/admin)               | `client-dev`                                                                 |
| Terraform, workflows, Docker, cloud cost change     | `infra-azure` (+ `cost-manager` to price it)                                 |
| Review my diff before push                          | `code-reviewer` (+ `security-reviewer` if auth/payment/main.ts/RGPD touched) |
| Run the tests / verify this change                  | `test-verifier`                                                              |
| Prod/staging error, Sentry issue, in-app bug report | `maintenance`                                                                |
| Structural design choice, "should we…"              | `architect`                                                                  |
| What to build, feature scoping, user stories        | `product-owner`                                                              |
| Backlog, status report, GitHub issues/Project       | `project-manager`                                                            |
| Promote/release/EAS build/TestFlight                | `release-manager`                                                            |
| E2E scenarios, exploratory QA, regression tests     | `qa-tester`                                                                  |
| ADR, runbook, docs update                           | `docs-scribe`                                                                |

For a substantial change, the default pipeline is: implement (dev agent) → `test-verifier` → `code-reviewer` + `security-reviewer` in parallel → push.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool as your FIRST action. Skills live on the developer's machine and may be absent in remote/CI sessions — when a routed skill is unavailable, fall back to the matching subagent above.

- Product ideas, "is this worth building", brainstorming → office-hours (fallback: `product-owner`)
- Bugs, errors, "why is this broken", 500 errors → investigate (fallback: `maintenance`)
- Ship, deploy, push, create PR → ship (fallback: `release-manager`)
- QA, test the site, find bugs → qa (fallback: `qa-tester`)
- Code review, check my diff → review (fallback: `code-reviewer`)
- Update docs after shipping → document-release (fallback: `docs-scribe`)
- Weekly retro → retro
- Design system, brand → design-consultation
- Visual audit, design polish → design-review
- Architecture review → plan-eng-review (fallback: `architect`)
- Save progress, checkpoint, resume → checkpoint
- Code quality, health check → health (fallback: `code-reviewer`)
