import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ManifestTrack, SyncedSnapshot } from '../src/manifest.js';
import { computeSyncPlan, SYNC_MARKER, type DbTrackRow } from '../src/sync.js';

function entry(overrides: Partial<ManifestTrack> = {}): ManifestTrack {
  return {
    filename: '01-SAMBA ｜ Artist - Title (52 MPM).mp3',
    artwork: '01-SAMBA ｜ Artist - Title (52 MPM).jpg',
    title: 'Title',
    artist: 'Artist',
    style: 'Samba',
    rawBpm: 104,
    mpm: 52,
    sourceKey: 'spotify:abc',
    sourceUrl: 'https://open.spotify.com/track/abc',
    origin: 'https://open.spotify.com/track/abc',
    preparedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

/** Instantané aligné sur les valeurs par défaut de entry()/row(). */
function snapshot(overrides: Partial<SyncedSnapshot> = {}): SyncedSnapshot {
  return {
    title: 'Title',
    artist: 'Artist',
    style: 'Samba',
    mpm: 52,
    rawBpm: 104,
    filename: '01-SAMBA ｜ Artist - Title (52 MPM).mp3',
    artwork: '01-SAMBA ｜ Artist - Title (52 MPM).jpg',
    at: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Partial<DbTrackRow> = {}): DbTrackRow {
  return {
    id: 'row-1',
    title: 'Title',
    artist: 'Artist',
    style: 'Samba',
    bpm: 52,
    rawBpm: 104,
    filename: '01-SAMBA ｜ Artist - Title (52 MPM).mp3',
    artwork: '01-SAMBA ｜ Artist - Title (52 MPM).jpg',
    sourceKey: 'spotify:abc',
    jobId: SYNC_MARKER,
    ...overrides,
  };
}

test('computeSyncPlan — nouveauté : entrée absente de la base → création', () => {
  const plan = computeSyncPlan([entry()], [], []);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test('computeSyncPlan — identique : aucune opération', () => {
  const plan = computeSyncPlan([entry({ synced: snapshot() })], [], [row()]);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deletes.length, 0);
  assert.equal(plan.pulls.length, 0);
  assert.equal(plan.conflicts.length, 0);
});

test('computeSyncPlan — modif locale seule : poussée en base', () => {
  const plan = computeSyncPlan(
    [entry({ title: 'Nouveau titre', mpm: 50, synced: snapshot() })],
    [],
    [row()],
  );
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0].changes, {
    title: 'Nouveau titre',
    bpm: 50,
  });
  assert.equal(plan.conflicts.length, 0);
});

test('computeSyncPlan — modif app seule : préservée et rapatriée (pull)', () => {
  const plan = computeSyncPlan(
    [entry({ synced: snapshot() })],
    [],
    [row({ title: 'Corrigé dans l’app', bpm: 50 })],
  );
  assert.equal(plan.updates.length, 0, 'rien ne doit être poussé en base');
  assert.equal(plan.pulls.length, 1);
  assert.deepEqual(plan.pulls[0].changes, {
    title: 'Corrigé dans l’app',
    bpm: 50,
  });
});

test('computeSyncPlan — modifié des deux côtés : conflit, rien poussé sans --force', () => {
  const plan = computeSyncPlan(
    [entry({ title: 'Version locale', synced: snapshot() })],
    [],
    [row({ title: 'Version app' })],
  );
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].fields[0].column, 'title');
  assert.equal(plan.conflicts[0].fields[0].local, 'Version locale');
  assert.equal(plan.conflicts[0].fields[0].remote, 'Version app');
});

test('computeSyncPlan — conflit + --force : le manifeste local gagne', () => {
  const plan = computeSyncPlan(
    [entry({ title: 'Version locale', synced: snapshot() })],
    [],
    [row({ title: 'Version app' })],
    { force: true },
  );
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0].changes, { title: 'Version locale' });
});

test('computeSyncPlan — sans instantané (legacy) : divergence = conflit, pas d’écrasement', () => {
  const plan = computeSyncPlan([entry({ title: 'Local' })], [], [row({ title: 'App' })]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.conflicts.length, 1);
});

