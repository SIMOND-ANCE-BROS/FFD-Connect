/**
 * Synchronisation du dossier préparé avec la base de données de staging :
 * créations, modifications et suppressions de lignes `Track`, plus l'envoi
 * des fichiers vers le stockage (blob Azure "tracks" et/ou dossier uploads/
 * local du backend) — mêmes conventions que le backend et que
 * apps/backend/scripts/seed-test-tracks.ts.
 *
 * Merge à trois voies : chaque entrée du manifeste garde un instantané
 * `synced` (dernier état poussé). En comparant manifeste ↔ instantané ↔ base,
 * on distingue les modifications locales (poussées), les modifications faites
 * dans l'app (préservées et rapatriées dans le manifeste) et les conflits
 * (les deux côtés ont changé : signalés, écrasés uniquement avec --force).
 * Un titre supprimé dans l'app n'est pas recréé ; un titre modifié dans
 * l'app n'est pas supprimé sans --force.
 *
 * L'app ne peut pas ajouter de musique — l'outil est la seule porte d'entrée.
 * Une ligne partageant le sourceKey d'une entrée locale mais sans le marqueur
 * de l'outil (ancienne ingestion, seed…) est donc ADOPTÉE : ses métadonnées
 * (titre, artiste, danse, MPM — éditables dans l'app) font foi et sont
 * rapatriées dans le manifeste, ses fichiers (propriété de l'outil) sont
 * alignés sur le local, et la ligne reçoit le marqueur. Les lignes non
 * marquées SANS entrée locale (ex. métronomes de test) ne sont jamais
 * touchées. Les drapeaux de modération (titleMasked, blacklisted) et les
 * clashTimecodes ne sont jamais écrits par l'outil.
 *
 * Dédup métier : une création dont (artiste + titre) normalisés existent
 * déjà en base est signalée comme doublon et ignorée sauf --allow-duplicates.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { trackSignature } from './dedupe.js';
import {
  loadManifest,
  saveManifest,
  snapshotFromEntry,
  type ManifestTrack,
  type SyncedSnapshot,
} from './manifest.js';
import { getErrorMessage } from './utils.js';

/** Marqueur des lignes gérées par l'outil (stocké dans Track.jobId). */
export const SYNC_MARKER = 'track-prep';

export interface DbTrackRow {
  id: string;
  title: string;
  artist: string;
  style: string | null;
  bpm: number;
  rawBpm: number;
  filename: string;
  artwork: string | null;
  sourceKey: string | null;
  jobId: string | null;
}

type ColumnValue = string | number | null;

interface ColumnSpec {
  /** Nom de colonne Prisma/Postgres. */
  column: string;
  fromEntry(entry: ManifestTrack): ColumnValue;
  fromRow(row: DbTrackRow): ColumnValue;
  fromSnapshot(snapshot: SyncedSnapshot): ColumnValue;
  numeric?: boolean;
}

/** Colonnes synchronisées (Track.bpm stocke le MPM, cf. schéma Prisma). */
const COLUMNS: ColumnSpec[] = [
  {
    column: 'title',
    fromEntry: (e) => e.title,
    fromRow: (r) => r.title,
    fromSnapshot: (s) => s.title,
  },
  {
    column: 'artist',
    fromEntry: (e) => e.artist,
    fromRow: (r) => r.artist,
    fromSnapshot: (s) => s.artist,
  },
  {
    column: 'style',
    fromEntry: (e) => e.style ?? null,
    fromRow: (r) => r.style ?? null,
    fromSnapshot: (s) => s.style ?? null,
  },
  {
    column: 'bpm',
    fromEntry: (e) => e.mpm,
    fromRow: (r) => r.bpm,
    fromSnapshot: (s) => s.mpm,
    numeric: true,
  },
  {
    column: 'rawBpm',
    fromEntry: (e) => e.rawBpm,
    fromRow: (r) => r.rawBpm,
    fromSnapshot: (s) => s.rawBpm,
    numeric: true,
  },
  {
    column: 'filename',
    fromEntry: (e) => e.filename,
    fromRow: (r) => r.filename,
    fromSnapshot: (s) => s.filename,
  },
  {
    column: 'artwork',
    fromEntry: (e) => e.artwork ?? null,
    fromRow: (r) => r.artwork ?? null,
    fromSnapshot: (s) => s.artwork ?? null,
  },
];

