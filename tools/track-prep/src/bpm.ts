/**
 * Détection du tempo brut (BPM) — même chaîne que le backend
 * (apps/backend/src/tracks/bpm.service.ts) : ffmpeg extrait une fenêtre WAV
 * de 15 s, `wav-decoder` la décode, `music-tempo` détecte le tempo.
 */
import * as fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import MusicTempo from 'music-tempo';
import * as WavDecoder from 'wav-decoder';
import { getErrorMessage, resolveFfmpeg } from './utils.js';

async function extractWavWindow(
  filePath: string,
  startSeconds: number,
  durationSeconds: number,
  outPath: string,
): Promise<void> {
  ffmpeg.setFfmpegPath(resolveFfmpeg().path);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(filePath)
      .setStartTime(startSeconds)
      .setDuration(durationSeconds)
      .toFormat('wav')
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(getErrorMessage(err))))
      .save(outPath);
  });
}

async function analyzeWindow(filePath: string, startSeconds: number): Promise<number> {
  const tempWav = filePath.replace(/\.[^.]+$/, `.temp-${startSeconds}.wav`);
  try {
    await extractWavWindow(filePath, startSeconds, 15, tempWav);
    const buffer = fs.readFileSync(tempWav);
    const audioData = await WavDecoder.decode(buffer);
    const channel = audioData.channelData[0];
    if (!channel || channel.length === 0) {
      throw new Error('fenêtre audio vide');
    }
    const tempo = new MusicTempo(channel);
    const bpm = parseFloat(tempo.tempo);
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new Error(`tempo détecté invalide (${tempo.tempo})`);
    }
    return bpm;
  } finally {
    if (fs.existsSync(tempWav)) {
      fs.unlinkSync(tempWav);
    }
  }
}

/**
 * BPM brut du fichier. Fenêtre 15 s à partir de 10 s (comme le backend) ;
 * si elle échoue (titre très court, silence), retente depuis le début.
 */
export async function analyzeBpm(filePath: string): Promise<number> {
  try {
    return await analyzeWindow(filePath, 10);
  } catch {
    return analyzeWindow(filePath, 0);
  }
}
