# ADR-0016: CI Tiered Execution Strategy

**Date**: 2026-04-05
**Status**: accepted
**Deciders**: Gabin Simond

## Context

The CI pipeline ran all 7 jobs (backend tests, client tests, Playwright E2E, Stryker mutation, audit, build-check, typecheck) on every event — both PR creation and post-merge push. This caused the same code to be fully validated 2-4 times across the flow: feature PR → merge to develop → PR to staging → merge to staging. Stryker alone takes 15-30 min, Playwright ~4 min, and the full suite ~20 min total. This slowed feedback loops and consumed unnecessary CI minutes.

## Decision

Adopt a tiered CI execution strategy based on event type and target branch:

### Tier 1 — Core validation (push + merge_group: always; PR: if paths changed)

- **Backend Tests & Lint**: unit, integration, e2e tests + lint (skipped on PR if only client changed)
- **Backend Build & Swagger**: compile + swagger freshness check (parallel with tests)
- **Client Tests & Lint**: unit tests + lint + coverage (skipped on PR if only backend changed)

### Tier 2 — PR-only (gate before merge)

- **Playwright E2E**: web E2E tests via Expo web build
- **Stryker Mutation Testing**: mutation score validation on critical modules
- **Audit Dependencies**: security vulnerability check
- **Build Check**: formatting, typecheck, quality audit

### Tier 3 — Production gate (PR + master push + hotfix push)

- Audit Dependencies and Build Check also run on push to `master` and `hotfix/**` branches as a final safety net before production.

### Performance optimizations applied alongside

| Optimization                                                    | Target           | Impact                                                                                      |
| --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------- |
| Stryker `incremental: true` + CI cache                          | Mutation testing | 2-5x faster on subsequent runs                                                              |
| Playwright browser caching (`actions/cache@v4`)                 | E2E tests        | ~30-60s saved per run                                                                       |
| Stryker concurrency auto-detect                                 | Mutation testing | Adapts to CI runner (2-core) vs local dev                                                   |
| `ObjectLiteral` mutation exclusion                              | Mutation testing | Fewer low-value mutants                                                                     |
| Stryker 3-shard matrix (auth-utils, competitions-clubs, common) | Mutation testing | ~25 min → ~10 min (wall clock), trades full-codebase coverage for domain-scoped parallelism |
| Stryker --since (shard skip on PR)                              | Mutation testing | Skips entire shard when no shard files changed in PR diff                                   |
| Nightly full mutation (`mutation-nightly.yml`)                  | Mutation testing | Full-codebase score + cache warming, compensates for --since skips                          |
| Landing path filter                                             | Lint & Format    | Skips landing lint on PRs not touching `apps/landing/`                                      |

## Alternatives Considered

### Alternative 1: Path-based filtering (only run backend CI when backend/ changes)

- **Pros**: Even fewer CI runs, very targeted
- **Cons**: Risk of missing cross-app breakage (shared types, Prisma schema changes affecting client)
- **Why not**: Monorepo with shared packages makes path isolation fragile

### Alternative 2: Keep full CI on every event

- **Pros**: Maximum safety, always validated
- **Cons**: 2-4x redundant runs, long feedback loops, high CI cost
- **Why not**: PR validation already provides the full gate — post-merge re-runs add cost without safety

### Alternative 3: Skip CI on push entirely (only run on PRs)

- **Pros**: Minimal CI usage
- **Cons**: Direct pushes to master/hotfix would be unvalidated
- **Why not**: Production branches must always have a safety net

## Consequences

### Positive

- Post-merge push to develop/staging drops from ~20 min / 7 jobs to ~3 min / 2 jobs
- Stryker incremental mode cuts mutation testing time by 2-5x on repeated PR pushes
- Playwright browser cache saves network time on every E2E run
- CI minutes consumption reduced significantly across the merge flow

### Negative

- Post-merge pushes on develop/staging skip typecheck and formatting — relies on PR gate having caught issues
- If branch protection is bypassed (admin merge without PR), heavy checks are skipped on develop/staging

### Risks

- **Mitigation for bypass risk**: master and hotfix branches always run the full suite, regardless of event type
- **Mitigation for stale incremental cache**: Stryker cache key includes source hash — cache misses force a full re-run

## Amendment — 2026-04-05: Path Filtering Introduced

### What changed

Path-based filtering (originally rejected as "too fragile" in Alternative 1) was introduced with safeguards that address the original concerns:

1. **`dorny/paths-filter@v3`** detects which apps changed on PRs
2. **Cross-package awareness**: filters include `packages/shared/**`, `packages/jest-config/**`, `packages/eslint-config/**`, and `pnpm-lock.yaml` — a change in any shared package triggers both backend and client jobs
3. **Prisma paths explicit**: `apps/backend/prisma/schema/**` and `apps/backend/prisma/migrations/**` are listed explicitly in the backend filter for visibility (already covered by `apps/backend/**`)
4. **Push and merge_group bypass**: path filtering only applies to PRs — push to master/develop/staging/hotfix and merge queue always run all jobs
5. **`ci-success` gate job**: a single required check that treats `skipped` as success and `failure`/`cancelled` as failure, so path-filtered jobs don't block PRs

### Why the original rejection no longer applies

The original concern was that "monorepo with shared packages makes path isolation fragile". The safeguards above — especially the shared package inclusion and push/merge_group bypass — make the trade-off acceptable: PRs get fast feedback when changes are app-scoped, while protected branches always get full validation.

### Backend split

The monolithic `backend` job was split into `backend-test` (DB + tests, 12 min) and `backend-build` (compile + swagger, 8 min) running in parallel. `typecheck` was decoupled from backend (only needs `prisma generate`, not the full build artifact).

### Stryker sharding

Mutation testing was split into 3 parallel matrix shards by domain (auth-utils, competitions-clubs, common). Each shard mutates ~5 files, has its own incremental cache, and uploads a separate report.

**Trade-off**: each shard only validates its own threshold independently — a regression in one domain cannot be offset by a surplus in another. This is stricter per-domain but no longer produces a single aggregate mutation score. For a full-codebase score, revert to a single job (at the cost of ~25 min wall time).

### Stryker --since (shard skip on PRs)

On pull requests, each mutation shard checks whether any of its target files were modified in the PR diff (via `gh pr diff --name-only`). If none were modified, the shard exits immediately after checkout — no pnpm install, no Prisma generate, no Stryker run. On merge queue events, all shards run unconditionally.

**Trade-off**: a change in a _test file_ or a _shared dependency_ could introduce a mutation regression in an unmodified source file that the PR shard would skip. The nightly full-coverage run mitigates this.

### Nightly full mutation run

A separate `mutation-nightly.yml` workflow runs the complete (non-sharded) mutation suite against `develop` every night at 02:00 UTC. _Amended 2026-10-04: moved to weekly (Sundays 02:00 UTC) to cut ~950 Actions min/month on a private repo — regressions now surface within a week._ This provides the full-codebase aggregate score that sharding and --since sacrifice for speed. It also warms the incremental cache for the next day's PR runs.

### Landing path filter

The `landing` app was added to the `dorny/paths-filter` change detection. On PRs where `apps/landing/**` was not modified, the `Lint landing` step in `lint-format` is skipped. Format check and quality audit still run unconditionally.

### Branch protection

With the matrix, GitHub displays multiple checks (`Mutation (auth-utils)`, `Mutation (competitions-clubs)`, etc.). **Configure only `CI Success` as the required status check** in branch protection — it aggregates all jobs including all matrix shards. Do not list individual mutation checks as required.
