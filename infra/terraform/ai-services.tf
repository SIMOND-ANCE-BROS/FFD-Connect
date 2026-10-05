# ============================================
# Azure AI (Cognitive Services) — OCR + TTS
# ============================================
# Vision (Image Analysis "Read" → OCR licences/certificats) and Speech (TTS
# annonces) replace the former Google Cloud services. Auth is via the backend
# Container App's MANAGED IDENTITY — no downloadable keys (local_auth_enabled
# = false). A custom subdomain is REQUIRED for Azure AD / managed-identity
# token auth on Cognitive Services data-plane calls.

resource "azurerm_cognitive_account" "vision" {
  name                  = "${local.name_prefix}-vision"
  resource_group_name   = azurerm_resource_group.main.name
  location              = azurerm_resource_group.main.location
  kind                  = "ComputerVision"
  sku_name              = "S1" # switch to "F0" for the free tier (quota-limited)
  custom_subdomain_name = "${local.name_prefix}-vision"
  local_auth_enabled    = false # managed identity only — no API keys issued

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_cognitive_account" "speech" {
  name                  = "${local.name_prefix}-speech"
  resource_group_name   = azurerm_resource_group.main.name
  location              = azurerm_resource_group.main.location
  kind                  = "SpeechServices"
  sku_name              = "S0" # "F0" free tier available (quota-limited)
  custom_subdomain_name = "${local.name_prefix}-speech"
  local_auth_enabled    = false

  tags = azurerm_resource_group.main.tags
}

# Grant each backend Container App's managed identity permission to CALL both
# services. The Container Apps + their identities are provisioned OUTSIDE this
# Terraform (via the deploy pipeline / az CLI); their principal ids are passed
# in. staging + prod share these AI accounts, so both are granted. Fetch with:
#   az containerapp show -n backend-<env> -g <rg> --query identity.principalId -o tsv
# Leave the set empty to skip these (then grant the role manually).
resource "azurerm_role_assignment" "backend_vision_user" {
  for_each             = var.backend_managed_identity_principal_ids
  scope                = azurerm_cognitive_account.vision.id
  role_definition_name = "Cognitive Services User"
  principal_id         = each.value
}

resource "azurerm_role_assignment" "backend_speech_user" {
  for_each             = var.backend_managed_identity_principal_ids
  scope                = azurerm_cognitive_account.speech.id
  role_definition_name = "Cognitive Services User"
  principal_id         = each.value
}
