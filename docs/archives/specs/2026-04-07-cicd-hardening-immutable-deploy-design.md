# CI/CD Hardening & Immutable Deploy — Design Spec

**Date:** 2026-04-07
**Scope:** GitHub Actions CI + backend deploy pipeline + Terraform ECR
**Branch:** `fix/ci-lint-audit-a11y` (or new branch TBD)

---

## Context

The CI/CD pipeline is mature (8 workflows, SHA-pinned actions, path filtering, mutation testing) but has operational gaps: fragile health checks, volatile rollback state, no active notifications, and a deploy mechanism that builds on the target server (non-immutable). The backend infrastructure is migrating from GCP to AWS (Terraform IaC in `infra/terraform/`).

## Goals

1. Fix known CI bugs and operational gaps (Phase 1 — quick wins)
2. Move to immutable container deploys via AWS ECR (Phase 2 — architecture)
3. Deduplicate staging/production deploy logic as a natural consequence of Phase 2

## Non-Goals

- Landing app deployment (out of scope — no AWS infra for it)
- Kubernetes / ECS migration (keep Docker Compose on EC2)
- Client (Expo) pipeline changes
- Changing the GitFlow branching model

---

## Phase 1 — Quick Wins

### 1.1 Fix `paths-ignore` → job-level filtering

**Problem:** `paths-ignore: ['docs/**', 'LICENSE']` at the `on:` level skips the entire CI workflow for docs-only commits. The required `CI Success` check never appears, blocking PRs indefinitely.

**Changes in `ci.yml`:**

- Remove `paths-ignore` from the `on:` block
- Add a `docs` output to the existing `changes` job (dorny/paths-filter):
  ```yaml
  docs:
    - 'docs/**'
    - 'LICENSE'
    - '*.md'
  ```
- No job condition changes needed — existing jobs already depend on `changes.outputs.backend` / `changes.outputs.client`. A docs-only PR skips all heavy jobs, `ci-success` still runs and reports success.

**Risk:** None. The `ci-success` job runs `if: always()` regardless.

### 1.2 Rollback persistant

**Problem:** Previous deploy SHA stored in `/tmp/previous-deploy-sha` is lost on server reboot.

**Changes in `deploy-backend.yml`:**

- Replace `/tmp/previous-deploy-sha` with `~/.deploy/previous-sha`
- Add `mkdir -p ~/.deploy` before writing
- Both staging and production deploy + rollback steps

**Rollback script:**

```bash
mkdir -p ~/.deploy
# On deploy: save current before switching
cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
echo "$DEPLOY_SHA" > ~/.deploy/current-sha

# On rollback: read previous
PREV_SHA=$(cat ~/.deploy/previous-sha 2>/dev/null || echo "")
```

### 1.3 Redis = hard fail in production smoke test

**Problem:** Redis down silently disables the `IpBlacklistMiddleware` — blacklisted IPs pass through.

**Changes in `deploy-backend.yml`:**

- **Production** smoke test: Redis `!= ok` → `exit 1` (hard fail, triggers rollback)
- **Staging** smoke test: Redis `!= ok` → `::warning::` (unchanged, allows testing without Redis)
- Add comment explaining the security rationale (IP blacklist dependency)

```bash
# Production only — Redis is security-critical (IP blacklist)
REDIS_STATUS=$(echo "$BODY" | jq -r '.redis.status')
if [ "$REDIS_STATUS" != "ok" ]; then
  echo "::error::Redis is DOWN — IP blacklist middleware disabled (security risk)"
  exit 1
fi
```

### 1.4 Active notifications (Slack)

**Problem:** `::error::` is passive logging — nobody gets alerted at 3am.

**Prerequisite:** Create a Slack webhook and store as repo secret `SLACK_WEBHOOK_URL`.

**Changes:** Add notification steps (using `slackapi/slack-github-action` pinned by SHA) in:

- `deploy-backend.yml` — on deploy failure (staging + prod)
- `ci.yml` — on `ci-success` failure for protected branches (master, hotfix/\*)
- `mutation-nightly.yml` — on nightly failure

**Notification payload:**

