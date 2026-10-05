import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import Tts from "../../../services/TtsService";
import { createLogger } from "../../../utils/logger";
import TrackPlayer from "../../../utils/TrackPlayerWrapper";
import { useLibrary } from "../../player/context/LibraryContext";
import { TrackData, usePlayer } from "../../player/context/PlayerContext";
import {
  PerformanceConfig,
  PlaylistItem,
  usePerformanceStore,
} from "../../../stores/performance.store";

const logger = createLogger("usePerformanceEngine");

// Helper to calculate playlist synchronously
const calculatePlaylist = (
  cfg: PerformanceConfig,
  tracks: TrackData[],
): PlaylistItem[] => {
  const newPlaylist: PlaylistItem[] = [];
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

  cfg.selectedDances.forEach((dance) => {
    const target = clean(dance);
    const candidates = tracks.filter(
      (t) =>
        t.style &&
        (clean(t.style).includes(target) || target.includes(clean(t.style))),
    );

    if (candidates.length > 0) {
      const isPaso = dance.toLowerCase().includes("paso");
      let danceDuration = cfg.duration;
      if (isPaso) {
        danceDuration = cfg.pasoClashes === 2 ? 80 : 120;
      }
      const heats = cfg.mode === "Round" ? cfg.numberOfHeats || 1 : 1;
      const safeHeats = Math.max(1, heats);

      for (let i = 1; i <= safeHeats; i++) {
        const randomTrack =
          candidates[Math.floor(Math.random() * candidates.length)];
        newPlaylist.push({
          track: randomTrack,
          style: dance,
          duration: danceDuration,
          isPaso,
          heatIndex: i,
          totalHeats: safeHeats,
        });
      }
    } else {
      logger.warn("[Performance] No tracks found for:", dance);
    }
  });

  return newPlaylist;
};

const getAnnouncementText = (item: PlaylistItem): string => {
  const ordinals = [
    "First",
    "Second",
    "Third",
    "Fourth",
    "Fifth",
    "Sixth",
    "Seventh",
  ];
  if (item.totalHeats > 1) {
    const heatText = `${ordinals[item.heatIndex - 1] ?? item.heatIndex} Heat`;
    return `${heatText}, ${item.style}`;
  } else {
    return `${item.style}!`;
  }
};

/**
 * IMPORTANT: This hook should only be mounted in ONE component at a time.
 * The timer is active when status === "playing" | "break".
 * PerformanceSetupScreen is unmounted (via navigation) before performance starts,
 * so calling this hook there is safe — but do NOT keep both screens mounted simultaneously.
 */
