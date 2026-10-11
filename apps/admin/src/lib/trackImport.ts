import type { AdminTracksControllerCreateData } from '../api/generated/types.gen';
import { apiErrorMessage, isConflict } from './apiError';
import { readText } from './files';
import type { Id3Picture, Id3Tags } from './id3';
import { calculateMpm, type DanceKey, normalizeDance } from './mpm';
import { AMBIANCE, type StyleOption } from './tracks';

/** Same limits as the API (POST /admin/tracks). */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
/** Items per POST /admin/tracks/check: the API refuses more. */
export const CHECK_BATCH_SIZE = 200;
/** Uploads in flight at once. */
export const MAX_PARALLEL_UPLOADS = 2;

const nfc = (name: string): string => name.normalize('NFC');

/** track-prep `manifest.json`, version 1: the fields the import uses. */
export interface ManifestTrack {
  filename: string;
  artwork: string | null;
  title: string;
  artist: string;
  style: string | null;
  rawBpm: number;
  mpm: number;
  sourceKey: string | null;
}

/**
 * Manifest entries by file name (NFC: macOS may hand the picked file names
 * decomposed), or null when the text is not a version 1 manifest.
 */
export function parseManifest(text: string): Map<string, ManifestTrack> | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { version, tracks } = data as { version?: unknown; tracks?: unknown };
  if (version !== 1 || !Array.isArray(tracks)) return null;
  const byFile = new Map<string, ManifestTrack>();
  for (const entry of tracks as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.filename !== 'string') continue;
    byFile.set(nfc(e.filename), {
      filename: e.filename,
      artwork: typeof e.artwork === 'string' ? e.artwork : null,
      title: typeof e.title === 'string' ? e.title : '',
      artist: typeof e.artist === 'string' ? e.artist : '',
      style: typeof e.style === 'string' ? e.style : null,
      rawBpm: typeof e.rawBpm === 'number' ? e.rawBpm : 0,
      mpm: typeof e.mpm === 'number' ? e.mpm : 0,
      sourceKey: typeof e.sourceKey === 'string' ? e.sourceKey : null,
    });
  }
  return byFile;
}

const STYLE_BY_DANCE: Record<DanceKey, StyleOption> = {
  rumba: 'Rumba',
  'cha-cha': 'Cha-cha',
  samba: 'Samba',
  'paso doble': 'Paso Doble',
  jive: 'Jive',
  'valse lente': 'Valse Lente',
  tango: 'Tango',
  viennoise: 'Valse Viennoise',
  'slow fox': 'Slow Fox',
  quickstep: 'Quickstep',
};

/** Canonical label of a dance written any way (manifest, ID3 genre, file-name token). */
export function canonicalStyle(input: string | null | undefined): StyleOption | null {
  if (!input) return null;
  if (input.trim().toLowerCase() === 'ambiance') return AMBIANCE;
  const key = normalizeDance(input);
  return key ? STYLE_BY_DANCE[key] : null;
}

export interface NameInfo {
  style: StyleOption | null;
  artist: string;
  title: string;
  mpm?: number;
  rawBpm?: number;
}

/**
 * track-prep file name `NN-DANSE ｜ Artiste - Titre (52 MPM).mp3`: fullwidth
 * bar U+FF5C (the one NTFS accepts) or ASCII `|`; `(N BPM)` when the dance is
 * unknown (`AUTRE`); no tempo part when none was detected.
 */
const TRACK_PREP_NAME =
  /^\d+-(.+?) [｜|] (.+?) - (.+?)(?: \((\d+(?:[.,]\d+)?) (MPM|BPM)\))?\.mp3$/i;

