# ============================================
# Release keys — app-distribution keys for the beta promotion (ADR-0020)
# ============================================
# Single source of truth for the keys `promote-beta` (eas-build.yml) uses to
# distribute a build to testers: App Store Connect API key (iOS) and the
# Google Play service account (Android).
#
# A DEDICATED vault, not the runtime vault `ffd-connect-kv` (created outside
# Terraform, holds the DB URLs and the Firebase service account): Key Vault
# RBAC is granted per vault (or per secret), so a separate vault lets the CI
# beta identity read the distribution keys and NOTHING else, without one role
# assignment per secret. It also keeps the runtime vault out of the blast
# radius of a compromised workflow.
#
# Secret VALUES are deliberately NOT declared here (no azurerm_key_vault_secret):
# they would land in plain text in the remote state. Gabin sets them with
# `az keyvault secret set --file …` (runbook docs/exploitation/rotation-cles-distribution.md).
# Expected secret names: asc-key-id, asc-issuer-id, asc-key-p8,
# play-service-account-json.
#
# Cost: Key Vault Standard has no fixed fee; ~10 secret reads per beta
# promotion = a few cents per month at most.

resource "azurerm_key_vault" "release_keys" {
  name                = var.release_keys_vault_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tenant_id           = data.azuread_client_config.current.tenant_id
  sku_name            = "standard"

  # RBAC only (same mode as ffd-connect-kv): no legacy access policies.
  rbac_authorization_enabled = true

  # Soft delete is mandatory; 90 days lets a deleted key be recovered (the
  # Apple .p8 files can be downloaded only once). Purge protection stays off
  # so the vault can be fully removed if the beta stack is torn down.
  soft_delete_retention_days = 90
  purge_protection_enabled   = false

  # GitHub-hosted runners have no stable egress IP: the vault stays reachable
  # publicly and relies on Entra ID auth + RBAC (no anonymous access exists).
  public_network_access_enabled = true

  tags = local.common_tags
}

# ── CI identity for the beta promotion ─────────
# Separate from `ci` (ci-iam.tf), which pushes images and updates the backend:
# this one can ONLY read the release keys. Same pattern as ci-iam.tf (Entra
# app + service principal + federated credential, no client secret).

resource "azuread_application" "ci_release" {
  display_name = "${local.name_prefix}-ci-release-keys"

  owners = [data.azuread_client_config.current.object_id]
}

resource "azuread_service_principal" "ci_release" {
  client_id = azuread_application.ci_release.client_id

  owners = [data.azuread_client_config.current.object_id]
}

# ONLY the `testflight-beta` GitHub Environment can exchange its OIDC token:
# that environment has a required reviewer and restricted branches, so a PR,
# a fork or any other job (no environment, or another one) gets AADSTS700213.
# Immutable subject prefix: see ci-iam.tf.
resource "azuread_application_federated_identity_credential" "ci_release_testflight_beta" {
  application_id = azuread_application.ci_release.id
  display_name   = "${local.name_prefix}-github-env-testflight-beta"
  description    = "GitHub Actions OIDC — testflight-beta ENVIRONMENT (eas-build.yml promote-beta)"

  audiences = ["api://AzureADTokenExchange"]
  issuer    = "https://token.actions.githubusercontent.com"
  subject   = "${local.github_oidc_subject_prefix}:environment:testflight-beta"
}

# Key Vault Secrets User = read secret values (data plane). Scoped to the
# release vault only: no access to ffd-connect-kv, no ARM role at all.
resource "azurerm_role_assignment" "ci_release_secrets_user" {
  scope                = azurerm_key_vault.release_keys.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azuread_service_principal.ci_release.object_id
}

# ── Human writers ──────────────────────────────
# In RBAC mode even the vault creator cannot write secrets without a data-plane
# role (pitfall #3 of isolation-secrets-db.md, where it was self-assigned by
# hand). Here it is declared: by default the principal running `terraform
# apply` (Gabin) gets Key Vault Secrets Officer on THIS vault only.
locals {
  release_keys_officers = length(var.release_keys_officer_principal_ids) > 0 ? var.release_keys_officer_principal_ids : toset([data.azuread_client_config.current.object_id])
}

resource "azurerm_role_assignment" "release_keys_officer" {
  for_each             = local.release_keys_officers
  scope                = azurerm_key_vault.release_keys.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = each.value
}
