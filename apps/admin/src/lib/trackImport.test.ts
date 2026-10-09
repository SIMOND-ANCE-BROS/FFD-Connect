import { JPEG_BYTES, mp3Bytes, mp3File, pictureFrame, textFrame } from '../test/id3Fixture';
import { readId3 } from './id3';
import {
  buildRow,
  canonicalStyle,
  findExisting,
  type ImportRow,
  importSummary,
  isSendable,
  MAX_ARTWORK_BYTES,
  MAX_AUDIO_BYTES,
  markBatchDuplicates,
  parseManifest,
  parseTrackPrepName,
  rowIssue,
  runPool,
  sortFiles,
  summaryText,
  uploadBody,
  uploadOutcome,
  withStyle,
  withUniqueKeys,
} from './trackImport';

const sources = {
  readTags: readId3,
  hash: (file: Blob) => Promise.resolve(`h-${(file as File).name}`),
};

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  key: 'a.mp3',
  file: new File(['x'], 'a.mp3'),
  artwork: null,
  title: 'T',
  artist: 'A',
  style: 'Rumba',
  mpm: '',
  mpmTouched: false,
  sha256: 'h1',
  existing: null,
  batchDuplicate: false,
  skip: false,
  state: 'idle',
  ...overrides,
});

const json = (value: unknown, name = 'manifest.json') =>
  new File([JSON.stringify(value)], name, { type: 'application/json' });

describe('manifest.json', () => {
  it('indexes the version 1 tracks by file name, normalised to NFC', () => {
    const manifest = parseManifest(
      JSON.stringify({
        version: 1,
        tracks: [
          {
            filename: 'Cañí.mp3'.normalize('NFD'),
            artwork: 'Cañí.jpg',
            title: 'España Cañí',
            artist: 'Orquesta',
            style: 'Paso Doble',
            rawBpm: 123.6,
            mpm: 62,
            sourceKey: 'apple:7',
            sourceUrl: 'https://example.test',
          },
          { title: 'no file name' },
        ],
      }),
    );
    expect(manifest?.size).toBe(1);
    expect(manifest?.get('Cañí.mp3')).toEqual({
      filename: 'Cañí.mp3'.normalize('NFD'),
      artwork: 'Cañí.jpg',
      title: 'España Cañí',
      artist: 'Orquesta',
      style: 'Paso Doble',
      rawBpm: 123.6,
      mpm: 62,
      sourceKey: 'apple:7',
    });
  });

  it('refuses anything that is not a version 1 manifest', () => {
    expect(parseManifest('{not json')).toBeNull();
    expect(parseManifest(JSON.stringify({ version: 2, tracks: [] }))).toBeNull();
    expect(parseManifest(JSON.stringify({ version: 1 }))).toBeNull();
  });
});

describe('track-prep file names', () => {
  it('reads dance, artist, title and MPM, with the fullwidth separator', () => {
    expect(parseTrackPrepName('01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).mp3')).toEqual({
      style: 'Jive',
      artist: 'Empress Orchestra',
      title: 'In the Mood',
      mpm: 42,
    });
    expect(
      parseTrackPrepName('02-JIVE ｜ DJ Maksy - On Ira (Jive 43bpm) (43 MPM).mp3'),
    ).toMatchObject({
      title: 'On Ira (Jive 43bpm)',
      mpm: 43,
    });
  });

  it('accepts the ASCII bar, a raw BPM, an unknown dance and no tempo', () => {
    expect(parseTrackPrepName('07-AUTRE | Artiste - Titre (124 BPM).mp3')).toEqual({
      style: null,
      artist: 'Artiste',
      title: 'Titre',
      rawBpm: 124,
    });
    expect(parseTrackPrepName('03-VALSE LENTE ｜ A – B - C.mp3')).toEqual({
      style: 'Valse Lente',
      artist: 'A – B',
      title: 'C',
    });
  });

  it('ignores any other name', () => {
    expect(parseTrackPrepName('Ma chanson.mp3')).toBeNull();
    expect(parseTrackPrepName('01-JIVE - Artiste - Titre.mp3')).toBeNull();
  });

  it('maps a dance written any way to its canonical label', () => {
    expect(canonicalStyle('VALSE VIENNOISE')).toBe('Valse Viennoise');
    expect(canonicalStyle('cha cha cha')).toBe('Cha-cha');
    expect(canonicalStyle(' ambiance ')).toBe('Ambiance');
    expect(canonicalStyle('AUTRE')).toBeNull();
    expect(canonicalStyle(undefined)).toBeNull();
  });
});

