# ============================================
# Outputs
# ============================================
# Only the Terraform-managed foundation is exposed here.
# VM / storage / backup outputs were removed with the
# single-VM stack (2026-07 → Azure Container Apps).

# ── Resource Group ──────────────────────────

output "resource_group_name" {
  description = "Azure resource group name"
  value       = azurerm_resource_group.main.name
}

# ── Public URLs (DNS managed in Cloudflare) ──

output "api_url" {
  description = "Production API endpoint"
  value       = "https://api.ffd.gabin-simond.fr"
}

output "landing_url" {
  description = "Landing site URL (GitHub Pages)"
  value       = "https://ffd.gabin-simond.fr"
}

output "webapp_url" {
  description = "Web app URL"
  value       = "https://my.ffd.gabin-simond.fr"
}

# ── Admin back-office (Azure Static Web App) ──

output "admin_swa_hostname" {
  description = "Default hostname of the admin Static Web App — target of the Cloudflare CNAME admin.ffd.gabin-simond.fr (DNS-only)"
  value       = azurerm_static_web_app.admin.default_host_name
}

output "admin_ci_client_id" {
  description = "Client ID of the dedicated admin deploy identity (OIDC) — set as the GitHub variable AZURE_ADMIN_CLIENT_ID"
  value       = azuread_application.ci_admin.client_id
}

output "admin_url" {
  description = "Admin back-office URL"
  value       = "https://admin.ffd.gabin-simond.fr"
}

# ── Container Registry ──────────────────────

output "acr_login_server" {
  description = "ACR login server hostname — set as ACR_REGISTRY secret"
  value       = azurerm_container_registry.backend.login_server
}

# ── CI/CD — values for GitHub Actions secrets ──

output "ci_client_id" {
  description = "Azure AD application (client) ID for GitHub Actions OIDC — set as AZURE_CLIENT_ID secret"
  value       = azuread_application.ci.client_id
}

output "ci_tenant_id" {
  description = "Azure AD tenant ID for GitHub Actions OIDC — set as AZURE_TENANT_ID secret"
  value       = data.azuread_client_config.current.tenant_id
}

output "ci_subscription_id" {
  description = "Azure subscription ID — set as AZURE_SUBSCRIPTION_ID secret"
  value       = data.azurerm_subscription.current.subscription_id
}

output "github_secrets_to_update" {
  description = "GitHub Actions secrets that need updating after apply"
  value = {
    AZURE_CLIENT_ID       = azuread_application.ci.client_id
    AZURE_TENANT_ID       = data.azuread_client_config.current.tenant_id
    AZURE_SUBSCRIPTION_ID = data.azurerm_subscription.current.subscription_id
    ACR_REGISTRY          = azurerm_container_registry.backend.login_server
    NOTE                  = "ACR_REGISTRY is the login server hostname. AZURE_CLIENT_ID is for GitHub OIDC (no secret needed)."
  }
}

# ── AI services (set on the backend Container App as env vars) ──

output "azure_vision_endpoint" {
  description = "Azure AI Vision endpoint — set as AZURE_VISION_ENDPOINT on the backend"
  value       = azurerm_cognitive_account.vision.endpoint
}

output "azure_speech_endpoint" {
  description = "Azure AI Speech endpoint — set as AZURE_SPEECH_ENDPOINT on the backend"
  value       = azurerm_cognitive_account.speech.endpoint
}

output "azure_speech_resource_id" {
  description = "Azure AI Speech ARM resource id — set as AZURE_SPEECH_RESOURCE_ID on the backend (Speech's Entra auth needs the aad#{resourceId}#{token} form)"
  value       = azurerm_cognitive_account.speech.id
}

# ── Release keys (beta promotion, ADR-0020) ──

output "release_keys_vault_name" {
  description = "Key Vault holding the app-distribution keys — target of `az keyvault secret set --vault-name` (runbook rotation-cles-distribution.md)"
  value       = azurerm_key_vault.release_keys.name
}

output "ci_release_client_id" {
  description = "Client ID of the beta-promotion identity — set as variable AZURE_RELEASE_KEYS_CLIENT_ID on the testflight-beta GitHub environment (not a secret)"
  value       = azuread_application.ci_release.client_id
}

output "release_keys_audit_workspace_id" {
  description = "Workspace (customer) ID receiving the release-keys vault AuditEvent logs — null while release_keys_audit_enabled = false. Query: AzureDiagnostics | where OperationName == \"SecretGet\""
  value       = var.release_keys_audit_enabled ? azurerm_log_analytics_workspace.release_keys_audit[0].workspace_id : null
}
