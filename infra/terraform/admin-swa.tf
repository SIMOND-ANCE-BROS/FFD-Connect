# ============================================
# Admin back-office (apps/admin) — static SPA, Free tier (0 EUR).
# ============================================
# Deployed by .github/workflows/deploy-admin.yml: the job logs in via OIDC
# with a dedicated identity (azuread_application.ci_admin in ci-iam.tf, trusted
# only from the GitHub environment `admin`) and reads the SWA deployment token
# at run time through a custom role assigned on this SWA only. No token is
# stored in GitHub.
#
# Static Web Apps is not offered in francecentral; westeurope is the closest
# region. Only the static content lives there — the API stays on the CAE.
#
# The custom domain needs the Cloudflare CNAME (admin.ffd.gabin-simond.fr →
# admin_swa_hostname output, DNS-only) to exist BEFORE apply, otherwise the
# cname-delegation validation fails. See docs/exploitation/backoffice-admin.md.

resource "azurerm_static_web_app" "admin" {
  name                = "swa-ffd-admin"
  resource_group_name = azurerm_resource_group.main.name
  location            = "westeurope"
  sku_tier            = "Free"
  sku_size            = "Free"

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_static_web_app_custom_domain" "admin" {
  static_web_app_id = azurerm_static_web_app.admin.id
  domain_name       = "admin.ffd.gabin-simond.fr"
  validation_type   = "cname-delegation"
}
