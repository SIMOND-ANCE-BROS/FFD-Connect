# ADR-0017: Migration de l'infrastructure vers Azure Container Apps

**Date**: 2026-04-27
**Status**: accepted (PR #245)
**Deciders**: Gabin Simond

## Context

Le backend tournait initialement sur une VM unique via `docker compose`, ce qui impliquait de gérer manuellement le système d'exploitation, les mises à jour et le cycle de vie du conteneur. Une migration vers AWS avait été planifiée (voir `docs/archives/aws-migration-checklist-2026-04.md`) mais a été abandonnée au profit d'Azure. Nous avons besoin de déploiements immuables, reproductibles, faciles à annuler (rollback), et d'une infrastructure sans gestion de VM.

## Decision

Héberger le backend sur **Azure Container Apps**.

- **Registre d'images** : Azure Container Registry (ACR), repo `ffd-connect-backend`, images taguées par SHA de commit.
- **Déploiement** : `az containerapp update --image` en mode single-revision, déclenché par le workflow `deploy-backend.yml` après la CI (`staging` → `backend-staging`, `master` → `backend-prod`).
- **Authentification CI** : OIDC federated (aucun secret long-terme stocké côté CI).
- **Stockage objets** : Azure Blob Storage (pistes audio + certificats de licence).
- **Secrets DB** : par environnement via Azure Key Vault + managed identity.
- **Fiabilité déploiement** : smoke test sur `/health` + auto-rollback en cas d'échec.

## Alternatives Considered

### Alternative 1: VM unique + docker compose (statu quo)

- **Pros**: Simple, déjà en place, contrôle total
- **Cons**: Gestion manuelle de l'OS et du conteneur, rollback fastidieux, pas de scale-to-zero
- **Why not**: La charge opérationnelle de la gestion de VM n'est pas justifiée pour une petite équipe

### Alternative 2: AWS (ECS / Fargate)

- **Pros**: Écosystème mature, checklist de migration déjà rédigée
- **Cons**: Complexité de mise en place, pas d'avantage décisif sur Azure pour nos besoins
- **Why not**: Planification abandonnée ; Azure retenu (voir archive AWS)

### Alternative 3: Kubernetes managé (AKS)

- **Pros**: Flexibilité maximale, standard de l'industrie
- **Cons**: Surdimensionné pour un seul service backend, charge opérationnelle élevée
- **Why not**: Container Apps couvre le besoin sans la complexité de Kubernetes

## Consequences

### Positive

- Déploiements immuables tagués par SHA + rollback trivial
- Scale-to-zero possible
- Plus aucune gestion de VM

### Negative

- Démarrage à froid d'une révision plus lent qu'une VM (le smoke test attend jusqu'à 180s)
- Les migrations DB doivent être rétrocompatibles pour permettre un rollback sans casse

### Notes

- Supersede la planification de migration AWS (archivée dans `docs/archives/aws-migration-checklist-2026-04.md`).
- Détails opérationnels : `docs/exploitation/deploiement-azure.md`.
