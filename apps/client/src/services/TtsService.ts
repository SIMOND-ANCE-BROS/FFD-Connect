import {
  cacheDirectory,
  getInfoAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import { Platform } from "react-native";
import { BACKEND_URL } from "../config";
import { createLogger } from "../utils/logger";
import TrackPlayer, { State } from "../utils/TrackPlayerWrapper";

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

/**
 * Downloads audio from backend and saves to local cache.
 * Returns the absolute path to the file.
 * Uses deterministic filenames (no timestamps) for cache reuse.
 */
const downloadAudio = async (text: string): Promise<string> => {
  try {
    // Generate deterministic filename (no timestamp for cache reuse)
    const sanitized = text.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
    const filename = `tts_${sanitized}.mp3`;
    const localPath = `${cacheDirectory}${filename}`;

    // 1. Check local cache first (instant if exists)
    const fileInfo = await getInfoAsync(localPath);
    if (fileInfo.exists) {
      return localPath;
    }

    // 2. Download from backend (which checks Redis + generates if needed)

    const controller = new AbortController();
    // Increased timeout to 30s to allow backend TTS generation
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(`${BACKEND_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`TTS API Error: ${response.status}`);
    }

    // Read the audio as an ArrayBuffer and base64-encode it ourselves.
    // response.blob() is NOT usable on RN New Architecture (it goes through
    // new Blob([arrayBuffer]) which RN rejects — the "TTS indisponible" crash).
    const arrayBuffer = await response.arrayBuffer();
    const base64data = arrayBufferToBase64(arrayBuffer);

    // 3. Save to local cache for future use (expo-file-system base64 encoding).
    await writeAsStringAsync(localPath, base64data, { encoding: "base64" });

    return localPath;
  } catch (e) {
    let errorMessage = "Network request failed";

    if (e instanceof Error) {
      if (e.name === "AbortError") {
        errorMessage = "Timeout - Le serveur TTS met trop de temps à répondre";
      } else {
        errorMessage = e.message;
      }
    }

    logger.warn("[TtsService] Download Error", e);
    throw new Error(`TTS indisponible (${errorMessage})`);
  }
};

const TtsService = {
  getInitStatus: () => {
    // Return 'success' to satisfy checks
    return "success";
  },

  voices: () => {
    // Return mock voices to satisfy PerformanceContext types
    return [
      { id: "en-US-Studio-M", name: "Studio Male", language: "en-US" },
      { id: "en-US-Journey-D", name: "Journey Male", language: "en-US" },
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
   * Preloads TTS audio for a given text.
   */
  preload: async (text: string): Promise<string | null> => {
    return downloadAudio(text);
  },

  /**
   * Plays TTS using TrackPlayer.
   * Note: This interrupts current playback by adding to queue and skipping.
   * If mixing is required without interruption, a separate player instance would be needed,
   * but TrackPlayer is singleton. For announcements, this is usually desired.
   */
  speak: async (text: string, forcePath?: string): Promise<void> => {
    try {
      let path = forcePath;
      path ??= await downloadAudio(text);

      const uri = Platform.OS === "web" ? path : `file://${path}`;

      // We add the TTS to the end of the queue and play it
      // or we can use a separate approach if we want to interrupt.
      // For now, let's keep it simple: Add and play.
      await TrackPlayer.add({
        id: `tts_${Date.now()}`,
        url: uri,
        title: "Announcement",
        artist: "System",
      });

      const queue = await TrackPlayer.getQueue();
      await TrackPlayer.skip(queue.length - 1);
      await TrackPlayer.play();

      // Wait for playback to finish
      return new Promise((resolve) => {
        const listener = TrackPlayer.addEventListener(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - Event type might be tricky with Wrapper
          "playback-queue-ended",
          () => {
            listener.remove();
            resolve();
          },
        );

        // Also resolve if state changes back to paused/stopped after this track
        const stateListener = TrackPlayer.addEventListener(
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          "playback-state",
          (data: { state: State }) => {
            if (data.state === State.Paused || data.state === State.None) {
              stateListener.remove();
              resolve();
            }
          },
        );
      });
    } catch (error) {
      logger.warn("[TtsService] Speak Critical Error:", error);
      throw error;
    }
  },

  stop: async () => {
    await TrackPlayer.reset();
  },
};

export default TtsService;
