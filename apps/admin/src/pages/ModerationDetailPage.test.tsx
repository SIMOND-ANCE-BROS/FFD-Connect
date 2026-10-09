import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { ModerationDetailPage } from './ModerationDetailPage';

const pendingMpm = {
  id: 'c1',
  trackId: 't1',
  reason: 'MPM',
  status: 'PENDING',
  proposed: { title: null, artist: null, style: null, bpm: 62, clashTimecodes: null },
  message: 'Compté au métronome',
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-10-06T10:00:00.000Z',
  track: {
    id: 't1',
    title: 'España Cañí',
    artist: 'Orchestre',
    style: 'Paso Doble',
    bpm: 60,
    clashTimecodes: [40, 80],
    titleMasked: false,
    blacklisted: false,
    filename: 'España Cañí.mp3',
  },
  resultingBpm: 62,
  proposer: { id: 'u1', name: 'Eva Martin' },
  reviewer: null,
};

const pendingClash = {
  ...pendingMpm,
  reason: 'PASO_CLASH',
  proposed: { title: null, artist: null, style: null, bpm: null, clashTimecodes: [40] },
  resultingBpm: 60,
};

const decided = (status: 'APPROVED' | 'REJECTED', base: object = pendingMpm) => ({
  ...base,
  status,
  reviewer: { id: 'a1', name: 'Gabin S' },
  reviewedAt: '2026-10-07T09:30:00.000Z',
  reviewComment: 'Valeur incorrecte',
});

const ok = (data: unknown) => ({ data, error: undefined });

function Probe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(item: object, path = '/moderation/c1') {
  const findOne = vi
    .spyOn(sdk, 'trackCorrectionsControllerFindOne')
    .mockResolvedValue(ok(item) as never);
  vi.spyOn(sdk, 'trackCorrectionsControllerPendingCount').mockResolvedValue(
    ok({ count: 1 }) as never,
  );
  const view = render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/moderation/:id"
              element={
                <>
                  <ModerationDetailPage />
                  <Probe />
                </>
              }
            />
            <Route path="/moderation" element={<Probe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...view, findOne };
}

const audioOf = (container: HTMLElement) => container.querySelector('audio') as HTMLAudioElement;

const setTime = (audio: HTMLAudioElement, seconds: number) =>
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    writable: true,
    value: seconds,
  });