```json
{
  "text": ":rotating_light: *Deploy failed* on `production`\nSHA: `abc1234`\nRun: <url|View logs>\nAuto-rollback attempted."
}
```

**Fallback:** If Slack webhook is not configured (`SLACK_WEBHOOK_URL` secret missing), the step is skipped via `if: secrets.SLACK_WEBHOOK_URL != ''`. Existing `::error::` logging is preserved alongside.

### 1.5 Explicit database migration in deploy

**Problem:** No visible `prisma migrate deploy` in the deploy workflow. If migrations fail, the rollback doesn't reverse the schema.

**Changes in `deploy-backend.yml`:**

- Add SSH step **before** `docker compose up`:
  ```bash
  # Run migrations inside the existing app container (or a one-off container)
  docker compose run --rm backend npx prisma migrate deploy
  ```
- If migration fails, abort deploy (don't bring up new containers)
- Add a comment: "Rollback does NOT reverse migrations. Migrations must be backward-compatible (expand-then-contract pattern)."

**Note:** In Phase 2 (immutable deploy), this becomes `docker compose run --rm backend npx prisma migrate deploy` using the new image tag before `docker compose up`.

### 1.6 CODEOWNERS

**Problem:** Changes to security-critical code (auth, payment, prisma schema) can be merged without explicit owner review.

**New file:** `.github/CODEOWNERS`

```
# Security-critical paths require owner review
apps/backend/src/auth/          @gabin
apps/backend/src/payment/       @gabin
apps/backend/prisma/schema/     @gabin
.github/workflows/              @gabin
infra/                          @gabin
```

**Prerequisite:** Enable "Require review from Code Owners" in branch protection settings for `develop`, `staging`, and `master`.

### 1.7 Robust health check (replace `sleep 5`)

**Problem:** `sleep 5` after `docker compose up` is arbitrary. Container boot time varies.

**Changes in `deploy-backend.yml`:**

- Remove `sleep 5`
- Replace with a wait loop that polls `/health` with exponential backoff:
  ```bash
  # Wait for container to respond (max 60s)
  for i in $(seq 1 12); do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      echo "Container responding after ~$((i * 5))s"
      break
    fi
    echo "Waiting for container... attempt $i/12"
    sleep 5
  done
  ```
- The existing 5-attempt smoke test (10s intervals) follows this wait as the functional validation layer

---

## Phase 2 — Immutable Deploy via AWS ECR

### 2.1 Architecture

**Current flow:**

```
CI validates → SSH to server → git fetch + checkout SHA → docker compose --build → smoke test
```

**Target flow:**

```
CI validates + builds image → push to ECR (tag: SHA) → SSH to server → docker compose pull → up → smoke test
```

The server no longer needs git. The same image built in CI runs everywhere.

### 2.2 Terraform additions (`infra/terraform/`)

#### ECR Repository

New file or append to `compute.tf`:

```hcl
resource "aws_ecr_repository" "backend" {
  name                 = "${var.project}-backend"
  image_tag_mutability = "IMMUTABLE"  # SHA tags cannot be overwritten

  image_scanning_configuration {
    scan_on_push = true  # Vulnerability scanning on every push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.name_prefix}-ecr" }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images, purge older"
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

#### GitHub OIDC Provider (keyless CI auth)

```hcl
# GitHub Actions OIDC — no static AWS keys
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ffffffffffffffffffffffffffffffffffffffff"]  # GitHub-managed
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
          # Replace <github-org> with your actual GitHub org/user during implementation
            "token.actions.githubusercontent.com:sub" = "repo:<github-org>/FFD-Connect:ref:refs/heads/*"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "ci_ecr_push" {
  name = "${local.name_prefix}-ci-ecr-push"
  role = aws_iam_role.ci.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ]
      Resource = "*"
    }]
  })
}
```

#### EC2 role: add ECR pull permissions

Append to existing `aws_iam_role_policy.s3_access` (or create separate policy):

```hcl
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

#### New Terraform output

```hcl
output "ecr_repository_url" {
  description = "ECR repository URL for CI image push"
  value       = aws_ecr_repository.backend.repository_url
}

output "ci_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC"
  value       = aws_iam_role.ci.arn
}
```

### 2.3 New CI job: `build-image` (in `ci.yml`)

