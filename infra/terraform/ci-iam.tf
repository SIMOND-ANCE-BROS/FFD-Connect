# ============================================
# CI/CD — GitHub Actions OIDC + Azure AD
# ============================================
# Keyless authentication: GitHub Actions authenticates via OIDC
# using a federated identity credential on an Azure AD app.
# No static client secrets stored in GitHub secrets.
#
# ONE IDENTITY PER ROLE AND ENVIRONMENT (#778). Staging and production used to
# share a single CI identity, so a job of the GitHub environment `staging` (no
# reviewer), or any run on develop/staging, could write backend-prod and
# bypass the required reviewer of the `production` environment. Now:
#
#   ci-image-push  trusts the staging/master branch refs (ci.yml build-image,
#                  which runs outside any environment). Rights: push images,
#                  read the registry. It can deploy NOTHING.
#   ci-staging     trusts `environment:staging` ONLY. Rights: read/purge the
#                  registry, read the RG, update backend-staging, run the
#                  staging migration job.
#   ci-prod        trusts `environment:production` ONLY, i.e. a job that
#                  waited for the production reviewer. Rights: read/purge the
#                  registry, read the RG, update backend-prod, run the prod
#                  migration job (once var.migrate_jobs has one, #215).
#
# No identity holds a write right on another environment's app or job. The
# registry is shared and tags are mutable, so deploys never pull a tag: they
# pull the immutable DIGEST that ci.yml's build-image recorded for the image
# it pushed in the triggering run (deploy-backend.yml, gate job). Pushing or
# overwriting a tag therefore cannot change what a deploy runs.
#
# The former shared identity (`ffd-connect-production-ci`) was stripped of its
# credentials and rights once the split was proven, then deleted (#826).

# azuread provider requirement is declared in main.tf (a module may have only
# one required_providers block).

# ── Data sources ────────────────────────────

data "azurerm_subscription" "current" {}
data "azuread_client_config" "current" {}

# Repositories created since 2026 get the IMMUTABLE subject format, which
# GitHub does not let you opt out of: `repo:<org>@<org_id>/<repo>@<repo_id>:…`.
# The numeric IDs pin the trust to this exact repository, so a repo that
# later takes the same name cannot assume a CI identity. Read the prefix
# with: gh api repos/<org>/<repo>/actions/oidc/customization/sub -q .sub_claim_prefix
#
# A job bound to a GitHub Environment presents `...:environment:<name>` (the
# environment replaces the ref); a job outside any environment presents
# `...:ref:refs/heads/<branch>`. A workflow_run run (deploy-backend.yml) runs
# in the context of the DEFAULT branch (develop), hence its jobs are bound to
# environments rather than trusted by branch. No identity trusts a
# `pull_request` subject, a develop ref or a wildcard.
locals {
  github_oidc_subject_prefix = "repo:${var.github_org}@${var.github_org_id}/${var.github_repo}@${var.github_repo_id}"

  # Everything that differs between the CI identities, in one place:
  #   subjects       trusted OIDC subjects (suffix after the repo prefix),
  #                  keyed by a short name used in the credential's name
  #   acr_roles      built-in roles on the registry
  #   reader_scope   "rg" (Reader on the resource group) or "acr" (Reader on
  #                  the registry only)
  #   container_app  backend app it may update (backend-app-deployer), or null
  # The migration job runner role is assigned in migrate-job.tf, to the
  # identity whose key equals the var.migrate_jobs key (staging / prod).
  ci_identities = {
    image-push = {
      display_name = "${local.name_prefix}-ci-image-push"
      subjects = {
        # ci.yml `build-image` on a staging / master push (no environment).
        branch-staging = {
          subject     = "ref:refs/heads/staging"
          description = "staging branch (ci.yml build-image, push only)"
        }
        branch-master = {
          subject     = "ref:refs/heads/master"
          description = "master branch (ci.yml build-image, push only)"
        }
      }
      # AcrPush: push the image and its build cache (includes pull, for the
      # cache and the Trivy scan).
      acr_roles = ["AcrPush"]
      # `az acr login` resolves the registry through ARM: Reader on the
      # registry alone, not the RG (this identity needs to see no app).
      reader_scope  = "acr"
      container_app = null
    }

    staging = {
      display_name = "${local.name_prefix}-ci-staging"
      subjects = {
        # deploy-backend.yml `deploy-staging` job.
        env-staging = {
          subject     = "environment:staging"
          description = "staging ENVIRONMENT only (deploy-backend.yml deploy-staging)"
        }
      }
      # AcrPull: manifest/tag reads of acr-purge.sh. AcrDelete: the purge
      # after a successful deploy (ACR Basic has no retention policy, acr.tf).
      # No AcrPush: a deploy never pushes.
      acr_roles     = ["AcrPull", "AcrDelete"]
      reader_scope  = "rg"
      container_app = "backend-staging"
    }

    prod = {
      display_name = "${local.name_prefix}-ci-prod"
      subjects = {
        # deploy-backend.yml `deploy-production` and backend-warm-hours.yml,
        # both bound to the `production` environment (required reviewer).
        env-production = {
          subject     = "environment:production"
          description = "production ENVIRONMENT only (deploy-backend.yml deploy-production, backend-warm-hours.yml)"
        }
      }
      acr_roles     = ["AcrPull", "AcrDelete"]
      reader_scope  = "rg"
      container_app = "backend-prod"
    }
  }

  ci_federated_credentials = merge([
    for id, cfg in local.ci_identities : {
      for name, s in cfg.subjects : "${id}/${name}" => merge(s, { id = id, name = name })
    }
  ]...)

  ci_acr_roles = merge([
    for id, cfg in local.ci_identities : {
      for role in cfg.acr_roles : "${id}/${role}" => { id = id, role = role }
    }
  ]...)
}

