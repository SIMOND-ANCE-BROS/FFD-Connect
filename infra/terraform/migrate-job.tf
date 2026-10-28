# ============================================
# DB migration jobs — ADR-0025 phase 1 (option A)
# ============================================
# One Azure Container Apps Job per environment runs `prisma migrate deploy`
# BEFORE deploy-backend.yml switches the app to a new image. A failed
# migration stops the deploy: the app keeps serving its current revision.
#
# Phase 1, option A: the job reuses the APP image (the Prisma CLI is still in
# it), so there is no second build target nor ACR repository yet. The
# workflow starts each execution with a full container override (image of
# the SHA being deployed + command + env), which is why the template image
# below is only a public placeholder: a bare `az containerapp job start`
# without override fails fast (no Prisma CLI in it) instead of migrating with
# a stale image. Nothing in ACR is pinned by this job's template.
#
# The entrypoint still migrates at boot during phase 1 (belt and braces): the
# job applies, the boot finds nothing to do.
#
# Which environments get a job: var.migrate_jobs. Default = staging only.
# Prod (`prod = { db_url_secret_name = "db-url-prod" }`) is added when
# backend-prod restarts (#215, ADR-0025 phase 4) — not before.
#
# Identity: backend-staging uses a SYSTEM-assigned identity that a job cannot
# share (phase 0 finding), so each job gets its own user-assigned identity,
# allowed to read ONE Key Vault secret (RBAC at secret scope) and to pull from
# the registry. No new secret, nothing in GitHub.
#
# The environment `ffd-connect-cae` and the vault `ffd-connect-kv` are created
# outside Terraform: data sources only (control-plane reads, no app wake).
#
# Cost: no idle cost (a job bills only while an execution runs). ~30 s of
# 0.5 vCPU / 1 GiB per deploy stays inside the Container Apps monthly free
# grant; a user-assigned identity and role assignments are free.

data "azurerm_container_app_environment" "main" {
  name                = var.container_app_environment_name
  resource_group_name = azurerm_resource_group.main.name
}

# Runtime vault (DB URLs, Firebase SA, signing keys). Metadata only: no
# azurerm_key_vault_secret data source, which would copy the secret VALUE
# into the remote state.
data "azurerm_key_vault" "runtime" {
  name                = var.runtime_key_vault_name
  resource_group_name = azurerm_resource_group.main.name
}

locals {
  # Container name inside the job: deploy-backend.yml's execution override
  # must use the same name.
  migrate_container_name = "migrate"
}

resource "azurerm_user_assigned_identity" "migrate" {
  for_each = var.migrate_jobs

  name                = "backend-migrate-${each.key}-id"
  resource_group_name = azurerm_resource_group.main.name
  location            = data.azurerm_container_app_environment.main.location

  tags = local.common_tags
}

# Key Vault Secrets User on the single DB URL secret of the environment
# (versionless secret scope): the staging job cannot read db-url-prod, the
# Firebase SA or any other secret of the vault.
resource "azurerm_role_assignment" "migrate_db_url_reader" {
  for_each = var.migrate_jobs

  scope                = "${data.azurerm_key_vault.runtime.id}/secrets/${each.value.db_url_secret_name}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.migrate[each.key].principal_id
}

# AcrPull — pull the backend image of the deploy being migrated.
resource "azurerm_role_assignment" "migrate_acr_pull" {
  for_each = var.migrate_jobs

  scope                = azurerm_container_registry.backend.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.migrate[each.key].principal_id
}

