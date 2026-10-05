# ============================================
# Monitoring — Azure Monitor Alerts + Budget
# ============================================

# ── Action group for email alerts ───────────

resource "azurerm_monitor_action_group" "alerts" {
  name                = "${local.name_prefix}-alerts"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "ffd-alerts"

  email_receiver {
    name                    = "admin"
    email_address           = var.budget_alert_email
    use_common_alert_schema = true
  }

  tags = { Name = "${local.name_prefix}-alerts" }
}

# NOTE: The VM CPU/disk metric alerts were removed when the single-VM
# stack was retired (2026-07). Container Apps alerts live in
# monitoring-containerapps.tf.

# ── Budget alert ─────────────────────────────
# ONE subscription-scoped budget (issue #681). Until then there were two
# same-named budgets: a resource-group one managed here (150, commented "USD")
# and a subscription one created out-of-band (140). Both double-alerted and
# neither matched the ~20-25 EUR/month beta envelope (ADR-0019). Subscription
# scope is deliberate: it also catches spend outside FFD-CONNECT-PRODUCTION-RG
# (tfstate storage, any stray resource).
#
# Currency: an Azure budget has no currency field — the amount is in the
# billing account currency, which is EUR for this subscription (Cost
# Management reports `currentSpend.unit = EUR`).
#
# The out-of-band subscription budget is ADOPTED by the `import` block below
# rather than deleted and recreated, so there is never a window without a
# budget. Once it is in state the import is a no-op; the block can be removed
# after the first apply.

import {
  to = azurerm_consumption_budget_subscription.monthly
  id = "${data.azurerm_subscription.current.id}/providers/Microsoft.Consumption/budgets/${local.name_prefix}-monthly"
}

resource "azurerm_consumption_budget_subscription" "monthly" {
  name            = "${local.name_prefix}-monthly"
  subscription_id = data.azurerm_subscription.current.id

  amount     = var.budget_monthly_limit_eur
  time_grain = "Monthly"

  time_period {
    # Azure requires an explicit start date. Use the first of the current month.
    # After initial apply, Terraform ignores drift on start_date.
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  # Early warning — half of the monthly envelope already spent
  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 50
    threshold_type = "Actual"

    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 80
    threshold_type = "Actual"

    contact_emails = [var.budget_alert_email]
  }

  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 100
    threshold_type = "Actual"

    contact_emails = [var.budget_alert_email]
  }

  # Forecast crosses the envelope — act before the money is spent
  notification {
    enabled        = true
    operator       = "GreaterThanOrEqualTo"
    threshold      = 100
    threshold_type = "Forecasted"

    contact_emails = [var.budget_alert_email]
  }

  lifecycle {
    ignore_changes = [time_period] # Don't drift on start_date after first apply
  }
}
