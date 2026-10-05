# Phase 8 — Frontend DX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Migrer 4 Contexts React vers des stores Zustand, ajouter une queue offline pour les mutations hors-réseau, et uniformiser la structure des dossiers `features/`.

**Architecture:** Axe 1 (Zustand) → Axe 3 (cleanup) → Axe 2 (offline). ClubContext et CompetitionContext sont des repositories DI → stores avec actions. PlayerContext a un état natif TrackPlayer → store Zustand + composant `PlayerStoreSync` qui bridge les hooks natifs. PerformanceContext est trop lié au cycle React (timers, refs) → le state est extrait dans le store, le moteur reste dans un hook `usePerformanceEngine` appelé depuis l'écran.

**Tech Stack:** Zustand 5.x, React Native, @tanstack/react-query, @react-native-community/netinfo (déjà installé), TypeScript 5.6, Jest 29

---

## Fichiers impactés

### Créer

- `apps/client/src/stores/club.store.ts`
- `apps/client/src/stores/competition.store.ts`
- `apps/client/src/stores/player.store.ts`
- `apps/client/src/stores/performance.store.ts`
- `apps/client/src/components/PlayerStoreSync.tsx` — bridge TrackPlayer hooks → store
- `apps/client/src/hooks/useOfflineQueue.ts`
- `apps/client/src/hooks/__tests__/useOfflineQueue.test.ts`
- `apps/client/src/features/player/types.ts` — fusion de `playerTypes.ts` + `types/`

### Modifier

- `apps/client/App.tsx` — supprimer les 4 providers migrés, ajouter `<PlayerStoreSync />`
- `apps/client/src/features/club/context/ClubContext.tsx` — supprimer, remplacer par re-export depuis store
- `apps/client/src/features/competitions/context/CompetitionContext.tsx` — supprimer, remplacer par re-export depuis store
- `apps/client/src/features/player/context/PlayerContext.tsx` — supprimer, remplacer par re-export depuis store
- `apps/client/src/features/performance/context/PerformanceContext.tsx` — supprimer, extraire moteur en hook
- `apps/client/src/features/performance/screens/PerformancePlayerScreen.tsx` — appeler `usePerformanceEngine()`
- `apps/client/src/features/competitions/hooks/useCompetitionsLogic.ts` — importer depuis store
- `apps/client/src/features/competitions/hooks/useCompetitionDetailLogic.ts` — importer depuis store
- `apps/client/src/features/competitions/hooks/useLiveResultsLogic.ts` — importer depuis store
- `apps/client/src/features/competitions/screens/EventRegistrantsScreen.tsx` — importer depuis store
- `apps/client/src/features/player/hooks/useAudioPlayerLogic.ts` — importer depuis store
- `apps/client/src/features/player/hooks/useLibraryLogic.ts` — importer depuis store
- `apps/client/src/services/queryClient.tsx` — ajouter handler `onReconnect`
- `apps/client/src/features/club/` — supprimer `config/`, déplacer dans `types.ts`
- `apps/client/src/features/player/` — renommer `playerTypes.ts` → `types.ts`
- `apps/client/package.json` — ajouter `zustand`

---

## Task 1 — Installer Zustand

**Files:**

- Modify: `apps/client/package.json`

- [x] **Step 1 : Installer Zustand**

```bash
cd apps/client && pnpm add zustand
```

Expected: `Done in X.Xs`

- [x] **Step 2 : Vérifier le typecheck**

```bash
cd apps/client && pnpm typecheck
```

Expected: aucune erreur nouvelle.

---

## Task 2 — Store Club (remplace ClubContext)

**Files:**

- Create: `apps/client/src/stores/club.store.ts`
- Modify: `apps/client/src/features/club/context/ClubContext.tsx`

- [x] **Step 1 : Créer `club.store.ts`**

```typescript
// apps/client/src/stores/club.store.ts
import { create } from 'zustand';
import { ClubService } from '../features/club/services/ClubService';

export type { ClubMember } from '../features/club/services/ClubService';

export interface ClubRepository {
  getMembers(): Promise<import('../features/club/services/ClubService').ClubMember[]>;
  checkEligibility(
    member: import('../features/club/services/ClubService').ClubMember,
    event: { ageGroup: string; category: string },
  ): boolean;
}

interface ClubStoreState {
  repository: ClubRepository;
  setRepository: (impl: ClubRepository) => void;
}

export const defaultClubRepository: ClubRepository = {
  getMembers: () => ClubService.getMembers(),
  checkEligibility: (member, event) => ClubService.checkEligibility(member, event),
};

export const useClubStore = create<ClubStoreState>((set) => ({
  repository: defaultClubRepository,
  setRepository: (impl) => set({ repository: impl }),
}));

/** Hook de remplacement pour useClubRepository() */
export const useClubRepository = () => useClubStore((s) => s.repository);
```

- [x] **Step 2 : Remplacer le contenu de ClubContext.tsx par un re-export**

```typescript
// apps/client/src/features/club/context/ClubContext.tsx
// Re-exports depuis le store Zustand pour rétrocompatibilité
export { useClubRepository, useClubStore, defaultClubRepository } from '../../../stores/club.store';
export type { ClubRepository, ClubMember } from '../../../stores/club.store';
```

- [x] **Step 3 : Vérifier le typecheck**

```bash
cd apps/client && pnpm typecheck
```

