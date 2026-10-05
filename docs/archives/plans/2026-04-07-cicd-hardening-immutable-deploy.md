# CI/CD Hardening & Immutable Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CI operational bugs, harden the deploy pipeline, and migrate to immutable container deploys via AWS ECR.

**Architecture:** Phase 1 modifies existing GitHub Actions workflows (ci.yml, deploy-backend.yml, mutation-nightly.yml) and adds CODEOWNERS. Phase 2 adds Terraform resources (ECR, OIDC, IAM), a new CI build-image job, and rewrites the deploy workflow to pull pre-built images instead of building on the server.

**Tech Stack:** GitHub Actions, Terraform (AWS provider ~5.0), Docker, AWS ECR, AWS IAM OIDC, Slack webhooks

**Spec:** `docs/superpowers/specs/2026-04-07-cicd-hardening-immutable-deploy-design.md`

---

## File Structure

### Phase 1 — Modified files

| File                                     | Responsibility                                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`               | Remove paths-ignore, add Slack notification on ci-success failure                                     |
| `.github/workflows/deploy-backend.yml`   | Persistent rollback, Redis hard fail prod, health wait loop, migration pre-check, Slack notifications |
| `.github/workflows/mutation-nightly.yml` | Slack notification on failure                                                                         |
| `.github/CODEOWNERS`                     | **New** — enforce review on sensitive paths                                                           |

### Phase 2 — Modified/new files

| File                                   | Responsibility                                             |
| -------------------------------------- | ---------------------------------------------------------- |
| `infra/terraform/ecr.tf`               | **New** — ECR repository + lifecycle policy                |
| `infra/terraform/ci-iam.tf`            | **New** — GitHub OIDC provider + CI IAM role for ECR push  |
| `infra/terraform/compute.tf`           | Add ECR pull IAM policy to EC2 role                        |
| `infra/terraform/outputs.tf`           | Add ECR URL + CI role ARN outputs                          |
| `infra/terraform/variables.tf`         | Add `github_org` variable for OIDC condition               |
| `.github/workflows/ci.yml`             | Add build-image job, update ci-success gate                |
| `.github/workflows/deploy-backend.yml` | Full rewrite — single reusable workflow, image pull deploy |
| `docker-compose.yml`                   | Backend service: `build:` → `image:` with variable         |
| `docker-compose.staging.yml`           | Remove build overrides                                     |
| `docker-compose.production.yml`        | Remove build overrides                                     |

---

## Phase 1 — Quick Wins

### Task 1: Remove `paths-ignore` from CI triggers

**Files:**

- Modify: `.github/workflows/ci.yml:1-11`

- [ ] **Step 1: Remove paths-ignore from on: block**

In `.github/workflows/ci.yml`, replace the `on:` block:

```yaml
on:
  push:
    branches: [master, develop, staging, 'hotfix/**']
    paths-ignore: ['docs/**', 'LICENSE']
  pull_request:
    branches: [master, develop, staging]
    paths-ignore: ['docs/**', 'LICENSE']
  merge_group:
    types: [checks_requested]
```

With:

```yaml
on:
  push:
    branches: [master, develop, staging, 'hotfix/**']
  pull_request:
    branches: [master, develop, staging]
  merge_group:
    types: [checks_requested]
```

- [ ] **Step 2: Verify ci-success always runs**

Confirm the `ci-success` job has `if: always()` (it does — line 535). No change needed. Docs-only PRs will trigger the workflow, all heavy jobs skip via dorny/paths-filter conditions, and `ci-success` reports success.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "fix(ci): remove paths-ignore to prevent CI Success check from being skipped on docs-only PRs"
```

---

### Task 2: Persistent rollback SHA storage

**Files:**

- Modify: `.github/workflows/deploy-backend.yml:86-105` (staging deploy)
- Modify: `.github/workflows/deploy-backend.yml:155-169` (staging rollback)
- Modify: `.github/workflows/deploy-backend.yml:197-208` (production deploy)
- Modify: `.github/workflows/deploy-backend.yml:254-271` (production rollback)

- [ ] **Step 1: Update staging deploy script**

In `.github/workflows/deploy-backend.yml`, in the `deploy-staging` job, replace the SSH deploy script:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.STAGING_APP_PATH }}
  git rev-parse HEAD > /tmp/previous-deploy-sha
  echo "Previous SHA: $(cat /tmp/previous-deploy-sha)"
  echo "Deploying exact SHA: $DEPLOY_SHA"
  git fetch origin
  git checkout "$DEPLOY_SHA"
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full pull
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d --build
  sleep 5
  docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
  echo "Deployed SHA: $(git rev-parse HEAD)"
```

With:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.STAGING_APP_PATH }}
  mkdir -p ~/.deploy
  cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
  echo "$DEPLOY_SHA" > ~/.deploy/current-sha
  echo "Previous SHA: $(cat ~/.deploy/previous-sha 2>/dev/null || echo 'none')"
  echo "Deploying exact SHA: $DEPLOY_SHA"
  git fetch origin
  git checkout "$DEPLOY_SHA"
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full pull
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d --build
  docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
  echo "Deployed SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 2: Update staging rollback script**

Replace the staging rollback script:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.STAGING_APP_PATH }}
  PREV_SHA=$(cat /tmp/previous-deploy-sha 2>/dev/null || echo "")
  if [ -z "$PREV_SHA" ]; then
    echo "::error::No previous SHA found — cannot auto-rollback"
    exit 1
  fi
  echo "Rolling back to previous SHA: $PREV_SHA"
  git checkout "$PREV_SHA"
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d --build
  sleep 5
  echo "Rollback complete. Current SHA: $(git rev-parse HEAD)"
```

With:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.STAGING_APP_PATH }}
  PREV_SHA=$(cat ~/.deploy/previous-sha 2>/dev/null || echo "")
  if [ -z "$PREV_SHA" ]; then
    echo "::error::No previous SHA found — cannot auto-rollback"
    exit 1
  fi
  echo "Rolling back to previous SHA: $PREV_SHA"
  git checkout "$PREV_SHA"
  docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d --build
  echo "$PREV_SHA" > ~/.deploy/current-sha
  echo "Rollback complete. Current SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 3: Update production deploy script**

Same changes as step 1, applied to the `deploy-production` job. Replace:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.PROD_APP_PATH }}
  git rev-parse HEAD > /tmp/previous-deploy-sha
  echo "Previous SHA: $(cat /tmp/previous-deploy-sha)"
  echo "Deploying exact SHA: $DEPLOY_SHA"
  git fetch origin
  git checkout "$DEPLOY_SHA"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full pull
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full up -d --build
  sleep 5
  docker compose -f docker-compose.yml -f docker-compose.production.yml ps
  echo "Deployed SHA: $(git rev-parse HEAD)"
```

With:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.PROD_APP_PATH }}
  mkdir -p ~/.deploy
  cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
  echo "$DEPLOY_SHA" > ~/.deploy/current-sha
  echo "Previous SHA: $(cat ~/.deploy/previous-sha 2>/dev/null || echo 'none')"
  echo "Deploying exact SHA: $DEPLOY_SHA"
  git fetch origin
  git checkout "$DEPLOY_SHA"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full pull
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full up -d --build
  docker compose -f docker-compose.yml -f docker-compose.production.yml ps
  echo "Deployed SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 4: Update production rollback script**

Same as step 2, applied to the `deploy-production` rollback. Replace:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.PROD_APP_PATH }}
  PREV_SHA=$(cat /tmp/previous-deploy-sha 2>/dev/null || echo "")
  if [ -z "$PREV_SHA" ]; then
    echo "::error::No previous SHA found — cannot auto-rollback"
    exit 1
  fi
  echo "Rolling back to previous SHA: $PREV_SHA"
  git checkout "$PREV_SHA"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full up -d --build
  sleep 5
  echo "Rollback complete. Current SHA: $(git rev-parse HEAD)"
```

With:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.PROD_APP_PATH }}
  PREV_SHA=$(cat ~/.deploy/previous-sha 2>/dev/null || echo "")
  if [ -z "$PREV_SHA" ]; then
    echo "::error::No previous SHA found — cannot auto-rollback"
    exit 1
  fi
  echo "Rolling back to previous SHA: $PREV_SHA"
  git checkout "$PREV_SHA"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full up -d --build
  echo "$PREV_SHA" > ~/.deploy/current-sha
  echo "Rollback complete. Current SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-backend.yml
git commit -m "fix(deploy): persist rollback SHA in ~/.deploy/ instead of /tmp (survives reboot)"
```

---

### Task 3: Redis hard fail in production smoke test

**Files:**

- Modify: `.github/workflows/deploy-backend.yml` (production smoke test step, ~line 210-252)

- [ ] **Step 1: Update production smoke test**

In the `deploy-production` job, replace the Redis check section of the smoke test:

```bash
          # 4. Verify Redis is connected
          REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status')
          if [ "$REDIS_STATUS" != "ok" ]; then
            echo "::warning::Redis health check failed (non-blocking): $(echo "$BODY" | jq -r '.redis.error // "unknown"')"
          fi

          echo "Smoke test passed: status=$STATUS db=$DB_STATUS redis=$REDIS_STATUS"
```

With:

```bash
          # 4. Verify Redis is connected
          # HARD FAIL in production — Redis down disables IpBlacklistMiddleware,
          # allowing blacklisted IPs through (security risk).
          REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status')
          if [ "$REDIS_STATUS" != "ok" ]; then
            echo "::error::Redis is DOWN — IP blacklist middleware disabled (security risk)"
            exit 1
          fi

          echo "Smoke test passed: status=$STATUS db=$DB_STATUS redis=$REDIS_STATUS"
```

- [ ] **Step 2: Verify staging smoke test is unchanged**

Confirm the staging smoke test still has the `::warning::` (non-blocking) behavior for Redis. No change needed — it already uses `echo "::warning::"` without `exit 1`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-backend.yml
git commit -m "security(deploy): make Redis a hard fail in production smoke test (IP blacklist dependency)"
```

---

### Task 4: Robust health check (replace sleep 5)

**Files:**

- Modify: `.github/workflows/deploy-backend.yml` (staging + production smoke test steps)

- [ ] **Step 1: Update staging smoke test with wait loop**

In the `deploy-staging` job, replace the entire smoke test step:

