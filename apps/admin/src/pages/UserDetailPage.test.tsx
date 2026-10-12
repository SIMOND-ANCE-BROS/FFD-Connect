import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import { fill, pickOption, renderWithProviders, setupUser } from '../test/render';
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
  competitionLevelLatin: null,
  competitionLevelStandard: null,
  wdsfMin: null,
  wdsfExpiresOn: null,
  licenseNumber: 'L1',
  licenseValidUntil: '2027-08-31T00:00:00.000Z',
  lastLoginAt: null,
  disabledAt: null,
  clubDisabledAt: null,
  createdByAdmin: true,
};

// Every keystroke re-renders the whole Mantine form, which pushed these flows past
// Vitest's 5 s budget under full-suite load (#257). No test here depends on
// per-character input, so text is pasted in one event and actions get no delay.
let user: UserEvent;

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/users/:id" element={<UserDetailPage />} />
      <Route path="/users" element={<p>users list</p>} />
    </Routes>,
    { route: '/users/u1' },
  );
}

// Residual explicit timeout (#257): each test drives a whole Mantine form (render,
// async reference data, several full re-renders) and the first one of the file also
// pays the cold render of the Mantine tree. Under a loaded full-suite run that still
// lands around Vitest's 5 s default even with pasted input, so give it headroom
// rather than let the suite flake. A real hang still fails, just later.
describe('UserDetailPage', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
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
    expect(await screen.findByDisplayValue('Latines (valeur historique)')).toBeInTheDocument();
  });

  it('confirms a before → after summary then PATCHes only the changed field', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, lastName: 'Durand' },
      error: undefined,
    } as never);
    renderPage();
    const lastName = await screen.findByLabelText(/^Nom/);
    await fill(user, lastName, 'Durand');
    await user.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Martin');
    expect(dialog).toHaveTextContent('Durand');
    await user.click(screen.getByRole('button', { name: /confirmer/i }));
    expect(patch).toHaveBeenCalledWith({
      path: { id: 'u1' },
      body: { lastName: 'Durand' },
    });
  });

  it('edits the Latin and Standard levels separately, never the legacy single level', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, competitionLevelLatin: 'Débutant' },
      error: undefined,
    } as never);
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, competitionLevelLatin: 'Débutant', competitionLevelStandard: 'Débutant' },
      error: undefined,
    } as never);
    renderPage();
    const standard = await screen.findByLabelText('Niveau Standards', { selector: 'input' });
    expect(screen.getByLabelText('Niveau Latines', { selector: 'input' })).toHaveValue('Débutant');
    await pickOption(user, standard, 'Débutant');
    await user.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Niveau Standards');
    await user.click(within(dialog).getByRole('button', { name: /confirmer/i }));
    expect(patch).toHaveBeenCalledWith({
      path: { id: 'u1' },
      body: { competitionLevelStandard: 'Débutant' },
    });
  });

  it('shows the legacy single level as a read-only hint when no discipline level is set', async () => {
    vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
      data: { ...detail, competitionLevel: 'Avancé' },
      error: undefined,
    } as never);
    renderPage();
    expect(await screen.findAllByText('Ancien niveau unique : Avancé')).toHaveLength(2);
  });

  it('blocks the save when a required name is cleared', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser');
    renderPage();
    await user.clear(await screen.findByLabelText(/^Nom/));
    await user.click(screen.getByRole('button', { name: /enregistrer/i }));
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
    await user.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
    expect(resend).toHaveBeenCalledWith({ path: { id: 'u1' } });
  });

  it('offers the invitation to a licensee who never logged in', async () => {
    const resend = vi
      .spyOn(sdk, 'adminControllerResendInvitation')
      .mockResolvedValue({ data: { invitationSent: true }, error: undefined } as never);
    renderPage();
    await user.click(await screen.findByRole('button', { name: /renvoyer l'invitation/i }));
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
    await user.click(await screen.findByRole('button', { name: 'Désactiver' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/déconnecté immédiatement/);
    await user.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
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
    await user.click(await screen.findByRole('button', { name: 'Réactiver' }));
    await user.click(
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
    await user.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Supprimer définitivement' });
    expect(confirm).toBeDisabled();
    await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.f');
    expect(confirm).toBeDisabled();
    await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), ' JEANNE@x.fr ');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
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
    await user.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
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
    await user.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
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
    await user.click(await screen.findByRole('button', { name: 'Désactiver' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Désactiver' }),
    );
    await screen.findByText('Compte désactivé');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    invalidate.mockClear();
    await user.click(screen.getByRole('button', { name: 'Supprimer le compte' }));
    const dialog = await screen.findByRole('dialog');
    await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
    await screen.findByText('users list');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  describe('store-review account', () => {
    beforeEach(() => {
      vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
        data: { ...detail, isStoreReview: true },
        error: undefined,
      } as never);
    });

    it('flags the account and keeps the edit form', async () => {
      renderPage();
      expect(
        await screen.findByText('Compte de validation App Store / Google Play'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /enregistrer/i })).toBeEnabled();
    });

    it('explains instead of deleting', async () => {
      const remove = vi.spyOn(sdk, 'adminControllerDeleteUser');
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(
        'Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.',
      );
      expect(within(dialog).queryByLabelText(/recopiez l'email/i)).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Compris' }));
      expect(remove).not.toHaveBeenCalled();
    });

    it('explains instead of disabling', async () => {
      const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus');
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Désactiver' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveTextContent(/il ne peut pas être désactivé/);
      expect(within(dialog).queryByRole('button', { name: 'Désactiver' })).toBeNull();
      expect(setStatus).not.toHaveBeenCalled();
    });

    it('still lets a disabled store-review account be reactivated', async () => {
      vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
        data: { ...detail, isStoreReview: true, disabledAt: '2026-10-01T10:00:00.000Z' },
        error: undefined,
      } as never);
      const setStatus = vi.spyOn(sdk, 'adminControllerSetUserStatus').mockResolvedValue({
        data: { ...detail, isStoreReview: true },
        error: undefined,
      } as never);
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Réactiver' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Réactiver' }),
      );
      expect(setStatus).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { active: true } });
    });

    it('shows the store-review message when the API refuses a deletion with a bare 403', async () => {
      vi.spyOn(sdk, 'adminControllerGetUser').mockResolvedValue({
        data: { ...detail, isStoreReview: false },
        error: undefined,
      } as never);
      vi.spyOn(sdk, 'adminControllerDeleteUser').mockResolvedValue({
        data: undefined,
        error: {
          statusCode: 403,
          message:
            'Ce compte est utilisé pour les validations App Store / Google Play : il ne peut pas être supprimé.',
        },
        response: new Response(null, { status: 403 }),
      } as never);
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Supprimer le compte' }));
      const dialog = await screen.findByRole('dialog');
      await fill(user, within(dialog).getByLabelText(/recopiez l'email/i), 'jeanne@x.fr');
      await user.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }));
      expect(await within(dialog).findByText(/il ne peut pas être supprimé/)).toBeInTheDocument();
    });
  });

  it('saves extra roles after the confirmation', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUser').mockResolvedValue({
      data: { ...detail, extraRoles: ['CLUB'], roles: ['LICENSEE', 'CLUB'] },
      error: undefined,
    } as never);
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Club' }));
    await user.click(screen.getByRole('button', { name: /enregistrer/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Rôles supplémentaires');
    await user.click(screen.getByRole('button', { name: /confirmer/i }));
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
