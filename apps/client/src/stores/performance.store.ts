import React from "react";
import { create } from "zustand";
import type { TrackData } from "../features/player/context/PlayerContext";

export type Category = "Standard" | "Latin";
/** Round = « Passage » (≥ 2 heats), Final = « Finale » (exactly 1 heat). */
export type RoundType = "Round" | "Final";
/** @deprecated kept for backwards compatibility — use RoundType. */
export type Mode = RoundType;

/** Canonical competition dances (ids), in official order per category. */
export const DANCES: Record<Category, readonly string[]> = {
  Standard: [
    "Valse Lente",
    "Tango",
    "Valse Viennoise",
    "Slow Fox",
    "Quickstep",
  ],
  Latin: ["Samba", "Cha-Cha-Cha", "Rumba", "Paso Doble", "Jive"],
};

export const MIN_ROUND_HEATS = 2;
export const MAX_ROUND_HEATS = 10;

/** One round (« tour ») of the competition programme. */
export interface RoundConfig {
  id: string;
  category: Category;
  type: RoundType;
  /** ≥ MIN_ROUND_HEATS when type is Round, always 1 when Final. */
  heats: number;
  /** Subset of DANCES[category], kept in canonical order. */
  selectedDances: string[];
}

export interface PerformanceConfig {
  /** Ordered programme of rounds (mixed Standard / Latin allowed). */
  rounds: RoundConfig[];
  /** Dance duration in seconds (Paso Doble uses the clash setting instead). */
  duration: number;
  /** Break between dances in seconds (also the initial "get ready" break). */
  pauseDuration: number;
  /** Applies to Latin rounds containing the Paso Doble. */
  pasoClashes: 2 | 3;
}

export interface PlaylistItem {
  track: TrackData;
  /** Canonical dance id (see DANCES). */
  style: string;
  duration: number;
  isPaso: boolean;
  heatIndex: number;
  totalHeats: number;
  /** 1-based round number and programme size. */
  roundIndex: number;
  totalRounds: number;
  roundType: RoundType;
  category: Category;
  /** 0-based position of the dance inside its round + dances in the round. */
  danceIndex: number;
  dancesInRound: number;
  /** French MC announcement spoken before this item (deterministic). */
  announcementText: string;
  announcementPath?: string;
}

export interface LoadingProgress {
  done: number;
  total: number;
}

let roundSeq = 0;
export const createRoundId = (): string => {
  roundSeq += 1;
  return `round-${Date.now().toString(36)}-${roundSeq}`;
};

export const createRound = (
  category: Category = "Latin",
  type: RoundType = "Round",
): RoundConfig => ({
  id: createRoundId(),
  category,
  type,
  heats: type === "Final" ? 1 : MIN_ROUND_HEATS,
  selectedDances: [...DANCES[category]],
});

export const createDefaultConfig = (): PerformanceConfig => ({
  rounds: [createRound("Latin", "Round")],
  duration: 90,
  pauseDuration: 15,
  pasoClashes: 2,
});

interface PerformanceState {
  config: PerformanceConfig;
  playlist: PlaylistItem[];
  currentDanceIndex: number;
  status: "idle" | "playing" | "paused" | "finished" | "break" | "loading";
  activePhase: "dance" | "break";
  timeRemaining: number;
  /** Download progress while status === "loading" (null otherwise). */
  loadingProgress: LoadingProgress | null;
  /** True while the MC announcement is being spoken (between break and dance). */
  isAnnouncing: boolean;

  setConfig: (config: React.SetStateAction<PerformanceConfig>) => void;
  setPlaylist: (playlist: PlaylistItem[]) => void;
  setCurrentDanceIndex: (idx: number) => void;
  setStatus: (status: PerformanceState["status"]) => void;
  setActivePhase: (phase: PerformanceState["activePhase"]) => void;
  setTimeRemaining: (t: React.SetStateAction<number>) => void;
  setLoadingProgress: (progress: LoadingProgress | null) => void;
  setIsAnnouncing: (announcing: boolean) => void;
}

export const usePerformanceStore = create<PerformanceState>((set) => ({
  config: createDefaultConfig(),
  playlist: [],
  currentDanceIndex: 0,
  status: "idle",
  activePhase: "dance",
  timeRemaining: 0,
  loadingProgress: null,
  isAnnouncing: false,

  setConfig: (configOrUpdater) =>
    set((s) => ({
      config:
        typeof configOrUpdater === "function"
          ? configOrUpdater(s.config)
          : configOrUpdater,
    })),
  setPlaylist: (playlist) => set({ playlist }),
  setCurrentDanceIndex: (idx) => set({ currentDanceIndex: idx }),
  setStatus: (status) => set({ status }),
  setActivePhase: (activePhase) => set({ activePhase }),
  setTimeRemaining: (tOrUpdater) =>
    set((s) => ({
      timeRemaining:
        typeof tOrUpdater === "function"
          ? tOrUpdater(s.timeRemaining)
          : tOrUpdater,
    })),
  setLoadingProgress: (loadingProgress) => set({ loadingProgress }),
  setIsAnnouncing: (isAnnouncing) => set({ isAnnouncing }),
}));