test('computeSyncPlan — supprimé dans l’app : non recréé sans --force', () => {
  const synced = entry({ synced: snapshot() });
  const plan = computeSyncPlan([synced], [], []);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.appDeleted.length, 1);

  const forced = computeSyncPlan([synced], [], [], { force: true });
  assert.equal(forced.creates.length, 1);
  assert.equal(forced.appDeleted.length, 0);
});

test('computeSyncPlan — suppression locale : ligne intacte supprimée, ligne modifiée dans l’app protégée', () => {
  // Ligne identique à l'instantané → suppression normale.
  const plan = computeSyncPlan([], [entry({ synced: snapshot() })], [row()]);
  assert.equal(plan.deletes.length, 1);
  assert.equal(plan.protectedDeletes.length, 0);

  // Ligne modifiée dans l'app depuis la dernière sync → protégée.
  const edited = computeSyncPlan(
    [],
    [entry({ synced: snapshot() })],
    [row({ style: 'Cha-cha', bpm: 31 })],
  );
  assert.equal(edited.deletes.length, 0);
  assert.equal(edited.protectedDeletes.length, 1);
  assert.deepEqual(
    edited.protectedDeletes[0].fields.map((f) => f.column),
    ['style', 'bpm'],
  );

  // --force : la suppression passe quand même.
  const forced = computeSyncPlan([], [entry({ synced: snapshot() })], [row({ style: 'Cha-cha' })], {
    force: true,
  });
  assert.equal(forced.deletes.length, 1);
});

test('computeSyncPlan — ligne orpheline gérée par l’outil (sans entrée locale) : supprimée', () => {
  const plan = computeSyncPlan([], [], [row()]);
  assert.equal(plan.deletes.length, 1);
  assert.equal(plan.deletes[0].id, 'row-1');
});

test('computeSyncPlan — adoption d’une ligne préexistante : métadonnées app conservées, fichiers outil', () => {
  // Ligne issue d'une ancienne ingestion (jobId BullMQ) : même sourceKey.
  const preexisting = row({
    jobId: 'bullmq-123',
    title: 'Titre corrigé dans l’app',
    bpm: 50,
    filename: 'ancien-fichier.mp3',
    artwork: null,
  });
  const plan = computeSyncPlan([entry()], [], [preexisting]);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.adoptions.length, 1);
  // Métadonnées (éditables dans l'app) : la base fait foi → rapatriées.
  assert.deepEqual(plan.adoptions[0].pull, {
    title: 'Titre corrigé dans l’app',
    bpm: 50,
  });
  // Fichiers : l'outil fait foi → poussés en base.
  assert.deepEqual(plan.adoptions[0].push, {
    filename: '01-SAMBA ｜ Artist - Title (52 MPM).mp3',
    artwork: '01-SAMBA ｜ Artist - Title (52 MPM).jpg',
  });
});

test('computeSyncPlan — ligne non marquée SANS entrée locale : jamais touchée (ex. seeds)', () => {
  const unmarked = row({ jobId: 'bullmq-123' });
  const plan = computeSyncPlan([], [], [unmarked]);
  assert.equal(plan.deletes.length, 0);
  assert.equal(plan.adoptions.length, 0);
});

test('computeSyncPlan — entrée sans sourceKey : signalée, pas synchronisée', () => {
  const plan = computeSyncPlan([entry({ sourceKey: null })], [], []);
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.unsyncable.length, 1);
});

test('computeSyncPlan — dédup métier : création ignorée si (artiste + titre) déjà en base', () => {
  const signatures = new Map([
    ['artist|title', { id: 'app-row', title: 'Title', artist: 'Artist' }],
  ]);
  const plan = computeSyncPlan([entry()], [], [], { librarySignatures: signatures });
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].match.id, 'app-row');

  const allowed = computeSyncPlan([entry()], [], [], {
    librarySignatures: signatures,
    allowDuplicates: true,
  });
  assert.equal(allowed.creates.length, 1);
  assert.equal(allowed.duplicates.length, 0);
});

test('computeSyncPlan — dédup métier entre deux créations du même plan', () => {
  const a = entry();
  const b = entry({ sourceKey: 'youtube:xyz12345678', filename: 'autre.mp3' });
  const plan = computeSyncPlan([a, b], [], []);
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.duplicates.length, 1);
});
