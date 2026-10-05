# Tests — FFD Connect

Vue d’ensemble des stratégies de tests (backend et client) et de leur exécution.

## Backend (NestJS)

### Types de tests

| Type                 | Emplacement             | Base de données                    | Rôle                                                                                                                |
| -------------------- | ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Unitaires**        | `src/**/*.spec.ts`      | Mockée (Prisma mock)               | Logique métier, services, controllers, guards, utils.                                                               |
| **Intégration HTTP** | `test/*.e2e-spec.ts`    | Mockée (Prisma ou services mockés) | Contrats HTTP, validation des DTO (ValidationPipe), routes. Exécutés en CI.                                         |
| **E2E avec DB**      | `test/*-db.e2e-spec.ts` | Réelle (PostgreSQL)                | Un ou quelques parcours critiques (ex. login) avec vraie base. Optionnel en local si une DB de test est disponible. |

Les fichiers `test/*.e2e-spec.ts` montent l’application Nest complète et utilisent **supertest** pour appeler les routes, mais remplacent Prisma (ou certains services) par des mocks. Ils ne touchent pas à la base : ce sont des **tests d’intégration HTTP**, pas des e2e “full stack”.  
Le terme “e2e” dans le nom du fichier est conservé pour rester cohérent avec la config Jest (`testRegex: ".e2e-spec.ts$"`).

### Commandes

- `pnpm test` — unitaires (Jest, config `jest.config.js`)
- `pnpm test:cov` — unitaires + couverture (seuils dans `packages/jest-config/backend.js`)
- `pnpm test:e2e` — tous les specs `test/*.e2e-spec.ts` (config `test/jest-e2e.json`)

En CI, les migrations sont appliquées sur une Postgres de test, puis les unitaires et les e2e sont exécutés. Les specs `*-db.e2e-spec.ts` utilisent cette même base.

---

## Client (React Native / Expo)

### Types de tests

| Type                       | Emplacement                        | Rôle                                                                                               |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Unitaires / composants** | `src/**/__tests__/*.test.{ts,tsx}` | Hooks, services, écrans, contextes, composants (Jest + Testing Library).                           |
| **E2E (Maestro)**          | `.maestro/*.yaml`                  | Parcours sur simulateur/appareil (login, compétitions, scan, etc.). Non exécutés en CI par défaut. |

### Commandes

- `pnpm test` — unitaires
- `pnpm test:cov` — unitaires + couverture (seuils dans `apps/client/jest.config.js`)
- `pnpm test:e2e` — Maestro (depuis `apps/client`) : nécessite un build installé sur simulateur ou appareil.

Voir [apps/client/README.md](../../apps/client/README.md) pour lancer les e2e Maestro (prérequis, app ID, etc.).

---

## Couverture

- **Backend** : seuils globaux (statements/lines/functions 90 %, branches 70 %). Script racine : `pnpm check:coverage` (compare backend + client aux seuils).
- **Client** : seuils globaux 80 % (tous métriques). Exclusions dans `apps/client/jest.config.js` (wrappers natifs, config, mocks).

Les rapports sont envoyés à Codecov en CI pour les deux apps.
