/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/require-await */
import { Injectable } from "@nestjs/common";
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
  setStartTime(time: number): this;
  setDuration(duration: number): this;
  toFormat(format: string): this;
  save(path: string): this;
  on(event: "end", callback: () => void | Promise<void>): this;
  on(event: "error", callback: (err: unknown) => void): this;
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
 * Map any synonym/uppercase variant the user or filename may provide to one of
 * the 10 canonical ballroom dances handled by `STYLE_CONFIG`. Returns null for
 * federation categories ("LATIN", "STANDARD") or unknown labels — caller
 * falls back to raw BPM.
 */
function normalizeStyle(
  input?: string | null,
): keyof typeof STYLE_CONFIG | null {
  if (!input) return null;
  const s = input.toLowerCase().trim();
  // Order matters: more specific patterns first.
  if (/cha[\s-]?cha|chacha/.test(s)) return "cha-cha";
  if (/paso/.test(s)) return "paso doble";
  if (/samba/.test(s)) return "samba";
  if (/jive/.test(s)) return "jive";
  if (/rumba/.test(s)) return "rumba";
  if (/quick\s?step/.test(s)) return "quickstep";
  if (/slow ?fox|foxtrot|^fox$/.test(s)) return "slow fox";
  if (/vienn|valse rapide/.test(s)) return "viennoise";
  if (/slow ?waltz|valse lente|^waltz$|^valse$/.test(s)) return "valse lente";
  if (/tango/.test(s)) return "tango";
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
  protected async loadMusicTempo(): Promise<MusicTempoModule> {
    return require("music-tempo") as MusicTempoModule;
  }

  protected async loadWavDecoder(): Promise<WavDecoderModule> {
    return require("wav-decoder") as WavDecoderModule;
  }

  /**
   * Analyzes the BPM of an audio file
   */
  async analyzeBpm(filePath: string): Promise<number> {
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

    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .setStartTime(10)
        .setDuration(15)
        .toFormat("wav")
        .save(tempWav)
        .on("end", async () => {
          try {
            const buffer = fs.readFileSync(tempWav);
            const decoder = WavDecoder.default ?? WavDecoder;
            const audioData = await decoder.decode(buffer);
            const MT = MusicTempo.default ?? MusicTempo;
            const tempo = new MT(audioData.channelData[0]);

            if (fs.existsSync(tempWav)) {
              fs.unlinkSync(tempWav);
            }

            resolve(parseFloat(tempo.tempo));
          } catch (err) {
            if (fs.existsSync(tempWav)) {
              fs.unlinkSync(tempWav);
            }
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        })
        .on("error", (err: unknown) => {
          if (fs.existsSync(tempWav)) {
            fs.unlinkSync(tempWav);
          }
          const errorMessage = getErrorMessage(err);
          reject(new Error(errorMessage));
        });
    });
  }

  /**
   * Convertit un BPM brut (détecté par `music-tempo`) en MPM (mesures par
   * minute) selon la danse. Corrige les erreurs d'octave (×2, ÷2…) en
   * recalant le BPM dans la plage attendue, puis divise par le nombre de
   * temps par mesure de la danse.
   *
   * Retourne le BPM brut si le style est inconnu (catégorie LATIN/STANDARD
   * sans danse précise, ou label non reconnu).
   */
  calculateMpm(rawBpm: number, style?: string): number {
    if (rawBpm === 0) return 0;
    const key = normalizeStyle(style);
    if (key == null) {
      return Math.round(rawBpm);
    }
    const config = STYLE_CONFIG[key];
    const normalized = normalizeToRange(rawBpm, config.bpmRange);
    return Math.round(normalized / config.beatsPerMeasure);
  }
}