Runs in parallel with `backend-test` and `backend-build`. Only on push to `staging` or `master`:

```yaml
build-image:
  name: Build & Push Docker Image
  runs-on: ubuntu-latest
  timeout-minutes: 10
  needs: [changes, backend-test, backend-build]
  if: >-
    github.event_name == 'push'
    && (github.ref == 'refs/heads/staging' || github.ref == 'refs/heads/master')
    && needs.backend-test.result == 'success'
    && needs.backend-build.result == 'success'

  permissions:
    id-token: write # Required for OIDC
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
        IMAGE_TAG: ${{ github.sha }}
      run: |
        docker build -t $ECR_REGISTRY/ffd-connect-backend:$IMAGE_TAG apps/backend/
        docker push $ECR_REGISTRY/ffd-connect-backend:$IMAGE_TAG
        echo "Pushed: $ECR_REGISTRY/ffd-connect-backend:$IMAGE_TAG"
```

The `ci-success` gate adds `build-image` to its `needs` list. On PRs, `build-image` is skipped (condition: push to staging/master only) and counts as success in the gate.

### 2.4 Refactored `deploy-backend.yml`

Replace the duplicated staging/production jobs with a single parameterized job using `strategy.matrix` or a reusable workflow:

```yaml
deploy:
  name: Deploy to ${{ matrix.env.name }}
  needs: [gate]
  if: needs.gate.outputs.backend_changed == 'true'
  runs-on: ubuntu-latest
  strategy:
    matrix:
      env:
        - name: staging
          condition: needs.gate.outputs.environment == 'staging'
          ssh_host_secret: STAGING_SSH_HOST
          ssh_user_secret: STAGING_SSH_USER
          ssh_key_secret: STAGING_SSH_KEY
          compose_override: docker-compose.staging.yml
          url: https://api-staging.ffd-connect.fr
          redis_critical: false
        - name: production
          condition: needs.gate.outputs.environment == 'production'
          ssh_host_secret: PROD_SSH_HOST
          ssh_user_secret: PROD_SSH_USER
          ssh_key_secret: PROD_SSH_KEY
          compose_override: docker-compose.production.yml
          url: https://api.ffd-connect.fr
          redis_critical: true
    # Only run the matching environment
    # (GitHub Actions matrix doesn't support conditional includes natively,
    #  so we use an if-guard on the first step instead)
  environment:
    name: ${{ matrix.env.name }}
    url: ${{ matrix.env.url }}
```

**Note:** If matrix conditional filtering proves awkward, the alternative is a reusable workflow (`workflow_call`) invoked twice with different inputs. Both eliminate duplication. The implementation plan will determine the cleanest approach.

### 2.5 Deploy SSH script (immutable)

```bash
set -euo pipefail
APP_DIR="${{ secrets.APP_PATH }}"
cd "$APP_DIR"

# 1. Persist previous SHA
mkdir -p ~/.deploy
cat ~/.deploy/current-sha > ~/.deploy/previous-sha 2>/dev/null || true
echo "$DEPLOY_SHA" > ~/.deploy/current-sha

# 2. Auth to ECR (token valid 12h)
aws ecr get-login-password --region eu-west-3 | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# 3. Set image tag and pull
export IMAGE_TAG="$DEPLOY_SHA"
docker compose -f docker-compose.yml -f "$COMPOSE_OVERRIDE" pull backend

# 4. Run migrations (using the NEW image, before swapping containers)
docker compose -f docker-compose.yml -f "$COMPOSE_OVERRIDE" \
  run --rm backend npx prisma migrate deploy

# 5. Bring up services
docker compose -f docker-compose.yml -f "$COMPOSE_OVERRIDE" up -d
```

### 2.6 Rollback script (immutable)

```bash
set -euo pipefail
cd "$APP_DIR"

PREV_SHA=$(cat ~/.deploy/previous-sha 2>/dev/null || echo "")
if [ -z "$PREV_SHA" ]; then
  echo "::error::No previous SHA found — cannot auto-rollback"
  exit 1
fi

echo "Rolling back to: $PREV_SHA"
aws ecr get-login-password --region eu-west-3 | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

export IMAGE_TAG="$PREV_SHA"
docker compose -f docker-compose.yml -f "$COMPOSE_OVERRIDE" pull backend
docker compose -f docker-compose.yml -f "$COMPOSE_OVERRIDE" up -d

echo "$PREV_SHA" > ~/.deploy/current-sha
```

