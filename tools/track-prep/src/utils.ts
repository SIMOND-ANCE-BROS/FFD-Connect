import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Rejette la promesse si elle ne se résout pas dans le délai imparti. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

let cachedFfmpeg: { path: string; system: boolean } | null = null;

/**
 * Résout le binaire ffmpeg : FFMPEG_PATH > ffmpeg du PATH > binaire embarqué
 * (@ffmpeg-installer/ffmpeg). Le binaire embarqué permet d'utiliser l'outil
 * sans installer ffmpeg sur le PC.
 */
export function resolveFfmpeg(): { path: string; system: boolean } {
  if (cachedFfmpeg) return cachedFfmpeg;
  const envPath = process.env.FFMPEG_PATH;
  if (envPath) {
    cachedFfmpeg = { path: envPath, system: true };
    return cachedFfmpeg;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    cachedFfmpeg = { path: 'ffmpeg', system: true };
  } catch {
    const installer = require('@ffmpeg-installer/ffmpeg') as { path: string };
    cachedFfmpeg = { path: installer.path, system: false };
  }
  return cachedFfmpeg;
}
