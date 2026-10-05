# Backend — FFD-Connect

## Role

API NestJS 11 (TypeScript strict) du monorepo FFD-Connect. Elle gere les competitions, licences, clubs, partenariats, musique et paiements. Architecture modulaire : chaque domaine est un module NestJS (controller + services).

## Prerequis & installation

Depuis la racine du monorepo :

```bash
pnpm install
docker compose --profile infra up -d   # Postgres + Redis
```

Configuration de l'environnement (dans `apps/backend/`) :

```bash
cp .env.example .env
```

Voir [../../docs/configuration/environment-variables.md](../../docs/configuration/environment-variables.md) pour le detail des variables.

## Base de donnees

Schema Prisma 7 decoupe par domaine dans `prisma/schema/`. Depuis `apps/backend/` :

```bash
pnpm exec prisma generate      # Genere le client Prisma
pnpm exec prisma migrate dev   # Applique les migrations (Postgres requis) — alias: pnpm migrate
pnpm exec prisma db seed       # Seed (tsx prisma/seed.ts)
```

## Demarrage

```bash
pnpm start:dev     # NestJS en watch → http://localhost:3000 (port PORT, defaut 3000)
```

- Swagger : `http://localhost:3000/api` — **cache en production**.
- Health : `GET /health` (verifie DB + Redis) et `GET /health/live` (liveness). Ces routes sont exclues du prefixe global `/api/v1`.

Toutes les autres routes sont prefixees par `/api/v1`.

## Structure

`src/` — modules metier :

- `auth`, `users`, `clubs`, `competitions`, `licenses`, `career`, `tracks`, `tts`, `notifications`, `reports`, `payment`, `wdsf`, `health`

Infra transverse :

- `common`, `config`, `prisma`, `redis`, `storage`, `utils`

`storage` est un service interne (Azure Blob) sans controller REST, consomme par d'autres modules.

Pattern : les services sont decomposes par responsabilite (`QueryService` en lecture / `Service` en ecriture) — voir [../../docs/adr/0014-service-decomposition-pattern.md](../../docs/adr/0014-service-decomposition-pattern.md).

## Tests

```bash
pnpm test              # Tests unitaires (jest --silent)
pnpm test:e2e          # Tests e2e
pnpm test:integration  # Tests d'integration (DB reelle, .env.test)
pnpm test:cov          # Couverture
pnpm test:mutation     # Mutation testing (Stryker)
```

Seuils de couverture (voir `jest.config.js`) : global `statements 58 / branches 52 / functions 65 / lines 57`. Des seuils plus eleves sont appliques par dossier, notamment `auth` (94 %) et `payment`. Le module `auth` est une zone sensible.

## Build & deploiement

```bash
pnpm build         # nest build → dist/
pnpm start:prod    # node dist/main
```

Conteneurisation via `Dockerfile`. Deploiement sur Azure Container Apps — voir [../../docs/exploitation/deploiement-azure.md](../../docs/exploitation/deploiement-azure.md).

## Liens

- [README racine du monorepo](../../README.md)
- [Documentation architecture](../../docs/architecture/)
- [Variables d'environnement](../../docs/configuration/environment-variables.md)
- [Scripts backend](./scripts/README.md)
- [Tests backend](./test/README.md)