**Important:** Rollback does NOT reverse database migrations. Migrations must follow the expand-then-contract pattern (add columns/tables first, remove later in a separate release).

### 2.7 Docker Compose changes (server-side)

The `docker-compose.yml` on the server changes the backend service from build-based to image-based:

```yaml
# Before
backend:
  build: .
  # ...

# After
backend:
  image: ${ECR_REGISTRY}/ffd-connect-backend:${IMAGE_TAG}
  # ...
```

`ECR_REGISTRY` and `IMAGE_TAG` are set as environment variables before `docker compose up`.

### 2.8 Migration sequence (zero-downtime transition)

1. **Terraform apply** — Create ECR repo, OIDC provider, CI role, EC2 ECR pull policy. Add `AWS_CI_ROLE_ARN` secret to GitHub repo settings.
2. **Add `build-image` job to CI** — With `continue-on-error: true` initially. Verify images land in ECR.
3. **Remove `continue-on-error`** — Add `build-image` to `ci-success` gate.
4. **Prepare staging server** — Update `docker-compose.yml` to use image reference. Test `docker compose pull` + `up` manually.
5. **Switch staging deploy workflow** — Deploy via image pull. Validate for a few days.
6. **Switch production deploy workflow** — Same change.
7. **Cleanup** — Remove git from server user-data. Remove old deploy scripts. Update `scripts/rollback-deploy.sh`.

---

## Files Changed

### Phase 1

| File                                     | Change                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`               | Remove `paths-ignore`, add Slack notification                                                   |
| `.github/workflows/deploy-backend.yml`   | Persistent rollback, Redis hard fail prod, health wait loop, migration step, Slack notification |
| `.github/workflows/mutation-nightly.yml` | Slack notification                                                                              |
| `.github/CODEOWNERS`                     | **New file**                                                                                    |

### Phase 2

| File                                   | Change                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `infra/terraform/compute.tf`           | ECR repository, OIDC provider, CI role, EC2 ECR pull policy                    |
| `infra/terraform/outputs.tf`           | ECR URL + CI role ARN outputs                                                  |
| `.github/workflows/ci.yml`             | Add `build-image` job, add to `ci-success` needs                               |
| `.github/workflows/deploy-backend.yml` | Full rewrite — single parameterized job, image pull deploy, immutable rollback |
| `docker-compose.yml`                   | Backend service: `build:` → `image:`                                           |
| `docker-compose.staging.yml`           | Remove build overrides if any                                                  |
| `docker-compose.production.yml`        | Remove build overrides if any                                                  |

---

## Risks & Mitigations

| Risk                            | Mitigation                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| ECR outage blocks deploy        | GHCR as documented fallback (manual switch)                             |
| OIDC misconfiguration blocks CI | Test with `continue-on-error: true` first                               |
| Migration fails during deploy   | Migration runs before `docker compose up` — abort before container swap |
| Rollback doesn't reverse schema | Document expand-then-contract requirement. Team convention.             |
| Image size too large            | Multi-stage Dockerfile (already in use). Monitor with ECR scanning.     |
| Slack webhook secret missing    | Notification steps guarded with `if: secrets.SLACK_WEBHOOK_URL != ''`   |

---

## Success Criteria

- [ ] Docs-only PRs no longer block on missing `CI Success` check
- [ ] Deploy rollback survives server reboot
- [ ] Production deploy fails and auto-rollbacks when Redis is down
- [ ] Team gets Slack notification within 1 minute of deploy/CI failure
- [ ] `prisma migrate deploy` runs explicitly and visibly in deploy logs
- [ ] CODEOWNERS requires review on auth/payment/prisma/infra changes
- [ ] Health check waits for container readiness instead of arbitrary sleep
- [ ] Backend image built once in CI, pulled identically on staging and prod
- [ ] No git installation required on deployment servers
- [ ] Staging and production deploy logic is a single parameterized job (no duplication)