Expected: aucune erreur.

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/client && pnpm test --testPathPattern="club"
```

Expected: PASS.

- [x] **Step 5 : Commit**

```bash
git add apps/client/src/stores/club.store.ts apps/client/src/features/club/context/ClubContext.tsx
git commit -m "feat(client): migrate ClubContext to Zustand club.store"
```

---

## Task 3 — Store Competition (remplace CompetitionContext)

**Files:**

- Create: `apps/client/src/stores/competition.store.ts`
- Modify: `apps/client/src/features/competitions/context/CompetitionContext.tsx`

- [x] **Step 1 : Lire les types exportés par CompetitionContext**

```bash
grep -n "^export" apps/client/src/features/competitions/context/CompetitionContext.tsx
```

Note tous les types et fonctions exportés — ils doivent tous être ré-exportés depuis le store.

- [x] **Step 2 : Créer `competition.store.ts`**

```typescript
// apps/client/src/stores/competition.store.ts
import type {
  ApiCompetition,
  ApiEvent,
  ApiRegistration,
  ApiResult,
  ApiScheduleItem,
  PaginatedResponse,
} from '@ffd-connect/shared';
import { create } from 'zustand';
import api from '../services/api';
import { createLogger } from '../utils/logger';

const logger = createLogger('competition.store');

// Aliases pour rétrocompatibilité avec les composants existants
export type Competition = ApiCompetition;
export type Event = ApiEvent;
export type ScheduleItem = ApiScheduleItem;
export type Result = ApiResult;
export type CompetitionRegistration = ApiRegistration;
export type { PaginatedResponse };

export interface PaginationMeta {
  total: number;
  skip: number;
  take: number;
  hasMore: boolean;
}

export interface ClubPendingRegistration {
  id: string;
  eventId: string;
  userId: string;
  partnerName: string | null;
  status: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    clubName: string | null;
  };
  event: {
    id: string;
    category: string;
    ageGroup: string;
    competitionId: string;
  };
  competition: { id: string; title: string; date: string } | null;
}

export interface CompetitionRepository {
  syncCompetitions: () => Promise<{ jobId: string } | null>;
  getCompetitionDetails: (
    id: string,
  ) => Promise<Competition & { events: Event[]; schedule: ScheduleItem[] }>;
  getCompetitionDetailsForUser?: (
    id: string,
  ) => Promise<Competition & { events: Event[]; schedule: ScheduleItem[] }>;
  registerForEvent: (competitionId: string, eventId: string, partnerName?: string) => Promise<void>;
  getResults: (competitionId: string) => Promise<Result[]>;
  getEventRegistrations: (eventId: string) => Promise<CompetitionRegistration[]>;
  unregisterFromEvent: (competitionId: string, eventId: string) => Promise<void>;
  getUserRegistrations: () => Promise<CompetitionRegistration[]>;
  getCompetitions: (
    skip?: number,
    take?: number,
  ) => Promise<{ data: Competition[]; meta: PaginationMeta | { hasMore: boolean } }>;
  getClubPendingRegistrations: () => Promise<ClubPendingRegistration[]>;
  registerMember: (eventId: string, userId: string, partnerName?: string) => Promise<void>;
  confirmRegistration: (registrationId: string) => Promise<void>;
  unregisterMember: (eventId: string, userId: string) => Promise<void>;
}

const defaultRepository: CompetitionRepository = {
  syncCompetitions: async () => {
    try {
      const res = await api.post<{ jobId: string }>(`/competitions/sync`);
      logger.info('Sync job enqueued', { jobId: res.data.jobId });
      return { jobId: res.data.jobId };
    } catch (e) {
      logger.warn('Failed to sync competitions from FFD API', e);
      return null;
    }
  },
  getCompetitions: async (skip = 0, take = 10) => {
    const res = await api.get<{ data: Competition[]; meta: PaginationMeta } | Competition[]>(
      `/competitions?skip=${skip}&take=${take}`,
    );
    const resData = res.data as { data?: Competition[]; meta?: PaginationMeta } | Competition[];
    return {
      data: (Array.isArray(resData) ? resData : resData.data) ?? [],
      meta: !Array.isArray(resData) && resData.meta ? resData.meta : { hasMore: false },
    };
  },
  getCompetitionDetails: async (id) => {
    const res = await api.get<Competition & { events: Event[]; schedule: ScheduleItem[] }>(
      `/competitions/${id}`,
    );
    return res.data;
  },
  getCompetitionDetailsForUser: async (id) => {
    const res = await api.get<Competition & { events: Event[]; schedule: ScheduleItem[] }>(
      `/competitions/${id}/for-user`,
    );
    return res.data;
  },
  registerForEvent: async (competitionId, eventId, partnerName) => {
    await api.post(`/competitions/${competitionId}/events/${eventId}/register`, {
      partnerName,
    });
  },
  getResults: async (competitionId) => {
    const res = await api.get<Result[]>(`/competitions/${competitionId}/results`);
    return res.data;
  },
  getEventRegistrations: async (eventId) => {
    const res = await api.get<CompetitionRegistration[]>(
      `/competitions/events/${eventId}/registrations`,
    );
    return res.data;
  },
  unregisterFromEvent: async (competitionId, eventId) => {
    await api.delete(`/competitions/${competitionId}/events/${eventId}/register`);
  },
  getUserRegistrations: async () => {
    const res = await api.get<CompetitionRegistration[]>(`/competitions/registrations/me`);
    return res.data;
  },
  getClubPendingRegistrations: async () => {
    const res = await api.get<ClubPendingRegistration[]>(`/competitions/registrations/pending`);
    return res.data;
  },
  registerMember: async (eventId, userId, partnerName) => {
    await api.post(`/competitions/events/${eventId}/members/${userId}/register`, {
      partnerName,
    });
  },
  confirmRegistration: async (registrationId) => {
    await api.patch(`/competitions/registrations/${registrationId}/confirm`);
  },
  unregisterMember: async (eventId, userId) => {
    await api.delete(`/competitions/events/${eventId}/members/${userId}/register`);
  },
};

