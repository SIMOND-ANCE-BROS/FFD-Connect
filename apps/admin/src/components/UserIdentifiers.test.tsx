import { notifications } from '@mantine/notifications';
import { screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { describe, vi } from 'vitest';
import * as sdk from '../api/generated/sdk.gen';
import type { AdminUserDetailDto } from '../api/generated/types.gen';
import { fill, renderWithProviders, setupUser } from '../test/render';
import { UserIdentifiers } from './UserIdentifiers';

const user0 = {
  id: 'u1',
  email: 'jeanne@x.fr',
  licenseNumber: 'FFD-1',
  licenseValidUntil: null,
  isStoreReview: false,
} as AdminUserDetailDto;

let user: UserEvent;

function renderIdentifiers(u: AdminUserDetailDto = user0, editable = true) {
  return renderWithProviders(<UserIdentifiers user={u} editable={editable} />);
}

const emailValue = () => screen.getByRole('button', { name: /Modifier l'email/ });
const licenseValue = () => screen.getByRole('button', { name: /Modifier le numéro de licence/ });

describe('UserIdentifiers (#672)', { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    user = setupUser();
  });

  it('turns the email into a field on click, pre-filled and focused', async () => {
    renderIdentifiers();
    await user.click(emailValue());
    const input = screen.getByLabelText('Email');
    expect(input).toHaveValue('jeanne@x.fr');
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Enregistrer (Email)' })).toBeInTheDocument();
  });

  it('opens with the keyboard: Enter on the focused value', async () => {
    renderIdentifiers();
    emailValue().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('Escape restores the value without calling the server', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), 'new@x.fr');
    await user.keyboard('{Escape}');

    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(emailValue()).toHaveTextContent('jeanne@x.fr');
    expect(patch).not.toHaveBeenCalled();
  });

  it('« Annuler » restores the value without calling the server', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(licenseValue());
    await fill(user, screen.getByLabelText('Licence'), 'FFD-9');
    await user.click(screen.getByRole('button', { name: 'Annuler (Licence)' }));

    expect(licenseValue()).toHaveTextContent('FFD-1');
    expect(patch).not.toHaveBeenCalled();
    // Reopening starts from the stored value, not the abandoned draft.
    await user.click(licenseValue());
    expect(screen.getByLabelText('Licence')).toHaveValue('FFD-1');
  });

  it('asks for confirmation before changing the email, then sends it normalised', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, email: 'new@x.fr' }, previousEmailNotified: true },
      error: undefined,
    } as never);
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), ' New@X.fr ');
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/déconnectée de toutes ses sessions/)).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: "Changer l'email" }));

    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { email: 'new@x.fr' } }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Email')).toBeNull());
  });

  it('« Retour » in the confirmation keeps the draft in edition, unsaved', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), 'new@x.fr');
    await user.click(screen.getByRole('button', { name: 'Enregistrer (Email)' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retour' }),
    );

    expect(screen.getByLabelText('Email')).toHaveValue('new@x.fr');
    expect(patch).not.toHaveBeenCalled();
  });

  it('saves a licence number on Enter without confirmation, warning about issued QR codes', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, licenseNumber: 'FFD-2' }, previousEmailNotified: null },
      error: undefined,
    } as never);
    renderIdentifiers();
    await user.click(licenseValue());
    expect(screen.queryByText(/QR codes et le pass Wallet déjà émis/)).toBeNull();
    await fill(user, screen.getByLabelText('Licence'), ' FFD-2 ');
    expect(screen.getByText(/QR codes et le pass Wallet déjà émis/)).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ path: { id: 'u1' }, body: { licenseNumber: 'FFD-2' } }),
    );
  });

  it('shows a duplicate under the field and stays in edition', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: undefined,
      error: { statusCode: 409, message: 'Ce numéro de licence est déjà utilisé' },
    } as never);
    renderIdentifiers();
    await user.click(licenseValue());
    await fill(user, screen.getByLabelText('Licence'), 'FFD-2');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Ce numéro de licence est déjà utilisé')).toBeInTheDocument();
    expect(screen.getByLabelText('Licence')).toHaveValue('FFD-2');
    expect(screen.getByLabelText('Licence')).toHaveAttribute('aria-invalid', 'true');
  });

  it('blocks a malformed email under the field, before any server call', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), 'pas-un-email');
    await user.keyboard('{Enter}');

    expect(screen.getByText('Adresse email invalide')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('pas-un-email');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it('blocks an empty or too long licence number', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(licenseValue());
    const input = screen.getByLabelText('Licence');
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Obligatoire')).toBeInTheDocument();
    await fill(user, input, '1'.repeat(33));
    await user.keyboard('{Enter}');
    expect(screen.getByText('32 caractères au plus')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('leaves edition without a server call when nothing changed (case aside)', async () => {
    const patch = vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers');
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), 'JEANNE@x.fr');
    await user.keyboard('{Enter}');

    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it('tells the admin when the old address could not be warned', async () => {
    vi.spyOn(sdk, 'adminControllerUpdateUserIdentifiers').mockResolvedValue({
      data: { user: { ...user0, email: 'new@x.fr' }, previousEmailNotified: false },
      error: undefined,
    } as never);
    const show = vi.spyOn(notifications, 'show');
    renderIdentifiers();
    await user.click(emailValue());
    await fill(user, screen.getByLabelText('Email'), 'new@x.fr');
    await user.keyboard('{Enter}');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: "Changer l'email" }),
    );

    await vi.waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'orange',
          message: expect.stringMatching(/ancienne adresse/),
        }),
      ),
    );
  });

  it('shows plain values for the store-review account', () => {
    renderIdentifiers({ ...user0, isStoreReview: true });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/jeanne@x\.fr/)).toBeInTheDocument();
  });

  it('shows plain values on the admin own account', () => {
    renderIdentifiers(user0, false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the email editable but not the licence of an account without licence', () => {
    renderIdentifiers({ ...user0, licenseNumber: null });
    expect(emailValue()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /numéro de licence/ })).toBeNull();
    expect(screen.getByText(/Licence :\s*—/)).toBeInTheDocument();
  });
});