export function parseTrackPrepName(filename: string): NameInfo | null {
  const match = TRACK_PREP_NAME.exec(nfc(filename));
  if (!match) return null;
  const [, styleToken, artist, title, tempo, unit] = match;
  const value = tempo ? Number(tempo.replace(',', '.')) : 0;
  const info: NameInfo = {
    style: canonicalStyle(styleToken),
    artist: artist.trim(),
    title: title.trim(),
  };
  if (value > 0 && unit.toUpperCase() === 'MPM') info.mpm = Math.round(value);
  if (value > 0 && unit.toUpperCase() === 'BPM') info.rawBpm = value;
  return info;
}

export interface PickedFiles {
  /** MP3 files, sorted by name (track-prep numbers them). */
  audio: File[];
  /** JPEG / PNG files by NFC name. */
  images: Map<string, File>;
  manifest: Map<string, ManifestTrack> | null;
  /** A manifest.json was dropped but could not be read. */
  manifestInvalid: boolean;
  /** Other files, hidden ones aside. */
  ignored: string[];
}

export async function sortFiles(files: readonly File[]): Promise<PickedFiles> {
  const picked: PickedFiles = {
    audio: [],
    images: new Map(),
    manifest: null,
    manifestInvalid: false,
    ignored: [],
  };
  for (const file of files) {
    const name = nfc(file.name);
    const lower = name.toLowerCase();
    // macOS archives carry AppleDouble companions (`._song.mp3`, `__MACOSX/`):
    // metadata, not audio, whatever their extension says.
    if (name.startsWith('.') || nfc(file.webkitRelativePath || '').includes('__MACOSX/')) continue;
    if (lower.endsWith('.mp3')) picked.audio.push(file);
    else if (/\.(jpe?g|png)$/.test(lower)) picked.images.set(name, file);
    else if (lower === 'manifest.json') {
      picked.manifest = parseManifest(await readText(file));
      picked.manifestInvalid = picked.manifest === null;
    } else picked.ignored.push(name);
  }
  picked.audio.sort((a, b) => nfc(a.name).localeCompare(nfc(b.name)));
  return picked;
}

export interface RowSources {
  readTags: (file: Blob) => Promise<Id3Tags | null>;
  hash: (file: Blob) => Promise<string>;
}

export type RowState = 'idle' | 'sending' | 'done' | 'failed';

/** One MP3 of the review table. */
export interface ImportRow {
  /** Relative path (or name) of the file: unique in the batch. */
  key: string;
  file: File;
  artwork: Blob | null;
  title: string;
  artist: string;
  style: StyleOption | '';
  /** '' while empty: the server then computes it. */
  mpm: number | '';
  mpmTouched: boolean;
  rawBpm?: number;
  sourceKey?: string;
  sha256: string;
  /** Already in the library (check or 409), with the existing track when known. */
  existing: { trackId?: string } | null;
  batchDuplicate: boolean;
  skip: boolean;
  state: RowState;
  error?: string;
  trackId?: string;
}

const usableArtwork = (image: Blob | null | undefined): Blob | null =>
  image && image.size <= MAX_ARTWORK_BYTES ? image : null;

function siblingImage(base: string, images: Map<string, File>): File | undefined {
  for (const ext of ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG']) {
    const image = images.get(base + ext);
    if (image) return image;
  }
  return undefined;
}

/**
 * Embedded covers in JPEG or PNG; some taggers write the non-standard
 * `image/jpg`. The server sniffs the bytes anyway, so the MIME only filters.
 */
const COVER_MIMES: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
};

function embeddedCover(picture: Id3Picture | undefined): Blob | null {
  const type = picture ? COVER_MIMES[picture.mime.toLowerCase()] : undefined;
  return picture && type ? new Blob([picture.data], { type }) : null;
}

/**
 * Pre-fill of one row, in the browser (nothing is sent): the manifest entry
 * when it lists the file; otherwise the ID3 tags, completed by the track-prep
 * file name; otherwise the file name without extension as title.
 */