interface CompetitionStoreState {
  repository: CompetitionRepository;
}

export const useCompetitionStore = create<CompetitionStoreState>(() => ({
  repository: defaultRepository,
}));

/** Hook de remplacement pour useCompetitionRepository() */
export const useCompetitionRepository = () => useCompetitionStore((s) => s.repository);
```

- [x] **Step 3 : Remplacer CompetitionContext.tsx par un re-export**

```typescript
// apps/client/src/features/competitions/context/CompetitionContext.tsx
export { useCompetitionRepository, useCompetitionStore } from '../../../stores/competition.store';
export type {
  Competition,
  Event,
  ScheduleItem,
  Result,
  CompetitionRegistration,
  PaginationMeta,
  ClubPendingRegistration,
  CompetitionRepository,
  PaginatedResponse,
} from '../../../stores/competition.store';
```

- [x] **Step 4 : Typecheck + tests**

```bash
cd apps/client && pnpm typecheck && pnpm test --testPathPattern="competition"
```

Expected: PASS.

- [x] **Step 5 : Commit**

```bash
git add apps/client/src/stores/competition.store.ts apps/client/src/features/competitions/context/CompetitionContext.tsx
git commit -m "feat(client): migrate CompetitionContext to Zustand competition.store"
```

---

## Task 4 — Store Player (remplace PlayerContext)

PlayerContext utilise `usePlaybackState()` de TrackPlayer — un hook React qui ne peut pas vivre dans un store Zustand. Pattern : le store Zustand gère le state stable (likedTrackIds, repeatMode, isShuffle, queueTracks, currentTrack, isPlayerReady, isPlaying). Un composant `PlayerStoreSync` (renders null) appelle les hooks TrackPlayer et met à jour le store.

**Files:**

- Create: `apps/client/src/stores/player.store.ts`
- Create: `apps/client/src/components/PlayerStoreSync.tsx`
- Modify: `apps/client/src/features/player/context/PlayerContext.tsx`

- [x] **Step 1 : Créer `player.store.ts`**

```typescript
// apps/client/src/stores/player.store.ts
import { create } from 'zustand';
import TrackPlayer from '../utils/TrackPlayerWrapper';
import * as TrackPlayerUtils from '../utils/TrackPlayerWrapper';
import { createLogger } from '../utils/logger';
import { hasExtendedTrackData } from '../utils/typeGuards';
import { setupPlayer } from '../features/player/services/TrackPlayerService';
import { PlayerRepeatMode, TrackData } from '../features/player/playerTypes';

export { PlayerRepeatMode };
export type { TrackData };

const logger = createLogger('player.store');

interface PlayerState {
  currentTrack: TrackData | null;
  isPlaying: boolean;
  isPlayerReady: boolean;
  queueTracks: TrackData[];
  likedTrackIds: string[];
  repeatMode: PlayerRepeatMode;
  isShuffle: boolean;

  // Internal setters (called by PlayerStoreSync)
  setIsPlaying: (v: boolean) => void;
  setCurrentTrack: (t: TrackData | null) => void;
  setQueueTracks: (tracks: TrackData[]) => void;

  // Actions
  ensurePlayerReady: () => Promise<boolean>;
  playTrack: (track: TrackData, playlist?: TrackData[], forceRestart?: boolean) => Promise<void>;
  togglePlayback: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  resetPlayer: () => Promise<void>;
  toggleLike: (trackId: string) => void;
  isLiked: (trackId: string) => boolean;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  isPlayerReady: false,
  queueTracks: [],
  likedTrackIds: [],
  repeatMode: PlayerRepeatMode.Off,
  isShuffle: false,

  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTrack: (t) => set({ currentTrack: t }),
  setQueueTracks: (tracks) => set({ queueTracks: tracks }),

  ensurePlayerReady: async () => {
    if (get().isPlayerReady) return true;
    try {
      const ready = await setupPlayer();
      if (ready) set({ isPlayerReady: true });
      return ready;
    } catch (e) {
      logger.error('Failed to setup player', e);
      return false;
    }
  },

  playTrack: async (track, playlist, forceRestart = false) => {
    const ready = await get().ensurePlayerReady();
    if (!ready) return;
    if (playlist) set({ queueTracks: playlist });
    const tracksToLoad = playlist ?? [track];
    const currentIndex = tracksToLoad.findIndex((t) => t.id === track.id);
    if (!forceRestart) {
      const activeTrack = await TrackPlayer.getActiveTrack();
      if (activeTrack?.id === track.id) {
        await TrackPlayer.play();
        return;
      }
    }
    await TrackPlayer.reset();
    await TrackPlayer.add(tracksToLoad.map((t) => ({ ...t, id: t.id })));
    await TrackPlayer.skip(currentIndex >= 0 ? currentIndex : 0);
    await TrackPlayer.play();
  },

