/**
 * Téléchargement audio via yt-dlp (youtube-dl-exec), mêmes drapeaux que
 * l'ancien pipeline d'import du backend (retiré depuis) : extraction mp3,
 * miniature convertie en jpg, info.json pour les métadonnées. Les liens
 * Spotify ne sont jamais téléchargés directement : on cherche l'équivalent
 * sur YouTube avec `ytsearch1:"Artiste - Titre"`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import youtubedlDefault, { create as createYoutubeDl } from 'youtube-dl-exec';
import type { DownloadSpec } from './sources.js';
import { resolveFfmpeg, withTimeout } from './utils.js';

const DOWNLOAD_TIMEOUT_MS = 180_000;
const METADATA_TIMEOUT_MS = 30_000;

export interface Metadata {
  title: string;
  artist: string;
}

export interface DownloadedTrack {
  filePath: string;
  artworkPath: string | null;
  metadata: Metadata;
}

export interface DownloadOptions {
  /** Fichier cookies.txt (format Netscape) pour contourner l'anti-bot YouTube. */
  cookies?: string;
}

interface YtDlpInfoJson {
  title?: string;
  track?: string;
  artist?: string;
  creator?: string;
  uploader?: string;
  channel?: string;
}

interface YtDlpFlatEntry {
  id?: string;
  title?: string;
  uploader?: string;
}

interface YtDlpFlatPlaylist {
  title?: string;
  entries?: YtDlpFlatEntry[];
}

const binaryPath = process.env.YOUTUBE_DL_BINARY_PATH;
const youtubedl = binaryPath
  ? createYoutubeDl(binaryPath)
  : (youtubedlDefault as unknown as ReturnType<typeof createYoutubeDl>);

function commonFlags(options: DownloadOptions): Record<string, unknown> {
  const ffmpeg = resolveFfmpeg();
  return {
    // Runtime JS pour le déchiffrement nsig de YouTube (même choix que le backend).
    jsRuntimes: process.env.YOUTUBE_DL_JS_RUNTIME ?? 'node',
    ...(options.cookies ? { cookies: options.cookies } : {}),
    // yt-dlp a besoin de ffmpeg pour extraire l'audio ; on lui passe le binaire
    // embarqué quand aucun ffmpeg système n'est disponible.
    ...(ffmpeg.path !== 'ffmpeg' ? { ffmpegLocation: ffmpeg.path } : {}),
  };
}

/** Entrées (id + titre) d'une playlist YouTube, sans télécharger l'audio. */
export async function listYoutubePlaylist(
  url: string,
  limit: number,
  options: DownloadOptions,
): Promise<{ title: string; entries: { id: string; title: string }[] }> {
  const info = (await withTimeout(
    youtubedl(url, {
      dumpSingleJson: true,
      skipDownload: true,
      flatPlaylist: true,
      playlistEnd: limit,
      ...commonFlags(options),
    }),
    METADATA_TIMEOUT_MS,
    'Lecture de la playlist YouTube',
  )) as unknown as YtDlpFlatPlaylist;

  const entries = (info.entries ?? [])
    .filter((e): e is YtDlpFlatEntry & { id: string } => Boolean(e.id))
    .map((e) => ({ id: e.id, title: e.title ?? e.id }));

  return { title: info.title ?? 'Playlist YouTube', entries };
}

/** Télécharge l'audio d'un spec (lien direct ou recherche) en mp3 + jpg. */
export async function downloadAudio(
  spec: DownloadSpec,
  downloadDir: string,
  tempId: string,
  options: DownloadOptions,
): Promise<DownloadedTrack> {
  const downloadUrl = spec.kind === 'search' ? `ytsearch1:${spec.target}` : spec.target;

  const outputTemplate = path.join(downloadDir, `${tempId}-%(title)s.%(ext)s`);

  await withTimeout(
    youtubedl(downloadUrl, {
      extractAudio: true,
      audioFormat: 'mp3',
      writeThumbnail: true,
      // Coerce les miniatures .webp en .jpg (drapeau yt-dlp réel absent des
      // types de youtube-dl-exec — même cast que le backend).
      ...({ convertThumbnails: 'jpg' } as Record<string, unknown>),
      writeInfoJson: true,
      output: outputTemplate,
      noPlaylist: true,
      ...({ concurrentFragments: 4 } as Record<string, unknown>),
      ...commonFlags(options),
    }),
    DOWNLOAD_TIMEOUT_MS,
    'Téléchargement yt-dlp',
  );

  const files = fs.readdirSync(downloadDir);
  const audioFile = files.find(
    (f) => f.startsWith(`${tempId}-`) && (f.endsWith('.mp3') || f.endsWith('.m4a')),
  );
  if (!audioFile) {
    throw new Error('Téléchargement terminé mais aucun fichier audio créé');
  }

  const artworkFile = files.find(
    (f) => f.startsWith(`${tempId}-`) && /\.(jpe?g|png|webp)$/i.test(f),
  );

  // Métadonnées : Spotify prime (plus propres) ; sinon info.json de yt-dlp.
  let metadata: Metadata = spec.presetMeta ?? {
    title: cleanTitle(audioFile.replace(/\.[^/.]+$/, '').replace(/^[^-]+-/, '')),
    artist: 'Unknown',
  };

  const infoFile = files.find((f) => f.startsWith(`${tempId}-`) && f.endsWith('.info.json'));
  if (infoFile) {
    const infoPath = path.join(downloadDir, infoFile);
    if (spec.presetMeta == null) {
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8')) as YtDlpInfoJson;
        metadata = metadataFromInfo(info, metadata);
      } catch {
        // best effort — on garde le fallback
      }
    }
    try {
      fs.unlinkSync(infoPath);
    } catch {
      // best effort
    }
  }

  return {
    filePath: path.join(downloadDir, audioFile),
    artworkPath: artworkFile ? path.join(downloadDir, artworkFile) : null,
    metadata,
  };
}

/**
 * Extraction de métadonnées depuis l'info.json de yt-dlp — copie du backend.
 * Préfère `track`/`artist` (YouTube Music), sinon découpe "Artiste - Titre".
 */
export function metadataFromInfo(info: YtDlpInfoJson, fallback: Metadata): Metadata {
  const rawTitle = info.track ?? info.title ?? fallback.title;
  const rawArtist = info.artist ?? info.creator ?? info.uploader ?? info.channel;

  if (info.track && (info.artist ?? info.creator)) {
    return {
      title: cleanTitle(rawTitle),
      artist: (info.artist ?? info.creator ?? 'Unknown').trim(),
    };
  }

  const split = splitArtistTitle(info.title ?? rawTitle);
  if (split) {
    return split;
  }

  return {
    title: cleanTitle(rawTitle),
    artist: (rawArtist ?? fallback.artist).trim(),
  };
}

function splitArtistTitle(title: string | undefined): Metadata | null {
  if (!title) return null;
  const cleaned = cleanTitle(title);
  // Format YouTube courant : "Artist - Title" ou "Artist – Title"
  const m = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return null;
  return { artist: m[1].trim(), title: m[2].trim() };
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(
      /\s*[\(\[](?:official\s+(?:music\s+)?(?:video|audio|lyric[s]?\s+video)|official|hd|hq|4k|lyrics?|audio|visualizer|m\/v|mv)[\)\]]/gi,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}
