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

import { TrackData, usePlayer } from "../../player/context";
import { useLibrary } from "../../player/context/LibraryContext";

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

const defaultConfig: PerformanceConfig = {
  mode: "Round",
  category: "Latin",
  selectedDances: ["Samba", "Cha-Cha-Cha", "Rumba", "Paso Doble", "Jive"],
  duration: 90,
  pauseDuration: 15,
  pasoClashes: 2,
  numberOfHeats: 1,
};

const PerformanceContext = createContext<
  | {
      config: PerformanceConfig;
      setConfig: React.Dispatch<React.SetStateAction<PerformanceConfig>>;
      playlist: PlaylistItem[];
      currentDanceIndex: number;
      status: "idle" | "playing" | "paused" | "finished" | "break" | "loading";
      activePhase: "dance" | "break";
      timeRemaining: number;
      generatePlaylist: () => void;
      startPerformance: () => Promise<boolean>;
      stopPerformance: () => void;
      nextDance: () => void;
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
  const [config, setConfig] = useState<PerformanceConfig>(defaultConfig);
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
    generatePlaylist: () => {},
    startPerformance: () => Promise.resolve(false),
    stopPerformance: () => {},
    nextDance: () => {},
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
