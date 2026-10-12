import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { adminControllerUpdateUserIdentifiers } from '../api/generated/sdk.gen';
import type { AdminUserDetailDto, UpdateAdminUserIdentifiersDto } from '../api/generated/types.gen';
import { unwrap, userQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';

/** Same shape the backend accepts (LICENSE_NUMBER_PATTERN, 32 characters max). */
const LICENSE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;
const LICENSE_NUMBER_MAX_LENGTH = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Values {
  email: string;
  licenseNumber: string;
}

const normalizeEmail = (v: string) => v.trim().toLowerCase();

/** Body with only the identifiers that actually change (the email compared case-insensitively). */
export function identifiersChanges(
  user: Pick<AdminUserDetailDto, 'email' | 'licenseNumber'>,
  values: Values,
): UpdateAdminUserIdentifiersDto {
  const email = normalizeEmail(values.email);
  const licenseNumber = values.licenseNumber.trim();
  return {
    ...(email !== user.email.toLowerCase() && { email }),
    ...(user.licenseNumber !== null && licenseNumber !== user.licenseNumber && { licenseNumber }),
  };
}

interface Props {
  user: AdminUserDetailDto;
  opened: boolean;
  onClose: () => void;
}

/**
 * Login email and licence number of an account (#448). Separate from the
 * main form: an email change ends the person's sessions and warns the old
 * address, so it gets its own explicit confirmation.
 */
export function UserIdentifiersModal({ user, opened, onClose }: Props) {
  const qc = useQueryClient();
  const hasLicense = user.licenseNumber !== null;
  const form = useForm<Values>({
    initialValues: { email: user.email, licenseNumber: user.licenseNumber ?? '' },
    validate: {
      email: (v) => (EMAIL_PATTERN.test(v.trim()) ? null : 'Adresse email invalide'),
      licenseNumber: (v) => {
        if (!hasLicense) return null;
        const n = v.trim();
        if (!n) return 'Obligatoire';
        if (n.length > LICENSE_NUMBER_MAX_LENGTH) {
          return `${LICENSE_NUMBER_MAX_LENGTH} caractères au plus`;
        }
        return LICENSE_NUMBER_PATTERN.test(n)
          ? null
          : 'Lettres, chiffres, espaces, points, barres obliques ou tirets uniquement';
      },
    },
  });
  const { setValues } = form;
  // Each opening starts from the account's current values.
  useEffect(() => {
    if (opened) setValues({ email: user.email, licenseNumber: user.licenseNumber ?? '' });
  }, [opened, user.email, user.licenseNumber, setValues]);

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
      onClose();
    },
  });

  const close = () => {
    save.reset();
    onClose();
  };

  const changes = identifiersChanges(user, form.values);
  const emailChanges = changes.email !== undefined;
  const onSubmit = form.onSubmit((values) => {
    const body = identifiersChanges(user, values);
    if (Object.keys(body).length) save.mutate(body);
  });

  return (
    <Modal opened={opened} onClose={close} title="Modifier les identifiants">
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput
            label="Email de connexion"
            withAsterisk
            disabled={user.isStoreReview}
            {...form.getInputProps('email')}
          />
          <TextInput
            label="Numéro de licence"
            disabled={!hasLicense || user.isStoreReview}
            description={
              hasLicense
                ? 'Modifié sur la licence rattachée.'
                : 'Aucune licence rattachée à ce compte.'
            }
            {...form.getInputProps('licenseNumber')}
          />
          {user.isStoreReview && (
            <Alert color="gray">
              Compte de validation App Store / Google Play : son email et son numéro de licence ne
              sont pas modifiables.
            </Alert>
          )}
          {changes.licenseNumber !== undefined && (
            <Alert color="orange" title="Changement de numéro de licence">
              Les QR codes et le pass Wallet déjà émis portent l'ancien numéro et ne sont pas
              invalidés : la personne doit rouvrir son e-licence dans l'app et réajouter son pass
              Wallet pour obtenir le nouveau numéro.
            </Alert>
          )}
          {emailChanges && (
            <Alert color="orange" title="Changement d'email">
              La personne sera déconnectée de toutes ses sessions et devra se reconnecter avec la
              nouvelle adresse. L'ancienne adresse sera prévenue et les liens de mot de passe déjà
              envoyés ne fonctionneront plus.
            </Alert>
          )}
          {save.isError && (
            <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
          )}
          <Text size="xs" c="dimmed">
            Chaque modification est inscrite dans l'historique admin.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={Object.keys(changes).length === 0}
              loading={save.isPending}
            >
              Enregistrer
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
