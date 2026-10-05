# ============================================
# FFD-Connect — Azure Infrastructure
# ============================================
# Terraform now manages only the shared foundation:
# resource group, Azure Container Registry, CI/CD
# OIDC identity, and monitoring (action group + budget).
# The runtime (backend/landing/redis Container Apps,
# Postgres, Key Vault, uploads storage) is provisioned
# outside Terraform. The legacy single-VM stack was
# retired in 2026-07 (migrated to Azure Container Apps).
# ============================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
  }

  # Remote state — Azure Blob (bootstrapped 2026-07, northeurope).
  # Storage: rg=ffd-connect-tfstate / account=ffdconnecttfstate / container=tfstate
  # (Standard_LRS, TLS1.2, blob versioning on, public blob access off).
  # Auth via Azure CLI / OIDC. To re-migrate: `terraform init -migrate-state`.
  backend "azurerm" {
    resource_group_name  = "ffd-connect-tfstate"
    storage_account_name = "ffdconnecttfstate"
    container_name       = "tfstate"
    key                  = "production/terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
}

# ── Resource group ──────────────────────────────

resource "azurerm_resource_group" "main" {
  name     = "${local.name_prefix}-rg"
  location = var.azure_region

  tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}

# ── Locals ──────────────────────────────────────

locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = merge(var.tags, {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  })
}