function valuesEqual(a: ColumnValue, b: ColumnValue, numeric?: boolean): boolean {
  if (numeric && typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 0.001;
  }
  return a === b;
}

export interface TrackUpdate {
  row: DbTrackRow;
  entry: ManifestTrack;
  /** Colonnes à modifier en base (nom de colonne → nouvelle valeur). */
  changes: Record<string, ColumnValue>;
}

/** Modification faite dans l'app : rapatriée dans le manifeste, pas écrasée. */
export interface TrackPull {
  row: DbTrackRow;
  entry: ManifestTrack;
  /** Colonnes modifiées côté app (nom de colonne → valeur en base). */
  changes: Record<string, ColumnValue>;
}

export interface FieldConflict {
  column: string;
  local: ColumnValue;
  remote: ColumnValue;
  base: ColumnValue;
}

/**
 * Ligne préexistante (même sourceKey, pas de marqueur outil) à adopter :
 * `pull` = métadonnées de la base rapatriées dans le manifeste (l'app fait
 * foi), `push` = fichiers locaux poussés en base (l'outil fait foi).
 */
export interface TrackAdoption {
  row: DbTrackRow;
  entry: ManifestTrack;
  pull: Record<string, ColumnValue>;
  push: Record<string, ColumnValue>;
}

export interface SyncPlan {
  creates: ManifestTrack[];
  updates: TrackUpdate[];
  /** Modifications app → manifeste (aucune écriture en base). */
  pulls: TrackPull[];
  deletes: DbTrackRow[];
  /** Champs modifiés des deux côtés : ignorés sans --force. */
  conflicts: { entry: ManifestTrack; row: DbTrackRow; fields: FieldConflict[] }[];
  /** Suppressions locales bloquées : la ligne a été modifiée dans l'app. */
  protectedDeletes: { entry: ManifestTrack; row: DbTrackRow; fields: FieldConflict[] }[];
  /** Titres supprimés dans l'app : non recréés sans --force. */
  appDeleted: ManifestTrack[];
  /** Créations ignorées : même (artiste + titre) déjà en base (dédup métier). */
  duplicates: { entry: ManifestTrack; match: LibraryTrackInfo }[];
  /** Lignes préexistantes (même sourceKey, sans marqueur) à adopter. */
  adoptions: TrackAdoption[];
  /** Entrées sans sourceKey : impossibles à synchroniser de façon fiable. */
  unsyncable: ManifestTrack[];
}

export interface LibraryTrackInfo {
  id: string;
  title: string;
  artist: string;
}

export interface SyncPlanOptions {
  /** Écrase les conflits (le manifeste gagne), recrée les titres supprimés
   *  dans l'app et force les suppressions protégées. */
  force?: boolean;
  /** Autorise la création de doublons métier (même artiste + titre). */
  allowDuplicates?: boolean;
  /** (artiste + titre) de TOUTE la bibliothèque, pour la dédup métier. */
  librarySignatures?: Map<string, LibraryTrackInfo>;
}

/** Champs où la base diffère de l'instantané `synced` (= modifs app). */
function diffRowFromSnapshot(row: DbTrackRow, snapshot: SyncedSnapshot): FieldConflict[] {
  const fields: FieldConflict[] = [];
  for (const spec of COLUMNS) {
    const remote = spec.fromRow(row);
    const base = spec.fromSnapshot(snapshot);
    if (!valuesEqual(remote, base, spec.numeric)) {
      fields.push({ column: spec.column, local: base, remote, base });
    }
  }
  return fields;
}

/**
 * Calcule le plan de synchronisation (fonction pure, testée unitairement).
 * `present` : entrées du manifeste dont le mp3 existe encore localement.
 * `removed` : entrées du manifeste dont le mp3 a été supprimé localement.
 * `dbRows` : lignes Track de staging gérées par l'outil ou partageant un
 * sourceKey avec le manifeste.
 */
