import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { TrackDetailPage } from './TrackDetailPage';

const base = {
  id: 't1',
  title: 'España Cañí',
  artist: 'Orchestre',
  style: 'Samba',
  bpm: 50,
  rawBpm: 100,
  clashTimecodes: [],
  titleMasked: false,
  blacklisted: false,
  status: 'READY',
  sourceKey: 'apple:1',
  filename: 'España Cañí.mp3',
  artwork: 'cover é.jpg',
  createdAt: '2026-10-09T10:00:00.000Z',
  pendingCorrections: 0,
};

const ok = (data: unknown) => ({
  data,
  error: undefined,
  response: new Response('{}', { status: 200 }),
});

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(track: object = base) {
  vi.spyOn(sdk, 'adminTracksControllerFindOne').mockResolvedValue(ok(track) as never);
  vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue(
    ok({ data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } }) as never,
  );
  return render(
    // env="test": no transitions, so the Select dropdown opens synchronously in jsdom.
    <MantineProvider env="test">
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/tracks/t1']}>
          <Routes>
            <Route
              path="/tracks/:id"
              element={
                <>
                  <TrackDetailPage />
                  <Probe />
                </>
              }
            />
            <Route path="/tracks" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function confirmSave() {
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirmer les modifications' });
  return dialog;
}

describe('TrackDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the track and shows its artwork from the API origin, in CORS mode', async () => {
    renderPage();
    const audio = await screen.findByLabelText('Lecteur de la musique');
    expect(audio).toHaveAttribute(
      'src',
      `${API_ORIGIN}/uploads/${encodeURIComponent('España Cañí.mp3')}`,
    );
    expect(audio).toHaveAttribute('crossorigin', 'anonymous');
    const cover = screen.getByRole('img', { name: 'Pochette' });
    expect(cover).toHaveAttribute(
      'src',
      `${API_ORIGIN}/uploads/${encodeURIComponent('cover é.jpg')}`,
    );
    // helmet's Cross-Origin-Resource-Policy blocks a no-cors image load.
    expect(cover).toHaveAttribute('crossorigin', 'anonymous');
  });

  it('previews the MPM recomputed from the raw tempo and leaves it to the server', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Danse', { selector: 'input' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Rumba' }));
    expect(screen.getByLabelText('MPM')).toHaveValue('25');
    expect(screen.getByText('Recalculé selon la danse')).toBeInTheDocument();

    const dialog = await confirmSave();
    expect(dialog).toHaveTextContent('Samba');
    expect(dialog).toHaveTextContent('Rumba');
    expect(dialog).toHaveTextContent('50');
    expect(dialog).toHaveTextContent('25');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { style: 'Rumba' } });
  });

  it('sends a typed MPM', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    const mpm = await screen.findByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '27');
    const dialog = await confirmSave();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { bpm: 27 } });
  });

  it('locks the confirmation while a save is in flight: one request, no way out', async () => {
    const update = vi
      .spyOn(sdk, 'tracksControllerUpdate')
      .mockReturnValue(new Promise(() => undefined) as never);
    renderPage();
    const mpm = await screen.findByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '27');
    const dialog = await confirmSave();
    const confirm = within(dialog).getByRole('button', { name: 'Confirmer' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(update).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Confirmer les modifications' })).toBeInTheDocument();
  });

  it('locks the deletion while it is in flight', async () => {
    const remove = vi
      .spyOn(sdk, 'tracksControllerRemove')
      .mockReturnValue(new Promise(() => undefined) as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Supprimer cette musique' })).toBeInTheDocument();
  });

  it('asks before blacklisting, and sends the flag only', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Blacklister'));
    const dialog = await screen.findByRole('dialog', { name: 'Blacklister la musique' });
    expect(dialog).toHaveTextContent("retirée de la bibliothèque de l'app");
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Blacklister' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { blacklisted: true } });
  });

  it('asks before masking the title', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    await userEvent.click(await screen.findByLabelText('Masquer le titre'));
    const dialog = await screen.findByRole('dialog', { name: 'Masquer le titre' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Masquer' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { titleMasked: true } });
  });

  it('deletes only once the title is typed, then goes back to the list', async () => {
    const remove = vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      '  españa cañí ',
    );
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith({ path: { id: 't1' } });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/tracks'));
  });

  it('suggests blacklisting when the server refuses the deletion (409)', async () => {
    vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 409,
        message:
          'Des propositions de correction sont en attente sur cette musique : traitez-les dans Modération, ou blacklistez la musique.',
        pendingCorrections: 1,
      },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(
      await within(dialog).findByText(/propositions de correction sont en attente/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Blacklister à la place' }));
    expect(
      await screen.findByRole('dialog', { name: 'Blacklister la musique' }),
    ).toBeInTheDocument();
  });

  it('blocks the deletion while proposals are pending, and links them in Modération', async () => {
    renderPage({ ...base, pendingCorrections: 2 });
    expect(await screen.findByRole('button', { name: 'Supprimer la musique' })).toBeDisabled();
    expect(
      screen.getByRole('link', { name: '2 propositions en attente dans Modération' }),
    ).toHaveAttribute('href', '/moderation?track=t1');
    expect(screen.getByRole('button', { name: 'Blacklister à la place' })).toBeEnabled();
  });

  it('publishes a track left in error once an MPM is typed', async () => {
    renderPage({ ...base, status: 'ERROR', bpm: 0, rawBpm: 0 });
    expect(await screen.findByText('Tempo non détecté')).toBeInTheDocument();
    const mpm = screen.getByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '52');
    const dialog = await confirmSave();
    expect(dialog).toHaveTextContent('En erreur');
    expect(dialog).toHaveTextContent('Prête');
  });

  it('keeps unsaved edits when a switch save refreshes the track', async () => {
    vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue(ok({}) as never);
    renderPage();
    // Every refetch after the first load answers the toggled track.
    vi.mocked(sdk.adminTracksControllerFindOne).mockResolvedValue(
      ok({ ...base, titleMasked: true }) as never,
    );
    const title = await screen.findByLabelText('Titre');
    await userEvent.clear(title);
    await userEvent.type(title, 'Nouveau titre');
    await userEvent.click(screen.getByLabelText('Masquer le titre'));
    const dialog = await screen.findByRole('dialog', { name: 'Masquer le titre' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Masquer' }));
    await waitFor(() => expect(screen.getByLabelText('Masquer le titre')).toBeChecked());
    expect(screen.getByLabelText('Titre')).toHaveValue('Nouveau titre');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('keeps unsaved edits when a refused deletion refreshes the track', async () => {
    vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'En attente', pendingCorrections: 1 },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    vi.mocked(sdk.adminTracksControllerFindOne).mockResolvedValue(
      ok({ ...base, pendingCorrections: 1 }) as never,
    );
    const title = await screen.findByLabelText('Titre');
    await userEvent.clear(title);
    await userEvent.type(title, 'Nouveau titre');
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Supprimer la musique' })).toBeDisabled(),
    );
    expect(screen.getByLabelText('Titre')).toHaveValue('Nouveau titre');
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
  });

  it('links the pending proposals from the refused deletion', async () => {
    vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'traitez-les dans Modération', pendingCorrections: 1 },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(
      await within(dialog).findByRole('link', { name: 'Voir les propositions dans Modération' }),
    ).toHaveAttribute('href', '/moderation?track=t1');
  });

  it('offers no retry of a refused deletion on a track already blacklisted', async () => {
    const remove = vi.spyOn(sdk, 'tracksControllerRemove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'En attente', pendingCorrections: 1 },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage({ ...base, blacklisted: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer la musique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Supprimer cette musique' });
    await userEvent.type(
      within(dialog).getByLabelText('Recopiez le titre pour confirmer'),
      'España Cañí',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    await userEvent.click(confirm);
    expect(
      await within(dialog).findByRole('link', { name: 'Voir les propositions dans Modération' }),
    ).toHaveAttribute('href', '/moderation?track=t1');
    expect(confirm).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Blacklister à la place' })).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('shows the shared alert when the server is unreachable', async () => {
    vi.spyOn(sdk, 'adminTracksControllerFindOne').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue(
      ok({ data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } }) as never,
    );
    render(
      <MantineProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={['/tracks/t1']}>
            <Routes>
              <Route path="/tracks/:id" element={<TrackDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(await screen.findByText(UNAVAILABLE_MESSAGE)).toBeInTheDocument();
  });
});