  togglePlayback: async () => {
    const ready = await get().ensurePlayerReady();
    if (!ready) return;
    if (get().isPlaying) {
      await TrackPlayer.pause();
    } else {
      await TrackPlayer.play();
    }
  },

  pause: async () => {
    const ready = await get().ensurePlayerReady();
    if (ready) await TrackPlayer.pause();
  },

  resume: async () => {
    const ready = await get().ensurePlayerReady();
    if (ready) await TrackPlayer.play();
  },

  seekTo: async (seconds) => {
    const ready = await get().ensurePlayerReady();
    if (ready) await TrackPlayer.seekTo(seconds);
  },

  resetPlayer: async () => {
    await TrackPlayer.reset();
    set({ currentTrack: null, queueTracks: [], isPlaying: false });
  },

  toggleLike: (trackId) =>
    set((s) => ({
      likedTrackIds: s.likedTrackIds.includes(trackId)
        ? s.likedTrackIds.filter((id) => id !== trackId)
        : [...s.likedTrackIds, trackId],
    })),

  isLiked: (trackId) => get().likedTrackIds.includes(trackId),

  toggleRepeat: () =>
    set((s) => {
      const next =
        s.repeatMode === PlayerRepeatMode.Off
          ? PlayerRepeatMode.Track
          : s.repeatMode === PlayerRepeatMode.Track
            ? PlayerRepeatMode.Queue
            : PlayerRepeatMode.Off;
      const tpMode =
        next === PlayerRepeatMode.Off
          ? TrackPlayerUtils.RepeatMode.Off
          : next === PlayerRepeatMode.Queue
            ? TrackPlayerUtils.RepeatMode.Queue
            : TrackPlayerUtils.RepeatMode.Track;
      TrackPlayer.setRepeatMode(tpMode).catch(() => {});
      return { repeatMode: next };
    }),

  toggleShuffle: () => set((s) => ({ isShuffle: !s.isShuffle })),
}));

/** Hook de remplacement pour usePlayer() */
export const usePlayer = () => usePlayerStore();
```

- [x] **Step 2 : Créer `PlayerStoreSync.tsx`**

Ce composant est rendu dans App.tsx à la place de PlayerProvider. Il appelle les hooks TrackPlayer réactifs et les synchronise dans le store.

```typescript
// apps/client/src/components/PlayerStoreSync.tsx
import { useEffect } from 'react';
import * as TrackPlayerUtils from '../utils/TrackPlayerWrapper';
import TrackPlayer from '../utils/TrackPlayerWrapper';
import { hasExtendedTrackData } from '../utils/typeGuards';
import { usePlayerStore } from '../stores/player.store';
import type { TrackData } from '../features/player/playerTypes';
import { createLogger } from '../utils/logger';

const logger = createLogger('PlayerStoreSync');

/**
 * Composant invisible qui bridge les hooks réactifs de TrackPlayer
 * vers le store Zustand. Doit être rendu une seule fois dans App.tsx.
 */