```yaml
- name: Smoke test (health + DB + Redis + functional)
  id: health
  run: |
    HEALTH_URL="https://api-staging.ffd-connect.fr/health"

    # 1. Wait for process to respond
    for i in 1 2 3 4 5; do
      BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
      if [ -n "$BODY" ]; then
        break
      fi
      echo "Attempt $i: not responding, retrying in 10s..."
      sleep 10
    done
```

With:

```yaml
- name: Smoke test (health + DB + Redis + functional)
  id: health
  run: |
    HEALTH_URL="https://api-staging.ffd-connect.fr/health"

    # 1. Wait for container to become responsive (max 60s)
    echo "Waiting for container to respond..."
    for i in $(seq 1 12); do
      if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo "Container responding after ~$((i * 5))s"
        break
      fi
      if [ "$i" -eq 12 ]; then
        echo "Container not responding after 60s"
        exit 1
      fi
      echo "  attempt $i/12 — retrying in 5s..."
      sleep 5
    done

    # 2. Functional health check
    BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
```

Also remove the old "not reachable after 5 attempts" check that follows, since the wait loop above now handles it. Replace:

```bash
          if [ -z "$BODY" ]; then
            echo "Health endpoint not reachable after 5 attempts"
            exit 1
          fi
```

With:

```bash
          if [ -z "$BODY" ]; then
            echo "Health endpoint returned empty body"
            exit 1
          fi
```

- [ ] **Step 2: Update production smoke test with same wait loop**

Apply the identical wait loop change to the `deploy-production` smoke test, using `HEALTH_URL="https://api.ffd-connect.fr/health"`.

Replace the production smoke test opening:

```yaml
- name: Smoke test (health + DB + Redis + functional)
  id: health
  run: |
    HEALTH_URL="https://api.ffd-connect.fr/health"

    # 1. Wait for process to respond
    for i in 1 2 3 4 5; do
      BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
      if [ -n "$BODY" ]; then
        break
      fi
      echo "Attempt $i: not responding, retrying in 10s..."
      sleep 10
    done

    if [ -z "$BODY" ]; then
      echo "Health endpoint not reachable after 5 attempts"
      exit 1
    fi
```

With:

```yaml
- name: Smoke test (health + DB + Redis + functional)
  id: health
  run: |
    HEALTH_URL="https://api.ffd-connect.fr/health"

    # 1. Wait for container to become responsive (max 60s)
    echo "Waiting for container to respond..."
    for i in $(seq 1 12); do
      if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
        echo "Container responding after ~$((i * 5))s"
        break
      fi
      if [ "$i" -eq 12 ]; then
        echo "Container not responding after 60s"
        exit 1
      fi
      echo "  attempt $i/12 — retrying in 5s..."
      sleep 5
    done

    # 2. Functional health check
    BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")

    if [ -z "$BODY" ]; then
      echo "Health endpoint returned empty body"
      exit 1
    fi
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-backend.yml
git commit -m "fix(deploy): replace sleep 5 with responsive wait loop (max 60s) in smoke tests"
```

---

### Task 5: Slack notifications on failure

**Files:**

- Modify: `.github/workflows/deploy-backend.yml` (staging + production deploy failure)
- Modify: `.github/workflows/ci.yml` (ci-success failure on protected branches)
- Modify: `.github/workflows/mutation-nightly.yml` (nightly failure)

- [ ] **Step 1: Add Slack notification to staging deploy**

In `.github/workflows/deploy-backend.yml`, after the staging rollback step, add a new step:

```yaml
- name: Notify deploy failure (Slack)
  if: failure() && env.SLACK_WEBHOOK_URL != ''
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    curl -sf -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\":rotating_light: *Deploy failed* on \`staging\`\nSHA: \`${DEPLOY_SHA:0:7}\`\nRun: <${RUN_URL}|View logs>\nAuto-rollback attempted.\"}" \
      || echo "Slack notification failed (non-blocking)"
```

- [ ] **Step 2: Add Slack notification to production deploy**

Add the same step after the production rollback step, changing `staging` to `production` in the message:

```yaml
- name: Notify deploy failure (Slack)
  if: failure() && env.SLACK_WEBHOOK_URL != ''
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    curl -sf -X POST "$SLACK_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\":rotating_light: *Deploy failed* on \`production\`\nSHA: \`${DEPLOY_SHA:0:7}\`\nRun: <${RUN_URL}|View logs>\nAuto-rollback attempted.\"}" \
      || echo "Slack notification failed (non-blocking)"
```

- [ ] **Step 3: Replace CI failure echo with Slack notification**

In `.github/workflows/ci.yml`, replace the `Notify CI failure on protected branch` step:

```yaml
- name: Notify CI failure on protected branch
  if: failure() && (github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/heads/hotfix/'))
  env:
    BRANCH: ${{ github.ref_name }}
    SHA: ${{ github.sha }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    echo "::error::CI failed on protected branch $BRANCH ($SHA)"
    echo "Run: $RUN_URL"
```

With:

```yaml
- name: Notify CI failure on protected branch
  if: failure() && (github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/heads/hotfix/'))
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    BRANCH: ${{ github.ref_name }}
    SHA: ${{ github.sha }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    echo "::error::CI failed on protected branch $BRANCH ($SHA)"
    echo "Run: $RUN_URL"
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
      curl -sf -X POST "$SLACK_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"text\":\":x: *CI failed* on \`${BRANCH}\`\nSHA: \`${SHA:0:7}\`\nRun: <${RUN_URL}|View logs>\"}" \
        || echo "Slack notification failed (non-blocking)"
    fi
```

