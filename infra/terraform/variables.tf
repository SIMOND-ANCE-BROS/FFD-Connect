# ============================================
# FFD-Connect — Azure Infrastructure Variables
# ============================================

variable "azure_region" {
  description = "Azure region (francecentral = Paris)"
  type        = string
  default     = "francecentral"
}

variable "project" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "ffd-connect"
}

variable "environment" {
  description = "Environment name (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

# ── Compute ──────────────────────────────────

variable "vm_size" {
  description = "Azure VM size (Standard_B2s = 2 vCPU, 4 GB — equivalent to AWS t3.small)"
  type        = string
  default     = "Standard_B2s"
}

variable "os_disk_size" {
  description = "OS disk size in GB"
  type        = number
  default     = 50
}

variable "admin_username" {
  description = "Admin username for the VM (SSH key auth only, no password)"
  type        = string
  default     = "azureuser"
}

# ── DNS ──────────────────────────────────────

variable "domain_name" {
  description = "Root domain name"
  type        = string
  default     = "ffd-connect.fr"
}

variable "api_subdomain" {
  description = "API subdomain (api or api-staging)"
  type        = string
  default     = "api"
}

variable "create_dns_zone" {
  description = "Whether to create a new Azure DNS zone (false if zone already exists)"
  type        = bool
  default     = false
}

variable "existing_dns_zone_name" {
  description = "Existing Azure DNS zone name (required if create_dns_zone = false)"
  type        = string
  default     = ""
}

variable "existing_dns_zone_rg" {
  description = "Resource group of the existing Azure DNS zone (required if create_dns_zone = false)"
  type        = string
  default     = ""
}

# ── TLS (Caddy / Let's Encrypt) ──────────────

variable "acme_email" {
  description = "Email for Let's Encrypt certificate notifications"
  type        = string
}

# ── Monitoring ───────────────────────────────

# Renamed from `budget_monthly_limit` (#681) so a stale local tfvars value
# (150) cannot silently override the new envelope: Terraform warns about the
# undeclared old name and falls back to this default.
variable "budget_monthly_limit_eur" {
  description = "Monthly subscription budget in EUR (the billing account currency; Azure budgets have no currency field). Beta envelope ~20-25 EUR/month of infra (ADR-0019)."
  type        = number
  default     = 30
}

variable "budget_alert_email" {
  description = "Email address for budget and alarm notifications"
  type        = string
}

# ── Tags ─────────────────────────────────────

variable "tags" {
  description = "Additional tags applied to all resources"
  type        = map(string)
  default     = {}
}

# ── CI/CD ───────────────────────────────────

variable "github_org" {
  description = "GitHub organization or user owning the repo (for federated identity)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (for federated identity)"
  type        = string
  default     = "FFD-Connect"
}

variable "github_org_id" {
  description = "Numeric GitHub org ID, part of the immutable OIDC subject (gh api orgs/<org> -q .id)"
  type        = string
  default     = "266684440"
}

variable "github_repo_id" {
  description = "Numeric GitHub repo ID, part of the immutable OIDC subject (gh api repos/<org>/<repo> -q .id) — changes if the repo is recreated"
  type        = string
  default     = "1405722043"
}

# ── AI services (OCR / TTS) ─────────────────

variable "backend_managed_identity_principal_ids" {
  description = "Object (principal) IDs of the backend Container Apps' managed identities (staging + prod share the AI accounts), each granted 'Cognitive Services User' on the Vision/Speech accounts. Defaults to the current backend-staging + backend-prod system-assigned identities (stable unless an app is recreated). Fetch: az containerapp show -n backend-<env> -g <rg> --query identity.principalId -o tsv. Empty set = skip the role assignments."
  type        = set(string)
  # backend-staging + backend-prod system-assigned managed identities (RG
  # FFD-CONNECT-PRODUCTION-RG). Matches the applied state (role assignments
  # created 2026-07-12). If a Container App is recreated, refresh its id here.
  default = [
    "b0d93235-6ca5-4593-86c5-c24fd47b2fba", # backend-staging
    "270b19f2-e363-4206-be9e-6bca71c18cdf", # backend-prod
  ]
}

# ── Release keys (app distribution, ADR-0020) ──

variable "release_keys_vault_name" {
  description = "Name of the Key Vault holding the app-distribution keys read by the beta promotion (3-24 chars, globally unique). Must match KV_NAME in eas-build.yml (promote-beta)."
  type        = string
  default     = "ffd-connect-release-kv"
}

variable "release_keys_officer_principal_ids" {
  description = "Object IDs granted 'Key Vault Secrets Officer' on the release-keys vault (humans who set/rotate the values). Empty = the principal running terraform apply."
  type        = set(string)
  default     = []
}
