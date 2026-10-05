/**
 * Finalisation des fichiers : nommage à la convention fédération
 * `NN-STYLE ｜ Artiste - Titre (52 MPM).mp3` (convention historique des
 * fichiers FFD, que parsait l'ancien import du backend) + réécriture des
 * tags ID3 (titre, artiste, genre = danse, TBPM = MPM) et pochette
 * intégrée au mp3.
 */
import ffmpeg from 'fluent-ffmpeg';
import { getErrorMessage, resolveFfmpeg } from './utils.js';

export interface TempoInfo {
  value: number;
  /** "MPM" quand la danse est connue, "BPM" brut sinon. */
  unit: 'MPM' | 'BPM';
}

/**
 * Nettoie une chaîne pour un nom de fichier valide sous Windows/macOS/Linux.
 * Le séparateur fédération utilise le pipe pleine largeur ｜ (U+FF5C), seul
 * accepté par NTFS — le backend reconnaît les deux variantes.
 */
export function fsSafe(input: string): string {
  return input
    .replace(/[<>:"/\\|?*\u0000-\u001f｜]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

/**
 * Variante pour artiste/titre dans le nom de fichier : les tirets simples
 * sont remplacés par des tirets demi-cadratin (–) pour que le seul " - " du
 * nom soit le séparateur artiste/titre attendu par la regex du backend.
 */
function forFilename(input: string, maxLength: number): string {
  const safe = fsSafe(input).replace(/-/g, '–');
  return safe.length > maxLength ? safe.slice(0, maxLength).trimEnd() : safe;
}

/**
 * Nom de fichier à la convention fédération. Sans danse connue, le style
 * vaut "AUTRE" (catégorie inconnue → le backend garde le BPM brut).
 */
export function buildBasename(
  index: number,
  styleLabel: string | null,
  artist: string,
  title: string,
  tempo: TempoInfo | null,
): string {
  const num = String(index).padStart(2, '0');
  const styleToken = styleLabel ? fsSafe(styleLabel).toUpperCase() : 'AUTRE';
  const artistPart = forFilename(artist || 'Unknown', 60);
  const titlePart = forFilename(title || 'Sans titre', 80);
  const tempoPart = tempo && tempo.value > 0 ? ` (${tempo.value} ${tempo.unit})` : '';
  return `${num}-${styleToken} ｜ ${artistPart} - ${titlePart}${tempoPart}`;
}

export interface FinalizeTags {
  title: string;
  artist: string;
  style: string | null;
  mpm: number;
}

/**
 * Réécrit le mp3 (copie sans réencodage) avec des tags ID3 propres et la
 * pochette intégrée quand elle existe.
 */
export async function writeFinalMp3(
  audioPath: string,
  artworkPath: string | null,
  outPath: string,
  tags: FinalizeTags,
): Promise<void> {
  ffmpeg.setFfmpegPath(resolveFfmpeg().path);

  const options: string[] = ['-map 0:a'];
  if (artworkPath) {
    options.push(
      '-map 1:v',
      '-disposition:v:0 attached_pic',
      '-metadata:s:v title=Album cover',
      '-metadata:s:v comment=Cover (front)',
    );
  }
  options.push('-c copy', '-id3v2_version 3');
  options.push(`-metadata title=${tags.title}`);
  options.push(`-metadata artist=${tags.artist}`);
  if (tags.style) {
    options.push(`-metadata genre=${tags.style}`);
  }
  if (tags.mpm > 0) {
    options.push(`-metadata TBPM=${tags.mpm}`);
  }

  let command = ffmpeg(audioPath);
  if (artworkPath) {
    command = command.input(artworkPath);
  }

  await new Promise<void>((resolve, reject) => {
    command
      .outputOptions(options)
      .on('end', () => resolve())
      .on('error', (err) => reject(new Error(getErrorMessage(err))))
      .save(outPath);
  });
}
