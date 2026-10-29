# ============================================
# Backend app secrets — Key Vault references (#848)
# ============================================
# The backend Container Apps (backend-staging, backend-prod) are provisioned
# outside Terraform, and so is their secret list: each app secret is a Key
# Vault reference (`keyvaultref:<vault uri>/secrets/<name>,identityref:system`)
# set with `az containerapp secret set` (runbook deploiement-azure.md,
# « Rotation des secrets de l'app »). The app resolves the versionless
# reference with its system-assigned managed identity when a replica starts,
# so rotating a secret = new Key Vault version + restart. No value lives in
# Terraform, in its state or in the app definition.
#
# What Terraform owns here: the data-plane read right of each app identity,
# scoped to ONE secret at a time (Key Vault Secrets User on
# <vault>/secrets/<name>, versionless) — the same per-secret RBAC as the DB
# URL (#503, isolation-secrets-db.md) and the migration job (migrate-job.tf).
# The staging identity cannot read a prod secret nor any other secret of the
# vault.
#
# Secret VALUES are deliberately NOT declared (no azurerm_key_vault_secret,
# no data source on a secret): they would be copied into the remote state
# (#779). Gabin creates them out-of-band with `az keyvault secret set --file`.
#
# Pre-existing grants of the staging identity (db-url-staging,
# firebase-sa-staging, qr-signing-secret-staging, the wallet-* secrets, ...)
# were created with `az role assignment create` before this file and stay
# out of Terraform: re-declaring them here would fail with
# RoleAssignmentExists unless imported first.
#
# Prod: backend-prod is stopped (#215). At its restart, add
#   prod = { principal_id = "<backend-prod principalId>", secret_names = [...-prod] }
# with its own -prod secrets, then apply.
#
# Cost: role assignments are free. Key Vault Standard bills 0.03 USD per
# 10,000 operations; each replica start resolves ~20 references, i.e. a few
# hundred reads per month at most — well under 0.01 EUR/month.
#
# Which secrets each identity may read: var.backend_app_key_vault_secrets.

locals {
  # "<env>/<secret>" => { principal_id, secret_name }: stable keys, so adding
  # or removing one secret never recreates the other assignments.
  backend_app_kv_grants = merge([
    for env, cfg in var.backend_app_key_vault_secrets : {
      for s in cfg.secret_names : "${env}/${s}" => {
        principal_id = cfg.principal_id
        secret_name  = s
      }
    }
  ]...)
}

resource "azurerm_role_assignment" "backend_app_kv_secret_reader" {
  for_each = local.backend_app_kv_grants

  scope                = "${data.azurerm_key_vault.runtime.id}/secrets/${each.value.secret_name}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = each.value.principal_id
  # Managed identity: skips the Entra lookup that can fail right after the
  # principal is created (replication delay).
  principal_type = "ServicePrincipal"
}
