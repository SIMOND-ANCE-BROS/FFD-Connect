// Engine logic (timers, TTS, TrackPlayer) lives in engine/competitionController,
// bound to the screens by usePerformanceEngine.
import React from "react";

export { usePerformanceStore } from "../../../stores/performance.store";
export type {
  PerformanceConfig,
  PlaylistItem,
  Category,
  Mode,
  RoundConfig,
  RoundType,
  LoadingProgress,
} from "../../../stores/performance.store";

// No-op provider kept for backwards compatibility with App.tsx
export const PerformanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
