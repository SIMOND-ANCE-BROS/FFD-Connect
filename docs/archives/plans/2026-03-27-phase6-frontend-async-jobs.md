# Phase 6 — Frontend Async Jobs

**Date:** 2026-03-27

## Objectif

Aligner le client React Native avec le backend async (Phase 3). Le backend retourne désormais `202 { jobId }` pour `POST /tracks/process` et `POST /competitions/sync` — le client doit poller jusqu'à completion.

## Contexte

Le backend Phase 3 a changé deux endpoints :

- `POST /tracks/process` → `202 { jobId, trackId }` (avant : `200 { title, artist, bpm, filename, downloadToken }`)
- `POST /competitions/sync` → `202 { jobId }` (avant : `200 { stats }`)

Le client n'a pas été mis à jour. Deux fonctionnalités sont cassées :

1. **`AddTrackModal`** : appelle `BackendService.analyzeUrl()` qui retourne un `AnalysisResult` — type incompatible avec la réponse réelle. Le step machine `"input" | "loading" | "confirm"` n'a pas d'état de polling.

2. **`handleRefresh` dans `useCompetitionsLogic`** : appelle `syncCompetitions()` puis `refetch()` immédiatement — le refetch se lance avant que le job background ait terminé.

**Architecture de polling :** Le backend expose :

- `GET /tracks/jobs/:jobId` → `{ status: 'pending'|'active'|'completed'|'failed', trackId?, error? }`
- `GET /competitions/sync/status` → `{ status: 'pending'|'active'|'completed'|'failed', jobId?, stats?, error? }`

Pas de WebSockets — polling simple avec intervalle fixe et timeout.

## Tâches

### Task 1 — Hook `useJobPolling`

**Fichier :** `apps/client/src/hooks/useJobPolling.ts` (nouveau)

Hook générique de polling pour un job BullMQ. Prend une fonction `fetchStatus` et retourne `{ status, result, error, isPolling }`.

```typescript
type JobStatus = 'pending' | 'active' | 'completed' | 'failed';

interface UseJobPollingOptions<T> {
  fetchStatus: () => Promise<{ status: JobStatus; result?: T; error?: string }>;
  onCompleted?: (result: T) => void;
  onFailed?: (error: string) => void;
  intervalMs?: number; // défaut: 2000
  timeoutMs?: number; // défaut: 180_000 (3min)
}

interface UseJobPollingReturn<T> {
  status: JobStatus | null;
  result: T | null;
  error: string | null;
  isPolling: boolean;
  startPolling: () => void;
  stopPolling: () => void;
}
```

**Comportement :**

- `startPolling()` lance un `setInterval` au rythme `intervalMs`
- Chaque tick appelle `fetchStatus()` — si `completed`, appelle `onCompleted(result)` et arrête ; si `failed`, appelle `onFailed(error)` et arrête
- Si le timeout est atteint avant completion/failed → `error = 'timeout'`, arrête
- `stopPolling()` arrête le polling (cleanup)
- `useEffect` cleanup arrête toujours le polling au démontage

**Tests (`useJobPolling.test.ts`) :**

- Appelle `onCompleted` quand `fetchStatus` retourne `{ status: 'completed', result }` (TDD)
- Appelle `onFailed` quand `fetchStatus` retourne `{ status: 'failed', error }`
- S'arrête après timeout
- Nettoie l'intervalle au démontage (pas de memory leak)

Utiliser `jest.useFakeTimers()` pour contrôler `setInterval`.

---

### Task 2 — Fix `AddTrackModal` pour le track processing async

**Fichiers :**

- `apps/client/src/services/BackendService.ts`
- `apps/client/src/features/player/components/AddTrackModal.tsx`

#### 2a. `BackendService.ts`

Remplacer `analyzeUrl` par deux nouvelles méthodes :

```typescript
// Nouveau : retourne jobId + trackId (202)
async submitTrackUrl(url: string): Promise<{ jobId: string; trackId: string }>

// Nouveau : poll le statut d'un job de track
async getTrackJobStatus(jobId: string): Promise<{
  status: 'pending' | 'active' | 'completed' | 'failed';
  trackId?: string;
  error?: string;
}>
```

Supprimer `analyzeUrl` et le type `AnalysisResult`.

