import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { JPEG_BYTES, mp3Bytes, mp3File, textFrame } from '../test/id3Fixture';
import { TrackImportPage } from './TrackImportPage';

const ok = (data: unknown) => ({ data, error: undefined });
const failure = (error: unknown) => ({ data: undefined, error });

type CreateOptions = { body: { title: string } & Record<string, unknown> };

function renderPage() {
  return render(
    // env="test": no transitions, so the Select dropdown opens synchronously in jsdom.
    <MantineProvider env="test">
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TrackImportPage />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const pick = (files: File[]) =>
  fireEvent.change(screen.getByTestId('files-input'), { target: { files } });

/** An MP3 tagged like track-prep does; the name salts the bytes (distinct hashes). */
const tagged = (name: string, title: string, artist: string, genre?: string) =>
  mp3File(
    name,
    mp3Bytes(
      [
        textFrame('TIT2', title),
        textFrame('TPE1', artist),
        ...(genre ? [textFrame('TCON', genre)] : []),
      ],
      3,
      name,
    ),
  );

const importButton = () => screen.getByRole('button', { name: 'Importer' });

const checkAnswers = (...items: object[]) =>
  vi.spyOn(sdk, 'adminTracksControllerCheck').mockResolvedValue(ok({ items }) as never);

const createImpl = (impl: (options: CreateOptions) => unknown) =>
  vi
    .spyOn(sdk, 'adminTracksControllerCreate')
    .mockImplementation((async (options: CreateOptions) => impl(options)) as never);

describe('TrackImportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pre-fills from a track-prep manifest, checks duplicates and imports the ready rows', async () => {
    const names = [
      '01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).mp3',
      '02-SAMBA ｜ DJ Maksy - Banto (51 MPM).mp3',
      '03-RUMBA ｜ Ana - Luz (25 MPM).mp3',
    ];
    const audio = names.map((name) => mp3File(name, mp3Bytes([], 3, name)));
    const cover = new File(
      [Uint8Array.from(JPEG_BYTES)],
      '01-JIVE ｜ Empress Orchestra - In the Mood (42 MPM).jpg',
      {
        type: 'image/jpeg',
      },
    );
    const manifest = new File(
      [
        JSON.stringify({
          version: 1,
          tracks: [
            {
              filename: names[0],
              artwork: cover.name,
              title: 'In the Mood',
              artist: 'Empress Orchestra',
              style: 'Jive',
              rawBpm: 169.64,
              mpm: 42,
              sourceKey: 'apple:1',
            },
            {
              filename: names[1],
              artwork: null,
              title: 'Banto',
              artist: 'DJ Maksy',
              style: 'Samba',
              rawBpm: 102,
              mpm: 51,
              sourceKey: 'apple:2',
            },
            {
              filename: names[2],
              artwork: null,
              title: 'Luz',
              artist: 'Ana',
              style: 'Rumba',
              rawBpm: 100,
              mpm: 25,
              sourceKey: 'apple:3',
            },
          ],
        }),
      ],
      'manifest.json',
      { type: 'application/json' },
    );
    const check = checkAnswers(
      { exists: false },
      { exists: true, trackId: 't-old' },
      { exists: false },
    );
    const create = createImpl((options) => ok({ id: `new-${options.body.title}` }));
    renderPage();

    pick([manifest, cover, ...audio]);

    expect(await screen.findAllByText('✅ Prête')).toHaveLength(2);
    expect(screen.getByText('⛔ Doublon')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/tracks/t-old');
    expect(screen.getByLabelText(`Titre — ${names[0]}`)).toHaveValue('In the Mood');
    expect((check.mock.calls[0][0] as { body: { items: unknown[] } }).body.items).toEqual([
      { sha256: expect.stringMatching(/^[0-9a-f]{64}$/), sourceKey: 'apple:1' },
      expect.objectContaining({ sourceKey: 'apple:2' }),
      expect.objectContaining({ sourceKey: 'apple:3' }),
    ]);

    await userEvent.click(importButton());

    expect(await screen.findByText('2 importées, 1 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
    const bodies = create.mock.calls.map(([options]) => (options as CreateOptions).body);
    expect(bodies[0]).toMatchObject({
      title: 'In the Mood',
      artist: 'Empress Orchestra',
      style: 'Jive',
      mpm: 42,
      rawBpm: 169.64,
      sourceKey: 'apple:1',
    });
    expect(bodies[0].audio).toBe(audio[0]);
    expect(bodies[0].artwork).toBe(cover);
    expect(bodies[1]).toMatchObject({ title: 'Luz', sourceKey: 'apple:3' });
    expect(bodies[1]).not.toHaveProperty('artwork');
  });

  it('falls back to the tags and the file name, and waits for a dance', async () => {
    checkAnswers({ exists: false });
    renderPage();

    pick([mp3File('Ma chanson.mp3', mp3Bytes([textFrame('TPE1', 'Orchestre')]))]);

    expect(await screen.findByText('⚠️ Danse manquante')).toBeInTheDocument();
    expect(screen.getByLabelText('Titre — Ma chanson.mp3')).toHaveValue('Ma chanson');
    expect(screen.getByLabelText('Artiste — Ma chanson.mp3')).toHaveValue('Orchestre');
    await waitFor(() => expect(screen.getByText('0 musique prête à importer')).toBeInTheDocument());
    expect(importButton()).toBeDisabled();

    await userEvent.click(screen.getByLabelText('Danse — Ma chanson.mp3', { selector: 'input' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Rumba' }));

    expect(await screen.findByText('✅ Prête')).toBeInTheDocument();
    expect(importButton()).toBeEnabled();
  });

  it('flags a file present twice in the batch', async () => {
    const bytes = mp3Bytes([
      textFrame('TIT2', 'Same'),
      textFrame('TPE1', 'A'),
      textFrame('TCON', 'Jive'),
    ]);
    checkAnswers({ exists: false }, { exists: false });
    renderPage();

    pick([mp3File('a.mp3', bytes), mp3File('b.mp3', bytes)]);

    expect(await screen.findByText('⛔ Doublon dans le lot')).toBeInTheDocument();
    expect(screen.getAllByText('✅ Prête')).toHaveLength(1);
  });

  it('reports each failure with its reason and retries the failures only', async () => {
    checkAnswers({ exists: false }, { exists: false });
    let firstTry = true;
    const create = createImpl((options) => {
      if (options.body.title === 'A' && firstTry) {
        firstTry = false;
        return failure({ statusCode: 500, message: 'Erreur interne' });
      }
      return ok({ id: `new-${options.body.title}` });
    });
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba'), tagged('b.mp3', 'B', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(importButton());

    expect(await screen.findByText('1 importées, 0 doublons, 1 échecs')).toBeInTheDocument();
    expect(screen.getByText('a.mp3 : Erreur interne')).toBeInTheDocument();
    expect(screen.getByText('⛔ Échec : Erreur interne')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Réessayer les échecs' }));

    expect(await screen.findByText('2 importées, 0 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(3);
    expect((create.mock.calls[2][0] as CreateOptions).body.title).toBe('A');
  });

  it('treats a saturated tempo analysis (503) as a failure the retry re-sends', async () => {
    checkAnswers({ exists: false });
    let firstTry = true;
    const create = createImpl((options) => {
      if (firstTry) {
        firstTry = false;
        return failure({
          statusCode: 503,
          message: 'Analyse du tempo saturée, réessayez dans un instant.',
        });
      }
      return ok({ id: `new-${options.body.title}` });
    });
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(importButton());

    expect(await screen.findByText('0 importées, 0 doublons, 1 échecs')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer les échecs' }));

    expect(await screen.findByText('1 importées, 0 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('counts a 409 during the send as a duplicate, with a link to the existing track', async () => {
    checkAnswers({ exists: false });
    createImpl(() =>
      failure({
        statusCode: 409,
        message: 'Cette musique est déjà dans la bibliothèque.',
        existingTrackId: 't9',
      }),
    );
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(importButton());

    expect(await screen.findByText('0 importées, 1 doublons, 0 échecs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir' })).toHaveAttribute('href', '/tracks/t9');
  });

  it('never sends a skipped row', async () => {
    checkAnswers({ exists: false }, { exists: false });
    const create = createImpl((options) => ok({ id: `new-${options.body.title}` }));
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba'), tagged('b.mp3', 'B', 'X', 'Rumba')]);
    await waitFor(() => expect(importButton()).toBeEnabled());

    await userEvent.click(screen.getByLabelText('Ignorer b.mp3'));
    await userEvent.click(importButton());

    expect(await screen.findByText('1 importées, 0 doublons, 0 échecs')).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as CreateOptions).body.title).toBe('A');
  });

  it('keeps the import closed until the duplicate check answered', async () => {
    const check = vi
      .spyOn(sdk, 'adminTracksControllerCheck')
      .mockResolvedValueOnce(failure(new TypeError('Failed to fetch')) as never)
      .mockResolvedValueOnce(ok({ items: [{ exists: false }] }) as never);
    renderPage();
    pick([tagged('a.mp3', 'A', 'X', 'Rumba')]);

    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
    expect(importButton()).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Vérifier à nouveau' }));

    await waitFor(() => expect(importButton()).toBeEnabled());
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('accepts files dropped on the zone', async () => {
    checkAnswers({ exists: false });
    renderPage();

    fireEvent.drop(screen.getByTestId('drop-zone'), {
      dataTransfer: { files: [tagged('a.mp3', 'A', 'X', 'Rumba')], items: [] },
    });

    expect(await screen.findByText('✅ Prête')).toBeInTheDocument();
  });

  it('offers the folder and file pickers as real buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Choisir un dossier' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choisir des fichiers' })).toBeEnabled();
    expect(screen.getByTestId('folder-input')).toHaveAttribute('webkitdirectory');
  });
});
