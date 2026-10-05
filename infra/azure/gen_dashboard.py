#!/usr/bin/env python3
"""Generate an Azure Portal dashboard ARM template for FFD-Connect beta infra."""
import json

SUB = "57d71dab-df99-43e0-bdd5-8ba55699ef15"
RG = "ffd-connect-production-rg"
RG_ID = f"/subscriptions/{SUB}/resourceGroups/{RG}"
BUDGET_ID = f"/subscriptions/{SUB}/providers/Microsoft.Consumption/budgets/ffd-connect-production-monthly"
LOC = "northeurope"
CA_NS = "microsoft.app/containerapps"
PG_NS = "microsoft.dbforpostgresql/flexibleservers"

def ca_id(name):
    return f"/subscriptions/{SUB}/resourceGroups/{RG}/providers/Microsoft.App/containerApps/{name}"
PG_ID = f"/subscriptions/{SUB}/resourceGroups/{RG}/providers/Microsoft.DBforPostgreSQL/flexibleServers/ffd-connect-pg"

APPS = ["backend-prod", "backend-staging", "landing", "ffd-redis-prod", "ffd-redis-staging"]
BACKENDS = ["backend-prod", "backend-staging"]

# aggregationType enum: 1=Total, 2=Min, 3=Max, 4=Average, 7=Count
AVG, TOTAL = 4, 1

def metric(rid, name, ns, disp, agg=AVG):
    return {
        "resourceMetadata": {"id": rid},
        "name": name,
        "aggregationType": agg,
        "namespace": ns,
        "metricVisualization": {"displayName": disp},
    }

def chart_part(x, y, w, h, title, metrics, chart_type=2):
    return {
        "position": {"x": x, "y": y, "colSpan": w, "rowSpan": h},
        "metadata": {
            "inputs": [
                {"name": "options", "isOptional": True},
                {"name": "sharedTimeRange", "isOptional": True},
            ],
            "type": "Extension/HubsExtension/PartType/MonitorChartPart",
            "settings": {
                "content": {
                    "options": {
                        "chart": {
                            "metrics": metrics,
                            "title": title,
                            "titleKind": 1,
                            "visualization": {
                                "chartType": chart_type,
                                "legendVisualization": {"isVisible": True, "position": 2, "hideSubtitle": False},
                                "axisVisualization": {"x": {"isVisible": True, "axisType": 2}, "y": {"isVisible": True, "axisType": 1}},
                            },
                        }
                    }
                }
            },
        },
    }

def markdown_part(x, y, w, h, title, content, subtitle=""):
    return {
        "position": {"x": x, "y": y, "colSpan": w, "rowSpan": h},
        "metadata": {
            "inputs": [],
            "type": "Extension/HubsExtension/PartType/MarkdownPart",
            "settings": {
                "content": {
                    "settings": {
                        "content": content,
                        "title": title,
                        "subtitle": subtitle,
                        "markdownSource": 1,
                    }
                }
            },
        },
    }

def cost_part(x, y, w, h, title, chart, grouping=None, with_budget=False, accumulated=False):
    dataset = {"granularity": "Daily" if accumulated else "None",
               "aggregation": {"totalCost": {"name": "Cost", "function": "Sum"}}}
    if grouping:
        dataset["grouping"] = [{"type": "Dimension", "name": grouping}]
    kpis = []
    if with_budget:
        kpis = [
            {"type": "Forecast", "id": "", "enabled": True},
            {"type": "Budget", "id": BUDGET_ID, "enabled": True,
             "extendedProperties": {"name": "ffd-connect-production-monthly"}},
        ]
    view = {
        "currency": "EUR",
        "dateRange": "ThisMonth",
        "query": {"type": "ActualCost", "dataSet": dataset, "timeframe": "MonthToDate"},
        "chart": chart,
        "accumulated": "true" if accumulated else "false",
        "pivots": [{"type": "Dimension", "name": grouping or "ServiceName"}],
        "kpis": kpis,
        "scope": RG_ID,
        "displayName": title,
    }
    return {
        "position": {"x": x, "y": y, "colSpan": w, "rowSpan": h},
        "metadata": {
            "inputs": [
                {"name": "scope", "value": RG_ID, "isOptional": True},
                {"name": "scopeName", "value": RG, "isOptional": True},
            ],
            "type": "Extension/Microsoft_Azure_CostManagement/PartType/CostAnalysisPinPart",
            "settings": {"content": {"view": view, "scope": RG_ID}},
            "partHeader": {"title": title, "subtitle": "ce mois-ci"},
        },
    }