describe('building the rows', () => {
  it('sorts the dropped files: MP3s by name, images, manifest, others ignored', async () => {
    const picked = await sortFiles([
      new File(['x'], 'b.mp3'),
      new File(['x'], 'notes.txt'),
      new File(['x'], '.DS_Store'),
      new File(['x'], 'a.MP3'),
      new File(['x'], 'a.jpg'),
      json({ version: 1, tracks: [] }),
    ]);
    expect(picked.audio.map((f) => f.name)).toEqual(['a.MP3', 'b.mp3']);
    expect([...picked.images.keys()]).toEqual(['a.jpg']);
    expect(picked.manifest?.size).toBe(0);
    expect(picked.manifestInvalid).toBe(false);
    expect(picked.ignored).toEqual(['notes.txt']);
    const broken = new File(['{oops'], 'manifest.json');
    expect((await sortFiles([broken])).manifestInvalid).toBe(true);
  });

  it('takes everything from the manifest when it lists the file', async () => {
    const audio = new File(['x'], '01-JIVE ｜ E - M (42 MPM).mp3');
    const cover = new File(['x'], '01.jpg');
    const picked = await sortFiles([
      audio,
      cover,
      json({
        version: 1,
        tracks: [
          {
            filename: audio.name,
            artwork: '01.jpg',
            title: 'In the Mood',
            artist: 'Empress Orchestra',
            style: 'Jive',
            rawBpm: 169.64,
            mpm: 42,
            sourceKey: 'apple:1',
          },
        ],
      }),
    ]);
    expect(await buildRow(audio, picked, sources)).toMatchObject({
      key: audio.name,
      title: 'In the Mood',
      artist: 'Empress Orchestra',
      style: 'Jive',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
      artwork: cover,
      sha256: `h-${audio.name}`,
      state: 'idle',
    });
  });

  it('falls back to the ID3 tags, then the file name, and the embedded cover', async () => {
    const bytes = mp3Bytes([
      textFrame('TIT2', 'Banto'),
      textFrame('TCON', 'Samba'),
      pictureFrame('image/jpeg', JPEG_BYTES),
    ]);
    const audio = mp3File('05-SAMBA ｜ DJ Maksy - Banto (Samba 51) (51 MPM).mp3', bytes);
    const built = await buildRow(audio, await sortFiles([audio]), sources);
    expect(built).toMatchObject({ title: 'Banto', artist: 'DJ Maksy', style: 'Samba', mpm: 51 });
    expect(built.rawBpm).toBeUndefined();
    expect(built.sourceKey).toBeUndefined();
    expect(built.artwork?.type).toBe('image/jpeg');
  });

  it('prefers a sibling image to the embedded cover, and ignores an artwork over 2 MB', async () => {
    const audio = mp3File('song.mp3', mp3Bytes([pictureFrame('image/jpeg', JPEG_BYTES)]));
    const sibling = new File(['x'], 'song.jpg');
    expect((await buildRow(audio, await sortFiles([audio, sibling]), sources)).artwork).toBe(
      sibling,
    );
    const huge = new File([new Uint8Array(MAX_ARTWORK_BYTES + 1)], 'song.png');
    const built = await buildRow(audio, await sortFiles([audio, huge]), sources);
    expect(built.artwork).not.toBe(huge);
    expect(built.artwork?.type).toBe('image/jpeg');
  });

  it('uses the bare file name as title when nothing else matches', async () => {
    const audio = new File(['not an mp3 tag'], 'Ma chanson.mp3');
    expect(await buildRow(audio, await sortFiles([audio]), sources)).toMatchObject({
      title: 'Ma chanson',
      artist: '',
      style: '',
      mpm: '',
    });
  });
});

describe('row statuses', () => {
  it('flags duplicates first, then the size, then the missing fields', () => {
    const big = new File(['x'], 'big.mp3');
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    expect(rowIssue(row())).toBeNull();
    expect(rowIssue(row({ existing: { trackId: 't1' }, title: '' }))).toBe('duplicate');
    expect(rowIssue(row({ batchDuplicate: true }))).toBe('batch-duplicate');
    expect(rowIssue(row({ file: big }))).toBe('too-big');
    expect(rowIssue(row({ title: '  ' }))).toBe('missing-title');
    expect(rowIssue(row({ artist: '' }))).toBe('missing-artist');
    expect(rowIssue(row({ style: '' }))).toBe('missing-dance');
  });

  it('sends only the ready rows that are neither skipped nor done', () => {
    expect(isSendable(row())).toBe(true);
    expect(isSendable(row({ state: 'failed' }))).toBe(true);
    expect(isSendable(row({ skip: true }))).toBe(false);
    expect(isSendable(row({ state: 'done' }))).toBe(false);
    expect(isSendable(row({ style: '' }))).toBe(false);
  });

  it('keeps the row keys unique when two dropped sub-folders hold the same file name', () => {
    const keys = withUniqueKeys([
      row({ key: 'a.mp3' }),
      row({ key: 'a.mp3' }),
      row({ key: 'b.mp3' }),
    ]);
    expect(keys.map((r) => r.key)).toEqual(['a.mp3', 'a.mp3 (2)', 'b.mp3']);
  });

  it('flags the second copy of a file or of a source in the batch', () => {
    const marked = markBatchDuplicates([
      row({ key: 'a', sha256: 'h1', sourceKey: 'apple:1' }),
      row({ key: 'b', sha256: 'h1' }),
      row({ key: 'c', sha256: 'h3', sourceKey: 'apple:1' }),
      row({ key: 'd', sha256: 'h4' }),
    ]);
    expect(marked.map((r) => r.batchDuplicate)).toEqual([false, true, true, false]);
  });
});

