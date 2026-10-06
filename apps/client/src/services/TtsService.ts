import {
  cacheDirectory,
  getInfoAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import {
  createAudioPlayer,
  type AudioPlayer,
  type AudioStatus,
} from "expo-audio";
import { Platform } from "react-native";
import { BACKEND_URL } from "../config";
import { createLogger } from "../utils/logger";
import { stableCacheKey } from "../utils/stableHash";

const logger = createLogger("TtsService");

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode un ArrayBuffer en base64 sans passer par Blob.
 *
 * RN New Architecture (SDK 57 / RN 0.86) ne supporte PAS `new Blob([arrayBuffer])`
 * (→ "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"),
 * donc `response.blob()` + FileReader échoue. On lit l'ArrayBuffer et on l'encode
 * nous-mêmes. Les clips TTS sont courts → coût négligeable.
 */
export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    result +=
      i + 1 < bytes.length ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    result += i + 2 < bytes.length ? BASE64_CHARS[b2 & 0x3f] : "=";
  }
  return result;
};

/** Bump when the cache naming scheme or the backend voice changes. */
const TTS_CACHE_VERSION = "v2";

/**
 * Deterministic cache filename for an announcement. Hash of the FULL text (+
 * length): the previous scheme kept the first 50 sanitized chars, so French
 * accents collapsed to "_" and two long announcements sharing a prefix
 * collided — the wrong announcement was played.
 */
export const ttsCacheFilename = (text: string): string =>
  `tts_${TTS_CACHE_VERSION}_${stableCacheKey(text)}.mp3`;

/** Backend TTS generation can take a while (30 s), body included. */
const TTS_REQUEST_TIMEOUT_MS = 30000;
/** Like tracks: one retry before giving up. */
const TTS_DOWNLOAD_ATTEMPTS = 2;

const describeError = (e: unknown): string => {
  if (e instanceof Error) {
    return e.name === "AbortError"
      ? "Timeout - Le serveur TTS met trop de temps à répondre"
      : e.message;
  }
  return "Network request failed";
};

/** One POST /tts → local file. Throws on any failure (incl. empty audio). */
const fetchAudioOnce = async (
  text: string,
  localPath: string,
): Promise<void> => {
  const controller = new AbortController();
  // The timeout covers the WHOLE exchange (headers AND body): clearing it as
  // soon as the headers arrive let a stalled body hang arrayBuffer() forever.
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`TTS API Error: ${response.status}`);
    }
    // Read the audio as an ArrayBuffer and base64-encode it ourselves.
    // response.blob() is NOT usable on RN New Architecture (it goes through
    // new Blob([arrayBuffer]) which RN rejects — the "TTS indisponible" crash).
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new Error("TTS API Error: audio vide");
    }
    await writeAsStringAsync(localPath, arrayBufferToBase64(arrayBuffer), {
      encoding: "base64",
    });
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Downloads audio from backend and saves it to the local cache (retried
 * once). Returns the absolute path to the file.
 */
const downloadAudio = async (text: string): Promise<string> => {
  const localPath = `${cacheDirectory ?? ""}${ttsCacheFilename(text)}`;

  // 1. Local cache first — an empty file (interrupted write) is not trusted.
  try {
    const fileInfo = await getInfoAsync(localPath);
    if (fileInfo.exists && fileInfo.size > 0) return localPath;
  } catch {
    /* unreadable = absent */
  }

  // 2. Backend (Redis cache + generation if needed).
  let lastError: unknown;
  for (let attempt = 1; attempt <= TTS_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await fetchAudioOnce(text, localPath);
      return localPath;
    } catch (e) {
      lastError = e;
      logger.warn("[TtsService] Download Error", { attempt, error: e });
    }
  }
  throw new Error(`TTS indisponible (${describeError(lastError)})`);
};

// --- Dedicated announcement player -----------------------------------------
//
// Announcements play on their OWN expo-audio player, separate from the music
// engine (utils/TrackPlayerWrapper). Two players of the same app mix together
// on iOS/Android, so the pause music keeps playing (ducked by the caller)
// under the announcement instead of being replaced by it — and the music
// queue/lock-screen state is never touched by a TTS clip.

/** Safety net while the clip duration is still unknown (not loaded yet). */
const UNKNOWN_DURATION_TIMEOUT_MS = 20000;
/** Extra time after the known clip duration before giving up waiting. */
const COMPLETION_MARGIN_MS = 1500;