parts = []

# Row 0 — COST: accumulated (with budget line) + by service
parts.append(cost_part(0, 0, 7, 4, "Coût cumulé vs budget (30 €)", "Area",
                       with_budget=True, accumulated=True))
parts.append(cost_part(7, 0, 5, 4, "Coût par service", "Donut", grouping="ServiceName"))

# Row 4 — info markdown (full width, short)
info_md = (
    "### ℹ️ FFD-Connect — Beta   ·   Budget **30 €/mois**  ·  Enveloppe **2000 €**\n"
    "**Beta → staging** (`api-staging`)  ·  **Prod endormie** (`min=0`)  ·  "
    "Postgres `ffd-connect-pg` **partagé** prod+staging  ·  toutes les Container Apps `min=0` (réveil HTTP à la demande)  ·  "
    "_ADR-0019 (stratégie prod/staging)_"
)
parts.append(markdown_part(0, 4, 12, 2, "", info_md))

# Row 6 — Container Apps CPU% & Memory%
parts.append(chart_part(0, 6, 6, 4, "Container Apps — CPU %",
    [metric(ca_id(a), "CpuPercentage", CA_NS, a) for a in APPS]))
parts.append(chart_part(6, 6, 6, 4, "Container Apps — Mémoire %",
    [metric(ca_id(a), "MemoryPercentage", CA_NS, a) for a in APPS]))

# Row 10 — Replicas (awake/asleep) & Requests by status
parts.append(chart_part(0, 10, 6, 4, "Container Apps — Replicas (éveil/veille)",
    [metric(ca_id(a), "Replicas", CA_NS, a) for a in APPS]))
parts.append(chart_part(6, 10, 6, 4, "Backends — Requêtes (Total)",
    [metric(ca_id(a), "Requests", CA_NS, a, TOTAL) for a in BACKENDS]))

# Row 14 — Response time (availability/latency) & Restart count
parts.append(chart_part(0, 14, 6, 4, "Backends — Temps de réponse (ms)",
    [metric(ca_id(a), "ResponseTime", CA_NS, a) for a in BACKENDS]))
parts.append(chart_part(6, 14, 6, 4, "Container Apps — Redémarrages",
    [metric(ca_id(a), "RestartCount", CA_NS, a, TOTAL) for a in BACKENDS]))

# Row 18 — Postgres CPU/Mem & storage
parts.append(chart_part(0, 18, 6, 4, "PostgreSQL — CPU % / Mémoire %",
    [metric(PG_ID, "cpu_percent", PG_NS, "CPU %"),
     metric(PG_ID, "memory_percent", PG_NS, "Mémoire %")]))
parts.append(chart_part(6, 18, 6, 4, "PostgreSQL — Stockage %",
    [metric(PG_ID, "storage_percent", PG_NS, "Stockage %")]))

# Row 22 — Postgres connections
parts.append(chart_part(0, 22, 6, 4, "PostgreSQL — Connexions actives",
    [metric(PG_ID, "active_connections", PG_NS, "Connexions actives")]))

dashboard = {
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {},
    "resources": [
        {
            "type": "Microsoft.Portal/dashboards",
            "apiVersion": "2020-09-01-preview",
            "name": "ffd-connect-beta",
            "location": LOC,
            "tags": {"hidden-title": "FFD-Connect — Beta"},
            "properties": {
                "lenses": [{"order": 0, "parts": parts}],
                "metadata": {
                    "model": {
                        "timeRange": {
                            "value": {"relative": {"duration": 24, "timeUnit": 1}},
                            "type": "MsPortalFx.Composition.Configuration.ValueTypes.TimeRange",
                        },
                        "filterLocale": {"value": "fr-fr"},
                    }
                },
            },
        }
    ],
}

import os
out = os.path.join(os.path.dirname(__file__), "dashboard.json")
with open(out, "w") as f:
    json.dump(dashboard, f, indent=2, ensure_ascii=False)
print("wrote", out, "with", len(parts), "tiles")
