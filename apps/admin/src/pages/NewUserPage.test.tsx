import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { NewUserPage } from './NewUserPage';

// Every keystroke re-renders the whole Mantine form, which pushed these flows past
// Vitest's 5 s budget under full-suite load (#257). No test here depends on
// per-character input, so text is pasted in one event and actions get no delay.
let user: UserEvent;

/** Fills an empty text field in one input event (paste) instead of one per character. */
async function fill(input: HTMLElement, text: string) {
  await user.click(input);
  await user.paste(text);
}

/** Picks an option in a Mantine Select (every listbox stays mounted in jsdom). */
async function pickOption(input: HTMLElement, name: string) {
  await user.click(input);
  const listbox = document.getElementById(input.getAttribute('aria-controls') ?? '');
  if (!listbox) throw new Error('listbox not found');
  await user.click(within(listbox).getByRole('option', { name, hidden: true }));
}

function renderPage() {
  return render(
    // env="test": no transitions or portals, so dialogs and dropdowns render at once.
    <MantineProvider env="test">
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
  await fill(await screen.findByLabelText(/^Email/), 'jeanne@x.fr');
  await fill(screen.getByLabelText(/^Prénom/), 'Jeanne');
  await fill(screen.getByLabelText(/^Nom de famille/), 'Martin');
}

const submit = () => user.click(screen.getByRole('button', { name: /créer l'utilisateur/i }));

// Residual explicit timeout (#257): each test drives a whole Mantine form (render,
// async reference data, several full re-renders) and the first one of the file also
// pays the cold render of the Mantine tree. Under a loaded full-suite run that still
// lands around Vitest's 5 s default even with pasted input, so give it headroom
// rather than let the suite flake. A real hang still fails, just later.
describe('NewUserPage', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = userEvent.setup({ delay: null });
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
    await fill(await screen.findByLabelText('Classement national'), '12');
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

  it('sends a competition level per discipline, never the legacy single level', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: null, invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await pickOption(
      await screen.findByLabelText('Niveau Latines', { selector: 'input' }),
      'Débutant',
    );
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        competitionLevelLatin: 'Débutant',
      },
    });
  });

  it('offers a new club only for the Club role, where a club becomes required', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser');
    renderPage();
    await fillIdentity();
    expect(screen.queryByRole('radio', { name: 'Nouveau club' })).toBeNull();
    expect(screen.getByLabelText('Club (facultatif)', { selector: 'input' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Club' }));
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
    await user.click(screen.getByRole('radio', { name: 'Club' }));
    await user.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await fill(screen.getByLabelText(/^Nom du nouveau club/), 'Club Neuf');
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
    await user.click(screen.getByRole('radio', { name: 'Club' }));
    await user.click(screen.getByRole('radio', { name: 'Nouveau club' }));
    await fill(screen.getByLabelText(/^Nom du nouveau club/), 'Club A');
    await submit();
    expect(await screen.findByText(/un club porte déjà ce nom/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /utiliser « club a »/i }));
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
    expect(
      await screen.findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });

  it('offers every role but the main one and Admin as extra roles', async () => {
    renderPage();
    await screen.findByLabelText(/^Email/);
    expect(screen.getByRole('checkbox', { name: 'Club' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Licencié' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Admin' })).toBeNull();
  });

  it('drops a role from the extras when it becomes the main role', async () => {
    renderPage();
    await screen.findByLabelText(/^Email/);
    await user.click(screen.getByRole('checkbox', { name: 'Staff' }));
    expect(screen.getByRole('checkbox', { name: 'Staff' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Staff' }));
    expect(screen.queryByRole('checkbox', { name: 'Staff' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Licencié' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Licencié' }));
    expect(screen.getByRole('checkbox', { name: 'Staff' })).not.toBeChecked();
  });

  it('sends the extra roles in the body', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser').mockResolvedValue({
      data: { userId: 'u-new', clubId: null, invitationSent: true },
      error: undefined,
    } as never);
    renderPage();
    await fillIdentity();
    await user.click(screen.getByRole('checkbox', { name: 'Staff' }));
    await submit();
    expect(create).toHaveBeenCalledWith({
      body: {
        email: 'jeanne@x.fr',
        firstName: 'Jeanne',
        lastName: 'Martin',
        role: 'LICENSEE',
        extraRoles: ['STAFF'],
      },
    });
  });

  it('requires a club before an extra Club role is sent', async () => {
    const create = vi.spyOn(sdk, 'adminControllerCreateUser');
    renderPage();
    await fillIdentity();
    await user.click(screen.getByRole('checkbox', { name: 'Club' }));
    await submit();
    expect(
      await screen.findByText('Un rôle Club supplémentaire nécessite un club'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
