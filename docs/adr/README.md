# Architecture Decision Records

Ce dossier contient les ADRs (Architecture Decision Records) du projet FFD-Connect. Chaque ADR documente une decision architecturale significative : le contexte, les alternatives envisagees, la decision prise et ses consequences.

| ADR                                                   | Title                                                    | Status     | Date       |
| ----------------------------------------------------- | -------------------------------------------------------- | ---------- | ---------- |
| [0001](0001-monorepo-pnpm-workspaces.md)              | Monorepo avec pnpm workspaces                            | accepted   | 2026-01-14 |
| [0002](0002-nestjs-backend-framework.md)              | NestJS comme framework backend                           | accepted   | 2026-01-14 |
| [0003](0003-prisma-postgresql.md)                     | Prisma ORM avec PostgreSQL                               | accepted   | 2026-01-14 |
| [0004](0004-expo-react-native.md)                     | Expo + React Native pour le mobile                       | accepted   | 2026-01-14 |
| [0005](0005-zustand-react-query-state.md)             | Zustand + React Query pour le state management           | accepted   | 2026-03-22 |
| [0006](0006-jwt-refresh-token-rotation.md)            | JWT avec rotation de refresh tokens                      | accepted   | 2026-02-15 |
| [0007](0007-rate-limiting-auth-endpoints.md)          | Rate limiting sur les endpoints auth                     | accepted   | 2026-04-02 |
| [0008](0008-swagger-hidden-production.md)             | Swagger cache en production                              | accepted   | 2026-04-02 |
| [0009](0009-circuit-breaker-external-services.md)     | Circuit breaker sur les services externes                | accepted   | 2026-03-26 |
| [0010](0010-redis-bullmq-job-queue.md)                | Redis + BullMQ pour les jobs async                       | accepted   | 2026-03-22 |
| [0011](0011-monitoring-newrelic-sentry.md)            | New Relic backend + Sentry client                        | superseded | 2026-03-16 |
| [0012](0012-testing-strategy-mutation.md)             | Strategie de test avec mutation testing                  | accepted   | 2026-02-15 |
| [0013](0013-helloasso-payments.md)                    | HelloAsso pour les paiements                             | accepted   | 2026-02-01 |
| [0014](0014-service-decomposition-pattern.md)         | Decomposition des services par responsabilite            | accepted   | 2026-02-24 |
| [0015](0015-api-versioning-global-prefix.md)          | Versioning API avec prefixe /api/v1                      | accepted   | 2026-03-25 |
| [0016](0016-ci-tiered-execution-strategy.md)          | Strategie CI par tiers (PR-only pour jobs lourds)        | accepted   | 2026-04-05 |
| [0017](0017-migration-azure-container-apps.md)        | Migration vers Azure Container Apps                      | accepted   | 2026-04-27 |
| [0018](0018-firebase-push-notifications.md)           | Firebase Cloud Messaging pour les notifications push     | accepted   | 2026-04-27 |
| [0019](0019-strategie-environnements-prod-staging.md) | Strategie d'environnements prod/staging (infra partagee) | accepted   | 2026-07-08 |
| [0020](0020-key-vault-cles-distribution.md)           | Key Vault, source de verite des cles de distribution     | proposed   | 2026-10-07 |
