# Contribuer à FFD Connect

Merci de votre intérêt ! Consultez le README principal pour l'installation et la configuration.

## Avant de commencer

- **pnpm** est le gestionnaire de paquets (pas npm/yarn)
- Les **pre-commit** hooks (Husky) exécutent lint et format sur les fichiers stagés
- Les **pre-push** hooks lancent `pnpm typecheck` puis les tests unitaires backend et client (`pnpm --filter backend test` / `pnpm --filter client test`) — pas toute la CI (e2e, couverture complète = GitHub Actions)

## Workflow

1. Créer une branche : `git checkout -b feature/ma-fonctionnalite`
2. Faire vos modifications
3. Vérifier localement avant de pousser :
   ```bash
   pnpm preflight   # Lance exactement ce qui bloque en CI (~45s)
   ```
   Ou manuellement :
   - `pnpm typecheck` — vérification des types
   - `pnpm lint` — linter les 3 apps
   - `pnpm format:check` — vérifier le formatage (ou `pnpm format` pour corriger)
   - `pnpm --filter backend test` — tests backend
   - `pnpm --filter client test` — tests client
4. Créer une Pull Request

## Merge gate (CI)

Une PR ne peut pas être mergée sans que ces jobs passent :

- **typecheck** — `tsc --noEmit` backend + client
- **lint-format** — ESLint + Prettier
- **backend-test** — unit + integration + e2e (avec DB)
- **backend-build** — compilation + swagger.json à jour
- **client** — lint + tests unitaires
- **audit-dependencies** — osv-scanner (base OSV) — bloque high/critical

Jobs **informationnels** (non-bloquants) : `playwright-e2e`, `mutation` (Stryker).

Détail complet : [docs/exploitation/ci-cd-minimal.md](docs/exploitation/ci-cd-minimal.md).

## Standards

- **TypeScript strict** — pas de `any` implicite
- **ESLint** + **Prettier** — respecter la config du projet
- **Tests** — couvrir les nouvelles fonctionnalités
- **Commits** — messages clairs (feat:/fix:/docs:/test:)

## Structure du monorepo

| Dossier           | Rôle                                  |
| ----------------- | ------------------------------------- |
| `apps/backend`    | API NestJS                            |
| `apps/client`     | App Expo / React Native               |
| `apps/landing`    | Page d'accueil (Vite)                 |
| `packages/shared` | Types et utilitaires partagés         |
| `scripts/`        | Scripts utilitaires (start-dev, etc.) |

## Points de vigilance

Ces pratiques ne sont pas des tâches ponctuelles — c’est de la discipline à tenir au fil du temps.

### Prisma : migrations vs db push

`prisma db push` est pratique en dev/CI (base éphémère), mais **chaque changement de schéma doit passer par une migration versionnée** (`prisma migrate dev`). Ne jamais `db push` en staging/prod. Si un dev oublie de créer la migration, le schéma CI diverge du schéma prod.

### Intégrations externes (Firebase, GCP, HelloAsso, WDSF)

Chaque appel externe doit avoir : timeout, retry borné, circuit breaker (opossum), et log structuré en cas d’échec. Tester au minimum le chemin heureux + le timeout/erreur réseau. L’idempotence est requise sur les webhooks (paiement notamment).

### Montées de version Expo / React Native

Fenêtre dédiée après chaque release Expo majeure. Checklist :

1. `npx expo-doctor` (valider l’alignement SDK)
2. Vérifier les patches dans `patches/` — certains deviennent inutiles
3. Tester sur device réel (iOS + Android) — les régressions natives ne sont pas visibles en CI web
4. Mettre à jour les `overrides` dans `pnpm-workspace.yaml` si nécessaire (voir [`patches/PATCHES.md`](./patches/PATCHES.md))

### Alignement versions Prisma

Garder `@prisma/client`, `prisma` (CLI), et `@prisma/adapter-pg` sur la même version majeure. Un écart génère des warnings au `prisma generate` et des bugs subtils au runtime. Vérifier à chaque bump Dependabot.

### CI/CD

Voir [docs/exploitation/ci-cd-minimal.md](docs/exploitation/ci-cd-minimal.md) pour le pipeline complet, les KPI, et les procédures de rollback.

### Temps CI

Surveiller la durée des jobs backend (unit + integration + e2e + mutation). Si le total dépasse 15min, envisager : parallélisation, quarantaine des tests lents, ou `ignoreStatic` plus agressif dans Stryker.

## En cas de problème

- **Client Expo ne démarre pas après `pnpm install`** : les patches Metro/Expo peuvent être impactés. Relancer `pnpm install` depuis la racine, ou après une mise à jour d’Expo/Metro, exécuter `pnpm run generate-patches` si besoin. Détails : [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).
