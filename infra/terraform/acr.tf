# ============================================
# ACR — Azure Container Registry for immutable deploys
# ============================================
# Images are tagged with the git SHA and pushed by CI.
# The VM pulls the exact image validated by CI.
# Admin access disabled — use managed identity instead.

resource "azurerm_container_registry" "backend" {
  name                = "${replace(var.project, "-", "")}${var.environment}acr"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false

  # Note: retention_policy requires Premium SKU.
  # On Basic SKU, rely on CI cleanup scripts to prune old images
  # (e.g. `az acr run --cmd "acr purge" ...`).

  tags = { Name = "${local.name_prefix}-acr-backend" }
}
