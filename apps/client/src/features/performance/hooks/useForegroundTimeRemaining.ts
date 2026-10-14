import { useRef } from "react";
import { useAppIsActive } from "../../../hooks/useAppIsActive";
import { usePerformanceStore } from "../../../stores/performance.store";

/**
 * The competition countdown, for display only.
 *
 * The engine's 1 s tick (engine/competitionController) keeps running with the
 * phone locked — it drives the fades and the move to the next dance — and
 * updates `timeRemaining` in the store every second. Re-rendering the player
 * screen for it while nobody can see it feeds iOS's background CPU limit,
 * which kills the app (#539). While the app is not active this returns the
 * last value seen in the foreground, so store updates do not re-render; it
 * resyncs as soon as the app is active again. Never use it for engine logic:
 * read `usePerformanceStore.getState().timeRemaining` there.
 */
export function useForegroundTimeRemaining(): number {
  const appActive = useAppIsActive();
  const shown = useRef(usePerformanceStore.getState().timeRemaining);
  return usePerformanceStore((s) => {
    if (appActive) shown.current = s.timeRemaining;
    return shown.current;
  });
}
