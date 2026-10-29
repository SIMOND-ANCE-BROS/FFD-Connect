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

variable "release_keys_audit_enabled" {
  description = "Send the release-keys vault AuditEvent logs (who read which distribution key) to a dedicated, capped Log Analytics workspace. Default false: no workspace exists yet. ~0 EUR/month when enabled (a few KB/month, within the 5 GB free ingestion)."
  type        = bool
  default     = false
}

# ── DB migration jobs (ADR-0025) ────────────

variable "container_app_environment_name" {
  description = "Name of the Container Apps environment (created outside Terraform) hosting the backend apps and the migration jobs."
  type        = string
  default     = "ffd-connect-cae"
}

variable "runtime_key_vault_name" {
  description = "Name of the runtime Key Vault (created outside Terraform) holding the per-environment DB URLs (db-url-staging, db-url-prod)."
  type        = string
  default     = "ffd-connect-kv"
}

variable "migrate_jobs" {
  description = "Environments that get a DB migration job (ADR-0025), keyed by short env name (job = backend-migrate-<key>), with the Key Vault secret holding that environment's DATABASE_URL. Staging only until backend-prod restarts (#215): then add prod = { db_url_secret_name = \"db-url-prod\" }."
  type = map(object({
    db_url_secret_name = string
  }))
  default = {
    staging = { db_url_secret_name = "db-url-staging" }
  }

  validation {
    condition     = alltrue([for k in keys(var.migrate_jobs) : contains(["staging", "prod"], k)])
    error_message = "migrate_jobs keys must be 'staging' or 'prod' (they name the job backend-migrate-<key>)."
  }
}

variable "migrate_job_placeholder_image" {
  description = "Image of the migration job TEMPLATE. Never used for a migration: deploy-backend.yml starts every execution with the backend image of the SHA being deployed. A public placeholder keeps the template from pinning an ACR tag (acr-purge.sh keeps every image a job references)."
  type        = string
  default     = "mcr.microsoft.com/k8se/quickstart-jobs:latest"
}

# ── Backend app secrets — Key Vault references (#848) ──

variable "backend_app_key_vault_secrets" {
  description = "Per environment (staging / prod): the backend Container App's system-assigned identity principal id and the runtime Key Vault secrets it may read (Key Vault Secrets User, one assignment per secret). Values are created out-of-band, never in Terraform. Fetch the principal id: az containerapp show -n backend-<env> -g <rg> --query identity.principalId -o tsv."
  type = map(object({
    principal_id = string
    secret_names = set(string)
  }))
  default = {
    staging = {
      principal_id = "b0d93235-6ca5-4593-86c5-c24fd47b2fba" # backend-staging (system-assigned)
      secret_names = [
        "jwt-secret-staging",           # JWT_SECRET
        "resend-api-key-staging",       # RESEND_API_KEY
        "sentry-dsn-staging",           # SENTRY_DSN
        "wdsf-username-staging",        # WDSF_USERNAME
        "wdsf-password-staging",        # WDSF_PASSWORD
        "wdsf-api-key-staging",         # WDSF_API_KEY
        "beta-tester-licenses-staging", # BETA_TESTER_LICENSES
      ]
    }
  }

  validation {
    condition     = alltrue([for k in keys(var.backend_app_key_vault_secrets) : contains(["staging", "prod"], k)])
    error_message = "backend_app_key_vault_secrets keys must be 'staging' or 'prod'."
  }

  # Isolation guard: an environment may only be granted secrets suffixed with
  # its own name, so a typo cannot hand a prod secret to the staging identity.
  validation {
    condition = alltrue(flatten([
      for env, cfg in var.backend_app_key_vault_secrets : [
        for s in cfg.secret_names : endswith(s, "-${env}")
      ]
    ]))
    error_message = "Each secret granted to an environment must end with -<env> (e.g. jwt-secret-staging for staging)."
  }
}