export async function buildRow(
  file: File,
  picked: PickedFiles,
  sources: RowSources,
): Promise<ImportRow> {
  const name = nfc(file.name);
  const row: ImportRow = {
    key: nfc(file.webkitRelativePath || file.name),
    file,
    artwork: null,
    title: '',
    artist: '',
    style: '',
    mpm: '',
    mpmTouched: false,
    sha256: await sources.hash(file),
    existing: null,
    batchDuplicate: false,
    skip: false,
    state: 'idle',
  };
  const entry = picked.manifest?.get(name);
  if (entry) {
    return {
      ...row,
      title: entry.title,
      artist: entry.artist,
      style: canonicalStyle(entry.style) ?? '',
      mpm: entry.mpm > 0 ? Math.round(entry.mpm) : '',
      ...(entry.rawBpm > 0 ? { rawBpm: entry.rawBpm } : {}),
      ...(entry.sourceKey ? { sourceKey: entry.sourceKey } : {}),
      artwork: usableArtwork(entry.artwork ? picked.images.get(nfc(entry.artwork)) : null),
    };
  }
  const tags = await sources.readTags(file);
  const fromName = parseTrackPrepName(name);
  const base = name.replace(/\.mp3$/i, '');
  const picture = embeddedCover(tags?.picture);
  return {
    ...row,
    title: tags?.title ?? fromName?.title ?? base,
    artist: tags?.artist ?? fromName?.artist ?? '',
    style: canonicalStyle(tags?.genre) ?? fromName?.style ?? '',
    mpm: fromName?.mpm ?? '',
    ...(fromName?.rawBpm !== undefined ? { rawBpm: fromName.rawBpm } : {}),
    artwork: usableArtwork(siblingImage(base, picked.images)) ?? usableArtwork(picture),
  };
}

export type RowIssue =
  | 'duplicate'
  | 'batch-duplicate'
  | 'too-big'
  | 'missing-title'
  | 'missing-artist'
  | 'missing-dance';

export const ISSUE_LABELS: Record<RowIssue, { icon: string; label: string }> = {
  duplicate: { icon: '⛔', label: 'Doublon' },
  'batch-duplicate': { icon: '⛔', label: 'Doublon dans le lot' },
  'too-big': { icon: '⛔', label: 'Fichier de plus de 20 Mo' },
  'missing-title': { icon: '⚠️', label: 'Titre manquant' },
  'missing-artist': { icon: '⚠️', label: 'Artiste manquant' },
  'missing-dance': { icon: '⚠️', label: 'Danse manquante' },
};

/** Why a row cannot be sent (⛔ or ⚠️), or null when it is ✅ ready. */
export function rowIssue(row: ImportRow): RowIssue | null {
  if (row.existing) return 'duplicate';
  if (row.batchDuplicate) return 'batch-duplicate';
  if (row.file.size > MAX_AUDIO_BYTES) return 'too-big';
  if (!row.title.trim()) return 'missing-title';
  if (!row.artist.trim()) return 'missing-artist';
  if (!row.style) return 'missing-dance';
  return null;
}

export const isSendable = (row: ImportRow): boolean =>
  !row.skip && row.state !== 'done' && rowIssue(row) === null;

/**
 * Row keys made unique: files read from a dropped folder carry no relative
 * path, so two sub-folders may hold the same file name.
 */
export function withUniqueKeys(rows: readonly ImportRow[]): ImportRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const count = (seen.get(row.key) ?? 0) + 1;
    seen.set(row.key, count);
    return count === 1 ? row : { ...row, key: `${row.key} (${count})` };
  });
}

/** The second copy of a file (same hash) or of a source in the batch is a duplicate. */
export function markBatchDuplicates(rows: readonly ImportRow[]): ImportRow[] {
  const hashes = new Set<string>();
  const keys = new Set<string>();
  return rows.map((row) => {
    const duplicate =
      hashes.has(row.sha256) || (row.sourceKey !== undefined && keys.has(row.sourceKey));
    hashes.add(row.sha256);
    if (row.sourceKey) keys.add(row.sourceKey);
    return { ...row, batchDuplicate: duplicate };
  });
}

