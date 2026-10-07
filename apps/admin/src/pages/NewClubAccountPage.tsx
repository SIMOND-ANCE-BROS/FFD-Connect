import { Alert, Button, Group, Radio, Select, Stack, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { adminControllerCreateUser } from '../api/generated/sdk.gen';
import { clubOptionsQuery } from '../api/queries';

const UNAVAILABLE = 'Serveur indisponible, réessayez dans un instant.';

type Mode = 'existing' | 'new';

interface FormError {
  message: string;
  existingClubId?: string;
}

/** Narrows the parsed error body (top-level message / existingClubId) without any cast to any. */
function toFormError(body: unknown): FormError {
  const fallback = 'Création impossible';
  if (typeof body !== 'object' || body === null) return { message: fallback };
  const { message, existingClubId } = body as { message?: unknown; existingClubId?: unknown };
  const text = Array.isArray(message)
    ? message.filter((m): m is string => typeof m === 'string').join(', ')
    : message;
  return {
    message: typeof text === 'string' && text ? text : fallback,
    existingClubId: typeof existingClubId === 'string' ? existingClubId : undefined,
  };
}

export function NewClubAccountPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clubs = useQuery(clubOptionsQuery());
  const [mode, setMode] = useState<Mode>('existing');
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm({
    initialValues: {
      email: '',
      firstName: '',
      lastName: '',
      clubId: null as string | null,
      clubName: '',
    },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Email invalide'),
      firstName: (v) => (v.trim() ? null : 'Obligatoire'),
      lastName: (v) => (v.trim() ? null : 'Obligatoire'),
      clubId: (v) => (mode === 'existing' && !v ? 'Choisir un club' : null),
      clubName: (v) => (mode === 'new' && v.trim().length < 2 ? 'Nom trop court' : null),
    },
  });

  const onSubmit = form.onSubmit(async (v) => {
    setError(null);
    setSubmitting(true);
    try {
      const body = {
        email: v.email.trim(),
        firstName: v.firstName.trim(),
        lastName: v.lastName.trim(),
        role: 'CLUB' as const,
        ...(mode === 'existing' ? { clubId: v.clubId as string } : { clubName: v.clubName.trim() }),
      };
      const { data, error: apiError, response } = await adminControllerCreateUser({ body });
      if (!data) {
        // The generated client never throws: no response means a network failure.
        setError(response ? toFormError(apiError) : { message: UNAVAILABLE });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['admin'] });
      notifications.show(
        data.invitationSent
          ? { color: 'green', message: 'Compte créé, invitation envoyée' }
          : {
              color: 'orange',
              message:
                "Compte créé, mais l'email n'est pas parti : utilisez « Renvoyer l'invitation »",
            },
      );
      navigate(`/users/${data.userId}`);
    } catch {
      setError({ message: UNAVAILABLE });
    } finally {
      setSubmitting(false);
    }
  });

  const existingName = error?.existingClubId
    ? clubs.data?.find((c) => c.id === error.existingClubId)?.name
    : undefined;

  return (
    <Stack maw={520}>
      <Title order={2}>Nouveau compte Club</Title>
      {clubs.isError && <Alert color="red">Impossible de charger la liste des clubs.</Alert>}
      {error && (
        <Alert color="red">
          {error.message}
          {error.existingClubId && (
            <Button
              size="xs"
              ml="sm"
              variant="white"
              onClick={() => {
                setMode('existing');
                form.setFieldValue('clubId', error.existingClubId ?? null);
                if (!existingName) void clubs.refetch();
                setError(null);
              }}
            >
              {existingName ? `Utiliser « ${existingName} »` : 'Utiliser le club existant'}
            </Button>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit}>
        <Stack>
          <TextInput label="Email" type="email" withAsterisk {...form.getInputProps('email')} />
          <TextInput
            label="Prénom du responsable"
            withAsterisk
            {...form.getInputProps('firstName')}
          />
          <TextInput label="Nom du responsable" withAsterisk {...form.getInputProps('lastName')} />
          <Radio.Group value={mode} onChange={(m) => setMode(m as Mode)} label="Club">
            <Group mt="xs">
              <Radio value="existing" label="Club existant" />
              <Radio value="new" label="Nouveau club" />
            </Group>
          </Radio.Group>
          {mode === 'existing' ? (
            <Select
              label="Club existant"
              withAsterisk
              searchable
              data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
              {...form.getInputProps('clubId')}
            />
          ) : (
            <TextInput
              label="Nom du nouveau club"
              withAsterisk
              {...form.getInputProps('clubName')}
            />
          )}
          <Button type="submit" loading={submitting}>
            Créer le compte
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
