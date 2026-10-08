import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { useSession } from '../session/sessionStore';
import { UserDetailPage } from './UserDetailPage';

const detail = {
  id: 'u1',
  email: 'jeanne@x.fr',
  firstName: 'Jeanne',
  lastName: 'Martin',
  role: 'LICENSEE',
  extraRoles: [],
  roles: ['LICENSEE'],
  clubId: 'c1',
  clubName: 'Club A',
  category: 'Latine',
  ageGroup: 'Adulte',
  licenseStatus: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  birthDate: null,
  nationalRanking: 12,
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  wdsfMin: null,
  wdsfExpiresOn: null,
  licenseNumber: 'L1',
  licenseValidUntil: '2027-08-31T00:00:00.000Z',
  lastLoginAt: null,
  disabledAt: null,
  clubDisabledAt: null,
  createdByAdmin: true,
};

function renderPage() {
  return render(
    <MantineProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/users/u1']}>
          <Routes>
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/users" element={<p>users list</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSession.getState().setSession({
      accessToken: 'a',
      refreshToken: 'r',
      user: { id: 'admin-1', email: 'a@x.fr', firstName: 'G', lastName: 'S', role: 'ADMIN' },
    });
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: detail,
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerClubOptions').mockResolvedValue({
      data: [
        { id: 'c1', name: 'Club A' },
        { id: 'c2', name: 'Club B' },
      ],
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerReferenceData').mockResolvedValue({
      data: {
        categories: ['Latin', 'Standard', 'Ten Dance'],
        ageGroups: ['Adulte'],
        competitionLevels: ['Débutant'],
        passportLevels: ['BLANC'],
        roles: ['LICENSEE', 'CLUB', 'STAFF', 'ADMIN'],
      },
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerAuditLog').mockResolvedValue({
      data: { data: [], meta: { total: 0, skip: 0, take: 20, hasMore: false } },
      error: undefined,
    } as never);
  });

  it('shows a legacy category instead of a blank select', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Latine (valeur historique)')).toBeInTheDocument();
  });

  it('confirms a before → after summary then PATCHes only the changed field', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, lastName: 'Durand' },
      error: undefined,
    } as never);
    renderPage();
    const lastName = await screen.findByLabelText(/^Nom/);
    await userEvent.clear(lastName);
    await userEvent.type(lastName, 'Durand');
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Martin');
    expect(dialog).toHaveTextContent('Durand');
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }));
    expect(patch).toHaveBeenCalledWith({
      path: { id: 'u1' },
      body: { lastName: 'Durand' },
    });
  });

  it('blocks the save when a required name is cleared', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser');
    renderPage();
    await userEvent.clear(await screen.findByLabelText(/^Nom/));
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    expect(await screen.findByText('Obligatoire')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("disables the role select on the admin's own account", async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, id: 'admin-1', role: 'ADMIN' },
      error: undefined,
    } as never);
    renderPage();
    // Mantine keeps each Select's listbox mounted in jsdom, labelled by the same
    // label, so target the input itself.
    expect(await screen.findByLabelText('Rôle', { selector: 'input' })).toBeDisabled();
  });

  it('offers to resend the invitation to a CLUB account that never logged in', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, role: 'CLUB' },
      error: undefined,
    } as never);
    const resend = vi
      .spyOn(sdk, 'adminControllerResendInvitation')
      .mockResolvedValue({ data: { invitationSent: true }, error: undefined } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
    expect(resend).toHaveBeenCalledWith({ path: { id: 'u1' } });
  });

  it('offers the invitation to a licensee who never logged in', async () => {
    const resend = vi
      .spyOn(sdk, 'adminControllerResendInvitation')
      .mockResolvedValue({ data: { invitationSent: true }, error: undefined } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
    expect(resend).toHaveBeenCalledWith({ path: { id: 'u1' } });
  });

  it.each([
    ['an ADMIN account', { role: 'ADMIN', roles: ['ADMIN'] }],
    [
      'an account whose extra role is ADMIN',
      { extraRoles: ['ADMIN'], roles: ['LICENSEE', 'ADMIN'] },
    ],
    ['a disabled account', { disabledAt: '2026-10-01T10:00:00.000Z' }],
    ['a self-registered account', { createdByAdmin: false }],
    [
      'a CLUB account of a disabled club',
      { role: 'CLUB', clubDisabledAt: '2026-10-01T10:00:00.000Z' },
    ],
  ])('hides the resend button for %s', async (_label, patch) => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, ...patch },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByText(/Dernière connexion/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /renvoyer l'invitation/i })).toBeNull();
  });

  it('hides the resend button for a CLUB account that has logged in', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, role: 'CLUB', lastLoginAt: '2026-10-01T10:00:00.000Z' },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByText(/01\/10\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /renvoyer l'invitation/i })).toBeNull();
  });

  it('shows an unrecorded last login as "inconnue", not "jamais"', async () => {
    renderPage();
    expect(await screen.findByText(/Dernière connexion :\s*inconnue/)).toBeInTheDocument();
    expect(screen.queryByText(/jamais/)).toBeNull();
  });

  it('deactivates after a confirmation, then shows the banner', async () => {
    const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
      data: { ...detail, disabledAt: '2026-10-07T10:00:00.000Z' },
      error: undefined,
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/déconnecté immédiatement/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
    expect(setStatus).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { active: false } });
    expect(await screen.findByText('Compte désactivé')).toBeInTheDocument();
  });

  it('reactivates a disabled account', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, disabledAt: '2026-10-01T10:00:00.000Z' },
      error: undefined,
    } as never);
    const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
      data: detail,
      error: undefined,
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Réactiver' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Réactiver' }),
    );
    expect(setStatus).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { active: true } });
    await waitFor(() => expect(screen.queryByText('Compte désactivé')).toBeNull());
  });

  it('explains that a CLUB account of a disabled club cannot log in', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, role: 'CLUB', clubDisabledAt: '2026-10-01T10:00:00.000Z' },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByText('Club désactivé')).toBeInTheDocument();
  });

  it('deletes only once the typed email matches, whatever its case, then returns to the list', async () => {
    const remove = vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.f');
    expect(confirm).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(/recopiez l'email/i));
    await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), ' JEANNE@x.fr ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith({
      path: { id: 'u1' },
      body: { confirmEmail: 'JEANNE@x.fr' },
    });
    expect(await screen.findByText('users list')).toBeInTheDocument();
  });

  it('keeps the dialog open with the server message when the deletion is refused', async () => {
    vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
      data: undefined,
      error: { message: "L'email saisi ne correspond pas au compte" },
      response: new Response(null, { status: 400 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(
      await within(dialog).findByText("L'email saisi ne correspond pas au compte"),
    ).toBeInTheDocument();
  });

  it("hides the status and delete actions on the admin's own account", async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, id: 'admin-1', role: 'ADMIN' },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByText(/Dernière connexion/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Désactiver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer le compte' })).toBeNull();
  });

  it('shows a French unavailable message on a network failure during deletion', async () => {
    vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
      data: undefined,
      error: new TypeError('Failed to fetch'),
      response: undefined,
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    expect(
      await within(dialog).findByText('Serveur injoignable, réessayez dans un instant.'),
    ).toBeInTheDocument();
  });

  it('invalidates the users list after a deletion and after a status change', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
      data: { ...detail, disabledAt: '2026-10-07T10:00:00.000Z' },
      error: undefined,
    } as never);
    vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Désactiver' }),
    );
    await screen.findByText('Compte désactivé');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    invalidate.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    await screen.findByText('users list');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('saves extra roles after the confirmation', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, extraRoles: ['CLUB'], roles: ['LICENSEE', 'CLUB'] },
      error: undefined,
    } as never);
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Club' }));
    await userEvent.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Rôles supplémentaires');
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }));
    expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { extraRoles: ['CLUB'] } });
  });

  it('does not offer the main role as an extra role', async () => {
    renderPage();
    await screen.findByRole('checkbox', { name: 'Club' });
    expect(screen.queryByRole('checkbox', { name: 'Licencié' })).not.toBeInTheDocument();
  });

  it("locks the admin's own ADMIN extra role", async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: {
        ...detail,
        id: 'admin-1',
        role: 'LICENSEE',
        extraRoles: ['ADMIN'],
        roles: ['LICENSEE', 'ADMIN'],
      },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findByRole('checkbox', { name: 'Admin' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Club' })).toBeEnabled();
  });
});
