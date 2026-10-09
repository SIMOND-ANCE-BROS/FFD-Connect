import {
  Alert,
  Button,
  Card,
  Checkbox,
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
import { useNavigate, useParams } from 'react-router';
import {
  adminControllerDeleteUser,
  adminControllerResendInvitation,
  adminControllerSetUserStatus,
  adminControllerUpdateUser,
} from '../api/generated/sdk.gen';
import type { AdminControllerUpdateUserData, UserRole } from '../api/generated/types.gen';
import {
  auditQuery,
  clubOptionsQuery,
  ensureOk,
  referenceQuery,
  unwrap,
  userQuery,
} from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { apiErrorMessage } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { ROLE_LABELS } from '../lib/labels';
import { changedFields, type EditableFields, withLegacy } from '../lib/diff';
import { formatDiscipline } from '../lib/discipline';
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
  const clubs = useQuery(clubOptionsQuery(user.data?.clubId));
  const ref = useQuery(referenceQuery);
  const history = useQuery(auditQuery({ targetType: 'USER', targetId: id, skip: 0, take: 20 }));
  const [pending, setPending] = useState<Partial<EditableFields> | null>(null);
  const navigate = useNavigate();
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState('');

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
      extraRoles: u.extraRoles,
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
      extraRoles: [],
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
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, "Échec de l'enregistrement"),
      }),
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

  const setStatus = useMutation({
    mutationFn: (active: boolean) =>
      unwrap(adminControllerSetUserStatus({ path: { id }, body: { active } })),
    onSuccess: (updated) => {
      qc.setQueryData(userQuery(id).queryKey, updated);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      setStatusOpen(false);
      notifications.show({
        color: 'green',
        message: updated.disabledAt ? 'Compte désactivé' : 'Compte réactivé',
      });
    },
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, 'Changement de statut impossible'),
      }),
  });

  const remove = useMutation({
    mutationFn: (confirmEmail: string) =>
      ensureOk(adminControllerDeleteUser({ path: { id }, body: { confirmEmail } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      notifications.show({ color: 'green', message: 'Compte supprimé' });
      navigate('/users', { replace: true });
      qc.removeQueries({ queryKey: userQuery(id).queryKey });
    },
  });

  if (user.isError) {
    return <Alert color="red">Utilisateur introuvable ou erreur serveur.</Alert>;
  }
  if (!user.data || !initial || !ref.data) return <Loader />;
  const u = user.data;
  const isSelf = me?.id === u.id;
  const disabled = u.disabledAt != null;
  // lastLoginAt is recorded at login and refresh since lot 1; null = never used.
  // Only back-office accounts get an invitation; a CLUB account of a disabled
  // club could not log in anyway (the server refuses both cases too).
  const canResend =
    u.createdByAdmin &&
    !u.roles.includes('ADMIN') &&
    u.lastLoginAt === null &&
    !disabled &&
    !(u.role === 'CLUB' && u.clubDisabledAt !== null);
  const emailMatches = typedEmail.trim().toLowerCase() === u.email.toLowerCase();
  const closeDelete = () => {
    setDeleteOpen(false);
    setTypedEmail('');
    remove.reset();
  };
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
        <Group>
          {canResend && (
            <Button variant="light" loading={resend.isPending} onClick={() => resend.mutate()}>
              Renvoyer l'invitation
            </Button>
          )}
          {!isSelf && (
            <Button
              variant="light"
              color={disabled ? 'green' : 'red'}
              onClick={() => setStatusOpen(true)}
            >
              {disabled ? 'Réactiver' : 'Désactiver'}
            </Button>
          )}
        </Group>
      </Group>
      {disabled && (
        <Alert color="red" title="Compte désactivé">
          Désactivé le {dayjs(u.disabledAt).format('DD/MM/YYYY HH:mm')} : connexion et accès
          refusés. Les données restent intactes.
        </Alert>
      )}
      {!disabled && u.role === 'CLUB' && u.clubDisabledAt && (
        <Alert color="orange" title="Club désactivé">
          Le club de ce compte est désactivé : la connexion est refusée tant que le club n'est pas
          réactivé.
        </Alert>
      )}
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
            {u.lastLoginAt ? dayjs(u.lastLoginAt).format('DD/MM/YYYY HH:mm') : 'inconnue'}
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
            data={withLegacy(ref.data.categories, initial.category, formatDiscipline)}
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
            onChange={(v) => {
              form.setFieldValue('role', v ?? '');
              form.setFieldValue(
                'extraRoles',
                form.values.extraRoles.filter((r) => r !== v),
              );
            }}
          />
          <Checkbox.Group
            label="Rôles supplémentaires"
            description="Droits cumulés avec le rôle principal"
            {...form.getInputProps('extraRoles')}
          >
            <Group mt="xs">
              {(Object.keys(ROLE_LABELS) as UserRole[])
                .filter((r) => r !== form.values.role)
                .map((r) => (
                  <Checkbox
                    key={r}
                    value={r}
                    label={ROLE_LABELS[r]}
                    disabled={isSelf && r === 'ADMIN' && u.role !== 'ADMIN'}
                  />
                ))}
            </Group>
          </Checkbox.Group>
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

      {!isSelf && (
        <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
          <Stack gap="xs">
            <Title order={4} c="red">
              Zone dangereuse
            </Title>
            <Text size="sm">
              La suppression efface définitivement le compte et ses données personnelles (droit à
              l'oubli). Pour une mesure réversible, désactivez le compte.
            </Text>
            <Group>
              <Button color="red" variant="outline" onClick={() => setDeleteOpen(true)}>
                Supprimer le compte
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Modal
        opened={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={disabled ? 'Réactiver ce compte' : 'Désactiver ce compte'}
      >
        <Stack>
          <Text size="sm">
            {disabled
              ? "L'utilisateur pourra de nouveau se connecter."
              : "L'utilisateur est déconnecté immédiatement et ne peut plus se connecter. Ses données restent intactes ; la désactivation est réversible."}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setStatusOpen(false)}>
              Annuler
            </Button>
            <Button
              color={disabled ? 'green' : 'red'}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate(disabled)}
            >
              {disabled ? 'Réactiver' : 'Désactiver'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpen} onClose={closeDelete} title="Supprimer définitivement ce compte">
        <Stack>
          <Text size="sm">
            Toutes les données de {u.firstName} {u.lastName} seront effacées : inscriptions,
            réservations, notifications, documents. Cette action est irréversible.
          </Text>
          {remove.isError && (
            <Alert color="red">{apiErrorMessage(remove.error, 'Suppression impossible')}</Alert>
          )}
          <TextInput
            label="Recopiez l'email du compte pour confirmer"
            placeholder={u.email}
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Annuler
            </Button>
            <Button
              color="red"
              disabled={!emailMatches}
              loading={remove.isPending}
              onClick={() => remove.mutate(typedEmail.trim())}
            >
              Supprimer définitivement
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Title order={4}>Historique admin</Title>
      {history.data?.data.length ? (
        history.data.data.map((h) => (
          <Card key={h.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(h.createdAt).format('DD/MM/YYYY HH:mm')} —{' '}
              {ACTION_LABELS[h.action] ?? h.action} par {h.actorName ?? 'admin supprimé'}
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