- [ ] **Step 4: Replace nightly mutation echo with Slack notification**

In `.github/workflows/mutation-nightly.yml`, replace the `Notify nightly failure` step:

```yaml
- name: Notify nightly failure
  if: failure()
  env:
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    echo "::error::Nightly mutation testing failed — mutation score may have regressed"
    echo "Run: $RUN_URL"
```

With:

```yaml
- name: Notify nightly failure
  if: failure()
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
  run: |
    echo "::error::Nightly mutation testing failed — mutation score may have regressed"
    echo "Run: $RUN_URL"
    if [ -n "$SLACK_WEBHOOK_URL" ]; then
      curl -sf -X POST "$SLACK_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"text\":\":warning: *Nightly mutation testing failed*\nMutation score may have regressed.\nRun: <${RUN_URL}|View logs>\"}" \
        || echo "Slack notification failed (non-blocking)"
    fi
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-backend.yml .github/workflows/ci.yml .github/workflows/mutation-nightly.yml
git commit -m "feat(ci): add Slack notifications on deploy/CI/mutation failure"
```

---

### Task 6: Explicit migration pre-check in deploy

**Files:**

- Modify: `.github/workflows/deploy-backend.yml` (staging + production deploy)

**Context:** The `docker-entrypoint.sh` already runs `prisma migrate deploy` at container start. This task adds an explicit pre-check step that runs migrations BEFORE `docker compose up`. If migration fails, deploy aborts before swapping containers. The migration runs twice (idempotent) — once as pre-check, once in the entrypoint.

- [ ] **Step 1: Add migration pre-check to staging deploy**

In the `deploy-staging` job, add a new step **between** the SSH deploy step and the smoke test step:

```yaml
- name: Run database migrations
  uses: appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1
  with:
    host: ${{ secrets.STAGING_SSH_HOST }}
    username: ${{ secrets.STAGING_SSH_USER }}
    key: ${{ secrets.STAGING_SSH_KEY }}
    # Run migrations using the newly checked-out code BEFORE docker compose up.
    # This is a pre-check: if migration fails, deploy aborts before container swap.
    # docker-entrypoint.sh also runs migrations (idempotent safety net).
    # IMPORTANT: Rollback does NOT reverse migrations.
    # Migrations must be backward-compatible (expand-then-contract pattern).
    script: |
      set -euo pipefail
      cd ${{ secrets.STAGING_APP_PATH }}
      echo "Running migration pre-check..."
      docker compose -f docker-compose.yml -f docker-compose.staging.yml \
        run --rm backend npx prisma migrate deploy
      echo "Migrations applied successfully"
```

Then update the staging deploy SSH script to run `docker compose up` **after** the migration step. Move the `docker compose up` part out of the deploy SSH step and into a separate step (or reorder — the migration step must come after `git checkout` but before `up`).

Actually, simpler approach: keep the deploy script as-is (it does `git checkout` + `pull` + `up`), and insert the migration pre-check **before** the deploy step but **after** a checkout step. Since the deploy script does everything in one SSH session, we need to restructure slightly.

Update the staging deploy SSH script to split into: checkout + migration + up:

```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1
  env:
    DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}
  with:
    host: ${{ secrets.STAGING_SSH_HOST }}
    username: ${{ secrets.STAGING_SSH_USER }}
    key: ${{ secrets.STAGING_SSH_KEY }}
    envs: DEPLOY_SHA
    script: |
      set -euo pipefail
      cd ${{ secrets.STAGING_APP_PATH }}
      mkdir -p ~/.deploy
      cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
      echo "$DEPLOY_SHA" > ~/.deploy/current-sha
      echo "Previous SHA: $(cat ~/.deploy/previous-sha 2>/dev/null || echo 'none')"
      echo "Deploying exact SHA: $DEPLOY_SHA"
      git fetch origin
      git checkout "$DEPLOY_SHA"
      docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full pull

      # Pre-check: run migrations before bringing up new containers.
      # If this fails, deploy aborts — old containers are still running.
      # docker-entrypoint.sh also runs migrations (idempotent safety net).
      # IMPORTANT: Rollback does NOT reverse migrations.
      # Migrations must be backward-compatible (expand-then-contract).
      echo "Running migration pre-check..."
      docker compose -f docker-compose.yml -f docker-compose.staging.yml \
        run --rm backend npx prisma migrate deploy
      echo "Migrations OK"

      docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d --build
      docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
      echo "Deployed SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 2: Add migration pre-check to production deploy**

Same change applied to the `deploy-production` SSH script, using the production compose override:

```yaml
script: |
  set -euo pipefail
  cd ${{ secrets.PROD_APP_PATH }}
  mkdir -p ~/.deploy
  cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
  echo "$DEPLOY_SHA" > ~/.deploy/current-sha
  echo "Previous SHA: $(cat ~/.deploy/previous-sha 2>/dev/null || echo 'none')"
  echo "Deploying exact SHA: $DEPLOY_SHA"
  git fetch origin
  git checkout "$DEPLOY_SHA"
  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full pull

  # Pre-check: run migrations before bringing up new containers.
  # If this fails, deploy aborts — old containers are still running.
  # docker-entrypoint.sh also runs migrations (idempotent safety net).
  # IMPORTANT: Rollback does NOT reverse migrations.
  # Migrations must be backward-compatible (expand-then-contract).
  echo "Running migration pre-check..."
  docker compose -f docker-compose.yml -f docker-compose.production.yml \
    run --rm backend npx prisma migrate deploy
  echo "Migrations OK"

  docker compose -f docker-compose.yml -f docker-compose.production.yml --profile full up -d --build
  docker compose -f docker-compose.yml -f docker-compose.production.yml ps
  echo "Deployed SHA: $(git rev-parse HEAD)"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-backend.yml
