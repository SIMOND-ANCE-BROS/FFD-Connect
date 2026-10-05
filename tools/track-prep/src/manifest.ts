/** Manifeste JSON des titres préparés (métadonnées + dédup entre exécutions). */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Instantané des valeurs envoyées en base lors de la dernière `sync --apply`.
 * Sert de base au merge à trois voies : il permet de distinguer une
 * modification locale (manifeste ≠ instantané) d'une modification faite dans
 * l'app (base ≠ instantané) et donc de ne jamais écraser cette dernière.
 */
export interface SyncedSnapshot {
  title: string;
  artist: string;
  style: string | null;
  mpm: number;
  rawBpm: number;
  filename: string;
  artwork: string | null;
  at: string;
}

export interface ManifestTrack {
  filename: string;
  artwork: string | null;
  title: string;
  artist: string;
  /** Libellé canonique ("Samba", "Valse Lente"…) — valeurs du DTO backend. */
  style: string | null;
  /** Tempo brut détecté (BPM), équivalent de Track.rawBpm. */
  rawBpm: number;
  /** Tempo dansé (MPM), équivalent de Track.bpm ; BPM brut si danse inconnue. */
  mpm: number;
  /** Même format que Track.sourceKey ("youtube:<id>", "spotify:<id>"). */
  sourceKey: string | null;
  /** Lien canonique du titre (trace de provenance). */
  sourceUrl: string;
  /** Lien fourni à l'outil (playlist ou titre). */
  origin: string;
  preparedAt: string;
  /** Provenance de la danse : option CLI, nom de playlist, titre, tempo. */
  styleSource?: 'option' | 'playlist' | 'titre' | 'tempo';
  /** Danses plausibles quand la détection auto est ambiguë (style resté null). */
  styleCandidates?: string[];
  /** Dernier état poussé en staging (absent tant que jamais synchronisé). */
  synced?: SyncedSnapshot;
}

/** Instantané `synced` correspondant à l'état courant d'une entrée. */
export function snapshotFromEntry(entry: ManifestTrack): SyncedSnapshot {
  return {
    title: entry.title,
    artist: entry.artist,
    style: entry.style,
    mpm: entry.mpm,
    rawBpm: entry.rawBpm,
    filename: entry.filename,
    artwork: entry.artwork,
    at: new Date().toISOString(),
  };
}

export interface Manifest {
  version: 1;
  tracks: ManifestTrack[];
}

const MANIFEST_NAME = 'manifest.json';

export function manifestPath(outDir: string): string {
  return path.join(outDir, MANIFEST_NAME);
}

export function loadManifest(outDir: string): Manifest {
  const file = manifestPath(outDir);
  if (!fs.existsSync(file)) {
    return { version: 1, tracks: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    if (Array.isArray(parsed.tracks)) {
      return { version: 1, tracks: parsed.tracks };
    }
  } catch {
    // manifeste corrompu — on repart de zéro sans écraser les mp3 existants
  }
  return { version: 1, tracks: [] };
}

export function saveManifest(outDir: string, manifest: Manifest): void {
  fs.writeFileSync(manifestPath(outDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Prochain numéro de piste : continue la numérotation des fichiers existants. */
export function nextTrackIndex(outDir: string): number {
  let max = 0;
  if (fs.existsSync(outDir)) {
    for (const file of fs.readdirSync(outDir)) {
      const m = file.match(/^(\d+)-/);
      if (m) {
        max = Math.max(max, parseInt(m[1], 10));
      }
    }
  }
  return max + 1;
}