export const usePerformanceEngine = () => {
  const { allTracks } = useLibrary();
  const { playTrack, pause, resume, resetPlayer } = usePlayer();

  const config = usePerformanceStore((s) => s.config);
  const playlist = usePerformanceStore((s) => s.playlist);
  const currentDanceIndex = usePerformanceStore((s) => s.currentDanceIndex);
  const status = usePerformanceStore((s) => s.status);
  const activePhase = usePerformanceStore((s) => s.activePhase);
  const timeRemaining = usePerformanceStore((s) => s.timeRemaining);

  const setConfig = usePerformanceStore((s) => s.setConfig);
  const setPlaylist = usePerformanceStore((s) => s.setPlaylist);
  const setCurrentDanceIndex = usePerformanceStore(
    (s) => s.setCurrentDanceIndex,
  );
  const setStatus = usePerformanceStore((s) => s.setStatus);
  const setActivePhase = usePerformanceStore((s) => s.setActivePhase);
  const setTimeRemaining = usePerformanceStore((s) => s.setTimeRemaining);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previousStatusRef = useRef<"playing" | "break" | null>(null);
  const ttsFailureRef = useRef(false);

  // Use refs to avoid stale closures in callbacks
  const statusRef = useRef(status);
  const playlistRef = useRef(playlist);
  const currentDanceIndexRef = useRef(currentDanceIndex);
  const configRef = useRef(config);
  const timeRemainingRef = useRef(timeRemaining);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);
  useEffect(() => {
    currentDanceIndexRef.current = currentDanceIndex;
  }, [currentDanceIndex]);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  useEffect(() => {
    timeRemainingRef.current = timeRemaining;
  }, [timeRemaining]);

  const stopPerformance = async () => {
    if (announcementTimerRef.current) {
      clearTimeout(announcementTimerRef.current);
      announcementTimerRef.current = null;
    }
    setStatus("idle");
    await resetPlayer();
    await TrackPlayer.setVolume(1);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleTtsFailure = async (message?: string) => {
    if (ttsFailureRef.current) {
      return;
    }
    ttsFailureRef.current = true;
    await stopPerformance();
    Alert.alert(
      "TTS indisponible",
      message ??
        "Les annonces sont indispensables pour le mode compétition. Vérifiez la connexion au serveur TTS.",
    );
  };

  const speakAnnouncement = async (item: PlaylistItem) => {
    const text = getAnnouncementText(item);
    try {
      await Tts.speak(text, item.announcementPath);
    } catch (e) {
      logger.warn("TTS Speak Error", e);
      const message = e instanceof Error ? e.message : undefined;
      await handleTtsFailure(message);
    }
  };

  const finishPerformance = async () => {
    setStatus("finished");
    await resetPlayer();
    await TrackPlayer.setVolume(1);
    setTimeRemaining(0);
  };

  const playItem = async (item: PlaylistItem) => {
    setStatus("playing");
    setActivePhase("dance");
    setTimeRemaining(item.duration);
    await TrackPlayer.setVolume(1);
    await playTrack(item.track, undefined, true);
  };

  const nextDance = async () => {
    const currentIdx = currentDanceIndexRef.current;
    const currentPlaylist = playlistRef.current;
    const nextIndex = currentIdx + 1;
    if (nextIndex < currentPlaylist.length) {
      setCurrentDanceIndex(nextIndex);
      await speakAnnouncement(currentPlaylist[nextIndex]);
      await playItem(currentPlaylist[nextIndex]);
    } else {
      await finishPerformance();
    }
  };

  const startBreak = async () => {
    const currentPlaylist = playlistRef.current;
    const currentIdx = currentDanceIndexRef.current;
    const cfg = configRef.current;

    setStatus("break");
    setActivePhase("break");
    setTimeRemaining(cfg.pauseDuration);

    const ambientCandidates = allTracks.filter(
      (t) =>
        t.style?.toLowerCase() === "ambiance" ||
        t.title.toLowerCase().includes("ambiance") ||
        t.artist.toLowerCase().includes("ambiance"),
    );

    if (ambientCandidates.length > 0) {
      const randomAmbient =
        ambientCandidates[Math.floor(Math.random() * ambientCandidates.length)];
      await TrackPlayer.setVolume(0);
      await playTrack(randomAmbient, undefined, true);
    } else {
      await pause();
    }

    announcementTimerRef.current = setTimeout(() => {
      announcementTimerRef.current = null;
      if (currentPlaylist[currentIdx + 1]) {
        speakAnnouncement(currentPlaylist[currentIdx + 1]).catch((e) =>
          logger.warn("Announcement Error", e),
        );
      }
    }, 2000);
  };

  const handleTimerComplete = () => {
    const currentStatus = statusRef.current;
    const currentPlaylist = playlistRef.current;
    const currentIdx = currentDanceIndexRef.current;
    const cfg = configRef.current;

    if (currentStatus === "playing") {
      if (cfg.pauseDuration > 0) {
        startBreak().catch(() => {});
      } else {
        nextDance().catch(() => {});
      }
    } else if (currentStatus === "break") {
      const nextIndex = currentIdx + 1;
      if (nextIndex < currentPlaylist.length) {
        setCurrentDanceIndex(nextIndex);
        playItem(currentPlaylist[nextIndex]).catch(() => {});
      } else {
        finishPerformance().catch(() => {});
      }
    }
  };

  const togglePlayPause = async () => {
    const currentStatus = statusRef.current;
    const currentTimeRemaining = timeRemainingRef.current;

    if (currentStatus === "break" && currentTimeRemaining === 0) {
      await nextDance();
    } else if (currentStatus === "playing" || currentStatus === "break") {
      previousStatusRef.current = currentStatus;
      setStatus("paused");
      await pause();
    } else if (currentStatus === "paused") {
      const nextStatus = previousStatusRef.current ?? "playing";
      setStatus(nextStatus);
      await resume();
    } else if (currentStatus === "idle") {
      await startPerformance();
    }
  };

  const startPerformance = async (): Promise<boolean> => {
    ttsFailureRef.current = false;
    const cfg = configRef.current;
    const list = calculatePlaylist(cfg, allTracks);

    if (list.length === 0) {
      Alert.alert(
        "Erreur",
        "Aucune musique trouvée pour les danses sélectionnées.",
      );
      return false;
    }

    try {
      setStatus("loading");
      let listWithAudio: PlaylistItem[];
      try {
        listWithAudio = await Promise.all(
          list.map(async (item) => {
            const text = getAnnouncementText(item);
            const path = await Tts.preload(text);
            return { ...item, announcementPath: path ?? undefined };
          }),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : undefined;
        await handleTtsFailure(message);
        return false;
      }

      const missingAudio = listWithAudio.some((item) => !item.announcementPath);
      if (missingAudio) {
        await handleTtsFailure();
        return false;
      }

      setPlaylist(listWithAudio);
      setCurrentDanceIndex(-1);
      setStatus("break");
      setActivePhase("break");
      setTimeRemaining(cfg.pauseDuration);

      const ambientCandidates = allTracks.filter(
        (t) =>
          t.style?.toLowerCase() === "ambiance" ||
          t.title.toLowerCase().includes("ambiance") ||
          t.artist.toLowerCase().includes("ambiance"),
      );

      if (ambientCandidates.length > 0) {
        const randomAmbient =
          ambientCandidates[
            Math.floor(Math.random() * ambientCandidates.length)
          ];
        await TrackPlayer.setVolume(0);
        await playTrack(randomAmbient, undefined, true);
      }

      announcementTimerRef.current = setTimeout(() => {
        announcementTimerRef.current = null;
        if (listWithAudio[0]) {
          speakAnnouncement(listWithAudio[0]).catch((e) =>
            logger.warn("Announcement Error", e),
          );
        }
      }, 2000);
      return true;
    } catch (error) {
      logger.warn("[Performance] TTS preload failed", error);
      await stopPerformance();
      Alert.alert(
        "TTS indisponible",
        "Les annonces sont indispensables pour le mode compétition. Vérifiez la connexion au serveur TTS.",
      );
      return false;
    }
  };

  const generatePlaylist = () => {
    const newPlaylist = calculatePlaylist(config, allTracks);
    setPlaylist(newPlaylist);
    setCurrentDanceIndex(0);
    setStatus("idle");
  };

  const fadeNow = () => {
    handleTimerComplete();
  };

  // Timer effect
  useEffect(() => {
    if (status === "playing" || status === "break") {
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          const nextTime = Math.max(0, prev - 1);

          if (statusRef.current === "playing" && prev <= 6 && prev > 0) {
            if (prev <= 5) {
              const vol = (prev - 1) / 5;
              TrackPlayer.setVolume(Math.max(0, vol)).catch(() => {});
            }
          }

          if (
            statusRef.current === "break" &&
            configRef.current.pauseDuration - prev <= 3
          ) {
            const elapsed = configRef.current.pauseDuration - prev;
            const vol = Math.min(1, elapsed / 3);
            TrackPlayer.setVolume(vol).catch(() => {});
          }

          if (statusRef.current === "break" && prev <= 4 && prev > 0) {
            const vol = Math.max(0, (prev - 1) / 4);
            TrackPlayer.setVolume(vol).catch(() => {});
          }

          if (prev <= 1) {
            return 0;
          }
          return nextTime;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, config.pauseDuration]);

  // Effect for timer completion detection
  useEffect(() => {
    if (timeRemaining === 0 && (status === "playing" || status === "break")) {
      handleTimerComplete();
    }
  }, [timeRemaining, status]);

  return {
    config,
    setConfig,
    playlist,
    currentDanceIndex,
    status,
    activePhase,
    timeRemaining,
    generatePlaylist,
    startPerformance,
    stopPerformance: () => {
      stopPerformance().catch(() => {});
    },
    nextDance: () => {
      nextDance().catch(() => {});
    },
    togglePlayPause: () => {
      togglePlayPause().catch(() => {});
    },
    fadeNow,
  };
};