git commit -m "feat(deploy): add explicit migration pre-check before container swap (fail-fast)"
```

---

### Task 7: CODEOWNERS

**Files:**

- Create: `.github/CODEOWNERS`

- [ ] **Step 1: Create CODEOWNERS file**

Create `.github/CODEOWNERS`:

```
# Security-critical paths require owner review.
# Prerequisite: Enable "Require review from Code Owners" in branch protection
# settings for develop, staging, and master.

# Auth — 94% coverage threshold, token hashing, guards
apps/backend/src/auth/          @gabin

# Payment — HelloAsso webhooks, DTO validation
apps/backend/src/payment/       @gabin

# Database schema — migrations, indexes, select constants
apps/backend/prisma/schema/     @gabin

# CI/CD pipelines
.github/workflows/              @gabin
.github/actions/                @gabin

# Infrastructure as Code
infra/                          @gabin
```

- [ ] **Step 2: Commit**

```bash
git add .github/CODEOWNERS
git commit -m "security: add CODEOWNERS for auth, payment, prisma, CI, and infra"
```

---

### Task 8: Phase 1 validation

- [ ] **Step 1: Validate CI workflow syntax**

```bash
cd /Users/gabin/Development/FFD-Connect
# Validate YAML syntax (no actionlint needed — just check parse)
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-backend.yml'))"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/mutation-nightly.yml'))"
```

Expected: No errors.

- [ ] **Step 2: Verify CODEOWNERS syntax**

```bash
# Each line should be: path pattern + @user
grep -cE '^[^#]' .github/CODEOWNERS
```

Expected: 6 (one per path rule).

- [ ] **Step 3: Review full diff**

```bash
git diff develop --stat
git diff develop -- .github/
```

Verify only the expected files are changed.

---

## Phase 2 — Immutable Deploy via AWS ECR

### Task 9: Terraform — ECR repository

**Files:**

- Create: `infra/terraform/ecr.tf`

- [ ] **Step 1: Create ECR resource file**

Create `infra/terraform/ecr.tf`:

```hcl
# ============================================
# ECR — Container Registry for immutable deploys
# ============================================
# Images are tagged with the git SHA and pushed by CI.
# EC2 instances pull the exact image validated by CI.
# Tags are IMMUTABLE — a SHA can never be overwritten.

resource "aws_ecr_repository" "backend" {
  name                 = "${var.project}-backend"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.name_prefix}-ecr-backend" }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images, expire older"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
```

- [ ] **Step 2: Validate Terraform syntax**

```bash
cd /Users/gabin/Development/FFD-Connect/infra/terraform
terraform fmt -check ecr.tf
terraform validate
```

Expected: No errors. (`terraform validate` may warn about missing vars — that's OK in isolation.)

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/ecr.tf
git commit -m "feat(infra): add ECR repository for immutable backend images"
```

---

### Task 10: Terraform — GitHub OIDC + CI IAM role

**Files:**

- Create: `infra/terraform/ci-iam.tf`
- Modify: `infra/terraform/variables.tf`

- [ ] **Step 1: Add github_org variable**

In `infra/terraform/variables.tf`, add after the `tags` variable:

```hcl

# ── CI/CD ───────────────────────────────────

variable "github_org" {
  description = "GitHub organization or user owning the repo (for OIDC trust policy)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (for OIDC trust policy)"
  type        = string
  default     = "FFD-Connect"
}
```

- [ ] **Step 2: Create CI IAM file**

Create `infra/terraform/ci-iam.tf`:

```hcl
# ============================================
# CI/CD — GitHub Actions OIDC + IAM Role
# ============================================
# Keyless authentication: GitHub Actions assumes an IAM role via OIDC.
# No static AWS keys stored in GitHub secrets.
# The CI role can push images to ECR. Nothing else.

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub manages their own certificate chain — thumbprint is validated automatically
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]

  tags = { Name = "${local.name_prefix}-github-oidc" }
}

resource "aws_iam_role" "ci" {
  name = "${local.name_prefix}-ci-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Only allow pushes from staging and master branches
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/*"
        }
      }
    }]
  })

  tags = { Name = "${local.name_prefix}-ci-role" }
}

resource "aws_iam_role_policy" "ci_ecr_push" {
  name = "${local.name_prefix}-ci-ecr-push"
  role = aws_iam_role.ci.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = [aws_ecr_repository.backend.arn]
      }
    ]
  })
}
```

- [ ] **Step 3: Validate Terraform syntax**

```bash
cd /Users/gabin/Development/FFD-Connect/infra/terraform
terraform fmt -check ci-iam.tf
terraform validate
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/ci-iam.tf infra/terraform/variables.tf
git commit -m "feat(infra): add GitHub OIDC provider + CI IAM role for ECR push"
```