export const PlayerStoreSync = () => {
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setCurrentTrack = usePlayerStore((s) => s.setCurrentTrack);
  const ensurePlayerReady = usePlayerStore((s) => s.ensurePlayerReady);

  const playbackState = TrackPlayerUtils.usePlaybackState();

  useEffect(() => {
    setIsPlaying(playbackState.state === TrackPlayerUtils.State.Playing);
  }, [playbackState.state, setIsPlaying]);

  useEffect(() => {
    ensurePlayerReady().catch(() => {});

    const sub1 = TrackPlayer.addEventListener(
      TrackPlayerUtils.Event.PlaybackError,
      (e: TrackPlayerUtils.PlaybackErrorEvent) => {
        logger.error('TrackPlayer Playback Error:', e);
      },
    );

    const sub2 = TrackPlayer.addEventListener(
      TrackPlayerUtils.Event.PlaybackTrackChanged,
      (e: TrackPlayerUtils.PlaybackTrackChangedEvent) => {
        (async () => {
          if (e.nextTrack !== null) {
            const track = await TrackPlayer.getTrack(e.nextTrack);
            if (track) {
              const extendedData = hasExtendedTrackData(track)
                ? track
                : { baseBpm: 0, style: undefined, playlist: undefined };
              const trackData: TrackData = {
                id: track.id,
                url: typeof track.url === 'string' ? track.url : '',
                title: track.title ?? '',
                artist: track.artist ?? '',
                artwork: typeof track.artwork === 'string' ? track.artwork : undefined,
                baseBpm: extendedData.baseBpm ?? 0,
                style: extendedData.style,
                playlist: extendedData.playlist,
              };
              setCurrentTrack(trackData);
            }
          }
        })().catch(() => {});
      },
    );

    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, [ensurePlayerReady, setCurrentTrack]);

  return null;
};
```

- [x] **Step 3 : Remplacer PlayerContext.tsx par un re-export**

```typescript
// apps/client/src/features/player/context/PlayerContext.tsx
export {
  usePlayer,
  usePlayerStore,
  PlayerRepeatMode as ContextRepeatMode,
} from '../../../stores/player.store';
export type { TrackData } from '../../../stores/player.store';
```

- [x] **Step 4 : Typecheck**

```bash
cd apps/client && pnpm typecheck
```

Expected: PASS. Si des erreurs apparaissent sur `ContextRepeatMode`, c'est que des composants importent `ContextRepeatMode` depuis PlayerContext — l'export ci-dessus le gère.

- [x] **Step 5 : Lancer les tests player**

```bash
cd apps/client && pnpm test --testPathPattern="player"
```

Expected: PASS.

- [x] **Step 6 : Commit**

```bash
git add apps/client/src/stores/player.store.ts apps/client/src/components/PlayerStoreSync.tsx apps/client/src/features/player/context/PlayerContext.tsx
git commit -m "feat(client): migrate PlayerContext to Zustand player.store + PlayerStoreSync bridge"
```

---

## Task 5 — Store Performance (remplace PerformanceContext)

PerformanceContext a des timers, refs et useEffect — impossible à mettre directement dans un store. Pattern : le state (config, playlist, status, etc.) va dans le store. La logique de moteur (timers, TTS, TrackPlayer) est extraite dans un hook `usePerformanceEngine` appelé dans `PerformancePlayerScreen`.

**Files:**

- Create: `apps/client/src/stores/performance.store.ts`
- Modify: `apps/client/src/features/performance/context/PerformanceContext.tsx`
- Modify: `apps/client/src/features/performance/screens/PerformancePlayerScreen.tsx`

- [x] **Step 1 : Lire PerformanceContext en entier**

```bash
wc -l apps/client/src/features/performance/context/PerformanceContext.tsx
cat apps/client/src/features/performance/context/PerformanceContext.tsx
```

Note les types (`PerformanceConfig`, `PlaylistItem`), le state et les actions.

- [x] **Step 2 : Créer `performance.store.ts`**

```typescript
// apps/client/src/stores/performance.store.ts
import { create } from 'zustand';

export type Category = 'Standard' | 'Latin';
export type Mode = 'Round' | 'Final';

export interface PerformanceConfig {
  mode: Mode;
  category: Category;
  selectedDances: string[];
  duration: number;
  pauseDuration: number;
  pasoClashes: 2 | 3;
  numberOfHeats: number;
}

export interface PlaylistItem {
  track: import('../features/player/playerTypes').TrackData;
  style: string;
  duration: number;
  isPaso: boolean;
  heatIndex: number;
  totalHeats: number;
  announcementPath?: string;
}

interface PerformanceState {
  config: PerformanceConfig;
  playlist: PlaylistItem[];
  currentDanceIndex: number;
  status: 'idle' | 'playing' | 'paused' | 'finished' | 'break' | 'loading';
  activePhase: 'dance' | 'break';
  timeRemaining: number;

  setConfig: (config: React.SetStateAction<PerformanceConfig>) => void;
  setPlaylist: (playlist: PlaylistItem[]) => void;
  setCurrentDanceIndex: (idx: number) => void;
  setStatus: (status: PerformanceState['status']) => void;
  setActivePhase: (phase: PerformanceState['activePhase']) => void;
  setTimeRemaining: (t: number) => void;
}

const DEFAULT_CONFIG: PerformanceConfig = {
  mode: 'Round',
  category: 'Standard',
  selectedDances: [],
  duration: 90,
  pauseDuration: 15,
  pasoClashes: 2,
  numberOfHeats: 3,
};

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  config: DEFAULT_CONFIG,
  playlist: [],
  currentDanceIndex: 0,
  status: 'idle',
  activePhase: 'dance',
  timeRemaining: 0,

  setConfig: (configOrUpdater) =>
    set((s) => ({
      config: typeof configOrUpdater === 'function' ? configOrUpdater(s.config) : configOrUpdater,
    })),
  setPlaylist: (playlist) => set({ playlist }),
  setCurrentDanceIndex: (idx) => set({ currentDanceIndex: idx }),
  setStatus: (status) => set({ status }),
  setActivePhase: (activePhase) => set({ activePhase }),
  setTimeRemaining: (timeRemaining) => set({ timeRemaining }),
}));
```

> Note : `React.SetStateAction` nécessite `import React from "react"` en haut du fichier. Ajouter cet import.

- [x] **Step 3 : Remplacer PerformanceContext.tsx**

```typescript
// apps/client/src/features/performance/context/PerformanceContext.tsx
// Le moteur (timers, TTS, TrackPlayer) est maintenant dans usePerformanceEngine
// appelé directement dans PerformancePlayerScreen.
// Ce fichier expose le hook usePerformance pour rétrocompatibilité.
export { usePerformanceStore } from '../../../stores/performance.store';
export type {
  PerformanceConfig,
  PlaylistItem,
  Category,
  Mode,
} from '../../../stores/performance.store';

