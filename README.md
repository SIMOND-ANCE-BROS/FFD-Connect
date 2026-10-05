# FFD Connect

> **Projet indépendant.** FFD Connect est un prototype conçu et développé par Gabin Simond pour la Fédération Française de Danse (FFD). Ce n'est **pas** une application officielle de la FFD, qui n'en est ni l'éditrice ni l'hébergeuse. Les noms et marques cités appartiennent à leurs détenteurs. Code consultable publiquement mais **tous droits réservés** : voir [`LICENSE`](LICENSE).

Application mobile et API pour la gestion des compétitions de danse de la Fédération Française de Danse (FFD).

## 📋 Table des Matières

- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Développement](#développement)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Structure du Projet](#structure-du-projet)
- [Contribuer](#contribuer)
- [Mises à jour client (Expo / React Native)](#mises-à-jour-client-expo--react-native)
- [Problèmes connus](#problèmes-connus)

## 🏗️ Architecture

### Monorepo Structure

Le projet est organisé en monorepo avec pnpm workspaces :

```
FFD-Connect/
├── apps/
│   ├── backend/          # API NestJS
│   ├── client/           # Application React Native (Expo)
│   └── landing/          # Page d'accueil (Vite)
├── packages/
│   ├── shared/           # Code partagé (types, erreurs)
│   └── jest-config/      # Configuration Jest partagée
├── scripts/              # Scripts utilitaires
└── docker-compose.yml   # Configuration Docker pour le développement
```

### Stack Technique

#### Backend

- **Framework:** NestJS (Node.js)
- **Langage:** TypeScript
- **Base de données:** PostgreSQL avec Prisma ORM
- **Cache:** Redis
- **Authentification:** JWT avec Passport
- **Documentation API:** Swagger/OpenAPI
- **Sécurité:** Helmet, Rate Limiting, Validation des entrées

#### Client (Expo / React Native)

- **Framework:** Expo (SDK 57) + React Native 0.86
- **Langage:** TypeScript
- **Navigation:** React Navigation (native-stack + bottom-tabs)
- **État:** Zustand (state client) + React Query (cache serveur) + Context (auth / thème uniquement)
- **Audio:** expo-audio
- **Tests:** Jest + React Testing Library + Maestro (E2E)

## 📦 Gestionnaire de Paquets

Ce projet utilise **pnpm** comme gestionnaire de paquets principal. Toutes les commandes doivent être exécutées avec `pnpm` plutôt qu'avec `npm` ou `yarn`.

**Commandes principales :**

- `pnpm install` - Installer les dépendances
- `pnpm exec <command>` - Exécuter une commande depuis les dépendances installées (équivalent de `npx`)
- `pnpm setup:dev` - Configuration automatique de l'environnement de développement (nouveau)
- `pnpm start:dev` - Démarrer l'environnement de développement (tous les services dans le même terminal)
- `pnpm start:dev:separate` - Démarrer l'environnement de développement avec chaque service dans un terminal séparé (macOS uniquement)
- `pnpm stop:dev` - Arrêter tous les services de développement (Metro bundler et Backend)
- `pnpm check:coverage` - Analyser la couverture de tests (nouveau)
- `pnpm --filter <workspace> <command>` - Exécuter une commande dans un workspace spécifique

**Note :** Si vous voyez des avertissements npm concernant `node-linker` ou `symlink` dans `.npmrc`, vous pouvez les ignorer. Ces configurations sont spécifiques à pnpm et nécessaires pour le bon fonctionnement du projet.

## 📦 Prérequis

- **Node.js:** >= 20
- **pnpm:** >= 9 (lockfile v9)
- **Docker & Docker Compose:** Pour la base de données et Redis
- **PostgreSQL:** 15+ (via Docker recommandé)
- **Redis:** (via Docker recommandé)

## 🚀 Installation

### 1. Cloner le dépôt

```bash
git clone <repository-url>
cd FFD-Connect
```

### 2. Installer les dépendances

```bash
pnpm install
```

**Patch pnpm appliqué automatiquement :** `pnpm install` applique le patch déclaré dans
`patchedDependencies` de `pnpm-workspace.yaml` (aujourd'hui un seul : `react-native@0.86.0`, correctif
TurboModule iOS 26). Aucun script post-install custom n'est nécessaire. Le seul hook est
`prepare` (installation des hooks Husky).

> ⚠️ Lors des montées de version d'Expo ou React Native, ce patch peut devenir obsolète.
> En cas de souci au démarrage du client, relancer `pnpm install`. Détails et workarounds :
> [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).
>
> Après une montée de version Expo / RN ou de dépendances natives, suivre la **checklist
> manuelle** : [apps/client/UPGRADES.md](./apps/client/UPGRADES.md). Le tableau des patches
> pnpm (version, raison, conduite à tenir) est dans [patches/PATCHES.md](./patches/PATCHES.md).

### 3. Configuration automatique (recommandé)

Utilisez le script de configuration automatique pour vérifier les prérequis et configurer l'environnement :

```bash
pnpm setup:dev
```

Ce script vérifie :

- ✅ Version de Node.js (>= 20)
- ✅ Version de pnpm (>= 9)
- ✅ Installation et démarrage de Docker
- ✅ Variables d'environnement backend
- ✅ Détection et mise à jour de l'IP locale

### 4. Configuration manuelle de l'environnement

Si vous préférez configurer manuellement, copiez le fichier `.env.example` et configurez vos variables d'environnement :

```bash
cd apps/backend
cp .env.example .env
# Éditez .env avec vos valeurs
```

Voir la section [Configuration](#configuration) pour plus de détails.

### 5. Démarrer l'infrastructure (Base de données et Redis)

```bash
# Dev local — démarre uniquement Postgres + Redis
docker compose --profile infra up -d

# Production / stack complète (backend buildé + frontend)
docker compose --profile full up -d
```

### 6. Configurer la base de données

```bash
cd apps/backend
pnpm exec prisma generate
pnpm exec prisma migrate dev
pnpm exec prisma db seed  # Optionnel: charger des données de test
```

## ⚙️ Configuration

### Variables d'environnement Backend

Créez un fichier `.env` dans `apps/backend/` avec les variables suivantes :

#### Requis

```env
# Base de données PostgreSQL
DATABASE_URL="postgresql://user:password@localhost:5432/ffd_connect"

# Secret JWT (générez une clé sécurisée)
JWT_SECRET="your-super-secret-jwt-key-min-32-chars"
```

#### Optionnel

```env
# Serveur
PORT=3000
NODE_ENV=development

# CORS (liste séparée par des virgules)
CORS_ORIGINS=http://localhost:3000,https://app.ffdconnect.fr

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API FFD
FFD_API_BASE_URL="https://api.ffdanse.fr"
FFD_API_PATH="/federal_actions"
FFD_ITEMS_PER_PAGE=50
FFD_DANCE_FAMILIES="latines-standards"
FFD_EVENT_CATEGORY="Compétitions"

# Email (Resend)
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="no-reply@ffd-connect.fr"

# Firebase (pour les notifications push)
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_PRIVATE_KEY="your-private-key"
FIREBASE_CLIENT_EMAIL="your-client-email"

# GitHub (pour les rapports de bugs)
GITHUB_TOKEN="your-github-token"
GITHUB_OWNER="your-username"
GITHUB_REPO="ffd-connect-reports"
```

> 📖 **Liste complète et à jour** (Sentry, Azure Blob, Google Cloud TTS/Vision, WDSF, HelloAsso, flags…) : **[docs/configuration/environment-variables.md](docs/configuration/environment-variables.md)**.

### Validation des Variables d'Environnement

Les variables d'environnement sont validées au démarrage de l'application (`apps/backend/src/config/env.validation.ts`). Si une variable requise est manquante ou invalide, l'application ne démarrera pas avec un message d'erreur explicite.

### Rôles utilisateur

Enum `UserRole` (Prisma, `apps/backend/prisma/schema/user.prisma`) :

| Rôle       | Usage                                                              |
| ---------- | ------------------------------------------------------------------ |
| `LICENSEE` | Licencié — pratiquant avec licence FFD, bibliothèque, compétitions |
| `CLUB`     | Structure (club) — représentant du club, gestion des membres       |
| `STAFF`    | Staff FFD — organisateur d'événement, scanner de check-in          |
| `ADMIN`    | Administration complète de la plateforme                           |

Les 4 rôles existent en base. Le mode « invité » (navigation sans connexion) est géré côté client sans rôle en base.

### Configuration IP locale (App mobile en développement)

L'app client se connecte au backend via `apps/client/src/config.ts`. En mode développement (`__DEV__`), elle utilise une IP locale :

- **iOS** : `LOCAL_IP` (par défaut `192.168.1.177` — à adapter à ton réseau)
- **Android (émulateur)** : `10.0.2.2` (localhost de l'hôte)
- **Android (appareil physique)** : `LOCAL_IP` comme pour iOS

**Mise à jour automatique de l'IP :** Le script `apps/backend/scripts/update-ip.ts` peut être utilisé pour détecter et mettre à jour l'IP locale dans le fichier de config. Le backend peut être lancé avec :

```bash
cd apps/backend
pnpm start:dev:with-ip   # Met à jour l'IP puis démarre le serveur
```

Ou manuellement : modifie `LOCAL_IP` dans `apps/client/src/config.ts` avec l'IP de ta machine (ex: `ifconfig` ou `ipconfig`).

## 💻 Développement

### Backend

```bash
cd apps/backend

# Mode développement avec hot-reload
pnpm start:dev

# Lancer les tests
pnpm test

# Tests avec couverture
pnpm test:cov

# Linter
pnpm lint

# Formater le code
pnpm format
```

L'API sera accessible sur `http://localhost:3000`  
La documentation Swagger sera disponible sur `http://localhost:3000/api`  
Health : `GET /health` (DB + Redis), `GET /health/live` (liveness, ex. Kubernetes).

### Client (Expo)

```bash
cd apps/client

# Démarrer Metro bundler (Expo)
pnpm start

# Lancer sur Android
pnpm android

# Lancer sur iOS (macOS uniquement)
pnpm ios

# Lancer sur le web
pnpm web

# Tests
pnpm test

# Tests avec couverture
pnpm test:cov

# Linter
pnpm lint
```

### Scripts Utilitaires

```bash
# Démarrer backend et client en parallèle
pnpm start:dev

# Tests CI (backend + client)
pnpm test:ci
```

## 🧪 Tests

Vue d’ensemble des types de tests (unitaires, intégration HTTP, e2e avec DB, Maestro) : **[docs/tests/README.md](docs/tests/README.md)**.

### Backend

Les tests utilisent Jest avec une couverture cible de :

- **Statements:** 90%
- **Branches:** 70%
- **Functions:** 90%
- **Lines:** 90%

```bash
cd apps/backend
pnpm test              # Tests unitaires
pnpm test:watch        # Mode watch
pnpm test:cov          # Avec couverture
pnpm test:e2e          # Tests end-to-end
```

### Client

Couverture cible (alignée avec la CI) : **80 %** (statements, branches, functions, lines).

```bash
cd apps/client
pnpm test              # Tests unitaires
pnpm test:cov          # Avec couverture
pnpm test:e2e          # Tests E2E avec Maestro
```

## 🚢 Déploiement

### Backend — Azure Container Apps

Le backend prod et staging tournent sur **Azure Container Apps**. Le déploiement est
automatisé par le workflow `deploy-backend.yml` après succès de la CI :

- branche `staging` → app `backend-staging` (`https://api-staging.ffd.gabin-simond.fr`)
- branche `master` → app `backend-prod` (`https://api.ffd.gabin-simond.fr`)

Mécanisme : image Docker taguée par SHA poussée sur ACR, puis `az containerapp update`
(mode single-revision) + smoke test `/health` + auto-rollback. **Procédure complète :
[docs/exploitation/deploiement-azure.md](docs/exploitation/deploiement-azure.md)** et
[docs/exploitation/ci-cd.md](docs/exploitation/ci-cd.md).

Build local de l'image (debug) :

```bash
docker build -f apps/backend/Dockerfile -t ffd-connect-backend .
docker run -p 3000:3000 --env-file apps/backend/.env ffd-connect-backend
```

### Variables d'Environnement en Production

Au minimum : `NODE_ENV=production`, `JWT_SECRET` (clé forte ≥ 32 car.), `DATABASE_URL`,
`CORS_ORIGINS` (obligatoire — l'app quitte en erreur fatale sinon). Liste complète :
[docs/configuration/environment-variables.md](docs/configuration/environment-variables.md).

## 📁 Structure du Projet

### Backend (`apps/backend/`)

```
src/
├── auth/             # Authentification (JWT, refresh tokens)
├── users/            # Utilisateurs
├── clubs/            # Clubs (membres, HelloAsso)
├── career/           # Parcours / carrière du danseur
├── competitions/     # Compétitions (inscriptions, résultats, sync)
├── licenses/         # Licences (OCR, WDSF)
├── wdsf/             # Intégration WDSF
├── tracks/           # Musiques (bibliothèque)
├── tts/              # Text-to-Speech (annonces)
├── notifications/    # Notifications push (Firebase)
├── reports/          # Rapports et signalements
├── payment/          # Paiement (webhooks HelloAsso)
├── health/           # Health checks (DB + Redis)
├── storage/          # Service Azure Blob (uploads : pistes, certificats)
├── redis/            # Client Redis / cache
├── common/           # Filters, interceptors partagés
├── config/           # Configuration + validation des env
├── prisma/           # Service Prisma
└── utils/            # Utilitaires (timeout, circuit breaker…)
```

> Chaque domaine décompose ses services par responsabilité (`QueryService` pour la lecture, `Service` pour l'écriture) — voir [ADR-0014](docs/adr/0014-service-decomposition-pattern.md). Détail par module : [docs/architecture/modules/](docs/architecture/modules/).

### Client (`apps/client/`)

```
src/
├── components/       # Composants réutilisables
├── features/         # Modules par fonctionnalité (auth, license, competitions, etc.)
├── screens/          # Écrans de l'application (dans chaque feature)
├── navigation/       # Configuration de navigation
├── services/         # Services API
├── context/          # Contextes React (état global)
├── hooks/            # Hooks personnalisés
├── utils/            # Utilitaires
└── constants/        # Constantes
```

## 🔒 Sécurité

### Mesures Implémentées

- ✅ **Authentification JWT** avec expiration
- ✅ **Hachage des mots de passe** avec bcrypt
- ✅ **Rate Limiting** (100 requêtes/minute par IP)
- ✅ **Headers de sécurité** avec Helmet
- ✅ **Validation des entrées** avec ValidationPipe
- ✅ **CORS configuré** avec restrictions
- ✅ **Gestion d'erreurs standardisée** avec ExceptionFilter
- ✅ **Variables d'environnement** pour les secrets

### Bonnes Pratiques

- Ne jamais commiter les fichiers `.env`
- Utiliser des secrets forts pour `JWT_SECRET`
- Configurer `CORS_ORIGINS` correctement en production
- Activer HTTPS en production
- Surveiller les logs pour détecter les tentatives d'attaque

## 📚 Documentation API

Une fois le backend démarré, la documentation Swagger est disponible sur :

```
http://localhost:3000/api
```

Elle inclut :

- Tous les endpoints disponibles
- Schémas de requêtes/réponses
- Authentification Bearer Token
- Exemples de requêtes

## 🤝 Contribuer

### Workflow

1. Créer une branche depuis `develop` (branche principale)

   ```bash
   git checkout -b feature/ma-fonctionnalite
   ```

2. Faire vos modifications

3. S'assurer que les tests passent

   ```bash
   pnpm test:ci
   ```

4. Vérifier le linting

   ```bash
   pnpm lint
   ```

5. Créer une Pull Request

> Détails complets : [CONTRIBUTING.md](CONTRIBUTING.md) (contrats Prisma / OpenAPI, boundaries, upgrades Expo).

### Standards de Code

- **TypeScript strict** activé
- **ESLint** + **Prettier** configurés
- **Pre-commit** (lint-staged) et **pre-push** (tests) avec Husky
- **Tests requis** pour les nouvelles fonctionnalités
- **Documentation JSDoc** pour les fonctions publiques

### Commits

Utilisez des messages de commit clairs et descriptifs :

```
feat: ajouter la synchronisation automatique des compétitions
fix: corriger la validation des licences
docs: mettre à jour le README
test: ajouter des tests pour le service auth
```

## 🐛 Signaler un Bug

Utilisez l'endpoint `/reports` de l'API ou créez une issue sur GitHub avec :

- Description du problème
- Steps to reproduce
- Comportement attendu vs réel
- Environnement (OS, version Node, etc.)

## 📦 Dépendances Critiques

### Backend

#### Core

- **@nestjs/core** (^11.0.1): Framework principal NestJS
- **@prisma/client** (7.3.0): Client Prisma ORM type-safe
- **prisma** (7.3.0): CLI Prisma pour les migrations

#### Sécurité

- **@nestjs/jwt** (^11.0.2): Gestion des tokens JWT
- **bcrypt** (^6.0.0): Hachage des mots de passe
- **helmet** (^7.1.0): Headers de sécurité HTTP
- **@nestjs/throttler** (^6.1.1): Rate limiting

#### Base de données

- **pg** (^8.17.2): Driver PostgreSQL
- **ioredis** (^5.9.2): Client Redis pour le cache

#### Validation

- **class-validator** (^0.14.1): Validation des DTOs
- **class-transformer** (^0.5.1): Transformation des objets

### Client

#### Core

- **expo** (~57.0): Framework Expo (SDK 57)
- **react** (19.2.x): Bibliothèque React
- **react-native** (0.86.0): Framework React Native
- **zustand** (^5): State management client
- **@tanstack/react-query** (^5): Cache serveur
- **expo-audio**: Lecteur audio (remplace react-native-track-player)

#### Navigation

- **@react-navigation/native** (^7.1.27): Navigation principale
- **@react-navigation/native-stack** (^7.9.1): Stack navigator
- **@react-navigation/bottom-tabs** (^7.9.1): Bottom tabs navigator

#### État et Context

- **@react-native-async-storage/async-storage** (^2.2.0): Stockage local

#### Tests

- **jest** (^29.6.3): Framework de tests
- **@testing-library/react-native** (^13.3.3): Tests de composants

### Package Shared (`packages/shared/`)

Types partagés entre backend et client. Pour l'utiliser :

```bash
cd packages/shared
pnpm build   # Compile TypeScript
```

Référence dans les apps : `@ffd-connect/shared` (voir `packages/shared/package.json`).

## Mises à jour client (Expo / React Native)

Les upgrades **Expo** / **React Native** et les paquets avec **patch pnpm** ne sont pas entièrement vérifiables en CI (audio natif, caméra, push, etc.). Une checklist de smoke tests manuels est maintenue dans **[apps/client/UPGRADES.md](./apps/client/UPGRADES.md)**. Le tableau des patches npm (version, raison, conduite à tenir après upgrade) est dans **[patches/PATCHES.md](./patches/PATCHES.md)**.

## Problèmes connus

Voir [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) pour les workarounds (patches Metro/Expo, migration mobile, etc.).

## 📚 Documentation

Toute la documentation projet est indexée dans **[docs/README.md](docs/README.md)** :
architecture & ADR, modules backend, règles métier FFD, exploitation (CI/CD, déploiement
Azure), tests, configuration, guides et légal.

## 📄 Licence

[À définir]

## 👥 Équipe

[À compléter]
