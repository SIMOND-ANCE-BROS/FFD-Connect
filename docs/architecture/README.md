# Architecture — FFD Connect

Point d'entrée de la documentation d'architecture. Cette page donne la vue
d'ensemble et renvoie vers les documents détaillés ; elle ne duplique pas les
décisions (voir les [ADR](../adr/)) ni les patterns (voir [patterns.md](patterns.md)).

## Vue d'ensemble

Monorepo pnpm workspaces :

```
FFD-Connect/
├── apps/
│   ├── backend/   # API NestJS 11 (TypeScript strict)
│   ├── client/    # App React Native 0.86 / Expo SDK 57
│   ├── landing/   # Page d'accueil (Vite/React)
│   └── docs/      # Site de documentation utilisateur (Astro/Starlight)
├── packages/
│   ├── shared/    # Types partagés (@ffd-connect/shared)
│   ├── eslint-config/
│   └── jest-config/
└── docs/          # Documentation projet (ce dossier)
```

## Stack technique

| Couche          | Choix                                                                | ADR                                                   |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Backend         | NestJS 11, architecture modulaire                                    | [0002](../adr/0002-nestjs-backend-framework.md)       |
| Base de données | PostgreSQL 15 + Prisma 7 (`@prisma/adapter-pg`)                      | [0003](../adr/0003-prisma-postgresql.md)              |
| Cache / files   | Redis + BullMQ                                                       | [0010](../adr/0010-redis-bullmq-job-queue.md)         |
| Auth            | JWT + refresh tokens avec rotation                                   | [0006](../adr/0006-jwt-refresh-token-rotation.md)     |
| Mobile          | Expo (SDK 57) + React Native 0.86                                    | [0004](../adr/0004-expo-react-native.md)              |
| État client     | Zustand (state) + React Query (cache serveur) + Context (auth/thème) | [0005](../adr/0005-zustand-react-query-state.md)      |
| Paiement        | HelloAsso (webhooks)                                                 | [0013](../adr/0013-helloasso-payments.md)             |
| Observabilité   | Sentry (backend + client)                                            | [0011](../adr/0011-monitoring-newrelic-sentry.md)     |
| Infra           | Azure Container Apps + ACR + Blob Storage + Key Vault                | [0017](../adr/0017-migration-azure-container-apps.md) |

## Où trouver quoi

- **Décisions d'architecture** → [`../adr/`](../adr/) (index dans [adr/README.md](../adr/README.md))
- **Patterns transverses** (DI, décomposition de services, hooks, gestion d'erreurs, upload sans état, offline-first) → [`patterns.md`](patterns.md)
- **Détail par module backend** (auth, clubs, compétitions, licences, tracks, paiement…) → [`modules/`](modules/)
- **Règles transverses client** (navigation, rôles, erreurs) → [`modules/cross-cutting-rules.md`](modules/cross-cutting-rules.md)
- **Règles métier FFD** (rôles, niveaux couples, solo, inscriptions) → [`../regles-metier/`](../regles-metier/)
- **Soft deletes** (proposition, non implémentée) → [`soft-deletes.md`](soft-deletes.md)
- **Configuration & variables d'environnement** → [`../configuration/environment-variables.md`](../configuration/environment-variables.md)
- **Exploitation** (CI/CD, déploiement Azure) → [`../exploitation/`](../exploitation/)
- **API** (Swagger, codes d'erreur) → [`../api/`](../api/)

## Principes clés

- **Backend** : chaque domaine est un module NestJS (controllers + services). Les
  services sont décomposés par responsabilité — `QueryService` pour la lecture,
  `Service` pour l'écriture (voir [ADR-0014](../adr/0014-service-decomposition-pattern.md)).
- **Services externes** (Google TTS/Vision, WDSF, HelloAsso) : toujours enveloppés
  d'un circuit breaker (opossum) + timeout (`withTimeout`), avec dégradation gracieuse
  (voir [ADR-0009](../adr/0009-circuit-breaker-external-services.md)).
- **API versionnée** sous `/api/v1` (health exclu) — voir [ADR-0015](../adr/0015-api-versioning-global-prefix.md).
- **Client** : organisation par feature sous `src/features/`, state via stores Zustand,
  cache serveur via React Query, Context réservé à l'auth et au thème.
