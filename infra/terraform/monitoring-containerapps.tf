# ============================================
# Container Apps — metric alerts (no wake)
# ============================================
# Platform metric alerts evaluated 100% inside Azure Monitor — no HTTP call to
# the app, so they NEVER wake a scaled-to-zero replica and stay active 24/7,
# including at night when uptime.yml is blind (the app is intentionally asleep).
#
# The Container Apps are provisioned out-of-band (not by this Terraform), so we
# reference them via data sources. A data lookup reads ARM metadata
# (control-plane) — it does NOT hit the app data-plane, so it does not wake it.
#
# Metric names + aggregations confirmed via `az monitor metrics
# list-definitions` (2026-07): RestartCount ("Total Replica Restart Count",
# primary aggregation Maximum) and Replicas ("Replica Count", Maximum). A
# scale-from-zero wake is a start, not a restart, so it does not increment
# RestartCount — the night-coverage design holds without threshold tuning.

data "azurerm_container_app" "backend_prod" {
  name                = "backend-prod"
  resource_group_name = azurerm_resource_group.main.name
}

data "azurerm_container_app" "backend_staging" {
  name                = "backend-staging"
  resource_group_name = azurerm_resource_group.main.name
}

locals {
  aca_metric_namespace = "Microsoft.App/containerApps"
}

# ── Restart storm = crash loop / failed boot migration / OOM ──────────────────
# The core night-coverage signal. A healthy wake (0->1 replica) is a start, not
# a restart, so it does not fire; an asleep app (0 replicas) produces 0 restarts
# → no nightly false positive. Also catches "revision that won't stay up".
resource "azurerm_monitor_metric_alert" "aca_restart_prod" {
  name                = "${local.name_prefix}-aca-restart-prod"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [data.azurerm_container_app.backend_prod.id]
  description         = "backend-prod: container restart storm (crash loop / boot migration / OOM)"
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT15M"
  auto_mitigate       = true

  criteria {
    metric_namespace = local.aca_metric_namespace
    metric_name      = "RestartCount"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }

  tags = { Name = "${local.name_prefix}-aca-restart-prod" }
}

resource "azurerm_monitor_metric_alert" "aca_restart_staging" {
  name                = "${local.name_prefix}-aca-restart-staging"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [data.azurerm_container_app.backend_staging.id]
  description         = "backend-staging: container restart storm"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  auto_mitigate       = true

  criteria {
    metric_namespace = local.aca_metric_namespace
    metric_name      = "RestartCount"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 5
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }

  tags = { Name = "${local.name_prefix}-aca-restart-staging" }
}

# ── Replica runaway = scale-out gone wrong (budget guard) ─────────────────────
# We deliberately do NOT alert on "too few replicas" (Minimum < 1): that is the
# normal nightly state under scale-to-zero and would page every night. Alerting
# on an unexpectedly HIGH replica count is night-safe (0 replicas never fires)
# and guards the tight beta budget against a runaway scale-out.
resource "azurerm_monitor_metric_alert" "aca_replicas_runaway_prod" {
  name                = "${local.name_prefix}-aca-replicas-runaway-prod"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [data.azurerm_container_app.backend_prod.id]
  description         = "backend-prod: replica count abnormally high (runaway scale-out / cost)"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  auto_mitigate       = true

  criteria {
    metric_namespace = local.aca_metric_namespace
    metric_name      = "Replicas"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 3 # align to (real maxReplicas - 1)
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }

  tags = { Name = "${local.name_prefix}-aca-replicas-runaway-prod" }
}