export function computeSyncPlan(
  present: ManifestTrack[],
  removed: ManifestTrack[],
  dbRows: DbTrackRow[],
  options: SyncPlanOptions = {},
): SyncPlan {
  const plan: SyncPlan = {
    creates: [],
    updates: [],
    pulls: [],
    deletes: [],
    conflicts: [],
    protectedDeletes: [],
    appDeleted: [],
    duplicates: [],
    adoptions: [],
    unsyncable: [],
  };

  const rowsByKey = new Map<string, DbTrackRow>();
  for (const row of dbRows) {
    if (row.sourceKey) rowsByKey.set(row.sourceKey, row);
  }
  const removedByKey = new Map<string, ManifestTrack>();
  for (const entry of removed) {
    if (entry.sourceKey) removedByKey.set(entry.sourceKey, entry);
  }

  const createSignatures = new Set<string>();
  const presentKeys = new Set<string>();

  for (const entry of present) {
    if (!entry.sourceKey) {
      plan.unsyncable.push(entry);
      continue;
    }
    presentKeys.add(entry.sourceKey);

    const row = rowsByKey.get(entry.sourceKey);
    if (!row) {
      // Jamais de ligne en base pour cette clé. Si l'entrée a déjà été
      // synchronisée (instantané présent), c'est que le titre a été supprimé
      // dans l'app : on ne le recrée pas sans --force.
      if (entry.synced && !options.force) {
        plan.appDeleted.push(entry);
        continue;
      }
      // Dédup métier : même (artiste + titre) déjà en bibliothèque, ou déjà
      // dans les créations de ce plan.
      const signature = trackSignature(entry.artist, entry.title);
      const match = options.librarySignatures?.get(signature);
      if (!options.allowDuplicates && match) {
        plan.duplicates.push({ entry, match });
        continue;
      }
      if (!options.allowDuplicates && createSignatures.has(signature)) {
        plan.duplicates.push({
          entry,
          match: { id: '(création du même plan)', title: entry.title, artist: entry.artist },
        });
        continue;
      }
      createSignatures.add(signature);
      plan.creates.push(entry);
      continue;
    }
    if (row.jobId !== SYNC_MARKER) {
      // Adoption : l'app ne peut pas ajouter de musique, donc cette ligne
      // vient d'une ancienne ingestion — c'est le même titre. Métadonnées
      // (éditables dans l'app) : la base fait foi ; fichiers : l'outil.
      const pull: Record<string, ColumnValue> = {};
      const push: Record<string, ColumnValue> = {};
      for (const spec of COLUMNS) {
        const local = spec.fromEntry(entry);
        const remote = spec.fromRow(row);
        if (valuesEqual(local, remote, spec.numeric)) continue;
        if (spec.column === 'filename' || spec.column === 'artwork') {
          push[spec.column] = local;
        } else {
          pull[spec.column] = remote;
        }
      }
      plan.adoptions.push({ entry, row, pull, push });
      continue;
    }

    const changes: Record<string, ColumnValue> = {};
    const pullChanges: Record<string, ColumnValue> = {};
    const conflictFields: FieldConflict[] = [];

    for (const spec of COLUMNS) {
      const local = spec.fromEntry(entry);
      const remote = spec.fromRow(row);
      if (valuesEqual(local, remote, spec.numeric)) continue;

      // Sans instantané (entrée d'avant cette fonctionnalité) : impossible de
      // savoir qui a changé — on protège la base et on signale un conflit.
      const base = entry.synced ? spec.fromSnapshot(entry.synced) : null;
      const localChanged = entry.synced ? !valuesEqual(local, base, spec.numeric) : true;
      const remoteChanged = entry.synced ? !valuesEqual(remote, base, spec.numeric) : true;

      if (localChanged && remoteChanged) {
        if (options.force) {
          changes[spec.column] = local;
        } else {
          conflictFields.push({ column: spec.column, local, remote, base });
        }
      } else if (localChanged) {
        changes[spec.column] = local;
      } else {
        pullChanges[spec.column] = remote;
      }
    }

    if (conflictFields.length > 0) {
      plan.conflicts.push({ entry, row, fields: conflictFields });
    }
    if (Object.keys(changes).length > 0) {
      plan.updates.push({ row, entry, changes });
    }
    if (Object.keys(pullChanges).length > 0) {
      plan.pulls.push({ row, entry, changes: pullChanges });
    }
  }

  for (const row of dbRows) {
    if (row.jobId !== SYNC_MARKER) continue;
    if (row.sourceKey && presentKeys.has(row.sourceKey)) continue;

    // Suppression demandée localement : si la ligne a été modifiée dans
    // l'app depuis la dernière sync, on la protège (sauf --force).
    const removedEntry = row.sourceKey ? removedByKey.get(row.sourceKey) : undefined;
    if (removedEntry?.synced && !options.force) {
      const appEdits = diffRowFromSnapshot(row, removedEntry.synced);
      if (appEdits.length > 0) {
        plan.protectedDeletes.push({ entry: removedEntry, row, fields: appEdits });
        continue;
      }
    }
    plan.deletes.push(row);
  }

  return plan;
}

