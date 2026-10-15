/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/require-await */
import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import { getErrorMessage } from "../utils/error.utils";

interface WavDecoderModule {
  decode(buffer: Buffer): Promise<{ channelData: Float32Array[] }>;
  default?: {
    decode(buffer: Buffer): Promise<{ channelData: Float32Array[] }>;
  };
}

interface MusicTempoInstance {
  tempo: string;
}

type MusicTempoConstructor = new (data: Float32Array) => MusicTempoInstance;

interface MusicTempoModule {
  default?: MusicTempoConstructor;
  new (data: Float32Array): MusicTempoInstance;
}

interface FfmpegCommand {
  inputFormat(format: string): this;
  inputOptions(options: string[]): this;
  setStartTime(time: number): this;
  setDuration(duration: number): this;
  toFormat(format: string): this;
  save(path: string): this;
  on(event: "end", callback: () => void | Promise<void>): this;
  on(event: "error", callback: (err: unknown) => void): this;
  kill(signal: string): this;
}

export interface AnalyzeBpmOptions {
  /**
   * Kills ffmpeg (SIGKILL) and rejects when the conversion runs longer than
   * this. Without it the analysis waits for ffmpeg as before.
   */
  timeoutMs?: number;
}

interface FfmpegStatic {
  (input: string): FfmpegCommand;
  setFfmpegPath(path: string): void;
}

interface StyleConfig {
  /** Raw BPM range typically reported for this dance in competition tempo. */
  bpmRange: [number, number];
  /** Beats per measure (used to convert BPM → MPM). */
  beatsPerMeasure: number;
}

/**
 * Tempo competition FFD / WDSF. Permet de :
 *  - corriger les détections octave-doublées/halvées de `music-tempo`
 *  - convertir BPM (temps/min) → MPM (mesures/min)
 *
 * BPM target ranges are deliberately a bit wider than the strict competition
 * spec so legitimate tracks aren't pushed into the wrong octave.
 */
const STYLE_CONFIG: Record<string, StyleConfig> = {
  // Danses Latines
  rumba: { bpmRange: [95, 115], beatsPerMeasure: 4 }, // ~100-108 BPM → 25-27 MPM
  "cha-cha": { bpmRange: [115, 140], beatsPerMeasure: 4 }, // ~120-128 → 30-32
  samba: { bpmRange: [90, 115], beatsPerMeasure: 2 }, // ~100-104 → 50-52
  "paso doble": { bpmRange: [110, 130], beatsPerMeasure: 2 }, // ~120-124 → 60-62
  jive: { bpmRange: [158, 186], beatsPerMeasure: 4 }, // ~168-176 → 42-44
  // Danses Standard
  "valse lente": { bpmRange: [78, 98], beatsPerMeasure: 3 }, // ~84-90 → 28-30
  tango: { bpmRange: [115, 140], beatsPerMeasure: 4 }, // ~124-132 → 31-33
  viennoise: { bpmRange: [168, 190], beatsPerMeasure: 3 }, // ~174-180 → 58-60
  "slow fox": { bpmRange: [100, 128], beatsPerMeasure: 4 }, // ~112-120 → 28-30
  quickstep: { bpmRange: [188, 220], beatsPerMeasure: 4 }, // ~200-208 → 50-52
};

/**
 * Dance recognition patterns, most specific first: the first match wins. A
 * style that matches none (federation categories "LATIN"/"STANDARD",
 * "Ambiance", free text) is unknown and gets no MPM.
 *
 * Mirrored by apps/client/src/features/player/utils/danceTempo.ts and
 * apps/admin/src/lib/mpm.ts (same patterns, same order); the three are pinned
 * by test/fixtures/dance-style-cases.json (#338: the client recognised
 * « valse anglaise » and the backend did not).
 */
const DANCE_STYLE_PATTERNS: ReadonlyArray<
  readonly [keyof typeof STYLE_CONFIG, RegExp]
> = [
  ["cha-cha", /cha[\s-]*cha/],
  ["paso doble", /paso/],
  ["samba", /samba/],
  ["jive", /jive/],
  ["rumba", /rumba/],
  ["quickstep", /quick\s*-?\s*step/],
  ["slow fox", /slow\s*-?\s*fox|foxtrot|^fox$/],
  ["viennoise", /vienn|valse\s*rapide/],
  [
    "valse lente",
    /valse\s*lente|valse\s*anglaise|slow\s*waltz|^waltz$|^valse$/,
  ],
  ["tango", /tango/],
];

/**
 * Map any synonym/uppercase variant the user or filename may provide to one of
 * the 10 canonical ballroom dances handled by `STYLE_CONFIG`, or null when the
 * dance is unknown.
 */
export function normalizeStyle(
  input?: string | null,
): keyof typeof STYLE_CONFIG | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  for (const [key, pattern] of DANCE_STYLE_PATTERNS) {
    if (pattern.test(s)) return key;
  }
  return null;
}

/**
 * `music-tempo` often reports half or double the real tempo. Pick the octave-
 * shifted candidate (×2, ÷2, ×4, ÷4, or unchanged) whose value sits closest
 * to the center of the dance's expected BPM range.
 */
