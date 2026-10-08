import { Alert, Anchor, Button, Select, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { adminControllerCreateClub } from '../api/generated/sdk.gen';
import type { ClubRegistrationMode } from '../api/generated/types.gen';
import { apiErrorMessage, UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { REGISTRATION_MODE_LABELS } from '../lib/labels';

const NAME_MAX = 120;

interface Values {
  name: string;
  registrationMode: ClubRegistrationMode;
}

interface FormError {
  message: string;
  existingClubId?: string;
}

const MODE_OPTIONS = (Object.keys(REGISTRATION_MODE_LABELS) as ClubRegistrationMode[]).map(
  (value) => ({ value, label: REGISTRATION_MODE_LABELS[value] }),
);

function toFormError(body: unknown): FormError {
  const existingClubId =
    typeof body === 'object' && body !== null
      ? (body as { existingClubId?: unknown }).existingClubId
      : undefined;
  return {
    message: apiErrorMessage(body, 'Création impossible'),
    existingClubId: typeof existingClubId === 'string' ? existingClubId : undefined,
  };
}

export function NewClubPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    initialValues: { name: '', registrationMode: 'MEMBERS_AUTO_CONFIRM' },
    validate: {
      name: (v) =>
        v.trim().length < 2
          ? 'Nom trop court'
          : v.trim().length > NAME_MAX
            ? `Nom trop long (${NAME_MAX} caractères max)`
            : null,
    },
  });

  const onSubmit = form.onSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await adminControllerCreateClub({
        body: { name: values.name.trim(), registrationMode: values.registrationMode },
      });
      if (!data) {
        // The generated client never throws: no response means a network failure.
        setError(response ? toFormError(apiError) : { message: UNAVAILABLE_MESSAGE });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['admin'] });
      notifications.show({ color: 'green', message: 'Club créé' });
      navigate(`/clubs/${data.id}`);
    } catch {
      setError({ message: UNAVAILABLE_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <Stack maw={640}>
      <Title order={2}>Nouveau club</Title>
      {error && (
        <Alert color="red">
          {error.message}
          {error.existingClubId && (
            <Anchor component={Link} to={`/clubs/${error.existingClubId}`} ml="sm">
              Voir le club existant
            </Anchor>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput
            label="Nom du club"
            withAsterisk
            maxLength={NAME_MAX}
            {...form.getInputProps('name')}
          />
          <Select
            label="Mode d'inscription"
            withAsterisk
            allowDeselect={false}
            data={MODE_OPTIONS}
            {...form.getInputProps('registrationMode')}
          />
          <Button type="submit" loading={submitting}>
            Créer le club
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
