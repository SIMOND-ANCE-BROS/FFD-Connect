import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewClubPage } from './NewClubPage';

function renderPage() {
  return render(
    <MantineProvider>
      <Notifications />
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/clubs/new']}>
          <Routes>
            <Route path="/clubs/new" element={<NewClubPage />} />
            <Route path="/clubs/:id" element={<p>club page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /créer le club/i }));

describe('NewClubPage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates the club with the default mode, then opens its page', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateClub').mockResolvedValue({
      data: { id: 'c-new', name: 'Club Neuf' },
      error: undefined,
    } as never);
    renderPage();
    expect(screen.getByLabelText(/^Mode d'inscription/, { selector: 'input' })).toHaveValue(
      'Licenciés, validation automatique',
    );
    await userEvent.type(screen.getByLabelText(/^Nom du club/), '  Club Neuf ');
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: { name: 'Club Neuf', registrationMode: 'MEMBERS_AUTO_CONFIRM' },
    });
    expect(await screen.findByText('club page')).toBeInTheDocument();
    expect(await screen.findByText('Club créé')).toBeInTheDocument();
  });

  it('sends the chosen registration mode', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateClub').mockResolvedValue({
      data: { id: 'c-new' },
      error: undefined,
    } as never);
    renderPage();
    await userEvent.type(screen.getByLabelText(/^Nom du club/), 'Club Neuf');
    await userEvent.click(screen.getByLabelText(/^Mode d'inscription/, { selector: 'input' }));
    await userEvent.click(await screen.findByText('Le club seul inscrit ses licenciés'));
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: { name: 'Club Neuf', registrationMode: 'CLUB_ONLY' },
    });
  });

  it('refuses an empty name without calling the API', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateClub');
    renderPage();
    await submit();
    expect(await screen.findByText('Obligatoire')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the server message and a link to the club that already has the name', async () => {
    vi.spyOn(sdk, 'adminControllerCreateClub').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await userEvent.type(screen.getByLabelText(/^Nom du club/), 'club a');
    await submit();
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /voir le club existant/i })).toHaveAttribute(
      'href',
      '/clubs/c1',
    );
  });

  it('shows the unavailable message on a network failure', async () => {
    vi.spyOn(sdk, 'adminControllerCreateClub').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage();
    await userEvent.type(screen.getByLabelText(/^Nom du club/), 'Club Neuf');
    await submit();
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });

  it('shows the unavailable message when the call throws', async () => {
    vi.spyOn(sdk, 'adminControllerCreateClub').mockRejectedValue(new Error('boom'));
    renderPage();
    await userEvent.type(screen.getByLabelText(/^Nom du club/), 'Club Neuf');
    await submit();
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });
});