describe('dance change in the table', () => {
  it('recomputes the MPM from the raw tempo, as the server would', () => {
    expect(withStyle(row({ style: 'Samba', rawBpm: 100, mpm: 50 }), 'Rumba')).toMatchObject({
      style: 'Rumba',
      mpm: 25,
    });
    expect(withStyle(row({ style: 'Samba', rawBpm: 123.6, mpm: 62 }), '')).toMatchObject({
      mpm: 124,
    });
  });

  it('keeps a typed MPM, and drops a file-name MPM without raw tempo (the server analyses)', () => {
    expect(withStyle(row({ rawBpm: 100, mpm: 30, mpmTouched: true }), 'Rumba')).toMatchObject({
      mpm: 30,
    });
    expect(withStyle(row({ mpm: 51 }), 'Rumba')).toMatchObject({ mpm: '' });
  });
});

describe('duplicate check', () => {
  it('asks by batches of 200 and maps the hits to their rows', async () => {
    const rows = Array.from({ length: 450 }, (_, i) =>
      row({ key: `r${i}`, sha256: `h${i}`, ...(i === 0 && { sourceKey: 'apple:0' }) }),
    );
    const check = vi.fn(async (items: { sha256: string; sourceKey?: string }[]) =>
      items.map((item) =>
        item.sha256 === 'h0' || item.sha256 === 'h449'
          ? { exists: true, trackId: `t-${item.sha256}` }
          : { exists: false },
      ),
    );
    const found = await findExisting(rows, check);
    expect(check.mock.calls.map(([items]) => items.length)).toEqual([200, 200, 50]);
    expect(check.mock.calls[0][0][0]).toEqual({ sha256: 'h0', sourceKey: 'apple:0' });
    expect(check.mock.calls[0][0][1]).toEqual({ sha256: 'h1' });
    expect([...found.entries()]).toEqual([
      ['r0', 't-h0'],
      ['r449', 't-h449'],
    ]);
  });
});

describe('upload', () => {
  it('sends the files and the filled fields only', () => {
    const cover = new Blob(['x'], { type: 'image/jpeg' });
    const r = row({ artwork: cover, mpm: 42, rawBpm: 169.64, sourceKey: 'apple:1', title: ' T ' });
    expect(uploadBody(r)).toEqual({
      audio: r.file,
      artwork: cover,
      title: 'T',
      artist: 'A',
      style: 'Rumba',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
      sha256: 'h1',
    });
    expect(uploadBody(row({ style: '' }))).toEqual({
      audio: expect.any(File),
      title: 'T',
      artist: 'A',
      sha256: 'h1',
    });
  });

  it('turns each answer into an outcome', () => {
    expect(uploadOutcome({ data: { id: 't1' } })).toEqual({ state: 'done', trackId: 't1' });
    expect(uploadOutcome({ error: { statusCode: 409, existingTrackId: 't9' } })).toEqual({
      state: 'duplicate',
      trackId: 't9',
    });
    expect(uploadOutcome({ error: { statusCode: 409 } })).toEqual({ state: 'duplicate' });
    expect(uploadOutcome({ error: { statusCode: 413, message: 'File too large' } })).toEqual({
      state: 'failed',
      error: 'Fichier trop volumineux (MP3 : 20 Mo, pochette : 2 Mo au plus).',
    });
    expect(uploadOutcome({ error: new TypeError('Failed to fetch') })).toEqual({
      state: 'failed',
      error: 'Serveur injoignable, réessayez dans un instant.',
    });
    expect(
      uploadOutcome({ error: { statusCode: 400, message: "Le fichier audio n'est pas un MP3." } }),
    ).toEqual({
      state: 'failed',
      error: "Le fichier audio n'est pas un MP3.",
    });
  });

  it('never runs more uploads at once than the limit, and runs them all', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5 * (6 - n)));
      inFlight -= 1;
      done.push(n);
    });
    expect(peak).toBe(2);
    expect([...done].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('sums up the import, skipped rows aside', () => {
    const summary = importSummary([
      row({ state: 'done' }),
      row({ state: 'done' }),
      row({ existing: { trackId: 't1' } }),
      row({ batchDuplicate: true }),
      row({ state: 'failed', error: 'x' }),
      row({ skip: true, state: 'failed' }),
      row(),
    ]);
    expect(summary).toEqual({ imported: 2, duplicates: 2, failed: 1 });
    expect(summaryText(summary)).toBe('2 importées, 2 doublons, 1 échecs');
  });
});
