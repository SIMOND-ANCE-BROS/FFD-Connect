import { useEffect } from "react";
import { useLibrary } from "../../player/context/LibraryContext";
import { usePlayer } from "../../player/context/PlayerContext";
import { useTrackRepository } from "../../player/context/TrackContext";
import { usePerformanceStore } from "../../../stores/performance.store";
import * as engine from "../engine/competitionController";

/**
 * IMPORTANT: This hook should only be mounted in ONE component at a time.
 * The timer is active when status === "playing" | "break".
 * PerformanceSetupScreen is unmounted (via navigation) before performance starts,
 * so calling this hook there is safe — but do NOT keep both screens mounted simultaneously.
 *
 * Update: in the native stack the setup screen actually stays mounted under
 * the player. The engine (timer, transitions, session state) therefore lives
 * in a module singleton (engine/competitionController) and this hook is only
 * a binding to it + the Zustand store — a second mount no longer starts a
 * second timer. Keep it that way: never move the timer back into an effect.
 */
export const usePerformanceEngine = () => {
  const { allTracks } = useLibrary();
  const { playTrack, pause, resume, resetPlayer, ensurePlayerReady } =
    usePlayer();
  const trackRepo = useTrackRepository();

  useEffect(() => {
    engine.setEngineDeps({
      playTrack,
      pause,
      resume,
      resetPlayer,
      ensurePlayerReady,
      allTracks,
      trackRepo,
    });
  }, [
    playTrack,
    pause,
    resume,
    resetPlayer,
    ensurePlayerReady,
    allTracks,
    trackRepo,
  ]);

  const config = usePerformanceStore((s) => s.config);
  const playlist = usePerformanceStore((s) => s.playlist);
  const currentDanceIndex = usePerformanceStore((s) => s.currentDanceIndex);
  const status = usePerformanceStore((s) => s.status);
  const activePhase = usePerformanceStore((s) => s.activePhase);
  const timeRemaining = usePerformanceStore((s) => s.timeRemaining);
  const loadingProgress = usePerformanceStore((s) => s.loadingProgress);
  const isAnnouncing = usePerformanceStore((s) => s.isAnnouncing);
  const setConfig = usePerformanceStore((s) => s.setConfig);

  return {
    config,
    setConfig,
    playlist,
    currentDanceIndex,
    status,
    activePhase,
    timeRemaining,
    loadingProgress,
    isAnnouncing,
    generatePlaylist: engine.generatePlaylist,
    startPerformance: engine.startPerformance,
    stopPerformance: () => {
      engine.stopPerformance().catch(() => {});
    },
    nextDance: () => {
      engine.nextDance().catch(() => {});
    },
    togglePlayPause: () => {
      engine.togglePlayPause().catch(() => {});
    },
    fadeNow: engine.fadeNow,
  };
};
