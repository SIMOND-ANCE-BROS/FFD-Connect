import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewClubAccountPage } from './NewClubAccountPage';

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/club-accounts/new']}>
          <Routes>
            <Route path="/club-accounts/new" element={<NewClubAccountPage />} />
            <Route path="/users/:id" element={<p>user page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillNewClub(clubName: string) {
  await userEvent.type(screen.getByLabelText(/^Email/), 'club@x.fr');
  await userEvent.type(screen.getByLabelText(/^Prénom du responsable/), 'Jeanne');
  await userEvent.type(screen.getByLabelText(/^Nom du responsable/), 'Martin');
  await userEvent.click(screen.getByRole('radio', { name: /nouveau club/i }));
  await userEvent.type(screen.getByLabelText(/^Nom du nouveau club/), clubName);
  await userEvent.click(screen.getByRole('button', { name: /créer le compte/i }));
}

describe('NewClubAccountPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
  });

  it('creates the account and opens the user page', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: 'c-new', invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillNewClub('Club Neuf');
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'club@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'CLUB',
        clubName: 'Club Neuf',
      },
    });
    expect(await screen.findByText('user page')).toBeInTheDocument();
  });

  it('offers the existing club when the name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await screen.findByLabelText(/^Email/);
    await fillNewClub('Club A');
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /utiliser « club a »/i }));
    expect(screen.getByRole('radio', { name: /club existant/i })).toBeChecked();
  });

  it('warns when the invitation email was not sent', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: 'c-new', invitationSent: false },
      error: undefined,
    } as never);
    renderPage();
    await fillNewClub('Club Neuf');
    expect(await screen.findByText('user page')).toBeInTheDocument();
  });

  it('shows a plain error without a club shortcut on an email conflict', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Email déjà utilisé' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillNewClub('Club Neuf');
    expect(await screen.findByText(/email déjà utilisé/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /utiliser/i })).not.toBeInTheDocument();
  });

  it('shows the unavailable message on a network failure', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage();
    await fillNewClub('Club Neuf');
    expect(await screen.findByText(/serveur indisponible/i)).toBeInTheDocument();
  });

  it('still offers the existing club when the clubs list is empty', async () => {
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
      data: [],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillNewClub('Club A');
    await userEvent.click(
      await screen.findByRole('button', { name: /utiliser le club existant/i }),
    );
    expect(screen.getByRole('radio', { name: /club existant/i })).toBeChecked();
  });
});
