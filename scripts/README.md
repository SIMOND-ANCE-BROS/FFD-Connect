# Scripts Utilitaires

Ce dossier contient les scripts utilitaires pour le développement et la maintenance du projet FFD Connect.

## Scripts Disponibles

### `setup-dev-env.ts`

Script de configuration automatique de l'environnement de développement.

**Usage:**
```bash
pnpm setup:dev
```

**Fonctionnalités:**
- ✅ Vérifie la version de Node.js (>= 20)
- ✅ Vérifie la version de pnpm (>= 9)
- ✅ Vérifie l'installation et le démarrage de Docker
- ✅ Vérifie les variables d'environnement backend
- ✅ Détecte et met à jour automatiquement l'IP locale dans `apps/client/src/config.ts`

**Recommandé pour:** Nouveaux développeurs ou après une mise à jour majeure.

---

### `check-coverage.ts`

Script d'analyse de la couverture de tests.

**Usage:**
```bash
pnpm check:coverage
```

**Fonctionnalités:**
- 📊 Analyse la couverture de tests du backend et du client
- 📈 Compare avec les seuils configurés dans Jest
- ✅ Génère un rapport détaillé avec statut par métrique
- ⚠️ Exécute les tests si aucun rapport n'existe

**Seuils configurés:**
- **Backend:** Statements 90%, Branches 70%, Functions 90%, Lines 90%
- **Client:** Statements 70%, Branches 55%, Functions 60%, Lines 70%

**Recommandé pour:** Avant un commit, vérification CI/CD, audits de qualité.

---

### `start-dev.ts`

Script principal pour démarrer l'environnement de développement.

**Usage:**
```bash
pnpm start:dev              # Tous les services dans le même terminal
pnpm start:dev:separate      # Chaque service dans un terminal séparé (macOS)
```

**Fonctionnalités:**
- 🐳 Vérifie et démarre Docker si nécessaire
- 🗄️ Démarre PostgreSQL et Redis via Docker Compose
- 🔧 Met à jour automatiquement l'IP locale
- 📱 Démarre Metro bundler (Expo)
- 💻 Démarre le backend NestJS
- 🔍 Vérifie les ports et arrête les processus existants si nécessaire

**Recommandé pour:** Développement quotidien.

---

### `stop-dev.ts`

Script pour arrêter tous les services de développement.

**Usage:**
```bash
pnpm stop:dev
```

**Fonctionnalités:**
- 🛑 Arrête Metro bundler (port 8081)
- 🛑 Arrête le backend (port 3000)
- 🐳 Garde Docker Compose actif (DB et Redis restent disponibles)

---

### `update-ip.ts` (Backend)

Script pour mettre à jour l'IP locale dans la configuration client.

**Usage:**
```bash
cd apps/backend
pnpm exec tsx scripts/update-ip.ts
```

**Fonctionnalités:**
- 🌐 Détecte automatiquement l'IP locale de la machine
- 📝 Met à jour `apps/client/src/config.ts` avec la nouvelle IP
- ⚠️ Ne met à jour que si l'IP a changé (évite les rechargements inutiles)

**Note:** Ce script est appelé automatiquement par `start-dev.ts`.

---

### `audit-quality.ts`

Script d'audit de qualité du code.

**Usage:**
```bash
pnpm audit:quality
```

**Fonctionnalités:**
- 📊 Analyse la qualité du code
- 📈 Génère des métriques de qualité
- ⚠️ Identifie les problèmes potentiels

---

### `generate-patches.ts`

Script pour régénérer les patches Metro/Expo.

**Usage:**
```bash
pnpm generate-patches
```

**Fonctionnalités:**
- 🔧 Régénère les patches pnpm pour Metro et Expo
- 📦 Utile après une mise à jour majeure d'Expo ou Metro

**Quand l'utiliser:**
- Après une mise à jour d'Expo ou React Native
- Si les patches deviennent obsolètes
- Si le client ne démarre pas correctement

---

## Ajout d'un Nouveau Script

Pour ajouter un nouveau script :

1. Créez le fichier dans `scripts/`
2. Ajoutez la commande dans `package.json` à la racine :
   ```json
   {
     "scripts": {
       "mon-script": "tsx scripts/mon-script.ts"
     }
   }
   ```
3. Documentez le script dans ce fichier README.md

## Bonnes Pratiques

- ✅ Utilisez `tsx` pour exécuter les scripts TypeScript directement
- ✅ Ajoutez un shebang `#!/usr/bin/env tsx` en première ligne
- ✅ Gérez les erreurs avec `try/catch` et `process.exit(1)` en cas d'erreur
- ✅ Affichez des messages clairs avec des emojis pour la lisibilité
- ✅ Documentez les scripts dans ce README