---

### Task 11: Terraform — EC2 ECR pull policy + outputs

**Files:**

- Modify: `infra/terraform/compute.tf` (add ECR pull policy after line 129)
- Modify: `infra/terraform/outputs.tf`

- [ ] **Step 1: Add ECR pull policy to EC2 role**

In `infra/terraform/compute.tf`, add after the `aws_iam_instance_profile.backend` resource (line 129):

```hcl

# ── ECR pull — deploy pulls pre-built images from ECR ──

resource "aws_iam_role_policy" "ecr_pull" {
  name = "${local.name_prefix}-ecr-pull"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRAuth"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = [aws_ecr_repository.backend.arn]
      }
    ]
  })
}
```

- [ ] **Step 2: Add outputs for ECR and CI role**

In `infra/terraform/outputs.tf`, add at the end:

```hcl

# ── CI/CD Immutable Deploy ──

output "ecr_repository_url" {
  description = "ECR repository URL — set as ECR_REGISTRY in deploy workflow"
  value       = aws_ecr_repository.backend.repository_url
}

output "ci_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — set as AWS_CI_ROLE_ARN secret"
  value       = aws_iam_role.ci.arn
}
```

- [ ] **Step 3: Validate full Terraform**

```bash
cd /Users/gabin/Development/FFD-Connect/infra/terraform
terraform fmt -check .
terraform validate
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/compute.tf infra/terraform/outputs.tf
git commit -m "feat(infra): add EC2 ECR pull policy + ECR/CI outputs"
```

---

### Task 12: CI — build-image job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add build-image job**

In `.github/workflows/ci.yml`, add the following job **before** the `ci-success` job:

```yaml
# ============================================================
# DOCKER IMAGE — build + push to ECR (staging/master push only)
# ============================================================
build-image:
  name: Build & Push Docker Image
  runs-on: ubuntu-latest
  timeout-minutes: 10
  needs: [changes, backend-test, backend-build]
  if: >-
    github.event_name == 'push'
    && (github.ref == 'refs/heads/staging' || github.ref == 'refs/heads/master')
    && needs.changes.outputs.backend == 'true'
    && needs.backend-test.result == 'success'
    && needs.backend-build.result == 'success'

  permissions:
    id-token: write
    contents: read

  steps:
    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
      with:
        persist-credentials: false

    - name: Configure AWS credentials (OIDC)
      uses: aws-actions/configure-aws-credentials@ececac1a45f3b08a01d2dd070d4bfb5b4e2d4321 # v4
      with:
        role-to-assume: ${{ secrets.AWS_CI_ROLE_ARN }}
        aws-region: eu-west-3

    - name: Login to Amazon ECR
      id: ecr-login
      uses: aws-actions/amazon-ecr-login@062b18b96a7aff071d4dc91bc00c4c1a7945b076 # v2

    - name: Build and push image
      env:
        ECR_REGISTRY: ${{ steps.ecr-login.outputs.registry }}
        ECR_REPOSITORY: ffd-connect-backend
        IMAGE_TAG: ${{ github.sha }}
      run: |
        IMAGE="$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"
        echo "Building $IMAGE"
        docker build -t "$IMAGE" -f apps/backend/Dockerfile .
        docker push "$IMAGE"
        echo "Pushed: $IMAGE"
```

Note: The Dockerfile is at `apps/backend/Dockerfile` but the build context is the repo root (`.`) because the Dockerfile copies from root (`COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./`).

- [ ] **Step 2: Add build-image to ci-success gate**

In the `ci-success` job, add `build-image` to the `needs` list:

```yaml
ci-success:
  name: CI Success
  runs-on: ubuntu-latest
  if: always()
  needs:
    - backend-test
    - backend-build
    - client
    - typecheck
    - lint-format
    - audit-dependencies
    - playwright-e2e
    - mutation
    - build-image
```

And add the result to the `RESULTS` env var:

```yaml
env:
  RESULTS: |
    backend-test=${{ needs.backend-test.result }}
    backend-build=${{ needs.backend-build.result }}
    client=${{ needs.client.result }}
    typecheck=${{ needs.typecheck.result }}
    lint-format=${{ needs.lint-format.result }}
    audit-dependencies=${{ needs.audit-dependencies.result }}
    playwright-e2e=${{ needs.playwright-e2e.result }}
    mutation=${{ needs.mutation.result }}
    build-image=${{ needs.build-image.result }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): add build-image job to build and push Docker image to ECR on staging/master"
```

---

### Task 13: Docker Compose — switch to image-based backend

**Files:**

- Modify: `docker-compose.yml`
- Modify: `docker-compose.staging.yml`
- Modify: `docker-compose.production.yml`

- [ ] **Step 1: Update docker-compose.yml backend service**

In `docker-compose.yml`, replace the backend service `build` block with `image`:

```yaml
backend:
  profiles: ['full']
  build:
    context: .
    dockerfile: apps/backend/Dockerfile
```

With:

```yaml
backend:
  profiles: ['full']
  # For immutable deploys: IMAGE_TAG is set by the deploy script.
  # For local dev: fall back to building from source.
  image: ${ECR_REGISTRY:-local}/ffd-connect-backend:${IMAGE_TAG:-latest}
  build:
    context: .
    dockerfile: apps/backend/Dockerfile
```

