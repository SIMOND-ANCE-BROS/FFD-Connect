import { MantineProvider } from '@mantine/core';
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
      disabledAt: null,
    },
    {
      id: 'u2',
      firstName: 'Paul',
      lastName: 'Durand',
      email: 'p@x.fr',
      role: 'CLUB',
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
});
