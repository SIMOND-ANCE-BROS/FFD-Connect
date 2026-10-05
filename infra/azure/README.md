# Azure Portal Dashboard — FFD-Connect Beta

Dashboard de supervision de l'infrastructure beta (coûts, Container Apps, PostgreSQL, disponibilité).

Contrairement au reste de l'infra runtime, le dashboard est déployé via un **template ARM** (le type `Microsoft.Portal/dashboards` n'est plus supporté par le provider `azurerm` v4).

## Fichiers

- `dashboard.json` — template ARM déployable (généré, ne pas éditer à la main).
- `gen_dashboard.py` — générateur du template (source de vérité ; éditer ici puis régénérer).

## Contenu du dashboard

| Section           | Tuiles                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| 💶 Coûts          | Coût cumulé du mois **avec ligne de budget (30 €)** + prévision ; coût par service  |
| 🚀 Container Apps | CPU %, Mémoire %, Replicas (éveil/veille), Requêtes, Temps de réponse, Redémarrages |
| 🐘 PostgreSQL     | CPU %, Mémoire %, Stockage %, Connexions actives                                    |

Le budget affiché provient de la ressource `azurerm_consumption_budget_subscription.monthly` (budget unique, portée abonnement, en EUR)
(voir `infra/terraform/monitoring.tf`, valeur `var.budget_monthly_limit_eur`).

## Régénérer

```bash
python3 infra/azure/gen_dashboard.py   # réécrit dashboard.json
```

## Déployer / mettre à jour

```bash
az deployment group create \
  --resource-group ffd-connect-production-rg \
  --name ffd-dashboard-deploy \
  --template-file infra/azure/dashboard.json
```

Le déploiement est idempotent (même nom de dashboard `ffd-connect-beta` → écrasé).

## Ouvrir

Portail Azure → **Dashboard** → « FFD-Connect — Beta », ou lien direct :

```
https://portal.azure.com/#@<tenantId>/dashboard/arm/subscriptions/<subId>/resourceGroups/ffd-connect-production-rg/providers/Microsoft.Portal/dashboards/ffd-connect-beta
```

> Les tuiles Cost Management se chargent côté client avec les droits de l'utilisateur connecté.
> Les courbes de métriques peuvent être plates tant que les Container Apps (en `minReplicas=0`)
> ne sont pas réveillées par du trafic — c'est attendu.