# ── CI identities (#778) ────────────────────

resource "azuread_application" "ci_env" {
  for_each = local.ci_identities

  display_name = each.value.display_name

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "ci_env" {
  for_each = local.ci_identities

  client_id = azuread_application.ci_env[each.key].client_id

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_application_federated_identity_credential" "ci_env" {
  for_each = local.ci_federated_credentials

  application_id = azuread_application.ci_env[each.value.id].id
  display_name   = "${local.name_prefix}-ci-${each.value.id}-github-${each.value.name}"
  description    = "GitHub Actions OIDC — ${each.value.description}"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:${each.value.subject}"
}

# Registry roles (see acr_roles above for each one's justification).
resource "azurerm_role_assignment" "ci_env_acr" {
  for_each = local.ci_acr_roles

  scope                = azurerm_container_registry.backend.id
  role_definition_name = each.value.role
  principal_id         = azuread_service_principal.ci_env[each.value.id].object_id
  # The SP is created in the same apply: skip the Entra lookup that can fail
  # with PrincipalNotFound before replication.
  skip_service_principal_aad_check = true
}

# Reader. On the RG (staging, prod): `az containerapp show/list`,
# `revision list`, `job list`, `job execution list`; acr-purge.sh inventories
# the revisions and job executions of EVERY app and job of the group before
# deleting anything (an image a revision references is never purged, #681):
# without this read the purge deletes nothing. Read-only; it shows the other
# environment's non-secret configuration, as before the split.
# On the registry only (image-push): `az acr login`.
resource "azurerm_role_assignment" "ci_env_reader" {
  for_each = local.ci_identities

  scope                = each.value.reader_scope == "rg" ? azurerm_resource_group.main.id : azurerm_container_registry.backend.id
  role_definition_name = "Reader"
  principal_id         = azuread_service_principal.ci_env[each.key].object_id
  # Fresh SP (same apply): avoid PrincipalNotFound before replication.
  skip_service_principal_aad_check = true
}

# Update THIS environment's backend app only (role definition below). The
# apps are created outside Terraform: the scope is built from the RG id rather
# than from an azurerm_container_app data source.
resource "azurerm_role_assignment" "ci_env_backend_app_deployer" {
  for_each = { for id, cfg in local.ci_identities : id => cfg if cfg.container_app != null }

  scope              = "${azurerm_resource_group.main.id}/providers/Microsoft.App/containerApps/${each.value.container_app}"
  role_definition_id = azurerm_role_definition.backend_app_deployer.role_definition_resource_id
  principal_id       = azuread_service_principal.ci_env[each.key].object_id
  # Fresh SP (same apply): avoid PrincipalNotFound before replication.
  skip_service_principal_aad_check = true
}

# ── Backend Container Apps: update only (#773) ──
# Replaces the built-in "Container Apps Contributor" that was granted on the
# WHOLE resource group outside Terraform (seen 2026-10-18), which let the CI
# create, modify or delete every app, job and environment of the group,
# Redis included.
#
# Every Container Apps call of the workflows, and what covers it:
#   az containerapp show / list, revision list, job list / execution list
#     (deploy-backend.yml, acr-purge.sh)            -> Reader on the RG (above)
#   az containerapp update --image --set-env-vars    (deploy, rollback)
#   az containerapp update --max-inactive-revisions  (cap step, #768)
#   az containerapp update --min-replicas            (backend-warm-hours.yml)
#     = GET + PATCH of the app, no secret listing, no environmentId in the
#       body (so no managedEnvironments/join)      -> containerApps/write
#   az containerapp logs show (post-deploy check)   -> getAuthToken + logstream
#   migration job start / executions / logs / stop  -> migrate-job.tf role
#
# Deliberately NOT granted: delete, listSecrets, exec, debug, start/stop,
# revisions activate/deactivate/restart, any jobs/* or managedEnvironments/*
# write. (containerApps/write can still change the revision mode and traffic
# split, i.e. effectively reactivate an old revision.) Residual risk, inherent
# to deploying: containerApps/write on an app can change its image, so it can
# run code with that app's secrets and managed identity. Hence one assignment
# per identity, on its own environment's app ONLY (#778).
#
# The read actions duplicate the RG Reader on purpose: the role stays
# sufficient for the deploy steps if that Reader is ever narrowed.
# Assignable at the RG (resource-level assignable scopes may be rejected by
# ARM); the ASSIGNMENTS are scoped to each app.
resource "azurerm_role_definition" "backend_app_deployer" {
  name        = "${local.name_prefix}-backend-app-deployer"
  scope       = azurerm_resource_group.main.id
  description = "Update the backend Container App (image, env vars, scale, maxInactiveRevisions) and read its logs (deploy-backend.yml, backend-warm-hours.yml, #773)."

  permissions {
    actions = [
      "Microsoft.App/containerApps/read",
      "Microsoft.App/containerApps/write",
      "Microsoft.App/containerApps/revisions/read",
      "Microsoft.App/containerApps/revisions/replicas/read",
      "Microsoft.App/containerApps/getAuthToken/action",
    ]
    not_actions = []
    # logstream is a data action: Azure rejects it in `actions` (400 InvalidActionOrNotAction).
    data_actions = [
      "Microsoft.App/containerApps/logstream/action",
    ]
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

# ============================================
# Admin back-office deploy identity (deploy-admin.yml)
# ============================================
# A DEDICATED app registration, not one of the CI identities above: those
# federate the staging/master refs and the staging/production environments,
# so any workflow on those refs could otherwise read the admin SWA
# deployment token. This identity trusts ONE subject — the GitHub
# environment `admin` (restricted to the `staging` branch) — and holds ONE
# role: read the admin Static Web App and list its deployment token.
#
# No RG Reader needed: deploy-admin.yml passes --resource-group, so
# `az staticwebapp secrets list` is a single POST .../listSecrets on the SWA.
# `az login` only needs the subscription to be visible, which any role
# assignment inside it (here, on the SWA) provides.

resource "azuread_application" "ci_admin" {
  display_name = "${local.name_prefix}-ci-admin"

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "ci_admin" {
  client_id = azuread_application.ci_admin.client_id

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_application_federated_identity_credential" "ci_admin_env_admin" {
  application_id = azuread_application.ci_admin.id
  display_name   = "${local.name_prefix}-github-env-admin"
  description    = "GitHub Actions OIDC — admin ENVIRONMENT only (deploy-admin.yml)"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:environment:admin"
}

# No built-in role grants listSecrets without also granting writes (Website
# Contributor / Contributor can modify or delete the site), hence a two-action
# custom role. Assignable at the RG (ARM may reject resource-level assignable
# scopes); the ASSIGNMENT below is scoped to the SWA alone.
# Blast radius of the token: replacing the admin SPA's content, nothing else.
resource "azurerm_role_definition" "swa_admin_deployer" {
  name        = "${local.name_prefix}-swa-admin-deployer"
  scope       = azurerm_resource_group.main.id
  description = "Read the admin Static Web App and list its deployment token (deploy-admin.yml)."

  permissions {
    actions = [
      "Microsoft.Web/staticSites/read",
      "Microsoft.Web/staticSites/listSecrets/action",
    ]
    not_actions = []
  }

  assignable_scopes = [azurerm_resource_group.main.id]
}

resource "azurerm_role_assignment" "ci_admin_swa_deployer" {
  scope              = azurerm_static_web_app.admin.id
  role_definition_id = azurerm_role_definition.swa_admin_deployer.role_definition_resource_id
  principal_id       = azuread_service_principal.ci_admin.object_id
}
