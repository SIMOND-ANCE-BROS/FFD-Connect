import {
  Alert,
  Button,
  Group,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { adminControllerCreateUser } from '../api/generated/sdk.gen';
import type { AdminControllerCreateUserData } from '../api/generated/types.gen';
import { clubOptionsQuery, referenceQuery } from '../api/queries';
import { apiErrorMessage, UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { ROLE_LABELS } from '../lib/labels';

type CreateBody = AdminControllerCreateUserData['body'];
type Role = CreateBody['role'];
type ClubMode = 'existing' | 'new';

const ROLES: Role[] = ['LICENSEE', 'CLUB', 'STAFF'];

interface FormError {
  message: string;
  existingClubId?: string;
}

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

interface Values {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  clubMode: ClubMode;
  clubId: string | null;
  clubName: string;
  category: string | null;
  ageGroup: string | null;
  competitionLevel: string | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  nationalRanking: number | string;
}

/**
 * The form holds plain strings while the DTO types reference-backed fields as
 * literal unions. Selects only offer reference values and the backend
 * validates them again, so this single widening cast is safe.
 */
function toBody(v: Values): CreateBody {
  const club =
    v.role === 'CLUB'
      ? v.clubMode === 'existing'
        ? { clubId: v.clubId as string }
        : { clubName: v.clubName.trim() }
      : v.clubId
        ? { clubId: v.clubId }
        : {};
  const ranking =
    typeof v.nationalRanking === 'number'
      ? v.nationalRanking
      : v.nationalRanking.trim()
        ? Number(v.nationalRanking)
        : null;
  const profile =
    v.role === 'LICENSEE'
      ? Object.fromEntries(
          Object.entries({
            category: v.category,
            ageGroup: v.ageGroup,
            competitionLevel: v.competitionLevel,
            passportLevelLatin: v.passportLevelLatin,
            passportLevelStandard: v.passportLevelStandard,
            nationalRanking: ranking,
          }).filter(([, value]) => value !== null),
        )
      : {};
  return {
    email: v.email.trim(),
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    role: v.role,
    ...club,
    ...profile,
  } as CreateBody;
}

export function NewUserPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const clubs = useQuery(clubOptionsQuery());
  const ref = useQuery(referenceQuery);
  const [error, setError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<Values>({
    initialValues: {
      email: '',
      firstName: '',
      lastName: '',
      role: 'LICENSEE',
      clubMode: 'existing',
      clubId: null,
      clubName: '',
      category: null,
      ageGroup: null,
      competitionLevel: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      nationalRanking: '',
    },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Email invalide'),
      firstName: (v) => (v.trim() ? null : 'Obligatoire'),
      lastName: (v) => (v.trim() ? null : 'Obligatoire'),
      clubId: (v, values) =>
        values.role === 'CLUB' && values.clubMode === 'existing' && !v ? 'Choisir un club' : null,
      clubName: (v, values) =>
        values.role === 'CLUB' && values.clubMode === 'new' && v.trim().length < 2
          ? 'Nom trop court'
          : null,
    },
  });
  const { role, clubMode } = form.values;
  const clubData = (clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }));

  const onSubmit = form.onSubmit(async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await adminControllerCreateUser({
        body: toBody(values),
      });
      if (!data) {
        // The generated client never throws: no response means a network failure.
        setError(response ? toFormError(apiError) : { message: UNAVAILABLE_MESSAGE });
        return;
      }
      void qc.invalidateQueries({ queryKey: ['admin'] });
      notifications.show(
        data.invitationSent
          ? { color: 'green', message: 'Utilisateur créé, invitation envoyée' }
          : {
              color: 'orange',
              message:
                "Utilisateur créé, mais l'email n'est pas parti : utilisez « Renvoyer l'invitation »",
            },
      );
      navigate(`/users/${data.userId}`);
    } catch {
      setError({ message: UNAVAILABLE_MESSAGE });
    } finally {
      setSubmitting(false);
    }
  });

  const existingName = error?.existingClubId
    ? clubs.data?.find((c) => c.id === error.existingClubId)?.name
    : undefined;

  return (
    <Stack maw={640}>
      <Title order={2}>Nouvel utilisateur</Title>
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
                form.setValues({ clubMode: 'existing', clubId: error.existingClubId ?? null });
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
          <Radio.Group label="Rôle" withAsterisk {...form.getInputProps('role')}>
            <Group mt="xs">
              {ROLES.map((r) => (
                <Radio key={r} value={r} label={ROLE_LABELS[r]} />
              ))}
            </Group>
          </Radio.Group>
          <TextInput label="Email" type="email" withAsterisk {...form.getInputProps('email')} />
          <TextInput label="Prénom" withAsterisk {...form.getInputProps('firstName')} />
          <TextInput label="Nom de famille" withAsterisk {...form.getInputProps('lastName')} />
          {role === 'CLUB' ? (
            <>
              <Radio.Group label="Club du compte" {...form.getInputProps('clubMode')}>
                <Group mt="xs">
                  <Radio value="existing" label="Club existant" />
                  <Radio value="new" label="Nouveau club" />
                </Group>
              </Radio.Group>
              {clubMode === 'existing' ? (
                <Select
                  label="Club existant"
                  withAsterisk
                  searchable
                  data={clubData}
                  {...form.getInputProps('clubId')}
                />
              ) : (
                <TextInput
                  label="Nom du nouveau club"
                  withAsterisk
                  {...form.getInputProps('clubName')}
                />
              )}
            </>
          ) : (
            <Select
              label="Club (facultatif)"
              clearable
              searchable
              data={clubData}
              {...form.getInputProps('clubId')}
            />
          )}
          {role === 'LICENSEE' && ref.data && (
            <>
              <Title order={4}>Profil (facultatif)</Title>
              <SimpleGrid cols={2}>
                <Select
                  label="Catégorie"
                  clearable
                  data={ref.data.categories}
                  {...form.getInputProps('category')}
                />
                <Select
                  label="Classe d'âge"
                  clearable
                  searchable
                  data={ref.data.ageGroups}
                  {...form.getInputProps('ageGroup')}
                />
                <Select
                  label="Niveau compétition"
                  clearable
                  data={ref.data.competitionLevels}
                  {...form.getInputProps('competitionLevel')}
                />
                <Select
                  label="Passeport Latine"
                  clearable
                  data={ref.data.passportLevels}
                  {...form.getInputProps('passportLevelLatin')}
                />
                <Select
                  label="Passeport Standard"
                  clearable
                  data={ref.data.passportLevels}
                  {...form.getInputProps('passportLevelStandard')}
                />
                <NumberInput
                  label="Classement national"
                  min={1}
                  max={100000}
                  allowDecimal={false}
                  {...form.getInputProps('nationalRanking')}
                />
              </SimpleGrid>
            </>
          )}
          <Button type="submit" loading={submitting}>
            Créer l'utilisateur
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}
