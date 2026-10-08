/**
 * PerformanceContext pour le web : stub sans react-native-track-player.
 * Le mode compétition est réservé à l'app mobile.
 */
import React, { createContext, useContext, useState } from "react";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("PerformanceContext.web");

logger.warn(
  "PerformanceContext.web.tsx loaded - This is a stub implementation for web",
);

import { usePlayer } from "../../player/context";
import {
  createDefaultConfig,
  type LoadingProgress,
  type PerformanceConfig,
  type PlaylistItem,
} from "../../../stores/performance.store";
import { useLibrary } from "../../player/context/LibraryContext";

// Types are shared with native (single source of truth in the store).
export type {
  Category,
  LoadingProgress,
  Mode,
  PerformanceConfig,
  PlaylistItem,
  RoundConfig,
  RoundType,
} from "../../../stores/performance.store";

const PerformanceContext = createContext<
  | {
      config: PerformanceConfig;
      setConfig: React.Dispatch<React.SetStateAction<PerformanceConfig>>;
      playlist: PlaylistItem[];
      currentDanceIndex: number;
      status: "idle" | "playing" | "paused" | "finished" | "break" | "loading";
      activePhase: "dance" | "break";
      timeRemaining: number;
      loadingProgress: LoadingProgress | null;
      isAnnouncing: boolean;
      generatePlaylist: () => void;
      startPerformance: () => Promise<boolean>;
      stopPerformance: () => void;
      nextStep: () => void;
      previousStep: () => void;
      togglePlayPause: () => void;
      fadeNow: () => void;
    }
  | undefined
>(undefined);

export const PerformanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  useLibrary(); // Ensure provider is mounted
  usePlayer();
  const [config, setConfig] = useState<PerformanceConfig>(createDefaultConfig);
  const [playlist] = useState<PlaylistItem[]>([]);
  const [currentDanceIndex] = useState(0);
  const [status] = useState<
    "idle" | "playing" | "paused" | "finished" | "break" | "loading"
  >("idle");
  const [activePhase] = useState<"dance" | "break">("break");
  const [timeRemaining] = useState(0);

  const value = {
    config,
    setConfig,
    playlist,
    currentDanceIndex,
    status,
    activePhase,
    timeRemaining,
    loadingProgress: null,
    isAnnouncing: false,
    generatePlaylist: () => {},
    startPerformance: () => Promise.resolve(false),
    stopPerformance: () => {},
    nextStep: () => {},
    previousStep: () => {},
    togglePlayPause: () => {},
    fadeNow: () => {},
  };

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  );
};

export const usePerformance = () => {
  const context = useContext(PerformanceContext);
  if (!context)
    throw new Error("usePerformance must be used within PerformanceProvider");
  return context;
};