// usePerformance() est fourni par le hook usePerformanceEngine dans les screens.
// Les screens qui avaient `const { ... } = usePerformance()` doivent passer à
// `const { ... } = usePerformanceStore()` et appeler `usePerformanceEngine()` pour les actions.
```

- [x] **Step 4 : Déplacer la logique moteur dans un hook dans PerformancePlayerScreen**

Ouvrir `apps/client/src/features/performance/screens/PerformancePlayerScreen.tsx`.

En haut du fichier, déplacer la logique qui était dans `PerformanceProvider` (les `useEffect` avec timers, les appels TTS, TrackPlayer) dans un hook local `usePerformanceEngine()` défini dans le même fichier :

```typescript
// Dans PerformancePlayerScreen.tsx, AVANT le composant principal :
function usePerformanceEngine() {
  const store = usePerformanceStore();
  const { playTrack, pause, resume } = usePlayer();
  const { allTracks } = useLibrary();
  // ... toute la logique qui était dans PerformanceProvider (timers, generatePlaylist, startPerformance, etc.)
  // Accéder au state via store.config, store.playlist, etc.
  // Mettre à jour via store.setStatus(...), store.setTimeRemaining(...), etc.
  return {
    config: store.config,
    setConfig: store.setConfig,
    playlist: store.playlist,
    currentDanceIndex: store.currentDanceIndex,
    status: store.status,
    activePhase: store.activePhase,
    timeRemaining: store.timeRemaining,
    generatePlaylist: () => {
      /* ... */
    },
    startPerformance: async () => {
      /* ... */
    },
    stopPerformance: () => {
      /* ... */
    },
    nextDance: () => {
      /* ... */
    },
    togglePlayPause: () => {
      /* ... */
    },
    fadeNow: () => {
      /* ... */
    },
  };
}
```

Dans le composant `PerformancePlayerScreen`, remplacer `const { ... } = usePerformance()` par `const { ... } = usePerformanceEngine()`.

- [x] **Step 5 : Mettre à jour PerformanceSetupScreen**

```bash
grep -n "usePerformance\b" apps/client/src/features/performance/screens/PerformanceSetupScreen.tsx
```

`PerformanceSetupScreen` utilise `config` et `setConfig` — remplacer `usePerformance()` par `usePerformanceStore()` :

```typescript
// Avant :
const { config, setConfig, startPerformance } = usePerformance();

// Après :
const { config, setConfig, startPerformance } = usePerformanceEngine();
// Note : si startPerformance n'est pas disponible depuis PerformanceSetupScreen,
// extraire usePerformanceEngine dans un fichier séparé hooks/usePerformanceEngine.ts
// partagé entre les deux screens.
```

- [x] **Step 6 : Typecheck + tests**

```bash
cd apps/client && pnpm typecheck && pnpm test --testPathPattern="performance"
```

Expected: PASS.

- [x] **Step 7 : Commit**

```bash
git add apps/client/src/stores/performance.store.ts apps/client/src/features/performance/
git commit -m "feat(client): migrate PerformanceContext to Zustand performance.store + usePerformanceEngine hook"
```

---

## Task 6 — Mettre à jour App.tsx

**Files:**

- Modify: `apps/client/App.tsx`

- [x] **Step 1 : Supprimer les providers migrés et ajouter PlayerStoreSync**

Dans `apps/client/App.tsx` :

1. Supprimer les imports : `ClubProvider`, `defaultClubRepository`, `CompetitionProvider`, `PlayerProvider`, `PerformanceProvider`
2. Ajouter l'import : `import { PlayerStoreSync } from "./src/components/PlayerStoreSync";`
3. Initialiser le store Club avec le repository par défaut (à faire une seule fois) :

```typescript
// Avant le composant App, initialiser le repository
import { useClubStore, defaultClubRepository } from './src/stores/club.store';
// Dans App(), avant le return :
useEffect(() => {
  useClubStore.getState().setRepository(defaultClubRepository);
}, []);
```

4. Remplacer dans le JSX :

```tsx
// Avant :
<ClubProvider implementation={defaultClubRepository}>
  <TrackProvider implementation={trackService}>
    <LibraryProvider>
      <PlayerProvider>
        <PerformanceProvider>
          <CompetitionProvider>
            <ThemedAppContent />
          </CompetitionProvider>
        </PerformanceProvider>
      </PlayerProvider>
    </LibraryProvider>
  </TrackProvider>
</ClubProvider>

// Après :
<TrackProvider implementation={trackService}>
  <LibraryProvider>
    <PlayerStoreSync />
    <ThemedAppContent />
  </LibraryProvider>
