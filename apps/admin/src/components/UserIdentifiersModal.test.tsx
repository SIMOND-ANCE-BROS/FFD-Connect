import { screen, waitFor } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { describe, vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import type { AdminUserDetailDto } from '../api/generated/types.gen';
import { fill, renderWithProviders, setupUser } from '../test/render';
import { identifiersChanges, UserIdentifiersModal } from './UserIdentifiersModal';

const user0 = {
  id: 'u1',
  email: 'jeanne@x.fr',
  licenseNumber: 'FFD-1',
  isStoreReview: false,
} as AdminUserDetailDto;

let user: UserEvent;
const onClose = vi.fn();

/**
 * Renders the open modal and waits for its focus trap to take the focus: it
 * does so after mount, and would otherwise steal it from a field being filled.
 */
async function renderModal(u: AdminUserDetailDto = user0) {
  renderWithProviders(<UserIdentifiersModal user={u} opened onClose={onClose} />);
  await waitFor(() => expect(document.body).not.toHaveFocus());
}

describe('identifiersChanges', () => {
  it('keeps only what changes, the email normalised and compared case-insensitively', () => {
    expect(identifiersChanges(user0, { email: ' Jeanne@X.fr ', licenseNumber: 'FFD-1' })).toEqual(
      {},
    );
    expect(identifiersChanges(user0, { email: ' New@X.fr', licenseNumber: ' FFD-2 ' })).toEqual({
      email: 'new@x.fr',
      licenseNumber: 'FFD-2',
    });
  });

  it('never sends a licence number for an account without licence', () => {
    expect(
      identifiersChanges(
        { ...user0, licenseNumber: null },
        { email: 'jeanne@x.fr', licenseNumber: 'X' },
      ),
    ).toEqual({});
  });
});

describe('UserIdentifiersModal', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    onClose.mockReset();
    user = setupUser();
  });

  it('warns about the session revocation and sends the new email only', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, email: 'new@x.fr' }, previousEmailNotified: true },
      error: undefined,
    } as never);
    await renderModal();
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();

    await fill(user, screen.getByLabelText(/Email de connexion/), 'New@X.fr');
    expect(screen.getByText(/déconnectée de toutes ses sessions/)).toBeInTheDocument();
    await user.click(save);

    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { email: 'new@x.fr' } }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('changes the licence number without the session warning', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, licenseNumber: 'FFD-2' }, previousEmailNotified: null },
      error: undefined,
    } as never);
    await renderModal();
    await fill(user, screen.getByLabelText(/Numéro de licence/), 'FFD-2');
    expect(screen.queryByText(/déconnectée/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { licenseNumber: 'FFD-2' } }),
    );
  });

  it('shows the API conflict message and stays open', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'Cet email est déjà utilisé par un autre compte' },
    } as never);
    await renderModal();
    await fill(user, screen.getByLabelText(/Email de connexion/), 'taken@x.fr');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findByText('Cet email est déjà utilisé par un autre compte'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks a malformed email or licence number before calling the API', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    await renderModal();
    await fill(user, screen.getByLabelText(/Email de connexion/), 'pas-un-email');
    await fill(user, screen.getByLabelText(/Numéro de licence/), 'FFD<1>');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Adresse email invalide')).toBeInTheDocument();
    expect(screen.getByText(/Lettres, chiffres/)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('requires a licence number and caps its length', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    await renderModal();
    const input = screen.getByLabelText(/Numéro de licence/);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Obligatoire')).toBeInTheDocument();
    await fill(user, input, '1'.repeat(33));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('32 caractères au plus')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('tells the admin when the old address could not be warned', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, email: 'new@x.fr' }, previousEmailNotified: false },
      error: undefined,
    } as never);
    await renderModal();
    const show = vi.spyOn(notifications, 'show');
    await fill(user, screen.getByLabelText(/Email de connexion/), 'new@x.fr');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'orange',
        message: expect.stringMatching(/ancienne adresse/),
      }),
    );
  });

  it('locks the fields that cannot change', async () => {
    await renderModal({ ...user0, licenseNumber: null, isStoreReview: true });
    expect(screen.getByLabelText(/Email de connexion/)).toBeDisabled();
    expect(screen.getByLabelText(/Numéro de licence/)).toBeDisabled();
    expect(screen.getByText('Aucune licence rattachée à ce compte.')).toBeInTheDocument();
  });

  it('cancels without calling the API', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    await renderModal();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