/**
 * Dance change in the table. Unless the admin typed an MPM, it follows the
 * dance as the server computes it from the raw tempo; without a raw tempo the
 * server analyses the file, so the MPM is left to it.
 */
export function withStyle(row: ImportRow, style: StyleOption | ''): ImportRow {
  if (row.mpmTouched) return { ...row, style };
  return { ...row, style, mpm: row.rawBpm ? calculateMpm(row.rawBpm, style) : '' };
}

export type CheckItem = { sha256: string; sourceKey?: string };
export type CheckAnswer = { exists: boolean; trackId?: string };

/** Rows already in the library, by row key (one request per 200 rows). */
export async function findExisting(
  rows: readonly ImportRow[],
  check: (items: CheckItem[]) => Promise<CheckAnswer[]>,
): Promise<Map<string, string | undefined>> {
  const found = new Map<string, string | undefined>();
  for (let start = 0; start < rows.length; start += CHECK_BATCH_SIZE) {
    const batch = rows.slice(start, start + CHECK_BATCH_SIZE);
    const answers = await check(
      batch.map((row) => ({
        sha256: row.sha256,
        ...(row.sourceKey ? { sourceKey: row.sourceKey } : {}),
      })),
    );
    answers.forEach((answer, index) => {
      const target = batch[index];
      if (answer.exists && target) found.set(target.key, answer.trackId);
    });
  }
  return found;
}

/** Multipart body of POST /admin/tracks: the files and the filled fields only. */
export function uploadBody(row: ImportRow): AdminTracksControllerCreateData['body'] {
  return {
    audio: row.file,
    ...(row.artwork ? { artwork: row.artwork } : {}),
    title: row.title.trim(),
    artist: row.artist.trim(),
    ...(row.style ? { style: row.style } : {}),
    ...(typeof row.mpm === 'number' ? { mpm: row.mpm } : {}),
    ...(row.rawBpm !== undefined ? { rawBpm: row.rawBpm } : {}),
    ...(row.sourceKey ? { sourceKey: row.sourceKey } : {}),
    sha256: row.sha256,
  };
}

export type UploadOutcome =
  | { state: 'done'; trackId: string }
  | { state: 'duplicate'; trackId?: string }
  | { state: 'failed'; error: string };

/** Outcome of one upload: a 409 is a duplicate, not a failure. */
export function uploadOutcome(result: { data?: { id: string }; error?: unknown }): UploadOutcome {
  if (result.error === undefined && result.data) {
    return { state: 'done', trackId: result.data.id };
  }
  const body = result.error;
  if (isConflict(body)) {
    const id = (body as { existingTrackId?: unknown }).existingTrackId;
    return typeof id === 'string' ? { state: 'duplicate', trackId: id } : { state: 'duplicate' };
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { statusCode?: unknown }).statusCode === 413
  ) {
    return {
      state: 'failed',
      error: 'Fichier trop volumineux (MP3 : 20 Mo, pochette : 2 Mo au plus).',
    };
  }
  return { state: 'failed', error: apiErrorMessage(body, "Échec de l'envoi.") };
}

/** Runs `work` on every item, at most `limit` at a time. `work` must not reject. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export interface ImportSummary {
  imported: number;
  duplicates: number;
  failed: number;
}

export function importSummary(rows: readonly ImportRow[]): ImportSummary {
  const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0 };
  for (const row of rows) {
    if (row.skip) continue;
    if (row.state === 'done') summary.imported += 1;
    else if (row.state === 'failed') summary.failed += 1;
    else if (row.existing || row.batchDuplicate) summary.duplicates += 1;
  }
  return summary;
}

/** « N importées, D doublons, E échecs » (spec wording, numbers as is). */
export const summaryText = ({ imported, duplicates, failed }: ImportSummary): string =>
  `${imported} importées, ${duplicates} doublons, ${failed} échecs`;
