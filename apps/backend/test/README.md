# Tests E2E Backend

## Prérequis

- **Variable d’environnement** : `DATABASE_URL` doit pointer vers une base de test (ex. `postgresql://.../ffd_connect_test`). La config Jest utilise une URL par défaut si non définie (voir `test/jest-e2e.json`).

## Stratégie : DB réelle vs mocks

| Fichier                                                                                                           | Base de données | Remarque                                                            |
| ----------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `competitions.e2e-spec.ts`                                                                                        | **Réelle**      | Cleanup + seed user + JWT à chaque test. Nécessite Postgres.        |
| `auth-db.e2e-spec.ts`                                                                                             | **Réelle**      | Crée/supprime un utilisateur pour tester le login avec DB.          |
| `auth.e2e-spec.ts`                                                                                                | **Mockée**      | `PrismaService` remplacé par un mock. Pas besoin de DB.             |
| `auth-additional.e2e-spec.ts`                                                                                     | **Mockée**      | Idem.                                                               |
| `health.e2e-spec.ts`                                                                                              | **Mockée**      | Prisma + Redis mockés.                                              |
| `competitions-additional.e2e-spec.ts`                                                                             | **Mockée**      | Prisma, Redis, HttpService mockés.                                  |
| `tracks.e2e-spec.ts`, `tracks-additional.e2e-spec.ts`                                                             | **Réelle**      | Seul `TracksService` est overridé ; Prisma reste réel.              |
| `tts.e2e-spec.ts`, `wdsf.e2e-spec.ts`, `notifications.e2e-spec.ts`, `licenses.e2e-spec.ts`, `reports.e2e-spec.ts` | **Réelle**      | Un service métier est mocké, pas Prisma. DB utilisée pour le reste. |

En résumé : tous les E2E **sauf** `auth*`, `health`, `competitions-additional` touchent à une base réelle. Pour lancer toute la suite E2E, avoir Postgres (et si besoin Redis) disponibles.

## Lancer les tests

```bash
# Depuis la racine du monorepo
pnpm --filter backend test:e2e

# Depuis apps/backend
pnpm test:e2e
```

## Base de test : migrations réelles (#272)

Le `globalSetup` des suites intégration et e2e (`test/setup/global-setup.ts`) construit la base avec **`prisma migrate deploy`**, comme le conteneur au démarrage, puis vérifie avec `prisma migrate diff --exit-code` que le schéma Prisma n'a aucun changement sans migration. Toute migration (schéma et données écrites à la main) est donc rejouée à chaque PR ; une migration cassée ou oubliée fait échouer la CI.

- Idempotent : sur une base à jour, `migrate deploy` ne fait rien (verrou consultatif Postgres en cas d'exécutions concurrentes).
- Une base créée par l'ancien `prisma db push` n'a pas d'historique de migrations : `migrate deploy` la refuse (P3005). Utiliser une base neuve.

Reproduire en local, sur une base **jetable** uniquement (jamais la base de dev partagée) :

```bash
docker run -d --rm --name ffd-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test -p 5440:5432 postgres:15
export DATABASE_URL=postgresql://test:test@localhost:5440/test
pnpm --filter backend test:db:prepare      # migrations + contrôle de dérive seuls
pnpm --filter backend test:integration     # le globalSetup refait la même préparation
docker stop ffd-test-pg
```
