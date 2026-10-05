# Analyse de la couverture et qualité des tests - FFD Connect

**Date:** 18 février 2026

## Vue d'ensemble (état actuel)

| App         | Unitaires             | Intégration (E2E)      | E2E Maestro | Couverture Stmts | Branches   | Functions  | Lines      |
| ----------- | --------------------- | ---------------------- | ----------- | ---------------- | ---------- | ---------- | ---------- |
| **Backend** | 296 tests (40 suites) | 66 tests (13 fichiers) | -           | **95.56%**       | **77.98%** | **95.69%** | **95.39%** |
| **Client**  | 511 tests (81 suites) | -                      | 9 scénarios | **84%**          | **70.53%** | **74.59%** | **84.49%** |

### Seuils configurés vs atteints

- **Backend** : objectif 90/70/90/90 (statements/branches/functions/lines) → ✅ **tous atteints** (95.56/77.98/95.69/95.39)
- **Client** : objectif **80 %** partout (aligné avec la CI) → à maintenir ; historique 70/55/60/70 remplacé par 80 % uniforme

---

## Backend - Analyse détaillée

### Points forts

- **40 modules** avec tests unitaires
- **14 fichiers E2E** couvrant : app, auth, competitions, tracks, TTS, WDSF, health, licenses, notifications, reports
- Couverture très homogène (>90% sur la plupart des services)
- Modules sensibles bien testés : auth, competitions, tracks, reports, licenses

### Modules avec couverture plus faible (< 95% statements)

| Module               | Stmts | Cause                                                |
| -------------------- | ----- | ---------------------------------------------------- |
| tracks.service       | 85.2% | Branches edge cases (erreurs, flux alternatifs)      |
| licenses.controller  | 85.7% | Quelques branches non couvertes (179-180, 200)       |
| competitions.service | 95.3% | Quelques lignes de fallback (281-282, 409-410, etc.) |
| live.gateway         | 90.5% | WebSocket (53-57)                                    |

### E2E Backend

- **14 fichiers** : app, auth (x2), competitions (x2), tracks (x2), tts, wdsf, health, licenses, notifications, reports
- Utilise Prisma mock et DB de test PostgreSQL
- Couverture fonctionnelle des endpoints principaux

**Verdict Backend** : ✅ **Très bon niveau**. Les zones restantes (tracks, licenses) sont surtout des chemins d’erreur. Amélioration possible mais sans surtest.

---

## Client - Analyse détaillée

### Structure des tests

- **20 fichiers .test.ts** répartis en hooks, services, utils, screens, components
- **9 scénarios Maestro** : login, login_error, competition_registration, competitions_list, notifications, scanner_checkin, settings_theme, library_playback, club_members

### Modules avec couverture faible (< 75%)

| Module              | Stmts | Type          | Priorité                      |
| ------------------- | ----- | ------------- | ----------------------------- |
| playerTypes.ts      | 0%    | Types purs    | Exclure de la couverture      |
| TrackPlayerWrapper  | 34.6% | Wrapper natif | Faible - dépendances lourdes  |
| VisionCameraWrapper | 42.1% | Caméra native | Faible - hardware             |
| validation.ts       | 71.4% | Logique pure  | **Haute**                     |
| retry.ts            | 60%   | Logique pure  | **Haute**                     |
| typeGuards.ts       | 80%   | Logique pure  | **Moyenne**                   |
| api.ts              | 74.3% | Intercepteurs | Moyenne - mocking complexe    |
| AppNavigator        | 60.8% | Navigation    | Moyenne - tests de navigation |
| useAudioPlayerLogic | 66.4% | Hook          | Moyenne                       |
| LicenseScreen       | 70.4% | Screen        | Moyenne                       |

### Opportunités d’amélioration (sans surtest)

1. ~~**validation.ts**~~ ✅ : loginSchema, registerSchema, competitionSchema, eventSchema, validate(), formatZodError() → **100% coverage**
2. ~~**retry.ts**~~ ✅ : retryAxios(), branches de shouldRetry, TypeError fetch → **~100% coverage**
3. ~~**typeGuards.ts**~~ ✅ : isWdsfQrData(), isQrData(), hasExtendedTrackData() → **100% coverage**
4. ~~**formValidation.ts**~~ ✅ : validateField() erreur non-ZodError (branche ligne 60) → **100% coverage**

Ces utilitaires purs ont une couverture maximale sans surtest.

### À éviter (surtest)

- Wrappers natifs (TrackPlayer, VisionCamera) : trop de mocks, peu de valeur
- Tests de snapshots complets sur des écrans complexes
- Tests E2E redondants avec les Maestro

---

## E2E - Maestro (client mobile)

| Scénario                 | Description                 |
| ------------------------ | --------------------------- |
| login                    | Connexion réussie           |
| login_error              | Gestion erreur de connexion |
| competition_registration | Inscription compétition     |
| competitions_list        | Liste des compétitions      |
| notifications            | Centre de notifications     |
| scanner_checkin          | Scan QR + check-in          |
| settings_theme           | Changement de thème         |
| library_playback         | Lecture bibliothèque        |
| club_members             | Gestion membres club        |

**Verdict** : Bonne couverture des parcours critiques.

---

## Recommandations

1. ~~**À faire**~~ ✅ : validation, retry, typeGuards, formValidation ont la couverture cible.
2. **Optionnel** : Quelques tests E2E backend supplémentaires sur les chemins d’erreur tracks/licenses si besoin.
3. **Éviter** : Tests sur wrappers natifs et surtests de composants UI.
4. **Maintenance** : Garder les seuils client à 70/55/60/70 ; le backend à 90/70/90/90 est pertinent.

