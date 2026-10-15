import { Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminControllerUpdateUserIdentifiers } from '../api/generated/sdk.gen';
import type { AdminUserDetailDto, UpdateAdminUserIdentifiersDto } from '../api/generated/types.gen';
import { unwrap, userQuery } from '../api/queries';
import {
  identifiersChanges,
  normalizeEmail,
  validateEmail,
  validateLicenseNumber,
} from '../lib/identifiers';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import { InlineEditField } from './InlineEditField';

interface Props {
  user: AdminUserDetailDto;
  /** False for the admin's own account. */
  editable: boolean;
}

/**
 * Login email and licence number of an account, edited in place (#672, after
 * #448). An email change ends the person's sessions and warns the old
 * address, so it is confirmed first. Every change is written to the audit log
 * by the API.
 */
export function UserIdentifiers({ user, editable }: Props) {
  const qc = useQueryClient();
  // The store-review account's identifiers are fixed (the API refuses too).
  const canEdit = editable && !user.isStoreReview;

  const save = useMutation({
    mutationFn: (body: UpdateAdminUserIdentifiersDto) =>
      unwrap(adminControllerUpdateUserIdentifiers({ path: { id: user.id }, body })),
    onSuccess: (result) => {
      qc.setQueryData(userQuery(user.id).queryKey, result.user);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      notifications.show({ color: 'green', message: 'Identifiants mis à jour' });
      if (result.previousEmailNotified === false) {
        notifications.show({
          color: 'orange',
          message: "L'ancienne adresse n'a pas pu être prévenue (envoi de l'email impossible).",
        });
      }
    },
  });

  const license = user.licenseNumber;

  return (
    <>
      <InlineEditField
        label="Email"
        value={user.email}
        editLabel="Modifier l'email"
        editable={canEdit}
        validate={validateEmail}
        isUnchanged={(draft) => identifiersChanges(user, { email: draft }).email === undefined}
        confirm={{
          title: "Confirmer le changement d'email",
          confirmLabel: "Changer l'email",
          body: (
            <Text size="sm">
              La personne sera déconnectée de toutes ses sessions et devra se reconnecter avec la
              nouvelle adresse. L'ancienne adresse sera prévenue et les liens de mot de passe déjà
              envoyés ne fonctionneront plus.
            </Text>
          ),
        }}
        onSave={(draft) => save.mutateAsync({ email: normalizeEmail(draft) })}
      />
      <InlineEditField
        label="Licence"
        value={license ?? ''}
        display={
          <>
            {license ?? '—'}
            {user.licenseValidUntil &&
              ` (jusqu'au ${formatLicenseValidUntil(user.licenseValidUntil)})`}
          </>
        }
        editLabel="Modifier le numéro de licence"
        // No licence attached: nothing to renumber.
        editable={canEdit && license !== null}
        validate={validateLicenseNumber}
        isUnchanged={(draft) =>
          identifiersChanges(user, { licenseNumber: draft }).licenseNumber === undefined
        }
        changeWarning={
          "Changement de numéro de licence : les QR codes et le pass Wallet déjà émis portent l'ancien numéro et ne sont pas invalidés. La personne doit rouvrir son e-licence dans l'app et réajouter son pass Wallet pour obtenir le nouveau numéro."
        }
        onSave={(draft) => save.mutateAsync({ licenseNumber: draft.trim() })}
      />
    </>
  );
}
