// Engine logic (timers, TTS, TrackPlayer) is now in usePerformanceEngine
// called directly from PerformancePlayerScreen and PerformanceSetupScreen.
import React from "react";

export { usePerformanceStore } from "../../../stores/performance.store";
export type {
  PerformanceConfig,
  PlaylistItem,
  Category,
  Mode,
} from "../../../stores/performance.store";

// No-op provider kept for backwards compatibility with App.tsx
export const PerformanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;