</TrackProvider>
```

> `TrackProvider` et `LibraryProvider` restent pour l'instant (non migrés dans ce plan). `PlayerStoreSync` doit être dans l'arbre React pour que `usePlaybackState()` fonctionne.

- [x] **Step 2 : Typecheck**

```bash
cd apps/client && pnpm typecheck
```

Expected: PASS.

- [x] **Step 3 : Lancer tous les tests**

```bash
cd apps/client && pnpm test
```

Expected: PASS.

- [x] **Step 4 : Commit**

```bash
git add apps/client/App.tsx
git commit -m "feat(client): remove migrated Context providers from App.tsx, add PlayerStoreSync"
```

---

## Task 7 — Structure features : player/types.ts et club/config

**Files:**

- Rename: `apps/client/src/features/player/playerTypes.ts` → `apps/client/src/features/player/types.ts`
- Modify: imports dans les fichiers qui importent `playerTypes`
- Modify: `apps/client/src/features/club/` — déplacer `config/` dans `types.ts`

- [x] **Step 1 : Identifier tous les imports de playerTypes**

```bash
grep -rn "from.*playerTypes\|import.*playerTypes" apps/client/src/ --include="*.tsx" --include="*.ts"
```

Note tous les fichiers listés.

- [x] **Step 2 : Créer player/types.ts avec le contenu de playerTypes.ts**

```typescript
// apps/client/src/features/player/types.ts
// Contenu identique à playerTypes.ts — fusionner aussi les types du dossier types/ si présents
export { TrackData, PlayerRepeatMode } from './playerTypes';
// Si apps/client/src/features/player/types/ (dossier) existe, fusionner ses exports ici
```

Vérifier si `apps/client/src/features/player/types/` (dossier) existe :

```bash
ls apps/client/src/features/player/types/ 2>/dev/null || echo "no types dir"
```

Si le dossier existe, copier ses exports dans `types.ts` et supprimer le dossier.

- [x] **Step 3 : Mettre à jour les imports dans les fichiers qui importaient playerTypes**

Pour chaque fichier trouvé au Step 1, remplacer :

```typescript
// Avant :
import { TrackData, PlayerRepeatMode } from '../playerTypes';
// Après :
import { TrackData, PlayerRepeatMode } from '../types';
```

- [x] **Step 4 : Supprimer playerTypes.ts**

```bash
rm apps/client/src/features/player/playerTypes.ts
```

- [x] **Step 5 : Déplacer club/config vers club/types.ts**

```bash
# Voir le contenu du dossier config
cat apps/client/src/features/club/config/TrackPlayerTypes.ts
cat apps/client/src/features/club/config/clubDashboardWidgets.ts
```

Créer `apps/client/src/features/club/types.ts` et y copier les exports des deux fichiers de config. Mettre à jour les imports dans les fichiers qui importaient depuis `club/config/`.

```bash
grep -rn "from.*club/config\|from.*clubDashboardWidgets\|from.*TrackPlayerTypes" apps/client/src/ --include="*.tsx" --include="*.ts"
```

- [x] **Step 6 : Typecheck final**

```bash
cd apps/client && pnpm typecheck
```

Expected: PASS.

- [x] **Step 7 : Commit**

```bash
git add apps/client/src/features/player/ apps/client/src/features/club/
git commit -m "chore(client): normalize feature structure — player/types.ts, club/types.ts"
```

---

## Task 8 — Offline Queue Hook

**Files:**

- Create: `apps/client/src/hooks/useOfflineQueue.ts`
- Create: `apps/client/src/hooks/__tests__/useOfflineQueue.test.ts`
- Modify: `apps/client/src/services/queryClient.tsx`

- [x] **Step 1 : Écrire le test**

```typescript
// apps/client/src/hooks/__tests__/useOfflineQueue.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, act } from '@testing-library/react-native';
import { useOfflineQueue } from '../useOfflineQueue';

// NetInfo mock
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()), // returns unsubscribe
  fetch: jest.fn().mockResolvedValue({ isConnected: true }),
}));

const QUEUE_KEY = '@ffd/offline-queue';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('useOfflineQueue', () => {
  it('enqueues a mutation when offline', async () => {
    const { result } = renderHook(() => useOfflineQueue());
    await act(async () => {
      await result.current.enqueue({
        endpoint: 'POST /competitions/123/register',
        payload: { partnerName: 'Jean' },
        queryKeysToInvalidate: [['competitions']],
      });
    });
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    expect(stored).not.toBeNull();
    const queue = JSON.parse(stored!) as unknown[];
    expect(queue).toHaveLength(1);
  });

  it('processes queue on reconnect and calls mutationFn', async () => {
    const NetInfo = require('@react-native-community/netinfo');
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null = null;
    NetInfo.addEventListener.mockImplementation((cb: (state: { isConnected: boolean }) => void) => {
      reconnectCallback = cb;
      return jest.fn();
    });

    const mutationFn = jest.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useOfflineQueue({ mutationFn }));

    // Enqueue a mutation
    await act(async () => {
      await result.current.enqueue({
        endpoint: 'POST /competitions/123/register',
        payload: { partnerName: 'Jean' },
        queryKeysToInvalidate: [['competitions']],
      });
    });

    // Simulate reconnect
    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      // Wait for async processing
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn).toHaveBeenCalledWith({
      endpoint: 'POST /competitions/123/register',
      payload: { partnerName: 'Jean' },
    });
  });

  it('shows conflict toast on 409 and clears queue entry', async () => {
    const NetInfo = require('@react-native-community/netinfo');
    let reconnectCallback: ((state: { isConnected: boolean }) => void) | null = null;
    NetInfo.addEventListener.mockImplementation((cb: (state: { isConnected: boolean }) => void) => {
      reconnectCallback = cb;
      return jest.fn();
    });

    const conflictError = Object.assign(new Error('Conflict'), {
      response: { status: 409 },
    });
    const mutationFn = jest.fn().mockRejectedValue(conflictError);
    const onConflict = jest.fn();
    const { result } = renderHook(() => useOfflineQueue({ mutationFn, onConflict }));

    await act(async () => {
      await result.current.enqueue({
        endpoint: 'POST /competitions/123/register',
        payload: {},
        queryKeysToInvalidate: [],
      });
    });

    await act(async () => {
      reconnectCallback?.({ isConnected: true });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(onConflict).toHaveBeenCalled();
    // Queue should be cleared after conflict
    const stored = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = stored ? (JSON.parse(stored) as unknown[]) : [];
    expect(queue).toHaveLength(0);
  });
});
```

- [x] **Step 2 : Lancer les tests pour confirmer qu'ils échouent**

```bash
cd apps/client && pnpm test src/hooks/__tests__/useOfflineQueue.test.ts
```

Expected: FAIL — `useOfflineQueue` is not defined.

- [x] **Step 3 : Implémenter `useOfflineQueue`**

```typescript
// apps/client/src/hooks/useOfflineQueue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { queryClient } from '../services/queryClient';
import { createLogger } from '../utils/logger';

const logger = createLogger('useOfflineQueue');
const QUEUE_KEY = '@ffd/offline-queue';

export interface PendingMutation {
  id: string;
  endpoint: string;
  payload: unknown;
  queryKeysToInvalidate: string[][];
  enqueuedAt: number;
}

