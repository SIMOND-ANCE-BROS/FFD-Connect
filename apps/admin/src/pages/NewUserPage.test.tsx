import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewUserPage } from './NewUserPage';

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users/new']}>
          <Routes>
            <Route path="/users/new" element={<NewUserPage />} />
            <Route path="/users/:id" element={<p>user page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function fillIdentity() {
  await userEvent.type(await screen.findByLabelText(/^Email/), 'jeanne@x.fr');
  await userEvent.type(screen.getByLabelText(/^Prénom/), 'Jeanne');
  await userEvent.type(screen.getByLabelText(/^Nom de famille/), 'Martin');
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /créer l'utilisateur/i }));

describe('NewUserPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
      data: [{ id: 'c1', name: 'Club A' }],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin'],
        ageGroups: ['Adulte'],
        competitionLevels: ['Débutant'],
        passportLevels: ['BLANC'],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
  });

  it('creates a licensee without club, with an optional ranking, then opens the user page', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: null, invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.type(await screen.findByLabelText('Classement national'), '12');
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        nationalRanking: 12,
      },
    });
    expect(await screen.findByText('user page')).toBeInTheDocument();
  });

  it('offers a new club only for the Club role, where a club becomes required', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser');
    renderPage();
    await fillIdentity();
    expect(screen.queryByRole('radio', { name: 'Nouveau club' })).toBeNull();
    expect(screen.getByLabelText('Club (facultatif)', { selector: 'input' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    expect(screen.getByRole('radio', { name: 'Nouveau club' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Classement national')).toBeNull();
    await submit();
    expect(await screen.findByText('Choisir un club')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a Club account with a new club', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: 'c-new', invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await userEvent.type(screen.getByLabelText(/^Nom du nouveau club/), 'Club Neuf');
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'CLUB',
        clubName: 'Club Neuf',
      },
    });
  });

  it('offers the existing club when the new club name is taken', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Un club porte déjà ce nom', existingClubId: 'c1' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillIdentity();
    await userEvent.click(screen.getByRole('radio', { name: 'Club' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await userEvent.type(screen.getByLabelText(/^Nom du nouveau club/), 'Club A');
    await submit();
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /utiliser « club a »/i }));
    expect(screen.getByRole('radio', { name: 'Club existant' })).toBeChecked();
  });

  it('shows a plain error without a club shortcut on an email conflict', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: { message: 'Cet email est déjà utilisé' },
      response: new Response(null, { status: 409 }),
    } as never);
    renderPage();
    await fillIdentity();
    await submit();
    expect(await screen.findByText('Cet email est déjà utilisé')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /utiliser/i })).not.toBeInTheDocument();
  });

  it('shows the unavailable message on a network failure', async () => {
    vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await submit();
    expect(await screen.findByText('Serveur injoignable, réessayez dans un instant.')).toBeInTheDocument();
  });
});