function normalizeToRange(bpm: number, [min, max]: [number, number]): number {
  if (bpm <= 0) return 0;
  const center = (min + max) / 2;
  const candidates = [bpm, bpm * 2, bpm / 2, bpm * 4, bpm / 4];
  let best = bpm;
  let bestDist = Math.abs(bpm - center);
  for (const c of candidates) {
    const d = Math.abs(c - center);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

@Injectable()
export class BpmService {
  private readonly logger = new Logger(BpmService.name);

  protected async loadMusicTempo(): Promise<MusicTempoModule> {
    return require("music-tempo") as MusicTempoModule;
  }

  protected async loadWavDecoder(): Promise<WavDecoderModule> {
    return require("wav-decoder") as WavDecoderModule;
  }

  /**
   * Analyzes the BPM of an MP3 file (read as MP3 whatever its content)
   */
  async analyzeBpm(
    filePath: string,
    options: AnalyzeBpmOptions = {},
  ): Promise<number> {
    const MusicTempo = await this.loadMusicTempo();
    const WavDecoder = await this.loadWavDecoder();

    // Use dynamic import/require for ffmpeg to avoid issues if not installed
    const ffmpeg = require("fluent-ffmpeg") as FfmpegStatic;
    // Prefer a system ffmpeg (FFMPEG_PATH, e.g. /usr/bin/ffmpeg in the Alpine
    // container) — the @ffmpeg-installer binary is glibc-linked and does NOT
    // run on Alpine/musl. Fall back to the installer package for local dev
    // (macOS/glibc), where a system ffmpeg may be absent.
    const ffmpegPath =
      process.env.FFMPEG_PATH ||
      (require("@ffmpeg-installer/ffmpeg") as { path: string }).path;
    ffmpeg.setFfmpegPath(ffmpegPath);

    const tempWav = filePath.replace(/\.[^.]+$/, ".temp.wav");
    // Best-effort, after the promise is settled: a failing cleanup must
    // neither keep the caller waiting nor throw inside an ffmpeg handler or
    // the kill timer.
    const removeTempWav = () => {
      try {
        if (fs.existsSync(tempWav)) {
          fs.unlinkSync(tempWav);
        }
      } catch (err) {
        this.logger.warn(
          `Could not remove ${tempWav}: ${getErrorMessage(err)}`,
        );
      }
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      // Exactly once: a killed ffmpeg still emits "error" afterwards.
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        finish();
      };

      // The only caller analyses uploaded MP3s (validated by their magic
      // bytes): force the demuxer instead of letting ffmpeg sniff the content
      // (HLS playlists, concat lists…), and allow local files only.
      const command = ffmpeg(filePath)
        .inputFormat("mp3")
        .inputOptions(["-protocol_whitelist", "file"])
        .setStartTime(10)
        .setDuration(15)
        .toFormat("wav")
        .save(tempWav)
        .on("end", async () => {
          // ffmpeg is done: the timeout no longer applies to the decoding.
          if (timer) clearTimeout(timer);
          if (settled) return;
          try {
            const buffer = fs.readFileSync(tempWav);
            const decoder = WavDecoder.default ?? WavDecoder;
            const audioData = await decoder.decode(buffer);
            const MT = MusicTempo.default ?? MusicTempo;
            const tempo = new MT(audioData.channelData[0]);

            settle(() => resolve(parseFloat(tempo.tempo)));
          } catch (err) {
            settle(() =>
              reject(err instanceof Error ? err : new Error(String(err))),
            );
          }
          removeTempWav();
        })
        .on("error", (err: unknown) => {
          const errorMessage = getErrorMessage(err);
          settle(() => reject(new Error(errorMessage)));
          removeTempWav();
        });

      const { timeoutMs } = options;
      if (timeoutMs !== undefined) {
        // settle() clears this timer: it only fires while ffmpeg still runs.
        timer = setTimeout(() => {
          settle(() =>
            reject(
              new Error(`ffmpeg tempo analysis timed out after ${timeoutMs}ms`),
            ),
          );
          // Stop the process, not just the wait: an orphan ffmpeg keeps its
          // memory and CPU on a small replica.
          try {
            command.kill("SIGKILL");
          } catch (err) {
            this.logger.warn(`Could not kill ffmpeg: ${getErrorMessage(err)}`);
          }
          removeTempWav();
        }, timeoutMs);
      }
    });
  }

  /**
   * Convertit un BPM brut (détecté par `music-tempo`) en MPM (mesures par
   * minute) selon la danse. Corrige les erreurs d'octave (×2, ÷2…) en
   * recalant le BPM dans la plage attendue, puis divise par le nombre de
   * temps par mesure de la danse.
   *
   * Retourne 0 (« MPM inconnu ») si le style est inconnu (catégorie
   * LATIN/STANDARD sans danse précise, Ambiance, label non reconnu) : un BPM
   * brut présenté comme MPM écartait le morceau du mode compétition (#338).
   */
  calculateMpm(rawBpm: number, style?: string | null): number {
    if (rawBpm <= 0) return 0;
    const key = normalizeStyle(style);
    if (key == null) return 0;
    const config = STYLE_CONFIG[key];
    const normalized = normalizeToRange(rawBpm, config.bpmRange);
    return Math.round(normalized / config.beatsPerMeasure);
  }

  /**
   * Tempo saisi à la main (admin, import) ramené en MPM : une valeur dans la
   * plage de BPM de la danse est un BPM tapé à la place d'un MPM (ex. 87 pour
   * une valse lente) et est convertie (÷ temps par mesure). Les plages BPM et
   * MPM d'une même danse ne se chevauchent pas. Toute autre valeur, ou une
   * danse inconnue, est gardée telle quelle.
   */
  toMpm(tempo: number, style?: string | null): number {
    const key = normalizeStyle(style);
    if (key == null) return tempo;
    const { bpmRange, beatsPerMeasure } = STYLE_CONFIG[key];
    const [min, max] = bpmRange;
    if (tempo < min || tempo > max) return tempo;
    return Math.round(tempo / beatsPerMeasure);
  }
}
