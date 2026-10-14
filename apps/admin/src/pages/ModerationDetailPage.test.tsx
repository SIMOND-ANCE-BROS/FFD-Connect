import { Notifications } from '@mantine/notifications';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { API_ORIGIN } from '../config';
import { fill, renderWithProviders, setupUser } from '../test/render';
import { ModerationDetailPage } from './ModerationDetailPage';

let user: UserEvent;

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
  const view = renderWithProviders(
    <>
      <Notifications />
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
    </>,
    { route: path },
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

async function submitDecision(decision: string) {
  await user.click(screen.getByRole('button', { name: decision }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
  return dialog;
}

describe('ModerationDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('plays the track file cross-origin from the API origin and shows current vs proposed', async () => {
    const { container } = renderPage(pendingMpm);
    expect(await screen.findByRole('heading', { name: 'España Cañí' })).toBeInTheDocument();
    const audio = audioOf(container);
    expect(audio).toHaveAttribute('src', `${API_ORIGIN}/uploads/Espa%C3%B1a%20Ca%C3%B1%C3%AD.mp3`);
    expect(audio).toHaveAttribute('crossorigin', 'anonymous');
    expect(audio).toHaveAttribute('aria-label', 'Lecteur de la musique');
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
    await fill(user, mpm, '61');
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('MPM');
    expect(dialog).toHaveTextContent('60');
    expect(dialog).toHaveTextContent('61');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
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
    await user.click(await screen.findByRole('button', { name: 'Valeur incorrecte' }));
    const comment = screen.getByLabelText(/^Commentaire/);
    expect(comment).toHaveValue('Valeur incorrecte');
    await user.type(comment, ' : 60 est juste');
    await user.click(screen.getByRole('button', { name: 'Refuser' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('La musique ne sera pas modifiée.');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(reject).toHaveBeenCalledWith({
      path: { id: 'c1' },
      body: { comment: 'Valeur incorrecte : 60 est juste' },
    });
  });

  it('hides the clashes of a track that is not a paso doble (#445)', async () => {
    renderPage({ ...pendingMpm, track: { ...pendingMpm.track, style: 'Rumba' } });
    await screen.findByLabelText('MPM');
    expect(screen.queryByText('Clashes paso')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marquer ici' })).not.toBeInTheDocument();
  });

  it('shows the clashes of a paso doble, in the table and the editor', async () => {
    renderPage(pendingMpm);
    await screen.findByLabelText('MPM');
    // Table row + editor title.
    expect(screen.getAllByText('Clashes paso')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Marquer ici' })).toBeInTheDocument();
  });

  it('keeps a clash proposal decidable on a track filed under another dance', async () => {
    renderPage({ ...pendingClash, track: { ...pendingClash.track, style: 'Rumba' } });
    expect(await screen.findByLabelText('Clash 1')).toHaveValue('0:40');
    expect(screen.getAllByText('Clashes paso')).toHaveLength(2);
  });

  it('shows the clashes when the proposal turns the track into a paso doble', async () => {
    renderPage({
      ...pendingMpm,
      reason: 'DANCE',
      proposed: { ...pendingMpm.proposed, bpm: null, style: 'Paso Doble' },
      track: { ...pendingMpm.track, style: 'Rumba', clashTimecodes: [] },
    });
    await screen.findByLabelText('MPM');
    expect(screen.getByRole('button', { name: 'Marquer ici' })).toBeInTheDocument();
  });

  it('a deletion request explains the hiding and approves with no value (#446)', async () => {
    const pendingDelete = {
      ...pendingMpm,
      reason: 'DELETE',
      message: 'Doublon de la version courte',
      proposed: { title: null, artist: null, style: null, bpm: null, clashTimecodes: null },
      resultingBpm: 60,
    };
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingDelete)) as never);
    renderPage(pendingDelete);

    expect(await screen.findByText('Proposition de suppression')).toBeInTheDocument();
    expect(screen.getByText('Doublon de la version courte')).toBeInTheDocument();
    // Nothing to compare nor to edit: the request carries no value.
    expect(screen.queryByText('Valeurs à appliquer')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Proposé' })).not.toBeInTheDocument();
    // The track can still be heard before deciding.
    expect(screen.getByLabelText('Lecteur de la musique')).toBeInTheDocument();

    const dialog = await submitDecision('Approuver et retirer la musique');
    expect(dialog).toHaveTextContent('sera retirée de la bibliothèque');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: {} });
  });

  it('places a clash from the player time and sends the list', async () => {
    const approve = vi
      .spyOn(sdk, 'trackCorrectionsControllerApprove')
      .mockResolvedValue(ok(decided('APPROVED', pendingClash)) as never);
    const { container } = renderPage(pendingClash);
    await screen.findByLabelText('Clash 1');
    setTime(audioOf(container), 83.46);
    await user.click(screen.getByRole('button', { name: 'Marquer ici' }));
    expect(screen.getByLabelText('Clash 2')).toHaveValue('1:23.5');
    await user.click(screen.getByRole('button', { name: 'Approuver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('0:40, 1:23.5');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
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
    await user.click(await screen.findByRole('button', { name: 'Supprimer le clash 1' }));
    expect(screen.getByText('Aucun clash')).toBeInTheDocument();
    await submitDecision('Approuver');
    expect(approve).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { clashTimecodes: [] } });
  });

  it('refuses a 4th clash in the editor', async () => {
    const { container } = renderPage(pendingMpm);
    await screen.findByLabelText('Clash 2');
    setTime(audioOf(container), 100);
    await user.click(screen.getByRole('button', { name: 'Marquer ici' }));
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
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
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
    await user.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
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
    await user.click(await screen.findByRole('button', { name: 'Proposition suivante' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/moderation?reason=MPM'),
    );
  });

  it('blacklists the related track after a confirmation (#561)', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue({
      data: { id: 't1', blacklisted: true },
      error: undefined,
      response: new Response(null, { status: 200 }),
    } as never);
    const { findOne } = renderPage(pendingMpm);
    await user.click(await screen.findByRole('button', { name: 'Blacklister le titre' }));
    const dialog = await screen.findByRole('dialog', { name: 'Blacklister le titre' });
    expect(dialog).toHaveTextContent("retirée de la bibliothèque de l'app");
    expect(update).not.toHaveBeenCalled();
    findOne.mockResolvedValue(
      ok({ ...pendingMpm, track: { ...pendingMpm.track, blacklisted: true } }) as never,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Blacklister' }));
    expect(update).toHaveBeenCalledWith({ path: { id: 't1' }, body: { blacklisted: true } });
    // Reversible from the track page, linked once the track is blacklisted.
    const link = await screen.findByRole(
      'link',
      { name: 'Fiche de la musique' },
      { timeout: 5_000 },
    );
    expect(link).toHaveAttribute('href', '/tracks/t1');
    expect(screen.queryByRole('button', { name: 'Blacklister le titre' })).not.toBeInTheDocument();
  }, 15_000);

  it('cancels the blacklist without any request', async () => {
    const update = vi.spyOn(sdk, 'tracksControllerUpdate');
    renderPage(pendingMpm);
    await user.click(await screen.findByRole('button', { name: 'Blacklister le titre' }));
    const dialog = await screen.findByRole('dialog', { name: 'Blacklister le titre' });
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
  });

  it('shows the API error in the blacklist dialog', async () => {
    vi.spyOn(sdk, 'tracksControllerUpdate').mockResolvedValue({
      data: undefined,
      error: { statusCode: 403, message: 'Accès refusé' },
      response: new Response(null, { status: 403 }),
    } as never);
    renderPage(pendingMpm);
    await user.click(await screen.findByRole('button', { name: 'Blacklister le titre' }));
    const dialog = await screen.findByRole('dialog', { name: 'Blacklister le titre' });
    await user.click(within(dialog).getByRole('button', { name: 'Blacklister' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });

  it('shows the shared message when the server is unreachable', async () => {
    vi.spyOn(sdk, 'trackCorrectionsControllerFindOne').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
    } as never);
    renderWithProviders(
      <Routes>
        <Route path="/moderation/:id" element={<ModerationDetailPage />} />
      </Routes>,
      { route: '/moderation/c1' },
    );
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });
});