---

## Actions récentes (18 fév 2026)

Tests ajoutés pour améliorer la couverture sans surtest :

### Client - useCompetitionsLogic (+12 tests)

- **Fonctions pures** : isValidCompetitionScope, isValidCompetitionStatusFilter, toCompetitionScope, toCompetitionStatusFilter
- Flux loadSettings : ORGANIZER scope ALL + defaultCompetitionStatus, registrant → FOR_ME
- handleRefresh : erreur syncCompetitions → recharge quand même via loadCompetitions

### Client - useNotificationsLogic + useNotificationsRepository (nouveau)

- useNotificationsLogic : load, load error, onMarkAsRead, onMarkAsRead error, onReadAll, onReadAll error, onRefresh
- useNotificationsRepository : getNotifications, markAsRead, markAllAsRead (happy path + no auth token)

**Résultat** : 448 → 473 tests. Couverture client 80.94% → 81.76% stmts, 81.54% → 82.36% lines.

### Client - useAudioPlayerLogic + NotificationHandler (18 fév 2026)

- **useAudioPlayerLogic** : +10 tests (handleNext/Prev repeat modes, shuffle single track, changeBpm/seekTo !isPlayerReady, removeQueueTrack resetPlayer/playTrackFromList)
- **NotificationHandler** : +5 tests (PROVISIONAL, denied, getToken error, subscribeToTopic, unsubscribeFromTopic)

**Résultat** : 473 → 488 tests. useAudioPlayerLogic 66% → 87.6%, NotificationHandler 77% → 100%. Couverture globale 81.76% → 82.64% stmts, 82.36% → 83.2% lines.

### Client - useLiveTiming + CompetitionContext + useClubCompetitionEditorLogic (18 fév 2026)

- **useLiveTiming** : +6 tests (heat_update, result_published, delay_update filter, disconnect, undefined competitionId, reconnect)
- **CompetitionContext** : +8 tests (loadCompetitions error, syncCompetitions success/error, getCompetitionDetails, getResults, unregister, getEventRegistrations, getUserRegistrations)
- **useClubCompetitionEditorLogic** : +6 tests (isValidCompetitionStatus, toCompetitionStatus, saveTiming empty title, openTimingModal empty schedule)

**Résultat** : 488 → 508 tests. Couverture globale 82.64% → 83.58% stmts, 69.42% → 69.85% branches, 72.84% → 74.46% functions, 83.2% → 84.05% lines.

### Client - useLicenseLogic + PerformanceContext (18 fév 2026)

- **useLicenseLogic** : +1 test (load profile when isLoggedIn + USER → getProfile, setFfdUser, listItems FFD). 76% → 90%.
- **PerformanceContext** : +2 tests (startPerformance returns false when no tracks match, TTS preload failure → Alert + idle). 74.6% → 79.1%.
- **generateAndSharePdf** : non testé en unitaire (timeouts async) ; couvert via flux Maestro/manuel.

**Résultat** : 508 → 511 tests. Couverture globale 83.58% → 84% stmts, 69.85% → 70.53% branches, 74.46% → 74.59% functions, 84.05% → 84.49% lines.

---

## Opportunités restantes sans surtest (18 fév 2026)

| Module                        | Couverture actuelle        | Actions                                                                                                                                                           |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| useAudioPlayerLogic           | ~~66.4%~~ → **87.6%** ✅   | +10 tests : handleNext/Prev repeat Track/Queue, shuffle single, changeBpm/seekTo !isPlayerReady, removeQueueTrack branches                                        |
| NotificationHandler           | ~~77.3%~~ → **100%** ✅    | +5 tests : PROVISIONAL, denied, getToken error, subscribeToTopic, unsubscribeFromTopic                                                                            |
| useLiveTiming                 | ~~76.2%~~ → **~95%** ✅    | +6 tests : heat_update, result_published, delay_update filter, disconnect, undefined competitionId, reconnect                                                     |
| CompetitionContext            | ~~65.9%~~ → **~95%** ✅    | +8 tests : loadCompetitions error, syncCompetitions (success + error), getCompetitionDetails, getResults, unregister, getEventRegistrations, getUserRegistrations |
| useClubCompetitionEditorLogic | ~~86.8%~~ → **~95%** ✅    | +6 tests : isValidCompetitionStatus, toCompetitionStatus, saveTiming empty title, openTimingModal empty schedule                                                  |
| useLicenseLogic               | ~~76.23%~~ → **90.09%** ✅ | +1 test : loadData isLoggedIn + getProfile → setFfdUser (listItems FFD)                                                                                           |
| PerformanceContext            | ~~74.62%~~ → **79.1%** ✅  | +2 tests : startPerformance returns false when no tracks, TTS preload failure                                                                                     |
| api.ts                        | 75.7%                      | Intercepteurs 401, retry - mocking complexe, ROI limité                                                                                                           |

---

## Conclusion

- **Backend** : niveau très bon, au-dessus des objectifs. Pas d’amélioration recommandée sans surtest.
- **Client** : objectifs atteints (70/55/60/70). 511 tests, couverture 84/70.5/74.6/84.5.
- **useLiveTiming, CompetitionContext, useClubCompetitionEditorLogic, useLicenseLogic, PerformanceContext** : couverture améliorée avec tests ciblés.
- **Maximum exploitable sans surtest** : atteint pour les modules logiques. Wrappers natifs (TrackPlayer, VisionCamera), generateAndSharePdf (async complexe), config.ts, écrans UI complexes = à éviter ou couvrir par E2E.