When `ECR_REGISTRY` and `IMAGE_TAG` are set (deploy), `docker compose pull` uses the image. When they're not set (local dev), `docker compose up --build` builds from source as before. Docker Compose uses `image` for `pull` and `build` for `--build`.

- [ ] **Step 2: Verify staging overlay**

Check `docker-compose.staging.yml` — it does NOT override `build:` for the backend service. No change needed.

- [ ] **Step 3: Verify production overlay**

Check `docker-compose.production.yml` — it does NOT override `build:` for the backend service. No change needed.

- [ ] **Step 4: Test local dev still works**

```bash
cd /Users/gabin/Development/FFD-Connect
# Should still build from source (no ECR_REGISTRY set)
docker compose --profile infra up -d
docker compose --profile full up -d --build backend
docker compose ps
# Verify backend is running
curl -sf http://localhost:3000/health | jq .
docker compose --profile full down
docker compose --profile infra down
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(deploy): support both image pull (deploy) and local build (dev) in docker-compose"
```

---

### Task 14: Rewrite deploy-backend.yml for immutable deploy

**Files:**

- Modify: `.github/workflows/deploy-backend.yml`

This is the full rewrite. The gate job stays. The two deploy jobs are replaced by a single parameterized approach using `if` conditions (matrix doesn't work well with secrets).

- [ ] **Step 1: Rewrite deploy-staging job for image pull**

Replace the entire `deploy-staging` job with:

```yaml
# ============================================================
# DEPLOY STAGING — pull pre-built image from ECR
# ============================================================
deploy-staging:
  name: Deploy to Staging
  needs: [gate]
  if: needs.gate.outputs.backend_changed == 'true' && needs.gate.outputs.environment == 'staging'
  runs-on: ubuntu-latest
  environment:
    name: staging
    url: https://api-staging.ffd-connect.fr

  steps:
    - name: Deploy via SSH
      uses: appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1
      env:
        DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}
        ECR_REGISTRY: ${{ secrets.ECR_REGISTRY }}
      with:
        host: ${{ secrets.STAGING_SSH_HOST }}
        username: ${{ secrets.STAGING_SSH_USER }}
        key: ${{ secrets.STAGING_SSH_KEY }}
        envs: DEPLOY_SHA,ECR_REGISTRY
        script: |
          set -euo pipefail
          cd ${{ secrets.STAGING_APP_PATH }}

          # 1. Persist SHA for rollback
          mkdir -p ~/.deploy
          cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
          echo "$DEPLOY_SHA" > ~/.deploy/current-sha
          echo "Previous SHA: $(cat ~/.deploy/previous-sha 2>/dev/null || echo 'none')"
          echo "Deploying image: $ECR_REGISTRY/ffd-connect-backend:$DEPLOY_SHA"

          # 2. Auth to ECR
          aws ecr get-login-password --region eu-west-3 | \
            docker login --username AWS --password-stdin "$ECR_REGISTRY"

          # 3. Pull pre-built image
          export IMAGE_TAG="$DEPLOY_SHA"
          docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full pull backend

          # 4. Run migration pre-check (fail-fast before container swap)
          # docker-entrypoint.sh also runs migrations (idempotent safety net).
          # Rollback does NOT reverse migrations — use expand-then-contract.
          echo "Running migration pre-check..."
          docker compose -f docker-compose.yml -f docker-compose.staging.yml \
            run --rm backend npx prisma migrate deploy
          echo "Migrations OK"

          # 5. Bring up services
          docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d
          docker compose -f docker-compose.yml -f docker-compose.staging.yml ps
          echo "Deployed: $ECR_REGISTRY/ffd-connect-backend:$DEPLOY_SHA"

    - name: Smoke test (health + DB + Redis)
      id: health
      run: |
        HEALTH_URL="https://api-staging.ffd-connect.fr/health"

        # Wait for container to become responsive (max 60s)
        echo "Waiting for container to respond..."
        for i in $(seq 1 12); do
          if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            echo "Container responding after ~$((i * 5))s"
            break
          fi
          if [ "$i" -eq 12 ]; then
            echo "Container not responding after 60s"
            exit 1
          fi
          echo "  attempt $i/12 — retrying in 5s..."
          sleep 5
        done

        BODY=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")
        if [ -z "$BODY" ]; then
          echo "Health endpoint returned empty body"
          exit 1
        fi

        echo "$BODY" | jq .

        STATUS=$(echo "$BODY" | jq -r '.status')
        if [ "$STATUS" = "down" ]; then
          echo "::error::Service is DOWN"
          exit 1
        fi

        DB_STATUS=$(echo "$BODY" | jq -r '.database.status')
        if [ "$DB_STATUS" != "ok" ]; then
          echo "::error::Database health check failed: $(echo "$BODY" | jq -r '.database.error // "unknown"')"
          exit 1
        fi

        # Staging: Redis warning only (non-blocking)
        REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status')
        if [ "$REDIS_STATUS" != "ok" ]; then
          echo "::warning::Redis health check failed (non-blocking): $(echo "$BODY" | jq -r '.redis.error // "unknown"')"
        fi

        echo "Smoke test passed: status=$STATUS db=$DB_STATUS redis=$REDIS_STATUS"

    - name: Auto-rollback on failure
      if: failure() && steps.health.outcome == 'failure'
      uses: appleboy/ssh-action@0ff4204d59e8e51228ff73bce53f80d53301dee2 # v1
      env:
        ECR_REGISTRY: ${{ secrets.ECR_REGISTRY }}
      with:
        host: ${{ secrets.STAGING_SSH_HOST }}
        username: ${{ secrets.STAGING_SSH_USER }}
        key: ${{ secrets.STAGING_SSH_KEY }}
        envs: ECR_REGISTRY
        script: |
          set -euo pipefail
          cd ${{ secrets.STAGING_APP_PATH }}
          PREV_SHA=$(cat ~/.deploy/previous-sha 2>/dev/null || echo "")
          if [ -z "$PREV_SHA" ]; then
            echo "::error::No previous SHA found — cannot auto-rollback"
            exit 1
          fi
          echo "Rolling back to: $PREV_SHA"
          aws ecr get-login-password --region eu-west-3 | \
            docker login --username AWS --password-stdin "$ECR_REGISTRY"
          export IMAGE_TAG="$PREV_SHA"
          docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full pull backend
          docker compose -f docker-compose.yml -f docker-compose.staging.yml --profile full up -d
          echo "$PREV_SHA" > ~/.deploy/current-sha
          echo "Rollback complete"

    - name: Notify deploy failure (Slack)
      if: failure() && env.SLACK_WEBHOOK_URL != ''
      env:
        SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        DEPLOY_SHA: ${{ github.event.workflow_run.head_sha }}
        RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      run: |
        curl -sf -X POST "$SLACK_WEBHOOK_URL" \
          -H 'Content-Type: application/json' \
          -d "{\"text\":\":rotating_light: *Deploy failed* on \`staging\`\nSHA: \`${DEPLOY_SHA:0:7}\`\nRun: <${RUN_URL}|View logs>\nAuto-rollback attempted.\"}" \
          || echo "Slack notification failed (non-blocking)"
```

- [ ] **Step 2: Rewrite deploy-production job for image pull**

Same structure as staging with these differences:

- Uses `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `PROD_APP_PATH`
- Uses `docker-compose.production.yml` instead of `docker-compose.staging.yml`
- Health URL: `https://api.ffd-connect.fr/health`
- Redis is a **hard fail** (`exit 1`) instead of warning
- Slack message says `production` instead of `staging`
- Keeps the existing `Notify deploy failure` step from the original

Replace the Redis check in the production smoke test with:

```bash
          # HARD FAIL — Redis down disables IpBlacklistMiddleware (security risk)
          REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status')
          if [ "$REDIS_STATUS" != "ok" ]; then
            echo "::error::Redis is DOWN — IP blacklist middleware disabled (security risk)"
            exit 1
          fi
```

- [ ] **Step 3: Remove `--build` from deploy (no longer needed)**

Verify that neither deploy job uses `--build` in `docker compose up`. The image is pre-built — we only `pull` + `up -d`.

- [ ] **Step 4: Validate YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-backend.yml'))"
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-backend.yml
git commit -m "feat(deploy): rewrite deploy to pull pre-built ECR images (immutable deploy)"
```

---

### Task 15: Phase 2 validation + final review

- [ ] **Step 1: Validate all Terraform**

```bash
cd /Users/gabin/Development/FFD-Connect/infra/terraform
terraform fmt -check .
terraform validate
```

- [ ] **Step 2: Validate all workflow YAML**

```bash
cd /Users/gabin/Development/FFD-Connect
for f in .github/workflows/*.yml; do
  python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "OK: $f" || echo "FAIL: $f"
done
```

- [ ] **Step 3: Full diff review**

```bash
git diff develop --stat
git log develop..HEAD --oneline
```

Verify the commit history matches the plan.

- [ ] **Step 4: Update terraform.tfvars.example**

Add the new variables to `infra/terraform/terraform.tfvars.example`:

```hcl
# CI/CD (required for immutable deploy)
github_org  = "your-github-org"
github_repo = "FFD-Connect"
```

```bash
git add infra/terraform/terraform.tfvars.example
git commit -m "docs(infra): add github_org/repo to tfvars example"
```

---

## Post-Implementation: Manual Steps

These steps cannot be automated in the plan — they require access to GitHub settings and AWS console:

1. **GitHub repo settings:** Add `SLACK_WEBHOOK_URL` secret (create a Slack incoming webhook first)
2. **GitHub branch protection:** Enable "Require review from Code Owners" on develop, staging, master
3. **Terraform apply:** Run `terraform apply` to create ECR repo, OIDC provider, CI role
4. **GitHub repo settings:** Add `AWS_CI_ROLE_ARN` secret (from `terraform output ci_role_arn`)
5. **GitHub repo settings:** Add `ECR_REGISTRY` secret (from `terraform output ecr_repository_url`, strip the repo name — just the registry host)
6. **Server prep:** On staging EC2 instance, verify `aws ecr get-login-password` works (IAM instance profile should handle auth)
7. **Validate:** Push a change to staging, verify the full flow: CI builds image → pushes to ECR → deploy pulls image → smoke test passes
8. **Production cutover:** After staging is validated for a few days, enable for production
