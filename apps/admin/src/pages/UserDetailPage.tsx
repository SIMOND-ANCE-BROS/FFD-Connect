import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import {
  adminControllerResendInvitation,
  adminControllerUpdateUser,
} from '../api/generated/sdk.gen';
import type { AdminControllerUpdateUserData } from '../api/generated/types.gen';
import { auditQuery, clubsQuery, referenceQuery, unwrap, userQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { changedFields, type EditableFields, withLegacy } from '../lib/diff';
import { useSession } from '../session/sessionStore';

type UpdateBody = AdminControllerUpdateUserData['body'];

/**
 * The form holds plain strings while the DTO types reference-backed fields as
 * literal unions. Every Select only offers reference values (plus the legacy
 * one, which changedFields never sends unless the admin re-picks it), and the
 * backend validates the enum anyway, so this single widening cast is safe.
 */
function toUpdateBody(changes: Partial<EditableFields>): UpdateBody {
  return changes as UpdateBody;
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const me = useSession((s) => s.user);
  const qc = useQueryClient();
  const user = useQuery(userQuery(id));
  const clubs = useQuery(clubsQuery);
  const ref = useQuery(referenceQuery);
  const history = useQuery(auditQuery({ targetType: 'USER', targetId: id, skip: 0, take: 20 }));
  const [pending, setPending] = useState<Partial<EditableFields> | null>(null);

  const initial = useMemo<EditableFields | null>(() => {
    const u = user.data;
    if (!u) return null;
    return {
      firstName: u.firstName,
      lastName: u.lastName,
      clubId: u.clubId,
      category: u.category,
      ageGroup: u.ageGroup,
      passportLevelLatin: u.passportLevelLatin ?? null,
      passportLevelStandard: u.passportLevelStandard ?? null,
      competitionLevel: u.competitionLevel,
      nationalRanking: u.nationalRanking,
      role: u.role,
    };
  }, [user.data]);

  const form = useForm<EditableFields>({
    initialValues: {
      firstName: '',
      lastName: '',
      clubId: null,
      category: null,
      ageGroup: null,
      passportLevelLatin: null,
      passportLevelStandard: null,
      competitionLevel: null,
      nationalRanking: null,
      role: '',
    },
    // The backend rejects null names; block the save instead of a 400.
    validate: {
      firstName: (v) => (v.trim() ? null : 'Obligatoire'),
      lastName: (v) => (v.trim() ? null : 'Obligatoire'),
    },
  });
  const { setValues } = form;
  useEffect(() => {
    if (initial) setValues(initial);
  }, [initial, setValues]);

  const save = useMutation({
    mutationFn: (body: Partial<EditableFields>) =>
      unwrap(adminControllerUpdateUser({ path: { id }, body: toUpdateBody(body) })),
    onSuccess: (updated) => {
      qc.setQueryData(userQuery(id).queryKey, updated);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setPending(null);
      notifications.show({ color: 'green', message: 'Fiche mise à jour' });
    },
    onError: () => notifications.show({ color: 'red', message: "Échec de l'enregistrement" }),
  });

  const resend = useMutation({
    mutationFn: () => unwrap(adminControllerResendInvitation({ path: { id } })),
    onSuccess: (r) =>
      notifications.show(
        r.invitationSent
          ? { color: 'green', message: 'Invitation renvoyée' }
          : {
              color: 'orange',
              message: "Envoi de l'email impossible, réessayez plus tard",
            },
      ),
    onError: () => notifications.show({ color: 'red', message: 'Renvoi impossible' }),
  });

  if (user.isError) {
    return <Alert color="red">Utilisateur introuvable ou erreur serveur.</Alert>;
  }
  if (!user.data || !initial || !ref.data) return <Loader />;
  const u = user.data;
  const isSelf = me?.id === u.id;
  const clubName = (cid: unknown) =>
    clubs.data?.find((c) => c.id === cid)?.name ?? (cid ? String(cid) : null);
  const displayBefore = (k: string): unknown =>
    k === 'clubId' ? u.clubName : initial[k as keyof EditableFields];

  const onSubmit = form.onSubmit((values) => {
    const changes = changedFields(initial, values);
    if (Object.keys(changes).length) setPending(changes);
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>
          {u.firstName} {u.lastName}
        </Title>
        {u.lastLoginAt === null && (
          <Button variant="light" loading={resend.isPending} onClick={() => resend.mutate()}>
            Renvoyer l'invitation
          </Button>
        )}
      </Group>
      <Card withBorder>
        <SimpleGrid cols={3}>
          <Text size="sm">Email : {u.email}</Text>
          <Text size="sm">
            Licence : {u.licenseNumber ?? '—'}
            {u.licenseValidUntil &&
              ` (jusqu'au ${dayjs(u.licenseValidUntil).format('DD/MM/YYYY')})`}
          </Text>
          <Text size="sm">WDSF : {u.wdsfMin ?? '—'}</Text>
          <Text size="sm">Inscription : {dayjs(u.createdAt).format('DD/MM/YYYY')}</Text>
          <Text size="sm">
            Dernière connexion :{' '}
            {u.lastLoginAt ? dayjs(u.lastLoginAt).format('DD/MM/YYYY HH:mm') : 'jamais'}
          </Text>
        </SimpleGrid>
      </Card>
      <form onSubmit={onSubmit}>
        <SimpleGrid cols={2}>
          <TextInput label="Prénom" withAsterisk {...form.getInputProps('firstName')} />
          <TextInput label="Nom" withAsterisk {...form.getInputProps('lastName')} />
          <Select
            label="Club"
            clearable
            searchable
            data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            {...form.getInputProps('clubId')}
          />
          <Select
            label="Catégorie"
            clearable
            data={withLegacy(ref.data.categories, initial.category)}
            {...form.getInputProps('category')}
          />
          <Select
            label="Classe d'âge"
            clearable
            searchable
            data={withLegacy(ref.data.ageGroups, initial.ageGroup)}
            {...form.getInputProps('ageGroup')}
          />
          <Select
            label="Niveau compétition"
            clearable
            data={withLegacy(ref.data.competitionLevels, initial.competitionLevel)}
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
          <Select
            label="Rôle"
            data={ref.data.roles}
            disabled={isSelf}
            description={isSelf ? 'Vous ne pouvez pas modifier votre propre rôle' : undefined}
            {...form.getInputProps('role')}
          />
        </SimpleGrid>
        <Group mt="md">
          <Button type="submit">Enregistrer</Button>
        </Group>
      </form>

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Confirmer les modifications"
      >
        {pending && (
          <Stack>
            <ChangeSummary
              before={Object.fromEntries(Object.keys(pending).map((k) => [k, displayBefore(k)]))}
              after={Object.fromEntries(
                Object.entries(pending).map(([k, v]) => [k, k === 'clubId' ? clubName(v) : v]),
              )}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setPending(null)}>
                Annuler
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate(pending)}>
                Confirmer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Title order={4}>Historique admin</Title>
      {history.data?.data.length ? (
        history.data.data.map((h) => (
          <Card key={h.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(h.createdAt).format('DD/MM/YYYY HH:mm')} — {h.action} par{' '}
              {h.actorName ?? 'admin supprimé'}
            </Text>
            {h.after && <ChangeSummary before={h.before ?? {}} after={h.after} />}
          </Card>
        ))
      ) : (
        <Text size="sm" c="dimmed">
          Aucune modification admin.
        </Text>
      )}
    </Stack>
  );
}