/** Cible de stockage des fichiers audio/pochette. */
export interface StorageTarget {
  describe(): string;
  upload(localPath: string, name: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Copie vers le dossier uploads/ servi par le backend (staging local/docker). */
export function makeDirStorage(dir: string): StorageTarget {
  return {
    describe: () => `dossier ${dir}`,
    upload(localPath, name) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(localPath, path.join(dir, name));
      return Promise.resolve();
    },
    remove(name) {
      const target = path.join(dir, name);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return Promise.resolve();
    },
  };
}

/**
 * Blob Azure (conteneur "tracks"), activé par AZURE_STORAGE_CONNECTION_STRING
 * ou AZURE_STORAGE_ACCOUNT_NAME — même logique que BlobStorageService et que
 * le script seed-test-tracks.ts du backend.
 */
export async function makeBlobStorage(): Promise<StorageTarget | null> {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  if (!conn && !account) return null;

  const { BlobServiceClient } = await import('@azure/storage-blob');
  const service = conn
    ? BlobServiceClient.fromConnectionString(conn)
    : new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        new (await import('@azure/identity')).DefaultAzureCredential(),
      );
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? 'tracks';
  const container = service.getContainerClient(containerName);

  return {
    describe: () => `blob Azure (conteneur "${containerName}")`,
    async upload(localPath, name) {
      await container.getBlockBlobClient(name).uploadFile(localPath);
    },
    async remove(name) {
      await container.getBlockBlobClient(name).deleteIfExists();
    },
  };
}

export interface SyncRuntimeOptions {
  outDir: string;
  apply: boolean;
  withDeletes: boolean;
  force: boolean;
  allowDuplicates: boolean;
  databaseUrl: string;
  uploadsDir?: string;
}

async function uploadEntryFiles(
  entry: ManifestTrack,
  outDir: string,
  storages: StorageTarget[],
): Promise<void> {
  for (const storage of storages) {
    await storage.upload(path.join(outDir, entry.filename), entry.filename);
    if (entry.artwork && fs.existsSync(path.join(outDir, entry.artwork))) {
      await storage.upload(path.join(outDir, entry.artwork), entry.artwork);
    }
  }
}

async function removeRowFiles(row: DbTrackRow, storages: StorageTarget[]): Promise<void> {
  for (const storage of storages) {
    try {
      await storage.remove(row.filename);
      if (row.artwork) await storage.remove(row.artwork);
    } catch (error) {
      console.warn(
        `  ⚠ Suppression du fichier « ${row.filename} » impossible sur ${storage.describe()} : ${getErrorMessage(error)}`,
      );
    }
  }
}

function formatValue(value: ColumnValue): string {
  if (value == null) return '∅';
  return String(value);
}

/** Applique des valeurs de colonnes DB sur une entrée du manifeste. */
function applyColumnsToEntry(entry: ManifestTrack, changes: Record<string, ColumnValue>): void {
  for (const [column, value] of Object.entries(changes)) {
    if (column === 'title' && typeof value === 'string') entry.title = value;
    else if (column === 'artist' && typeof value === 'string') entry.artist = value;
    else if (column === 'style') entry.style = typeof value === 'string' ? value : null;
    else if (column === 'bpm' && typeof value === 'number') entry.mpm = value;
    else if (column === 'rawBpm' && typeof value === 'number') entry.rawBpm = value;
    else if (column === 'filename' && typeof value === 'string') entry.filename = value;
    else if (column === 'artwork') entry.artwork = typeof value === 'string' ? value : null;
  }
}