let announcer: AudioPlayer | null = null;
let cancelCurrent: (() => void) | null = null;

const getAnnouncer = (): AudioPlayer => {
  announcer ??= createAudioPlayer(null, { updateInterval: 250 });
  return announcer;
};

const toPlayableUri = (path: string): string => {
  if (Platform.OS === "web") return path;
  return /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`;
};

/**
 * Plays a local clip on the announcement player and resolves ONLY when it has
 * really finished (didJustFinish), was stopped, or the safety timeout
 * (clip duration + margin) expired. In particular it does NOT resolve on the
 * initial "loaded but paused" status emitted right after replace() — that
 * early resolution is what cut announcements short.
 * Rejects when the clip cannot be played (status error / native exception),
 * so the caller can stop the competition instead of skipping announcements.
 */
const playClip = (uri: string): Promise<void> => {
  // A new clip supersedes any clip still playing.
  cancelCurrent?.();
  const p = getAnnouncer();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let durationArmed = false;
    let safety: ReturnType<typeof setTimeout> | null = null;
    let subscription: { remove: () => void } | null = null;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (safety) clearTimeout(safety);
      subscription?.remove();
      if (cancelCurrent === cancel) cancelCurrent = null;
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      try {
        p.pause();
      } catch {
        /* best-effort */
      }
      settle();
    };
    const arm = (ms: number) => {
      if (safety) clearTimeout(safety);
      safety = setTimeout(() => {
        logger.warn("[TtsService] Announcement completion timeout");
        settle();
      }, ms);
    };

    subscription = p.addListener(
      "playbackStatusUpdate",
      (status: AudioStatus) => {
        if (settled) return;
        if (status.didJustFinish) {
          settle();
          return;
        }
        if (status.error) {
          logger.warn("[TtsService] Announcement playback error", status.error);
          settle(
            new Error(`Lecture de l'annonce impossible (${status.error})`),
          );
          return;
        }
        if (!durationArmed && status.isLoaded && status.duration > 0) {
          durationArmed = true;
          const remaining = Math.max(0, status.duration - status.currentTime);
          arm(remaining * 1000 + COMPLETION_MARGIN_MS);
        }
      },
    );
    cancelCurrent = cancel;
    arm(UNKNOWN_DURATION_TIMEOUT_MS);

    try {
      p.loop = false;
      p.volume = 1;
      p.replace({ uri });
      p.play();
    } catch (e) {
      logger.warn("[TtsService] Announcement play failed", e);
      settle(
        new Error(
          `Lecture de l'annonce impossible (${e instanceof Error ? e.message : String(e)})`,
        ),
      );
    }
  });
};

const TtsService = {
  getInitStatus: () => {
    // Return 'success' to satisfy checks
    return "success";
  },

  voices: () => {
    // Return mock voices to satisfy PerformanceContext types
    return [
      { id: "fr-FR-Neural-M", name: "Neural Male", language: "fr-FR" },
      { id: "fr-FR-Neural-F", name: "Neural Female", language: "fr-FR" },
    ];
  },

  setDefaultVoice: async (_voiceId: string) => {
    // No-op
  },

  setDefaultRate: async (_rate: number) => {
    // No-op
  },

  setDefaultPitch: async (_pitch: number) => {
    // No-op
  },

  setDucking: async (_enabled: boolean) => {
    // No-op
  },

  setIgnoreSilentSwitch: async (_ignore: boolean) => {
    // No-op
  },

  /**
   * Preloads TTS audio for a given text (downloads it to the local cache).
   */
  preload: async (text: string): Promise<string | null> => {
    return downloadAudio(text);
  },

  /**
   * Speaks `text` on the dedicated announcement player, at full volume, and
   * resolves when the announcement has been fully spoken.
   */
  speak: async (text: string, forcePath?: string): Promise<void> => {
    try {
      const path = forcePath ?? (await downloadAudio(text));
      await playClip(toPlayableUri(path));
    } catch (error) {
      logger.warn("[TtsService] Speak Critical Error:", error);
      throw error;
    }
  },

  /** Stops the announcement in progress (pending speak() resolves). */
  stop: (): Promise<void> => {
    if (cancelCurrent) {
      cancelCurrent();
    } else {
      announcer?.pause();
    }
    return Promise.resolve();
  },
};

export default TtsService;