interface UseOfflineQueueOptions {
  /** Fonction qui exécute la mutation. Reçoit { endpoint, payload }. Par défaut appelle api. */
  mutationFn?: (m: { endpoint: string; payload: unknown }) => Promise<unknown>;
  /** Appelé quand une mutation reçoit un 409 Conflict. */
  onConflict?: () => void;
}

async function loadQueue(): Promise<PendingMutation[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PendingMutation[];
  } catch {
    return [];
  }
}

async function saveQueue(queue: PendingMutation[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function useOfflineQueue(options: UseOfflineQueueOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      if (!state.isConnected) return;

      const queue = await loadQueue();
      if (queue.length === 0) return;

      logger.info(`Replaying ${queue.length} offline mutation(s)`);

      const remaining: PendingMutation[] = [];

      for (const mutation of queue) {
        try {
          if (optionsRef.current.mutationFn) {
            await optionsRef.current.mutationFn({
              endpoint: mutation.endpoint,
              payload: mutation.payload,
            });
          } else {
            // Default: use api module
            const [method, path] = mutation.endpoint.split(' ');
            const { default: api } = await import('../services/api');
            if (method === 'POST') await api.post(path, mutation.payload);
            else if (method === 'PATCH') await api.patch(path, mutation.payload);
            else if (method === 'DELETE') await api.delete(path);
          }
          // Success: invalidate related queries
          for (const key of mutation.queryKeysToInvalidate) {
            await queryClient.invalidateQueries({ queryKey: key });
          }
          logger.info(`Replayed: ${mutation.endpoint}`);
        } catch (err: unknown) {
          const status =
            err !== null &&
            typeof err === 'object' &&
            'response' in err &&
            err.response !== null &&
            typeof err.response === 'object' &&
            'status' in err.response
              ? (err.response as { status: number }).status
              : null;

          if (status === 409) {
            logger.warn(`Conflict replaying ${mutation.endpoint}, discarding`);
            optionsRef.current.onConflict?.();
            // Invalidate to get fresh data
            for (const key of mutation.queryKeysToInvalidate) {
              await queryClient.invalidateQueries({ queryKey: key });
            }
            // Don't add to remaining — discard this mutation
          } else {
            logger.error(`Failed replaying ${mutation.endpoint}, keeping in queue`, err);
            remaining.push(mutation);
          }
        }
      }

      await saveQueue(remaining);
    });

    return unsubscribe;
  }, []);

  const enqueue = async (mutation: Omit<PendingMutation, 'id' | 'enqueuedAt'>) => {
    const queue = await loadQueue();
    const entry: PendingMutation = {
      ...mutation,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      enqueuedAt: Date.now(),
    };
    queue.push(entry);
    await saveQueue(queue);
    logger.info(`Enqueued offline mutation: ${mutation.endpoint}`);
  };

  return { enqueue };
}
```

- [x] **Step 4 : Lancer les tests**

```bash
cd apps/client && pnpm test src/hooks/__tests__/useOfflineQueue.test.ts
```

Expected: PASS — 3 tests passing.

- [x] **Step 5 : Monter le hook dans queryClient.tsx**

Dans `apps/client/src/services/queryClient.tsx`, ajouter un composant `OfflineQueueProvider` qui monte le hook :

```typescript
// Dans queryClient.tsx, ajouter :
import { useOfflineQueue } from "../hooks/useOfflineQueue";
import { Alert } from "react-native";

const OfflineQueueRunner = () => {
  useOfflineQueue({
    onConflict: () =>
      Alert.alert(
        "Données mises à jour",
        "Tes modifications ont été ignorées car les données ont été mises à jour depuis une autre session.",
      ),
  });
  return null;
};

// Dans PersistedQueryClientProvider, ajouter <OfflineQueueRunner /> :
export const PersistedQueryClientProvider = ({ children }: Props) => {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: asyncStoragePersister }}
    >
      <OfflineQueueRunner />
      {children}
    </PersistQueryClientProvider>
  );
};
```

- [x] **Step 6 : Lancer tous les tests**

```bash
cd apps/client && pnpm test
```

Expected: PASS.

- [x] **Step 7 : Commit**

```bash
git add apps/client/src/hooks/ apps/client/src/services/queryClient.tsx
git commit -m "feat(client): add useOfflineQueue hook for offline mutation replay with conflict detection"
```

---

## Task 9 — Vérification finale

- [x] **Step 1 : Typecheck complet**

```bash
cd apps/client && pnpm typecheck
```

Expected: PASS.

- [x] **Step 2 : Suite de tests complète**

```bash
cd apps/client && pnpm test
```

Expected: PASS, coverage ≥ 80%.

- [x] **Step 3 : Supprimer les dossiers context/ vides**

```bash
# Vérifier que les dossiers context/ des features migrées sont maintenant de simples re-exports
cat apps/client/src/features/club/context/ClubContext.tsx
cat apps/client/src/features/competitions/context/CompetitionContext.tsx
cat apps/client/src/features/player/context/PlayerContext.tsx
cat apps/client/src/features/performance/context/PerformanceContext.tsx
```

Si un fichier de context ne contient que des re-exports et n'est plus importé directement (les consommateurs importent depuis le store), le supprimer est optionnel — les re-exports évitent les breaking changes dans les imports existants.

- [x] **Step 4 : Commit final**

```bash
git commit --allow-empty -m "chore(phase8): all tests green — frontend DX complete"
```
