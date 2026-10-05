# ADR-0019: Stratégie d'environnements prod/staging (infra partagée)

**Date**: 2026-07-08
**Status**: accepted
**Deciders**: Gabin Simond

## Context

Après le retrait du stack mono-VM (voir [ADR-0017](0017-migration-azure-container-apps.md)) et le nettoyage des ressources Azure obsolètes (juillet 2026), l'infrastructure tient dans **deux resource groups** :

- `ffd-connect-production-rg` : tout le runtime applicatif (Container Apps `backend-prod`/`backend-staging`/`landing` + `ffd-redis-prod`/`ffd-redis-staging`, Container Apps Environment `ffd-connect-cae`, PostgreSQL Flexible `ffd-connect-pg`, ACR, Key Vault, storage uploads, monitoring) ;
- `ffd-connect-tfstate` : le storage account de l'état Terraform distant.

Le RG s'appelle « production » mais héberge en réalité **prod ET staging**, qui **partagent la même infrastructure physique** :

- un seul serveur PostgreSQL (`ffd-connect-pg`) avec deux bases (`ffd_connect_prod`, `ffd_connect_staging`) ;
- un seul Container Apps Environment (`ffd-connect-cae`) ;
- un seul ACR, un seul Key Vault, un seul storage uploads.

La question s'est posée de **séparer prod et staging** dans des resource groups distincts. Le projet est en **beta** (les testeurs TestFlight tapent sur staging via `api-staging` — le profil EAS `beta` hérite de `preview`), porté par un seul développeur avec un budget serré (~2000 €). L'objectif actuel est le **coût minimal** sans sacrifier la capacité de tester avant de livrer.

## Decision

**Conserver une infrastructure partagée dans un resource group unique pour la durée de la beta.** L'isolation prod/staging repose sur des **ressources logiques séparées, pas sur des resource groups distincts** :

- bases de données distinctes (`ffd_connect_prod` vs `ffd_connect_staging`) sur le serveur partagé ;
- Container Apps distinctes par environnement (`backend-prod` vs `backend-staging`, `ffd-redis-prod` vs `ffd-redis-staging`) ;
- secrets isolés par environnement (Key Vault + managed identity, voir la rotation des secrets DB per-env).

Pour maîtriser les coûts pendant la beta, toutes les Container Apps sont en `minReplicas = 0` (réveil à la demande sur requête HTTP).

**Déclencheur de re-évaluation** : au **lancement de la vraie production** (utilisateurs réels), passer à une séparation forte (serveur PostgreSQL prod dédié, idéalement Container Apps Environment prod séparé, et à ce moment un resource group `ffd-connect-staging-rg` distinct). Voir « Alternatives ».

## Alternatives Considered

### Alternative 1: Deux resource groups séparés (prod + staging) dès maintenant

- **Pros** : rayon d'action réduit (supprimer staging sans toucher prod), RBAC et budgets par environnement, modèle mental plus clair.
- **Cons** : les ressources partagées (CAE, Postgres, ACR, Key Vault) vivent dans un seul RG — les répartir n'apporte pas d'isolation runtime réelle. Certaines ressources (le Container Apps Environment notamment) ne se déplacent pas proprement entre RG et devraient être **recréées**. Effort et risque élevés pour un bénéfice surtout cosmétique en beta.
- **Why not** : un resource group est un conteneur organisationnel, pas une frontière d'isolation. Tant que l'infra est physiquement partagée, séparer les RG ne protège pas la prod des tests staging.

### Alternative 2: Isolation complète (infra prod et staging dupliquée)

- **Pros** : isolation maximale (un incident staging ne peut pas impacter la prod), gestion du cycle de vie indépendante.
- **Cons** : **double ~la facture** (serveur Postgres, CAE, Redis, etc. en double).
- **Why not** : disproportionné pour une beta à faible trafic portée par un seul développeur avec un budget serré. À réserver au lancement de la production réelle.

## Consequences

### Positive

- Coût minimal pendant la beta (~20-25 €/mois) grâce à l'infra partagée + `minReplicas = 0`.
- Séparation logique suffisante pour tester en staging avant de livrer (bases, apps et secrets distincts).
- Moins de surface Terraform et opérationnelle à gérer.

### Negative

- Un incident sur une ressource partagée (serveur Postgres, CAE) impacte **les deux** environnements.
- Le nommage `ffd-connect-production-rg` est trompeur (il contient aussi staging) — assumé et documenté ici.
- Pas de budget/RBAC séparé par environnement.

### Risks

- **Un test staging pourrait dégrader la prod** (serveur DB / CAE communs). Mitigation : les bases sont distinctes ; surveiller la charge ; **passer à un serveur Postgres prod dédié dès le lancement** de la vraie production.
- **Dérive de la décision** : rester en partagé au-delà de la beta par inertie. Mitigation : ce déclencheur (lancement prod) est acté ici et à revoir à ce moment.