Le `downloadTrack` reste — le download est toujours synchrone une fois le job terminé. Mais maintenant, au lieu d'un `downloadToken`, on utilise le `trackId` pour construire l'URL de download : `GET /tracks/:trackId/download` (vérifier le backend pour l'URL exacte).

> Note : Vérifier dans `apps/backend/src/tracks/tracks.controller.ts` comment le download est exposé. Si c'est encore `GET /tracks/download/:token`, on ne change pas la route — mais il faut récupérer le track complet via `GET /tracks/:trackId` pour avoir les métadonnées (titre, artiste, bpm, filename).

Ajouter aussi :

```typescript
async getTrack(trackId: string): Promise<{ id: string; title: string; artist: string; bpm: number; filename: string; style?: string }>
```

#### 2b. `AddTrackModal.tsx`

**Step machine :** `"input" | "loading" | "polling" | "confirm" | "error"`

**State :**

- Supprimer `metadata: AnalysisResult | null`
- Ajouter `jobId: string | null` et `trackId: string | null`
- `trackData: { title; artist; bpm; filename; style? } | null` (récupéré depuis `GET /tracks/:trackId` après completion)

**Flow :**

```
input → [Analyser] → loading (submitTrackUrl) → polling (useJobPolling)
  → completed → GET /tracks/:trackId → confirm (affichage + édition)
  → failed → error (message + bouton "Réessayer" → input)
```

**`handleAnalyze` :**

1. `setStep("loading")`
2. `submitTrackUrl(url)` → `{ jobId, trackId }`
3. `setJobId(jobId)` ; `setTrackId(trackId)` ; `setStep("polling")`

**Step `polling` :** Afficher `ActivityIndicator` + texte "Analyse en cours..." + appeler `useJobPolling` avec `fetchStatus = () => BackendService.getTrackJobStatus(jobId)`. Sur `onCompleted` → fetch le track via `getTrack(trackId)` → `setTrackData(...)` → `setStep("confirm")`. Sur `onFailed` → `setStep("error")`.

**Step `error` :** Afficher le message d'erreur + bouton "Réessayer" qui reset à `"input"`.

**`handleSave` :** Utilise `trackData.filename` pour download. Le `downloadToken` n'existe plus — vérifier si le download se fait via `trackId` ou si un token est toujours nécessaire (lire le backend).

**`reset` :** Nettoyer aussi `jobId`, `trackId`, `trackData`.

**Tests (`AddTrackModal.test.tsx`) :**

- Affiche step `polling` après submit réussi (TDD)
- Passe à `confirm` après `onCompleted`
- Passe à `error` après `onFailed`
- Le bouton "Réessayer" en step `error` revient à `input`

---

### Task 3 — Fix competition sync polling

**Fichiers :**

- `apps/client/src/features/competitions/context/CompetitionContext.tsx`
- `apps/client/src/features/competitions/hooks/useCompetitionsLogic.ts`

#### 3a. `CompetitionContext.tsx`

Modifier `syncCompetitions` pour retourner le `jobId` :

```typescript
// Avant
syncCompetitions: () => Promise<void>;

// Après
syncCompetitions: () => Promise<{ jobId: string } | null>;
```

Impl : `POST /competitions/sync` retourne `{ jobId }` (202). Retourner `{ jobId }`. Si erreur (403 non-admin, 409 sync déjà active), logger et retourner `null` — ne pas propager.

Mettre à jour l'interface `CompetitionRepository` et l'implémentation.

#### 3b. `useCompetitionsLogic.ts`

Modifier `handleRefresh` pour poller après le sync :

```typescript
const handleRefresh = async () => {
  setRefreshing(true);
  try {
    const syncResult = await syncCompetitions();
    if (syncResult?.jobId) {
      // Poll jusqu'à completion (max 60s pour le sync)
      await pollSyncJob(syncResult.jobId);
    }
    await refetch();
  } catch {
    await refetch();
  } finally {
    setRefreshing(false);
  }
};
```

`pollSyncJob` : fonction locale qui fait `GET /competitions/sync/status` toutes les 2s jusqu'à `completed` ou `failed` (timeout 60s). Ne pas utiliser `useJobPolling` ici (ce n'est pas un hook) — implémenter un helper async simple avec `while` loop + `sleep`.

Ajouter un helper dans le fichier :

```typescript
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Tests (`useCompetitionsLogic` ou spec dédié) :**

- `handleRefresh` attend la fin du sync avant de `refetch` (mock `syncCompetitions` qui retourne `jobId`, mock `GET /competitions/sync/status`)
- `handleRefresh` appelle `refetch` même si le sync échoue (robustesse)
- `handleRefresh` appelle `refetch` si `syncResult` est null (pas de jobId)

---

### Task 4 — Ajouter `refetchOnReconnect` et `refetchOnWindowFocus` au QueryClient

**Fichier :** `apps/client/src/services/queryClient.tsx`

```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24,
      staleTime: 1000 * 30,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});
```

**Pourquoi :** Sur mobile, l'app passe fréquemment en background. Sans `refetchOnReconnect`, après une coupure réseau (4G → WiFi), les données ne se rechargent pas automatiquement.

**Tests :** Vérifier que le `QueryClient` est créé avec les bonnes options (snapshot ou assertion sur `defaultOptions`).

---

## Vérifications avant de commencer

Lire `apps/backend/src/tracks/tracks.controller.ts` pour confirmer :

1. L'URL exacte de `GET /tracks/jobs/:jobId`
2. L'URL de download d'un track (token vs trackId)
3. S'il existe un `GET /tracks/:trackId` pour récupérer les métadonnées d'un track prêt

## Critères de sortie

- [x] `POST /tracks/process` retourne `{ jobId, trackId }` — `AddTrackModal` polle et affiche confirm
- [x] Step `"polling"` visible pendant l'analyse, `"error"` si échec
- [x] `handleRefresh` attend la fin du sync avant de refetch
- [x] `syncCompetitions` retourne `{ jobId } | null`
- [x] `refetchOnReconnect: true` dans `queryClient`
- [x] `pnpm typecheck` vert (client)
- [x] Tous les tests client passent

## Fichiers à créer

- `apps/client/src/hooks/useJobPolling.ts`
- `apps/client/src/hooks/useJobPolling.test.ts`

## Fichiers à modifier

- `apps/client/src/services/BackendService.ts`
- `apps/client/src/features/player/components/AddTrackModal.tsx`
- `apps/client/src/features/competitions/context/CompetitionContext.tsx`
- `apps/client/src/features/competitions/hooks/useCompetitionsLogic.ts`
- `apps/client/src/services/queryClient.tsx`
