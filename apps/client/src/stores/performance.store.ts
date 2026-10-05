import React from "react";
import { create } from "zustand";
import type { TrackData } from "../features/player/context/PlayerContext";

export type Category = "Standard" | "Latin";
export type Mode = "Round" | "Final";

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
  track: TrackData;
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
  status: "idle" | "playing" | "paused" | "finished" | "break" | "loading";
  activePhase: "dance" | "break";
  timeRemaining: number;

  setConfig: (config: React.SetStateAction<PerformanceConfig>) => void;
  setPlaylist: (playlist: PlaylistItem[]) => void;
  setCurrentDanceIndex: (idx: number) => void;
  setStatus: (status: PerformanceState["status"]) => void;
  setActivePhase: (phase: PerformanceState["activePhase"]) => void;
  setTimeRemaining: (t: React.SetStateAction<number>) => void;
}

const DEFAULT_CONFIG: PerformanceConfig = {
  mode: "Round",
  category: "Latin",
  selectedDances: ["Samba", "Cha-Cha-Cha", "Rumba", "Paso Doble", "Jive"],
  duration: 90,
  pauseDuration: 15,
  pasoClashes: 2,
  numberOfHeats: 1,
};

export const usePerformanceStore = create<PerformanceState>((set) => ({
  config: DEFAULT_CONFIG,
  playlist: [],
  currentDanceIndex: 0,
  status: "idle",
  activePhase: "dance",
  timeRemaining: 0,

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
}));
