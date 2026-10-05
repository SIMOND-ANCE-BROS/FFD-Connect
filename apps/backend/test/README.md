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