/** Exécute la synchronisation complète (plan → affichage → application). */
export async function runSync(options: SyncRuntimeOptions): Promise<void> {
  const manifest = loadManifest(options.outDir);
  if (manifest.tracks.length === 0) {
    console.log(
      `Manifeste vide ou absent dans ${options.outDir} — lancez d'abord une préparation.`,
    );
  }

  // 1. Partition du manifeste : fichiers présents vs supprimés localement.
  const present: ManifestTrack[] = [];
  const removedLocally: ManifestTrack[] = [];
  for (const entry of manifest.tracks) {
    if (fs.existsSync(path.join(options.outDir, entry.filename))) {
      present.push(entry);
    } else {
      removedLocally.push(entry);
    }
  }
  if (removedLocally.length > 0) {
    console.log(
      `${removedLocally.length} titre(s) supprimé(s) localement (mp3 absent) → suppression en staging`,
    );
  }

  // 2. Lignes concernées en base + signatures métier de toute la bibliothèque.
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: options.databaseUrl });
  try {
    const keys = [...present, ...removedLocally]
      .map((t) => t.sourceKey)
      .filter((k): k is string => Boolean(k));
    const result = await pool.query<DbTrackRow>(
      `SELECT id, title, artist, style, bpm, "rawBpm", filename, artwork,
              "sourceKey", "jobId"
         FROM "Track"
        WHERE "jobId" = $1 OR "sourceKey" = ANY($2::text[])`,
      [SYNC_MARKER, keys],
    );

    const library = await pool.query<LibraryTrackInfo>(`SELECT id, title, artist FROM "Track"`);
    const librarySignatures = new Map<string, LibraryTrackInfo>();
    for (const info of library.rows) {
      const signature = trackSignature(info.artist, info.title);
      if (!librarySignatures.has(signature)) librarySignatures.set(signature, info);
    }

    const plan = computeSyncPlan(present, removedLocally, result.rows, {
      force: options.force,
      allowDuplicates: options.allowDuplicates,
      librarySignatures,
    });
    if (!options.withDeletes) {
      plan.deletes = [];
      plan.protectedDeletes = [];
    }

    // 3. Affichage du plan.
    console.log(`\n─── Plan de synchronisation ───`);
    console.log(`Créations     : ${plan.creates.length}`);
    for (const e of plan.creates) console.log(`  + ${e.filename}`);
    console.log(`Modifications : ${plan.updates.length}`);
    for (const u of plan.updates) {
      console.log(`  ~ ${u.entry.filename} (${Object.keys(u.changes).join(', ')})`);
    }
    console.log(`Suppressions  : ${plan.deletes.length}`);
    for (const d of plan.deletes) console.log(`  - ${d.filename}`);
    if (plan.pulls.length > 0) {
      console.log(`Modifs app → manifeste (préservées) : ${plan.pulls.length}`);
      for (const p of plan.pulls) {
        console.log(`  ← ${p.entry.filename} (${Object.keys(p.changes).join(', ')})`);
      }
    }
    if (plan.conflicts.length > 0) {
      console.log(
        `⚠ Conflits (modifié dans l'app ET localement — ignorés, --force pour écraser) : ${plan.conflicts.length}`,
      );
      for (const c of plan.conflicts) {
        for (const f of c.fields) {
          console.log(
            `  ! ${c.entry.filename} · ${f.column} : app « ${formatValue(f.remote)} » ↔ local « ${formatValue(f.local)} »`,
          );
        }
      }
    }
    if (plan.protectedDeletes.length > 0) {
      console.log(
        `⚠ Suppressions bloquées (titre modifié dans l'app — --force pour supprimer quand même) : ${plan.protectedDeletes.length}`,
      );
      for (const d of plan.protectedDeletes) {
        console.log(
          `  ! ${d.row.filename} (modifié dans l'app : ${d.fields.map((f) => f.column).join(', ')})`,
        );
      }
    }
    if (plan.appDeleted.length > 0) {
      console.log(
        `Supprimés dans l'app (non recréés — --force pour réimporter) : ${plan.appDeleted.length}`,
      );
      for (const e of plan.appDeleted) console.log(`  × ${e.filename}`);
    }
    if (plan.duplicates.length > 0) {
      console.log(
        `Doublons métier ignorés (même artiste + titre déjà en base — --allow-duplicates pour forcer) : ${plan.duplicates.length}`,
      );
      for (const d of plan.duplicates) {
        console.log(`  ≈ ${d.entry.filename} ↔ « ${d.match.artist} - ${d.match.title} »`);
      }
    }
    if (plan.adoptions.length > 0) {
      console.log(
        `Adoptions (ligne préexistante reprise par l'outil ; métadonnées de l'app conservées) : ${plan.adoptions.length}`,
      );
      for (const a of plan.adoptions) {
        const detail = [
          Object.keys(a.pull).length > 0 ? `← app : ${Object.keys(a.pull).join(', ')}` : null,
          Object.keys(a.push).length > 0 ? `→ base : ${Object.keys(a.push).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join(' ; ');
        console.log(`  ⇄ ${a.entry.filename}${detail ? ` (${detail})` : ''}`);
      }
    }
    if (plan.unsyncable.length > 0) {
      console.log(`Sans sourceKey (non synchronisables) : ${plan.unsyncable.length}`);
    }

    const totalOps =
      plan.creates.length +
      plan.updates.length +
      plan.deletes.length +
      plan.pulls.length +
      plan.adoptions.length;
    if (totalOps === 0) {
      console.log('\nRien à synchroniser — staging à jour.');
      return;
    }
    if (!options.apply) {
      console.log('\nMode simulation (aucune écriture). Relancez avec --apply pour exécuter.');
      return;
    }

    // 4. Stockage des fichiers.
    const storages: StorageTarget[] = [];
    const blob = await makeBlobStorage();
    if (blob) storages.push(blob);
    if (options.uploadsDir) storages.push(makeDirStorage(options.uploadsDir));
    const needsFiles =
      plan.creates.length > 0 ||
      plan.updates.some((u) => 'filename' in u.changes) ||
      plan.adoptions.some((a) => Object.keys(a.push).length > 0);
    if (needsFiles && storages.length === 0) {
      throw new Error(
        'Aucune cible de stockage pour envoyer les mp3 : définissez ' +
          'AZURE_STORAGE_CONNECTION_STRING (ou AZURE_STORAGE_ACCOUNT_NAME), ' +
          'ou passez --uploads-dir <dossier uploads/ du backend>',
      );
    }
    if (storages.length > 0) {
      console.log(`\nStockage : ${storages.map((s) => s.describe()).join(' + ')}`);
    }

    // 5. Application.
    let failures = 0;
    let manifestDirty = false;
    const deletedRowIds = new Set<string>();

    for (const entry of plan.creates) {
      try {
        await uploadEntryFiles(entry, options.outDir, storages);
        await pool.query(
          `INSERT INTO "Track"
             (id, title, artist, filename, artwork, style, bpm, "rawBpm",
              status, "titleMasked", blacklisted, "jobId", "sourceKey", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   'READY'::"TrackStatus", false, false, $9, $10, now())`,
          [
            randomUUID(),
            entry.title,
            entry.artist,
            entry.filename,
            entry.artwork,
            entry.style,
            entry.mpm,
            entry.rawBpm,
            SYNC_MARKER,
            entry.sourceKey,
          ],
        );
        entry.synced = snapshotFromEntry(entry);
        manifestDirty = true;
        console.log(`  ✓ Créé : ${entry.filename}`);
      } catch (error) {
        failures += 1;
        console.error(`  ✗ Création échouée (${entry.filename}) : ${getErrorMessage(error)}`);
      }
    }

    for (const adoption of plan.adoptions) {
      try {
        // Fichiers : l'outil fait foi — upload du mp3/jpg locaux et
        // suppression des anciens fichiers si le nom change.
        if (Object.keys(adoption.push).length > 0) {
          await uploadEntryFiles(adoption.entry, options.outDir, storages);
          if ('filename' in adoption.push) {
            await removeRowFiles(adoption.row, storages);
          }
        }
        const columns = Object.keys(adoption.push);
        const assignments = ['"jobId" = $1', ...columns.map((c, i) => `"${c}" = $${i + 2}`)].join(
          ', ',
        );
        const values = columns.map((c) => adoption.push[c]);
        await pool.query(`UPDATE "Track" SET ${assignments} WHERE id = $${columns.length + 2}`, [
          SYNC_MARKER,
          ...values,
          adoption.row.id,
        ]);
        // Métadonnées : l'app fait foi — rapatriées dans le manifeste.
        applyColumnsToEntry(adoption.entry, adoption.pull);
        adoption.entry.synced = snapshotFromEntry(adoption.entry);
        manifestDirty = true;
        console.log(`  ⇄ Adopté : ${adoption.entry.filename}`);
      } catch (error) {
        failures += 1;
        console.error(
          `  ✗ Adoption échouée (${adoption.entry.filename}) : ${getErrorMessage(error)}`,
        );
      }
    }

    for (const update of plan.updates) {
      try {
        if ('filename' in update.changes) {
          await uploadEntryFiles(update.entry, options.outDir, storages);
          await removeRowFiles(update.row, storages);
        }
        const columns = Object.keys(update.changes);
        const assignments = columns.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
        const values = columns.map((c) => update.changes[c]);
        await pool.query(`UPDATE "Track" SET ${assignments} WHERE id = $${columns.length + 1}`, [
          ...values,
          update.row.id,
        ]);
        // L'instantané reflète l'état fusionné : nos champs poussés + les
        // éventuels champs app rapatriés par le pull correspondant.
        const pull = plan.pulls.find((p) => p.row.id === update.row.id);
        if (pull) applyColumnsToEntry(update.entry, pull.changes);
        update.entry.synced = snapshotFromEntry(update.entry);
        manifestDirty = true;
        console.log(`  ✓ Modifié : ${update.entry.filename} (${columns.join(', ')})`);
      } catch (error) {
        failures += 1;
        console.error(
          `  ✗ Modification échouée (${update.entry.filename}) : ${getErrorMessage(error)}`,
        );
      }
    }

    // Pulls sans update associé : rapatrier les modifs app dans le manifeste.
    for (const pull of plan.pulls) {
      if (plan.updates.some((u) => u.row.id === pull.row.id)) continue;
      applyColumnsToEntry(pull.entry, pull.changes);
      pull.entry.synced = snapshotFromEntry(pull.entry);
      manifestDirty = true;
      console.log(
        `  ← Rapatrié depuis l'app : ${pull.entry.filename} (${Object.keys(pull.changes).join(', ')})`,
      );
    }

    for (const row of plan.deletes) {
      try {
        await pool.query(`DELETE FROM "Track" WHERE id = $1`, [row.id]);
        await removeRowFiles(row, storages);
        deletedRowIds.add(row.id);
        console.log(`  ✓ Supprimé : ${row.filename}`);
      } catch (error) {
        failures += 1;
        console.error(`  ✗ Suppression échouée (${row.filename}) : ${getErrorMessage(error)}`);
      }
    }

    // Purge du manifeste : on ne retire que les entrées locales supprimées
    // dont la ligne staging a bien été supprimée (ou n'existait pas). Les
    // suppressions bloquées (modifs app) restent dans le manifeste pour que
    // la protection persiste au prochain lancement.
    if (options.withDeletes) {
      const rowsByKey = new Map<string, DbTrackRow>();
      for (const row of result.rows) {
        if (row.sourceKey) rowsByKey.set(row.sourceKey, row);
      }
      const before = manifest.tracks.length;
      manifest.tracks = manifest.tracks.filter((entry) => {
        if (present.includes(entry)) return true;
        const row = entry.sourceKey ? rowsByKey.get(entry.sourceKey) : undefined;
        if (!row) return false; // plus rien ni en local ni en base
        return !deletedRowIds.has(row.id); // gardée si la suppression est bloquée/échouée
      });
      if (manifest.tracks.length !== before) manifestDirty = true;
    }

    if (manifestDirty) {
      saveManifest(options.outDir, manifest);
    }

    console.log(
      `\nSynchronisation terminée : ${totalOps - failures}/${totalOps} opération(s) réussie(s)`,
    );
    if (plan.conflicts.length > 0 || plan.protectedDeletes.length > 0) {
      console.log(
        'Des modifications faites dans l’app ont été préservées — relancez avec --force pour les écraser.',
      );
    }
    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
