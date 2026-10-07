import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
    vi.spyOn(sdk, 'adminControllerClubs').mockResolvedValue({
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

  it('hides the resend button for a non-CLUB account', async () => {
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
});
