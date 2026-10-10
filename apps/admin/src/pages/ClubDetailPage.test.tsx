import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { ClubDetailPage } from './ClubDetailPage';

const empty = {
  id: 'c1',
  name: 'Club A',
  registrationMode: 'CLUB_ONLY',
  disabledAt: null,
  memberCount: 0,
  clubAccountCount: 0,
  competitionCount: 0,
  partnershipCount: 0,
  soloTeamCount: 0,
  helloAssoConfigured: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  members: [],
};

const busy = {
  ...empty,
  memberCount: 2,
  clubAccountCount: 1,
  competitionCount: 1,
  members: [
    {
      id: 'u1',
      firstName: 'Jeanne',
      lastName: 'Martin',
      email: 'j@x.fr',
      role: 'LICENSEE',
      extraRoles: ['CLUB'],
      disabledAt: null,
    },
    {
      id: 'u2',
      firstName: 'Paul',
      lastName: 'Durand',
      email: 'p@x.fr',
      role: 'CLUB',
      extraRoles: [],
      disabledAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

function renderPage(club: object) {
  vi.spyOn(sdk, 'adminControllerGetClub').mockResolvedValue({
    data: club,
    error: undefined,
  } as never);
  return render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/clubs/c1']}>
          <Routes>
            <Route path="/clubs/:id" element={<ClubDetailPage />} />
            <Route path="/clubs" element={<p>clubs list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('ClubDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } },
      error: undefined,
    } as never);
  });

  it('confirms a rename with a before → after summary, then PATCHes only the name', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateClub').mockResolvedValue({
      data: { ...empty, name: 'Club Z' },
      error: undefined,
    } as never);
    renderPage(empty);
    const name = await screen.findByLabelText(/^Nom du club/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Club Z');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Club A');
    expect(dialog).toHaveTextContent('Club Z');
    expect(dialog).toHaveTextContent(/reporté/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(patch).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { name: 'Club Z' } });
  });

  it('shows the server message when the new name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateClub').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c2' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage(empty);
    const name = await screen.findByLabelText(/^Nom du club/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Club B');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await within(dialog).findByText('Un club porte déjà ce nom')).toBeInTheDocument();
  });

  it('explains why a club organising FFD-synced competitions cannot be renamed', async () => {
    const message =
      "Ce club organise des compétitions synchronisées avec la FFD : son nom ne peut pas être changé ici (la synchronisation rétablirait l'ancien nom).";
    vi.spyOn(sdk, 'adminControllerUpdateClub').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage(empty);
    const name = await screen.findByLabelText(/^Nom du club/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Club Z');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
  });

  it('deactivates the club after a confirmation', async () => {
    const setStatus = vi.spyOn(sdk, 'adminControllerSetClubStatus').mockResolvedValue({
      data: { ...empty, disabledAt: '2026-10-07T10:00:00.000Z' },
      error: undefined,
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver le club' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/licenciés ne sont pas affectés/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
    expect(setStatus).toHaveBeenCalledWith({ path: { id: 'c1' }, body: { active: false } });
  });

  it('blocks the deletion of a club in use, lists why, and offers to deactivate instead', async () => {
    renderPage(busy);
    expect(await screen.findByText('2 membres')).toBeInTheDocument();
    expect(screen.getByText('1 compte Club')).toBeInTheDocument();
    expect(screen.getByText('1 compétition organisée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Supprimer le club' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Désactiver à la place' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Désactiver ce club');
  });

  it('flags the store-review club and explains instead of deleting or disabling', async () => {
    const remove = vi.spyOn(sdk, 'adminControllerDeleteClub');
    const setStatus = vi.spyOn(sdk, 'adminControllerSetClubStatus');
    renderPage({ ...busy, isStoreReview: true });
    expect(
      await screen.findByText('Compte de validation App Store / Google Play'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Supprimer le club' }));
    let dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Ce club est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Compris' }));

    await userEvent.click(screen.getByRole('button', { name: 'Désactiver le club' }));
    dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/il ne peut pas être désactivé/);
    expect(remove).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('deletes an empty club after a confirmation and returns to the list', async () => {
    const remove = vi.spyOn(sdk, 'adminControllerDeleteClub').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le club' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Supprimer définitivement',
      }),
    );
    expect(remove).toHaveBeenCalledWith({ path: { id: 'c1' } });
    expect(await screen.findByText('clubs list')).toBeInTheDocument();
  });

  it('shows the counts sent by the server when the club filled up meanwhile', async () => {
    vi.spyOn(sdk, 'adminControllerDeleteClub').mockResolvedValue({
      data: undefined,
      error: {
        statusCode: 409,
        message: "Ce club n'est pas vide : désactivez-le plutôt.",
        memberCount: 1,
        clubAccountCount: 0,
        competitionCount: 0,
        partnershipCount: 2,
        soloTeamCount: 0,
      },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le club' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await within(dialog).findByText('1 membre')).toBeInTheDocument();
    expect(within(dialog).getByText('2 couples rattachés')).toBeInTheDocument();
  });

  it('links each member to their page and flags disabled ones', async () => {
    renderPage(busy);
    expect(await screen.findByRole('link', { name: 'Martin Jeanne' })).toHaveAttribute(
      'href',
      '/users/u1',
    );
    const row = screen.getByRole('link', { name: 'Durand Paul' }).closest('tr') as HTMLElement;
    expect(within(row).getByText('Désactivé')).toBeInTheDocument();
    expect(within(row).getByText('Club')).toBeInTheDocument();
  });
  it('badges a member extra role next to the main role', async () => {
    renderPage(busy);
    const row = (await screen.findByRole('link', { name: 'Martin Jeanne' })).closest(
      'tr',
    ) as HTMLElement;
    expect(within(row).getByText('+ Club')).toBeInTheDocument();
    const other = screen.getByRole('link', { name: 'Durand Paul' }).closest('tr') as HTMLElement;
    expect(within(other).queryByText(/^\+ /)).toBeNull();
  });

  it('keeps the delete button for a retry when the server is unreachable', async () => {
    vi.spyOn(sdk, 'adminControllerDeleteClub').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage(empty);
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le club' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(await within(dialog).findByText(/Serveur injoignable/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Supprimer définitivement' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Désactiver à la place' })).toBeNull();
  });

  it('shows only an alert when the history fails to load', async () => {
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: undefined,
      error: { message: 'boom' },
    } as never);
    renderPage(empty);
    expect(await screen.findByText("Impossible de charger l'historique.")).toBeInTheDocument();
    expect(screen.queryByText('Aucune modification admin.')).toBeNull();
  });

  it('disables « Lier un membre » on a disabled club', async () => {
    renderPage({ ...empty, disabledAt: '2026-10-07T10:00:00.000Z' });
    const button = await screen.findByRole('button', { name: 'Lier un membre' });
    expect(button).toBeDisabled();
    expect(within(button.parentElement as HTMLElement).getByText('Club désactivé')).toBeVisible();
  });

  describe('Lier un membre', () => {
    // Mantine keeps notifications in a module-level store.
    afterEach(() => notifications.clean());

    const user = (o: object) => ({
      id: 'u9',
      email: 'anna@x.fr',
      firstName: 'Anna',
      lastName: 'Petit',
      role: 'LICENSEE',
      extraRoles: [],
      roles: ['LICENSEE'],
      clubId: null,
      clubName: null,
      category: null,
      ageGroup: null,
      licenseStatus: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      disabledAt: null,
      ...o,
    });
    const search = (...users: object[]) =>
      vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
        data: { data: users, meta: { total: users.length, skip: 0, take: 10, hasMore: false } },
        error: undefined,
      } as never);
    const openSearch = async (term = 'anna') => {
      await userEvent.click(await screen.findByRole('button', { name: 'Lier un membre' }));
      await userEvent.type(await screen.findByLabelText('Rechercher un utilisateur'), term);
    };

    it('patches a user without club directly, then confirms with a notification', async () => {
      const list = search(user({}));
      const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: { id: 'u9' },
        error: undefined,
      } as never);
      renderPage(empty);
      await openSearch();
      expect(await screen.findByText('anna@x.fr')).toBeInTheDocument();
      expect(screen.getByText('Sans club')).toBeInTheDocument();
      expect(list).toHaveBeenCalledWith({ query: { search: 'anna', skip: 0, take: 10 } });

      await userEvent.click(screen.getByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u9' }, body: { clubId: 'c1' } });
      expect(await screen.findByText('Membre ajouté au club')).toBeInTheDocument();
    });

    it('asks for confirmation before moving a user out of another club', async () => {
      search(user({ clubId: 'c2', clubName: 'Club B' }));
      const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: { id: 'u9' },
        error: undefined,
      } as never);
      renderPage(empty);
      await openSearch();
      expect(await screen.findByText('Club B')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(await screen.findByText('Anna Petit quitte Club B pour Club A')).toBeInTheDocument();
      expect(patch).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u9' }, body: { clubId: 'c1' } });
      expect(await screen.findByText('Membre ajouté au club')).toBeInTheDocument();
    });

    it('shows the role badges of each result', async () => {
      search(user({ role: 'STAFF', extraRoles: ['CLUB'] }));
      renderPage(empty);
      await openSearch();
      const row = (await screen.findByText('anna@x.fr')).closest('tr') as HTMLElement;
      expect(within(row).getByText('Staff')).toBeInTheDocument();
      expect(within(row).getByText('+ Club')).toBeInTheDocument();
    });

    it('confirms before linking a user holding the CLUB role, even without a club', async () => {
      search(user({ extraRoles: ['CLUB'], roles: ['LICENSEE', 'CLUB'] }));
      const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: { id: 'u9' },
        error: undefined,
      } as never);
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(
        await screen.findByText('Anna Petit deviendra gestionnaire de Club A'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/quitte/)).toBeNull();
      expect(patch).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u9' }, body: { clubId: 'c1' } });
    });

    it('mentions both the manager role and the club left', async () => {
      search(user({ role: 'CLUB', clubId: 'c2', clubName: 'Club B' }));
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(
        await screen.findByText('Anna Petit deviendra gestionnaire de Club A'),
      ).toBeInTheDocument();
      expect(screen.getByText('Anna Petit quitte Club B pour Club A')).toBeInTheDocument();
    });

    it('links a legacy user whose club name is this club (any case) directly', async () => {
      search(user({ clubId: null, clubName: 'club a' }));
      const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: { id: 'u9' },
        error: undefined,
      } as never);
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u9' }, body: { clubId: 'c1' } });
      expect(screen.queryByText(/quitte/)).toBeNull();
    });

    it('asks to refine the search when there are more results than shown', async () => {
      vi.spyOn(sdk, 'adminControllerListUsers').mockResolvedValue({
        data: { data: [user({})], meta: { total: 25, skip: 0, take: 10, hasMore: true } },
        error: undefined,
      } as never);
      renderPage(empty);
      await openSearch();
      expect(await screen.findByText('Affinez la recherche')).toBeInTheDocument();
    });

    it('goes back to the results when the move is cancelled', async () => {
      search(user({ clubId: 'c2', clubName: 'Club B' }));
      const patch = vi.spyOn(sdk, 'adminControllerUpdateUser');
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
      expect(await screen.findByText('anna@x.fr')).toBeInTheDocument();
      expect(patch).not.toHaveBeenCalled();
    });

    it('does not offer a user who already belongs to this club', async () => {
      search(user({ id: 'u1', clubId: 'c1', clubName: 'Club A' }));
      renderPage(empty);
      await openSearch();
      expect(await screen.findByText('Déjà membre')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Ajouter Anna Petit' })).toBeNull();
    });

    it('shows the server error verbatim', async () => {
      search(user({}));
      vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: undefined,
        error: { message: 'Un rôle Club supplémentaire nécessite un club' },
        response: new Response(null, { status: 400 }),
      } as never);
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      expect(
        await screen.findByText('Un rôle Club supplémentaire nécessite un club'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Membre ajouté au club')).toBeNull();
    });

    it('shows the server error on the confirmation step too', async () => {
      search(user({ clubId: 'c2', clubName: 'Club B' }));
      vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
        data: undefined,
        error: { message: 'Ce club est désactivé.' },
        response: new Response(null, { status: 400 }),
      } as never);
      renderPage(empty);
      await openSearch();
      await userEvent.click(await screen.findByRole('button', { name: 'Ajouter Anna Petit' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Confirmer' }));
      expect(await screen.findByText('Ce club est désactivé.')).toBeInTheDocument();
    });

    it('waits for two characters and reports an empty or failed search', async () => {
      const list = search();
      renderPage(empty);
      await userEvent.click(await screen.findByRole('button', { name: 'Lier un membre' }));
      await userEvent.type(await screen.findByLabelText('Rechercher un utilisateur'), 'a');
      expect(screen.getByText('Saisissez au moins 2 caractères.')).toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
      await userEvent.type(screen.getByLabelText('Rechercher un utilisateur'), 'b');
      expect(await screen.findByText('Aucun utilisateur trouvé.')).toBeInTheDocument();

      list.mockResolvedValue({ data: undefined, error: { message: 'Panne' } } as never);
      await userEvent.type(screen.getByLabelText('Rechercher un utilisateur'), 'c');
      expect(await screen.findByText('Panne')).toBeInTheDocument();
    });
  });
});
