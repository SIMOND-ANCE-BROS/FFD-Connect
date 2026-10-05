# FFD Connect — Client

Application mobile et web du projet **FFD Connect**, construite avec [React Native](https://reactnative.dev) et [Expo](https://expo.dev). Elle permet la gestion des compétitions, licences, bibliothèque musicale et des fonctionnalités club (inscriptions, scan QR, etc.).

## Prérequis

- **Node.js** ≥ 20 (voir [.nvmrc](https://github.com/nvm-sh/nvm#nvmrc) à la racine du monorepo)
- **pnpm** ≥ 9
- **iOS** : Xcode, CocoaPods (`bundle install` puis `bundle exec pod install` dans `apps/client`)
- **Android** : Android Studio, SDK configuré
- **Développement** : Docker (PostgreSQL, Redis) et backend NestJS — voir [scripts/README.md](../../scripts/README.md) à la racine

## Installation

Le client fait partie du monorepo. À la **racine du dépôt** :

```bash
pnpm install
```

Pour une première configuration complète (IP locale, env, Docker) :

```bash
pnpm setup:dev
```

## Configuration

### URL de l’API

En développement, l’app pointe vers le backend local. L’URL est définie dans `src/config.ts` :

- **iOS** : `http://<LOCAL_IP>:3000` (simulateur et appareil)
- **Android simulateur** : `http://10.0.2.2:3000`
- **Android appareil physique** : `http://<LOCAL_IP>:3000`
- **Production** : `https://api.ffd.gabin-simond.fr`

Le script `pnpm setup:dev` met à jour automatiquement `LOCAL_IP` dans `config.ts`. En cas de changement de machine ou de réseau, relancer `pnpm setup:dev` ou adapter `LOCAL_IP` manuellement.

### Variables d’environnement

Variables optionnelles (Expo) :

- `EXPO_PUBLIC_SENTRY_DSN` : DSN Sentry pour le reporting d’erreurs (production)

Elles peuvent être définies dans un fichier `.env` à la racine du monorepo ou dans l’environnement de build (EAS).

### Notifications push (Firebase / FCM)

Les push passent par FCM (`@react-native-firebase/app` + `/messaging`, voir
[ADR-0018](../../docs/adr/0018-firebase-push-notifications.md)). L’app existe en
**4 variantes** avec un bundle id chacune, donc **un app Firebase et un fichier de
config par variante** — un fichier prod ne peut pas servir la beta.

Convention (`<env>` = valeur de `EXPO_PUBLIC_APP_ENV`) :

| `<env>`       | Bundle id / package          | iOS                                             | Android                                     |
| ------------- | ---------------------------- | ----------------------------------------------- | ------------------------------------------- |
| `production`  | `fr.ffdanse.connect`         | `GoogleService-Info.plist` (racine, versionné)  | `google-services.json` (racine, versionné)  |
| `beta`        | `fr.ffdanse.connect.beta`    | `firebase/GoogleService-Info.beta.plist`        | `firebase/google-services.beta.json`        |
| `preview`     | `fr.ffdanse.connect.staging` | `firebase/GoogleService-Info.preview.plist`     | `firebase/google-services.preview.json`     |
| `development` | `fr.ffdanse.connect.dev`     | `firebase/GoogleService-Info.development.plist` | `firebase/google-services.development.json` |

**Comment déposer les fichiers d’une variante :** télécharger le
`GoogleService-Info.plist` / `google-services.json` depuis la Firebase Console
(projet `ffd-connect-app`, app correspondant au bundle id de la variante), les
renommer selon le tableau et les placer dans `apps/client/firebase/`.

Ces fichiers ne sont **jamais committés** (`.gitignore` ignore `firebase/*` sauf
son README ; le dépôt a déjà eu des alertes secret-scanning à cause de configs
Firebase versionnées). Détails, cas mixte iOS/Android et variables d’environnement
EAS pour les builds CI : [`firebase/README.md`](firebase/README.md).

Tant qu’un fichier est absent, `app.config.js` n’active ni `googleServicesFile`
ni les plugins Firebase : le build fonctionne, les push sont simplement inactives
et un avertissement s’affiche à l’évaluation de la config. Le jour où le fichier
est déposé, les push s’activent au prochain **build natif** (changement natif :
non livrable en OTA).

## Scripts

| Commande          | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `pnpm start`      | Démarre Metro (Expo) en mode LAN                          |
| `pnpm start:dev`  | Depuis la **racine** : backend + Metro + optionnel Docker |
| `pnpm web`        | Lance l’app en mode web (Expo)                            |
| `pnpm ios`        | Build et run iOS (simulateur / appareil)                  |
| `pnpm android`    | Build et run Android                                      |
| `pnpm test`       | Lance les tests unitaires (Jest)                          |
| `pnpm test:watch` | Tests en mode watch                                       |
| `pnpm test:cov`   | Tests avec rapport de couverture                          |
| `pnpm lint`       | Vérification ESLint                                       |

Pour démarrer tout l’environnement de dev (backend + BDD + Metro), utiliser depuis la **racine** :

```bash
pnpm start:dev
```

Puis dans un autre terminal, depuis `apps/client` : `pnpm ios` ou `pnpm android` ou `pnpm web`.

## Structure du projet

```
apps/client/
├── src/
│   ├── features/           # Fonctionnalités par domaine
│   │   ├── auth/           # Authentification (login, reset password)
│   │   ├── competitions/   # Compétitions, inscriptions, résultats
│   │   ├── license/        # Licences, scan QR, WDSF
│   │   ├── player/         # Bibliothèque, lecteur audio
│   │   ├── club/           # Gestion club (membres, événements)
│   │   ├── performance/    # Mode performance (ordre des musiques)
│   │   └── settings/       # Paramètres, notifications
│   ├── components/         # Composants UI partagés
│   ├── navigation/         # React Navigation (stack + tabs)
│   ├── services/           # Client API (api.ts, TtsService, etc.)
│   ├── utils/              # Utilitaires (logger, retry, validation)
│   ├── constants/          # Messages d’erreur, etc.
│   ├── context/            # ThemeContext (et alias vers features)
│   ├── config.ts           # URL API, Metro, détection émulateur
│   └── theme/              # Thème (couleurs, typo)
├── app.config.js           # Configuration Expo (plugins, permissions)
├── MODULES_MOBILE_ONLY.md  # Modules natifs et fallbacks web
└── docs/                   # Documentation client
```

Chaque feature regroupe typiquement : `screens/`, `hooks/`, `services/`, `components/`, `context/`. Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et le [guide d’architecture global](../../docs/architecture/patterns.md).

## Plateformes

- **iOS** : Simulateur et appareil. Premier clone ou après mise à jour des deps natives : `bundle install` puis `bundle exec pod install` dans `apps/client`.
- **Android** : Émulateur (10.0.2.2) ou appareil (IP locale). Vérifier que `ANDROID_HOME` est défini.
- **Web** : `pnpm web`. Certaines fonctionnalités ont des fallbacks (ex. scan QR, lecteur audio) — voir [MODULES_MOBILE_ONLY.md](MODULES_MOBILE_ONLY.md).

L’app utilise un moteur JS configuré (JSC sur iOS dans `app.config.js`) qui n’est pas compatible avec Expo Go ; utiliser un **dev build** : `npx expo run:ios` / `npx expo run:android` (ou les scripts `pnpm ios` / `pnpm android`).

## Tests

- **Unitaires** : `pnpm test` (Jest, config partagée via `@ffd-connect/jest-config`).
- **Couverture** : `pnpm test:cov`. Les seuils sont définis dans la config Jest du client.
- **E2E (Maestro)** : `pnpm test:e2e` depuis `apps/client`. Les scénarios sont dans `.maestro/*.yaml` (login, compétitions, scan, bibliothèque, paramètres, etc.). Prérequis : app installée sur un simulateur ou un appareil (ex. `pnpm ios` puis lancer l’app), et [Maestro](https://maestro.mobile.dev/) installé. L’app ID par défaut est dans chaque fichier YAML (`appId: fr.simond-gabin.ffdconnect.mobile`) — à adapter si votre build a un autre identifiant. Ces tests ne sont pas exécutés en CI par défaut.

## Builds de production (EAS)

- `pnpm build:dev` : profil development
- `pnpm build:beta` : profil preview
- `pnpm build:prod` : profil production

Les profils sont définis dans la configuration EAS du projet.

## Documentation associée

- [Architecture client](docs/ARCHITECTURE.md) — Structure, API client, erreurs, navigation
- [Modules réservés au mobile](MODULES_MOBILE_ONLY.md) — Modules natifs et fallbacks web
- [Architecture globale et patterns](../../docs/architecture/patterns.md) — Monorepo, backend, client
- [Gestion des erreurs](../../docs/guides/gestion-erreurs.md) — Format API, retry, messages centralisés
- [Scripts utilitaires](../../scripts/README.md) — `setup:dev`, `start:dev`, `check:coverage`, etc.

## Dépannage

- **401 / token expiré** : L’intercepteur API nettoie le token et déconnecte ; se reconnecter.
- **Réseau / timeout** : Vérifier que le backend tourne et que `config.ts` utilise la bonne IP (ou exécuter `pnpm setup:dev` à la racine).
- **Metro ne se connecte pas** : Vérifier le port 8081 et que `start` utilise bien `--host lan` si vous testez sur appareil.
- **iOS build** : Si problème avec les pods, essayer `cd ios && pod install --repo-update`.
- **Erreurs Hermes / Reanimated** : L’app est configurée pour utiliser JSC sur iOS ; utiliser un dev build (`npx expo run:ios`) et non Expo Go.

Pour plus de détails sur l’environnement de développement, voir [scripts/README.md](../../scripts/README.md).
