# Architecture — Client FFD Connect

Ce document décrit l’architecture du client React Native/Expo. Pour une vue d’ensemble monorepo et les patterns partagés, voir [Architecture et patterns](../../../docs/architecture/patterns.md).

## Table des matières

- [Structure par features](#structure-par-features)
- [Client API et intercepteurs](#client-api-et-intercepteurs)
- [Gestion des erreurs](#gestion-des-erreurs)
- [Navigation](#navigation)
- [État global et contextes](#état-global-et-contextes)
- [Tests](#tests)

---

## Structure par features

Le code est organisé par **feature** (domaine métier). Chaque feature est autonome et contient :

```
features/<nom>/
├── screens/       # Écrans (pages)
├── hooks/         # Hooks métier (logique réutilisable)
├── services/      # Appels API et logique métier
├── components/    # Composants spécifiques à la feature
├── context/       # Contexte React si besoin (ex. CompetitionContext)
└── __tests__/     # Tests de la feature
```

| Feature          | Rôle                                                              |
| ---------------- | ----------------------------------------------------------------- |
| **auth**         | Connexion, mot de passe oublié, reset, rôles (UserRole)           |
| **competitions** | Liste des compétitions, détail, inscriptions, résultats en direct |
| **license**      | Affichage licence, scan QR, vérification WDSF                     |
| **player**       | Bibliothèque musicale, lecteur audio, MiniPlayer, TrackContext    |
| **club**         | Tableau de bord club, membres, événements, inscriptions           |
| **performance**  | Configuration et lecture en mode performance (ordre des pistes)   |
| **settings**     | Paramètres, notifications                                         |

Les **services API** partagés (instance Axios, TTS, etc.) sont dans `src/services/`. Les **composants UI** réutilisables sont dans `src/components/`.

---

## Client API et intercepteurs

### Instance Axios (`src/services/api.ts`)

- **baseURL** : définie via `config.ts` (`API_URL`), selon environnement (dev/prod) et plateforme (iOS/Android).
- **Timeout** : 30 secondes.
- **Request interceptor** :
  - Injection du token JWT depuis `AsyncStorage` (`auth_config.authToken`).
  - Log des requêtes (sauf `/reports` pour limiter le bruit).
- **Response interceptor** :
  - **401** : nettoyage du token et de `auth_config` (déconnexion), pas de retry.
  - **4xx** (hors 408/429) : pas de retry, rejet direct.
  - **Réseau / 5xx / 408 / 429** : retry automatique (2 tentatives, délai initial 1 s) via `retryAxios` dans `src/utils/retry.ts`.

Utilisation typique : importer `api` depuis `src/services/api.ts` et faire `api.get(...)`, `api.post(...)`, etc. Le token et le retry sont gérés par les intercepteurs.

### Alternative avec retry configurable : `httpInterceptor`

Le module `src/utils/httpInterceptor.ts` expose `httpRequest` (fetch-based) avec options de **retry** et messages d’erreur centralisés. Utile quand on veut un comportement de retry différent de celui de l’intercepteur Axios. Voir [Gestion des erreurs](../../../docs/guides/gestion-erreurs.md).

---

## Gestion des erreurs

### Messages centralisés

Tous les messages utilisateur (erreurs et succès) sont dans **`src/constants/errorMessages.ts`** :

- `ERROR_MESSAGES` : échecs (login, réseau, validation, compétitions, WDSF, etc.)
- `SUCCESS_MESSAGES` : confirmations (connexion, inscription, PDF, etc.)

Utiliser ces constantes partout pour garder des libellés cohérents et faciliter l’i18n future.

### Format des erreurs API

Le backend renvoie un format standard (voir [error-handling.md](../../../docs/guides/gestion-erreurs.md)). Pour typer les réponses d’erreur côté client, utiliser le type partagé **`ApiErrorResponse`** de `@ffd-connect/shared`.

### Comportement côté client

- **Axios** : les erreurs sont loguées et, selon le code HTTP, retentées ou rejetées (voir [Client API](#client-api-et-intercepteurs)).
- **Affichage** : utiliser `ERROR_MESSAGES` (ou `SUCCESS_MESSAGES`) dans les écrans et hooks ; pour des messages dynamiques, combiner avec le `message` ou les champs de `ApiErrorResponse` si nécessaire.

---

## Navigation

- **Bibliothèque** : React Navigation (native-stack + bottom-tabs).
- **Fichiers** : `src/navigation/AppNavigator.tsx`, `src/navigation/types.ts`.

### Types de navigation

- **RootStackParamList** : toutes les écrans (Login, Main, License, Library, Settings, Competitions, CompetitionDetail, LiveResults, PerformanceSetup/Player, AudioPlayer, EventRegistrants, Notifications, écrans Club, Scanner, ForgotPassword, ResetPassword).
- **TabParamList** : onglets du tab navigator (ScannerTab, ClubDashboard, License, Library, Competitions, Settings).

Les paramètres de route (ex. `competitionId`, `eventId`, `token`) sont typés dans `RootStackParamList` / `TabParamList`. Utiliser `RootStackScreenProps<'NomEcran'>` pour les props d’écran.

### Thème et navigation

Le thème (sombre/clair) est fourni par `ThemeContext` ; `AppNavigator` utilise les thèmes React Navigation (`DarkTheme` / `DefaultTheme`) en fonction du thème actif.

---

## État global et contextes

L’arbre de contextes (dans `App.tsx`) est le suivant :

1. **ErrorBoundary** — capture des erreurs React
2. **SafeAreaProvider** — zones sûres
3. **AuthProvider** (AuthService) — authentification
4. **ThemeProvider** — thème
5. **ClubProvider** — données club
6. **TrackProvider** (TrackService) — catalogue de pistes
7. **LibraryProvider** — état de la bibliothèque
8. **PlayerProvider** — lecteur audio
9. **PerformanceProvider** — mode performance
10. **CompetitionProvider** — données compétitions

Chaque feature qui a besoin d’un état partagé expose son propre contexte (ex. `CompetitionContext`, `PlayerContext`). Les implémentations concrètes (services, repositories) sont injectées au niveau du provider (ex. `AuthService`, `TrackService`, `defaultClubRepository`).

---

## Tests

- **Framework** : Jest + React Native Testing Library ; config partagée via `@ffd-connect/jest-config`.
- **Emplacements** : `__tests__` à l’intérieur des features ou à côté des modules (`*.test.ts`, `*.test.tsx`).
- **Mocks** : `__tests__/mocks/` (navigation, Reanimated, Gesture Handler, etc.) pour isoler les composants.
- **Couverture** : `pnpm test:cov` ; seuils définis dans la config Jest du client.

Bonnes pratiques : tester les hooks avec `renderHook`, les écrans avec des providers minimalement nécessaires, et les services avec mocks de `api` ou de `httpRequest` selon le cas.

---

## Voir aussi

- [Architecture et patterns (monorepo)](../../../docs/architecture/patterns.md)
- [Gestion des erreurs (backend + client)](../../../docs/guides/gestion-erreurs.md)
- [Modules réservés au mobile](../MODULES_MOBILE_ONLY.md)
