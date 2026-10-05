# ============================================
# CI/CD — GitHub Actions OIDC + Azure AD
# ============================================
# Keyless authentication: GitHub Actions authenticates via OIDC
# using a federated identity credential on an Azure AD app.
# No static client secrets stored in GitHub secrets.
# The CI identity can push images to ACR, read the resource
# group, and run commands on the VM via Run Command.

# azuread provider requirement is declared in main.tf (a module may have only
# one required_providers block).

# ── Data sources ────────────────────────────

data "azurerm_subscription" "current" {}
data "azuread_client_config" "current" {}

# ── Azure AD Application + Service Principal ─

resource "azuread_application" "ci" {
  display_name = "${local.name_prefix}-ci"

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "ci" {
  client_id = azuread_application.ci.client_id

  owners = [data.azuread_client_config.current.object_id]
}

# ── Federated Identity Credentials (OIDC) ──
# One credential per branch that is allowed to deploy.
# GitHub Actions presents a token with a subject claim
# matching the repo + branch — Azure validates it.
#
# Repositories created since 2026 get the IMMUTABLE subject format, which
# GitHub does not let you opt out of: `repo:<org>@<org_id>/<repo>@<repo_id>:…`.
# The numeric IDs pin the trust to this exact repository, so a repo that
# later takes the same name cannot assume the CI identity. Read the prefix
# with: gh api repos/<org>/<repo>/actions/oidc/customization/sub -q .sub_claim_prefix
locals {
  github_oidc_subject_prefix = "repo:${var.github_org}@${var.github_org_id}/${var.github_repo}@${var.github_repo_id}"
}

resource "azuread_application_federated_identity_credential" "staging" {
  application_id = azuread_application.ci.id
  display_name   = "${local.name_prefix}-github-staging"
  description    = "GitHub Actions OIDC — staging branch"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:ref:refs/heads/staging"
}

resource "azuread_application_federated_identity_credential" "master" {
  application_id = azuread_application.ci.id
  display_name   = "${local.name_prefix}-github-master"
  description    = "GitHub Actions OIDC — master branch"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:ref:refs/heads/master"
}

# `workflow_run` triggers (deploy-backend.yml) execute with the OIDC subject
# of the workflow file's branch — which is the default branch (develop) since
# the workflow definition lives there. Without this credential the deploy job
# fails Azure login with AADSTS700213.
resource "azuread_application_federated_identity_credential" "develop" {
  application_id = azuread_application.ci.id
  display_name   = "${local.name_prefix}-github-develop"
  description    = "GitHub Actions OIDC — develop branch (workflow_run subject)"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:ref:refs/heads/develop"
}

# A job bound to a GitHub Environment presents a DIFFERENT subject: the
# environment replaces the ref. Binding the deploy jobs to Environments (#787)
# therefore broke Azure login with the very AADSTS700213 documented above —
# the branch credentials never match `...:environment:<name>`.
#
# These two cover the environments used by deploy-backend.yml. The EAS
# environments (preview, testflight-beta, app-production) need nothing here:
# those jobs talk to Expo, not Azure.
resource "azuread_application_federated_identity_credential" "env_staging" {
  application_id = azuread_application.ci.id
  display_name   = "${local.name_prefix}-github-env-staging"
  description    = "GitHub Actions OIDC — staging ENVIRONMENT (deploy-backend.yml)"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:environment:staging"
}

resource "azuread_application_federated_identity_credential" "env_production" {
  application_id = azuread_application.ci.id
  display_name   = "${local.name_prefix}-github-env-production"
  description    = "GitHub Actions OIDC — production ENVIRONMENT (deploy-backend.yml)"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:environment:production"
}

# ── Role Assignments ───────────────────────
# Principle of least privilege: CI can push images,
# read resource metadata, and invoke Run Command on the VM.

# AcrPush — push (and pull) images to the container registry
resource "azurerm_role_assignment" "ci_acr_push" {
  scope                = azurerm_container_registry.backend.id
  role_definition_name = "AcrPush"
  principal_id         = azuread_service_principal.ci.object_id
}

# AcrDelete — let the deploy workflow purge old SHA-tagged images after a
# successful deploy (Basic SKU has no retention policy — see acr.tf). Keeps
# the registry under the 10 GiB included storage.
resource "azurerm_role_assignment" "ci_acr_delete" {
  scope                = azurerm_container_registry.backend.id
  role_definition_name = "AcrDelete"
  principal_id         = azuread_service_principal.ci.object_id
}

# Reader — list resources, read metadata (needed for az commands in CI)
resource "azurerm_role_assignment" "ci_reader" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Reader"
  principal_id         = azuread_service_principal.ci.object_id
}

# NOTE: ci_vm_contributor (Virtual Machine Contributor for `az vm run-command`)
# was removed with the single-VM stack (2026-07). Container Apps deploys rely on
# ACR push + `az containerapp update`; AcrPush + Reader above cover CI's needs.
# If CI must update Container Apps directly, add a scoped Contributor/custom role
# assignment here.