resource "azurerm_container_app_job" "migrate" {
  for_each = var.migrate_jobs

  # "backend-migrate-staging" / "backend-migrate-prod" (< 32 chars).
  name                         = "backend-migrate-${each.key}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = data.azurerm_container_app_environment.main.location
  container_app_environment_id = data.azurerm_container_app_environment.main.id
  # The environment is a workload-profiles environment whose only profile
  # is the serverless "Consumption" one (same as the apps).
  workload_profile_name = "Consumption"

  # Never retried: a failed migration may be half-applied (phase 0, result 3)
  # and must be looked at by a human (runbook migrations-job-adr-0025.md).
  replica_retry_limit        = 0
  replica_timeout_in_seconds = 600

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.migrate[each.key].id]
  }

  registry {
    server   = azurerm_container_registry.backend.login_server
    identity = azurerm_user_assigned_identity.migrate[each.key].id
  }

  # Key Vault reference read by the job's identity: same secret as the app of
  # the same environment, never its value in Terraform.
  secret {
    name                = "db-url"
    key_vault_secret_id = "${data.azurerm_key_vault.runtime.vault_uri}secrets/${each.value.db_url_secret_name}"
    identity            = azurerm_user_assigned_identity.migrate[each.key].id
  }

  template {
    container {
      name   = local.migrate_container_name
      image  = var.migrate_job_placeholder_image
      cpu    = 0.5
      memory = "1Gi"

      # Documentation of what an execution runs; deploy-backend.yml passes the
      # same command in its override. WORKDIR of the backend image is
      # /app/apps/backend, so the relative --schema matches the entrypoint.
      command = ["/app/apps/backend/node_modules/.bin/prisma"]
      args    = ["migrate", "deploy", "--schema=./prisma/schema"]

      # No env here on purpose: DATABASE_URL is injected only by the
      # execution override of deploy-backend.yml (secretRef db-url). A bare
      # start of this template (placeholder image, mutable tag) therefore
      # never receives the database URL.
    }
  }

  tags = local.common_tags

  lifecycle {
    # Case-only drift that would force a REPLACEMENT: Azure returns the
    # environment id with `/resourceGroups/FFD-CONNECT-PRODUCTION-RG/` while
    # the data source yields `/resourceGroups/ffd-connect-production-rg/`
    # (seen on the 2026-10-18 apply). Resource ids are case-insensitive in
    # ARM; the job never moves to another environment, so ignoring the
    # attribute loses nothing. Moving it on purpose = taint/replace by hand.
    ignore_changes = [container_app_environment_id]
  }

  # Azure resolves the Key Vault reference when the job is created.
  depends_on = [
    azurerm_role_assignment.migrate_db_url_reader,
    azurerm_role_assignment.migrate_acr_pull,
  ]
}

# ── CI: start the job and follow its executions ─────────────────────────────
# What deploy-backend.yml needs and nothing more: read the job, start an
# execution (with a container override, so no jobs/write), read executions,
# stream their logs, and stop one that overruns. No secret listing, no exec.
#
# This is the CI's ONLY right on the job (#773: the RG-wide "Container Apps
# Contributor" it used to hold is replaced by the app-scoped
# backend_app_deployer role in ci-iam.tf). Starting an execution with an
# override still amounts to reading db-url-<env> (any command can receive
# the secret as an env var), the same exposure as containerApps/write on the
# app of that environment — hence each job's runner is the CI identity of
# that environment ONLY (#778): ci-staging can never start the prod job.
resource "azurerm_role_definition" "migrate_job_runner" {
  name        = "${local.name_prefix}-migrate-job-runner"
  scope       = azurerm_resource_group.main.id
  description = "Start the backend DB migration job and follow its executions (deploy-backend.yml, ADR-0025)."

  permissions {
    actions = [
      "Microsoft.App/jobs/read",
      "Microsoft.App/jobs/start/action",
      "Microsoft.App/jobs/stop/execution/action",
      "Microsoft.App/jobs/executions/read",
      "Microsoft.App/jobs/execution/read",
      "Microsoft.App/jobs/getAuthToken/action",
    ]
    not_actions = []
    # logstream is a data action: Azure rejects it in `actions` (400 InvalidActionOrNotAction).
    data_actions = [
      "Microsoft.App/jobs/logstream/action",
    ]
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

# Per-environment CI identity (#778): the migrate_jobs keys (staging, prod)
# are keys of local.ci_identities (ci-iam.tf), so the staging job's runner is
# ci-staging and the prod job's is ci-prod.
resource "azurerm_role_assignment" "ci_env_migrate_job_runner" {
  for_each = var.migrate_jobs

  scope              = azurerm_container_app_job.migrate[each.key].id
  role_definition_id = azurerm_role_definition.migrate_job_runner.role_definition_resource_id
  principal_id       = azuread_service_principal.ci_env[each.key].object_id
  # Fresh SP (same apply): avoid PrincipalNotFound before replication.
  skip_service_principal_aad_check = true
}