async function submitDecision(decision: 'Approuver' | 'Refuser') {
  await userEvent.click(screen.getByRole('button', { name: decision }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
  return dialog;
}

describe('ModerationDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('plays the track file cross-origin from the API origin and shows current vs proposed', async () => {
    const { container } = renderPage(pendingMpm);
    expect(await screen.findByRole('heading', { name: 'España Cañí' })).toBeInTheDocument();
    const audio = audioOf(container);
    expect(audio).toHaveAttribute('src', `${API_ORIGIN}/uploads/Espa%C3%B1a%20Ca%C3%B1%C3%AD.mp3`);
    expect(audio).toHaveAttribute('crossorigin', 'anonymous');
    expect(audio.getAttribute('src')).not.toContain('/api/v');
    expect(screen.getByText('Compté au métronome')).toBeInTheDocument();
    expect(screen.getByText(/Eva Martin/)).toBeInTheDocument();
    setTime(audio, 83.46);
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('Position : 1:23.5')).toBeInTheDocument();
  });

  it('approves with an adjusted MPM after a before → after confirmation', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED')) as never);
    renderPage(pendingMpm);
    const mpm = await screen.findByLabelText('MPM');
    await userEvent.clear(mpm);
    await userEvent.type(mpm, '61');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('MPM');
    expect(dialog).toHaveTextContent('60');
    expect(dialog).toHaveTextContent('61');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { bpm: 61 } });
    expect(await screen.findByText(/Traitée par Gabin S/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proposition suivante' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it('leaves untouched values to the proposal', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED')) as never);
    renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    await submitDecision('Approuver');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: {} });
  });

  it('rejects with a template, still editable', async () => {
    const reject = vi
      .spyOn(sdk, 'trackCorrectionsControllerReject')
      .mockResolvedValue(ok(decided('REJECTED')) as never);
    renderPage(pendingMpm);
    await userEvent.click(await screen.findByRole('button', { name: 'Valeur incorrecte' }));
    const comment = screen.getByLabelText(/^Commentaire/);
    expect(comment).toHaveValue('Valeur incorrecte');
    await userEvent.type(comment, ' : 60 est juste');
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('La musique ne sera pas modifiée.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(reject).toHaveBeenCalledWith({
      path: { id: 'c1' },
      body: { comment: 'Valeur incorrecte : 60 est juste' },
    });
  });

  it('places a clash from the player time and sends the list', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingClash)) as never);
    const { container } = renderPage(pendingClash);
    await screen.findByLabelText('Clash 1');
    setTime(audioOf(container), 83.46);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(screen.getByLabelText('Clash 2')).toHaveValue('1:23.5');
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('0:40, 1:23.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(approve).toHaveBeenCalledWith({
      path: { id: 'c1' },
      body: { clashTimecodes: [40, 83.5] },
    });
  });

  it('sends an emptied clash list as « no clash »', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingClash)) as never);
    renderPage(pendingClash);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le clash 1' }));
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
    await submitDecision('Approuver');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { clashTimecodes: [] } });
  });

  it('refuses a 4th clash in the editor', async () => {
    const { container } = renderPage(pendingMpm);
    await screen.findByLabelText('Clash 2');
    setTime(audioOf(container), 100);
    await userEvent.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(screen.getByRole('button', { name: 'Marquer ici' })).toBeDisabled();
    expect(screen.getByText('3 clashes au maximum')).toBeInTheDocument();
  });

  it('sends a single decision while one is pending, whatever the admin clicks', async () => {
    // Stays pending, like a decision sent during a cold start.
    const reject = vi
      .spyOn(sdk, 'trackCorrectionsControllerReject')
      .mockReturnValue(new Promise(() => undefined) as never);
    const approve = vi.spyOn(sdk, 'trackCorrectionsControllerApprove');
    renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    const dialog = await submitDecision('Refuser');
    await waitFor(() => expect(reject).toHaveBeenCalledTimes(1));
    // Neither Escape nor « Annuler » closes the modal while the request runs.
    await userEvent.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(screen.getByRole('button', { name: 'Refuser', hidden: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approuver', hidden: true })).toBeDisabled();
    expect(reject).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
  });

  it('says « Déjà traitée » on a 409 and reloads the proposal', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerApprove').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'Cette proposition a déjà été traitée.' },
      response: new Response(null, { status: 409 }),
    } as never);
    const { findOne } = renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    // First load done: the reload after the 409 sees the other admin's decision.
    findOne.mockResolvedValue(ok(decided('APPROVED')) as never);
    await submitDecision('Approuver');
    expect(await screen.findByText('Déjà traitée')).toBeInTheDocument();
    expect(await screen.findByText(/Traitée par Gabin S/)).toBeInTheDocument();
    await waitFor(() => expect(findOne).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
  });

  it('shows a decided proposal read-only', async () => {
    renderPage(decided('REJECTED'));
    expect(await screen.findByText('Refusée')).toBeInTheDocument();
    expect(screen.getByText(/Traitée par Gabin S le 07\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Commentaire : Valeur incorrecte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approuver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refuser' })).toBeNull();
    expect(screen.queryByLabelText('MPM')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Proposition suivante' })).toBeNull();
  });

  it('« Proposition suivante » opens the oldest pending one matching the filters', async () => {
    const next = { ...pendingMpm, id: 'c2' };
    vi.spyOn(sdk, 'trackCorrectionsControllerReject').mockResolvedValue(
      ok(decided('REJECTED')) as never,
    );
    const list = vi
      .spyOn(sdk, 'trackCorrectionsControllerList')
      .mockResolvedValue(
        ok({ data: [next], meta: { total: 1, skip: 0, take: 1, hasMore: false } }) as never,
      );
    const { findOne } = renderPage(pendingMpm, '/moderation/c1?status=REJECTED&reason=MPM&q=paso');
    findOne.mockImplementation((({ path }: { path: { id: string } }) =>
      Promise.resolve(ok(path.id === 'c1' ? pendingMpm : next))) as never);
    await screen.findByLabelText('MPM');
    await submitDecision('Refuser');
    await userEvent.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
    expect(list).toHaveBeenCalledWith({
      query: { status: 'PENDING', reason: ['MPM'], q: 'paso', skip: 0, take: 1 },
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/moderation/c2?status=REJECTED&reason=MPM&q=paso',
      ),
    );
    expect(await screen.findByRole('button', { name: 'Approuver' })).toBeInTheDocument();
  });

  it('goes back to the list when nothing is pending anymore', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerReject').mockResolvedValue(
      ok(decided('REJECTED')) as never,
    );
    vi.spyOn(sdk, 'trackCorrectionsControllerList').mockResolvedValue(
      ok({ data: [], meta: { total: 0, skip: 0, take: 1, hasMore: false } }) as never,
    );
    renderPage(pendingMpm, '/moderation/c1?reason=MPM');
    await screen.findByLabelText('MPM');
    await submitDecision('Refuser');
    await userEvent.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/moderation?reason=MPM'),
    );
  });

  it('shows a masked title for real, flagged « Titre masqué »', async () => {
    renderPage({ ...pendingMpm, track: { ...pendingMpm.track, titleMasked: true } });
    expect(await screen.findByRole('heading', { name: 'España Cañí' })).toBeInTheDocument();
    expect(screen.getByText('Titre masqué')).toBeInTheDocument();
  });

  it('shows the shared message when the server is unreachable', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerFindOne').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    render(
      <MantineProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/moderation/c1']}>
            <Routes>
              <Route path="/moderation/:id" element={<ModerationDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });
});
