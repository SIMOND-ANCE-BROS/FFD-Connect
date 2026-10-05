# Phase 8 — Frontend DX : Design Spec

**Date:** 2026-03-27

## Objectif

Trois améliorations de l'expérience développeur côté client React Native :

1. **Réduction des Contexts** — migrer les states globaux non-React vers Zustand
2. **Offline Sync** — gestion explicite des mutations faites hors-ligne
3. **Structure features** — convention uniforme dans tous les dossiers `features/`

---

## Axe 1 — Réduction des Contexts React

### Contexte

8 features contiennent chacune un ou plusieurs Contexts globaux. La prolifération crée des re-renders cachés, une hiérarchie de providers difficile à lire, et une logique métier couplée au cycle de vie React.

**Inventory actuel :**

| Context            | Dossier                | Migrer ?                                                      |
| ------------------ | ---------------------- | ------------------------------------------------------------- |
| AuthContext        | `auth/context`         | **Non** — lié au cycle de vie React (redirect, token refresh) |
| ThemeContext       | `context/` (global)    | **Non** — provider pattern légitime                           |
| ClubContext        | `club/context`         | **Oui** — state métier pur                                    |
| CompetitionContext | `competitions/context` | **Oui** — state métier pur                                    |
| PlayerContext      | `player/context`       | **Oui** — state UI complexe (playback)                        |
| PerformanceContext | `performance/context`  | **Oui** — state métier pur                                    |

### Design

**Librairie :** Zustand 5.x — minimaliste, pas de boilerplate, compatible React Native, testable sans provider.

**Un store par domaine :**

```
apps/client/src/stores/
  club.store.ts        # remplace ClubContext
  competition.store.ts # remplace CompetitionContext
  player.store.ts      # remplace PlayerContext
  performance.store.ts # remplace PerformanceContext
```

Chaque store expose :

- Le state
- Les actions (setters, async thunks si nécessaire)
- Un selector hook (`useClubStore`, `useCompetitionStore`, etc.)

**Migration** : les composants qui consomment `useContext(ClubContext)` passent à `useClubStore()`. Les providers correspondants sont supprimés de l'arbre dans `App.tsx` / `AppNavigator.tsx`.

**Persistence** : si un Context utilisait `AsyncStorage` pour persister du state, le store Zustand utilise le middleware `persist` de Zustand avec le même storage adapter.

### Fichiers

- Créer : `apps/client/src/stores/club.store.ts`
- Créer : `apps/client/src/stores/competition.store.ts`
- Créer : `apps/client/src/stores/player.store.ts`
- Créer : `apps/client/src/stores/performance.store.ts`
- Supprimer : les 4 fichiers de Context correspondants
- Modifier : tous les composants/hooks qui consomment ces Contexts
- Modifier : `App.tsx` ou `AppNavigator.tsx` (retirer les providers supprimés)

### Non-scope

- AuthContext et ThemeContext restent en Context
- Pas de migration de React Query vers Zustand — React Query reste pour le server state

---

## Axe 2 — Offline Sync Conflict Resolution

### Contexte

React Query persiste le cache via AsyncStorage (mis en place en Phase 6). Mais si l'utilisateur effectue une mutation hors-ligne (inscription à une compétition, mise à jour profil), la mutation échoue silencieusement ou est perdue au retour du réseau.

### Design

**Pattern : optimistic queue avec rejeu au retour réseau**

**`useOfflineQueue` hook** (`src/hooks/useOfflineQueue.ts`) :

- Écoute `NetInfo` pour détecter la reconnexion
- Lit une queue de mutations pendantes dans AsyncStorage (`@ffd/offline-queue`)
- Au retour du réseau, rejoue les mutations dans l'ordre
- En cas de succès : retire de la queue, invalide les queries React Query concernées
- En cas de 409 Conflict : toast "Tes données ont été mises à jour depuis une autre session" + invalidation cache (pas de merge automatique)
- En cas d'autre erreur : retry une fois, puis notification à l'utilisateur

**Format de queue** :

```typescript
type PendingMutation = {
  id: string; // uuid
  endpoint: string; // ex: 'POST /competitions/:id/register'
  payload: unknown;
  enqueuedAt: number; // timestamp
};
```

**Intégration** : les mutations "à risque offline" (inscription compétition, mise à jour profil) wrappent leur `mutationFn` via un helper `withOfflineQueue(mutationFn)`. Si hors-ligne, la mutation est enqueued plutôt qu'exécutée.

**`queryClient.tsx`** : ajouter un handler `onReconnect` qui trigger le rejeu de la queue.

### Fichiers

- Créer : `apps/client/src/hooks/useOfflineQueue.ts`
- Créer : `apps/client/src/hooks/__tests__/useOfflineQueue.test.ts`
- Modifier : `apps/client/src/services/queryClient.tsx`
- Modifier : mutations dans `competitions/hooks/` et `settings/hooks/` (inscription, profil)

### Non-scope

- Pas de merge automatique en cas de conflit — la règle FFD est trop stricte pour du merge optimiste
- Pas d'UI de gestion de queue (liste des mutations pendantes) — hors scope

---

## Axe 3 — Structure cohérente des features

### Contexte

Les 8 features ont des structures inconsistantes. `career` n'a que `hooks/` et `screens/`. `player` a `playerTypes.ts` à la racine et deux dossiers `types/` et `types.ts`. Certaines features mélangent types dans `hooks/`, d'autres dans un dossier dédié.

### Convention cible

```
features/<name>/
  screens/      # obligatoire — composants de page
  components/   # si composants réutilisables dans la feature
  hooks/        # si logique métier extraite
  services/     # si appels API spécifiques à la feature
  types.ts      # types locaux à la feature (un seul fichier plat)
```

Règles :

- `types.ts` à la racine du dossier feature (pas de sous-dossier `types/`)
- Pas de fichiers isolés à la racine (ex: `playerTypes.ts` → `player/types.ts`)
- `context/` supprimé après migration Axe 1

### Audit par feature

| Feature      | Actions                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| auth         | Renommer `schemas/` → conserver (cas particulier Zod), supprimer `context/` après Axe 1              |
| career       | Aucun changement structurel                                                                          |
| club         | Supprimer `context/` + `config/` → déplacer config dans `types.ts`, supprimer `context/` après Axe 1 |
| competitions | Supprimer `context/` après Axe 1                                                                     |
| license      | Aucun changement structurel                                                                          |
| performance  | Supprimer `context/` après Axe 1                                                                     |
| player       | `playerTypes.ts` → `types.ts`, supprimer `types/` (fusionner), supprimer `context/` après Axe 1      |
| settings     | Aucun changement structurel                                                                          |

### Fichiers

- Modifier : `apps/client/src/features/player/` (renommage + fusion types)
- Modifier : `apps/client/src/features/club/` (déplacer config)
- Les suppressions de `context/` sont dépendantes de l'Axe 1

### Non-scope

- Pas de déplacement de screens ou hooks — uniquement réorganisation de fichiers de types/config
- Pas de convention imposée sur les noms de fichiers dans `screens/`

---

## Dépendances entre axes

L'Axe 3 dépend partiellement de l'Axe 1 (les `context/` ne peuvent être supprimés qu'après migration Zustand). L'Axe 2 est indépendant.

**Ordre d'implémentation recommandé :** Axe 1 → Axe 3 (nettoyage context/) → Axe 2

## Dépendances externes

- `zustand` 5.x à ajouter dans `apps/client/package.json`
- `@react-native-community/netinfo` — déjà présent (utilisé par React Query)
- Aucune autre nouvelle dépendance
