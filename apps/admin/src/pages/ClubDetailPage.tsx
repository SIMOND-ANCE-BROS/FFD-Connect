import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  List,
  Loader,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  adminControllerDeleteClub,
  adminControllerSetClubStatus,
  adminControllerUpdateClub,
} from '../api/generated/sdk.gen';
import type { AdminClubDetailDto, ClubRegistrationMode } from '../api/generated/types.gen';
import { auditQuery, clubQuery, ensureOk, unwrap } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { apiErrorMessage } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { REGISTRATION_MODE_LABELS, ROLE_LABELS } from '../lib/labels';

interface ClubForm {
  name: string;
  registrationMode: ClubRegistrationMode;
}

type UsageKey =
  | 'memberCount'
  | 'clubAccountCount'
  | 'competitionCount'
  | 'partnershipCount'
  | 'soloTeamCount';

/** [singular, plural] for each thing that blocks a deletion. */
const USAGE_LABELS: Record<UsageKey, [string, string]> = {
  memberCount: ['membre', 'membres'],
  clubAccountCount: ['compte Club', 'comptes Club'],
  competitionCount: ['compétition organisée', 'compétitions organisées'],
  partnershipCount: ['couple rattaché', 'couples rattachés'],
  soloTeamCount: ['équipe solo', 'équipes solo'],
};
const USAGE_KEYS = Object.keys(USAGE_LABELS) as UsageKey[];

/** Non-zero usage lines, from the club detail or from a 409 body. */
function usageLines(source: unknown): string[] {
  if (typeof source !== 'object' || source === null) return [];
  const counts = source as Partial<Record<UsageKey, unknown>>;
  return USAGE_KEYS.flatMap((key) => {
    const n = counts[key];
    if (typeof n !== 'number' || n === 0) return [];
    const [one, many] = USAGE_LABELS[key];
    return [`${n} ${n > 1 ? many : one}`];
  });
}

const MODE_OPTIONS = (Object.keys(REGISTRATION_MODE_LABELS) as ClubRegistrationMode[]).map(
  (value) => ({ value, label: REGISTRATION_MODE_LABELS[value] }),
);

export function ClubDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const club = useQuery(clubQuery(id));
  const history = useQuery(auditQuery({ targetType: 'CLUB', targetId: id, skip: 0, take: 20 }));
  const [pending, setPending] = useState<Partial<ClubForm> | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const form = useForm<ClubForm>({
    initialValues: { name: '', registrationMode: 'MEMBERS_AUTO_CONFIRM' },
    validate: { name: (v) => (v.trim().length >= 2 ? null : 'Nom trop court') },
  });
  const { setValues } = form;
  useEffect(() => {
    if (club.data) {
      setValues({ name: club.data.name, registrationMode: club.data.registrationMode });
    }
  }, [club.data, setValues]);

  const applyUpdate = (updated: AdminClubDetailDto) => {
    qc.setQueryData(clubQuery(id).queryKey, updated);
    void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const save = useMutation({
    mutationFn: (body: Partial<ClubForm>) =>
      unwrap(adminControllerUpdateClub({ path: { id }, body })),
    onSuccess: (updated) => {
      applyUpdate(updated);
      // A rename rewrites the club name on every member.
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'user'] });
      setPending(null);
      notifications.show({ color: 'green', message: 'Club mis à jour' });
    },
  });

  const setStatus = useMutation({
    mutationFn: (active: boolean) =>
      unwrap(adminControllerSetClubStatus({ path: { id }, body: { active } })),
    onSuccess: (updated) => {
      applyUpdate(updated);
      setStatusOpen(false);
      setDeleteOpen(false);
      notifications.show({
        color: 'green',
        message: updated.disabledAt ? 'Club désactivé' : 'Club réactivé',
      });
    },
    onError: (e) =>
      notifications.show({
        color: 'red',
        message: apiErrorMessage(e, 'Changement de statut impossible'),
      }),
  });

  const remove = useMutation({
    mutationFn: () => ensureOk(adminControllerDeleteClub({ path: { id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
      notifications.show({ color: 'green', message: 'Club supprimé' });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      navigate('/clubs', { replace: true });
      qc.removeQueries({ queryKey: clubQuery(id).queryKey });
    },
    // A 409 means the club filled up since it was loaded: refresh the danger zone.
    onError: () => void qc.invalidateQueries({ queryKey: clubQuery(id).queryKey }),
  });

  if (club.isError) return <Alert color="red">Club introuvable ou erreur serveur.</Alert>;
  if (!club.data) return <Loader />;
  const c = club.data;
  const disabled = c.disabledAt !== null;
  const blocking = usageLines(c);
  // Counts only come with a 409; a network or server failure keeps the retry button.
  const deleteBlockers = remove.isError ? usageLines(remove.error) : [];

  const onSubmit = form.onSubmit((v) => {
    const changes: Partial<ClubForm> = {};
    if (v.name.trim() !== c.name) changes.name = v.name.trim();
    if (v.registrationMode !== c.registrationMode) changes.registrationMode = v.registrationMode;
    if (Object.keys(changes).length) {
      save.reset();
      setPending(changes);
    }
  });

  const closeDelete = () => {
    setDeleteOpen(false);
    remove.reset();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>{c.name}</Title>
          {disabled && (
            <Badge color="red" variant="light">
              Désactivé
            </Badge>
          )}
        </Group>
        <Button
          variant="light"
          color={disabled ? 'green' : 'red'}
          onClick={() => setStatusOpen(true)}
        >
          {disabled ? 'Réactiver le club' : 'Désactiver le club'}
        </Button>
      </Group>
      {disabled && (
        <Alert color="red" title="Club désactivé">
          Depuis le {dayjs(c.disabledAt).format('DD/MM/YYYY HH:mm')}, ses comptes Club ne peuvent
          plus se connecter. Ses licenciés ne sont pas affectés.
        </Alert>
      )}
      <Card withBorder>
        <SimpleGrid cols={3}>
          <Text size="sm">Création : {dayjs(c.createdAt).format('DD/MM/YYYY')}</Text>
          <Text size="sm">HelloAsso : {c.helloAssoConfigured ? 'configuré' : 'non configuré'}</Text>
          <Text size="sm">
            Membres : {c.memberCount} · comptes Club : {c.clubAccountCount}
          </Text>
        </SimpleGrid>
      </Card>

      <form onSubmit={onSubmit}>
        <SimpleGrid cols={2}>
          <TextInput label="Nom du club" withAsterisk {...form.getInputProps('name')} />
          <Select
            label="Mode d'inscription"
            allowDeselect={false}
            data={MODE_OPTIONS}
            {...form.getInputProps('registrationMode')}
          />
        </SimpleGrid>
        <Group mt="md">
          <Button type="submit">Enregistrer</Button>
        </Group>
      </form>

      <Card withBorder style={{ borderColor: 'var(--mantine-color-red-6)' }}>
        <Stack gap="xs">
          <Title order={4} c="red">
            Zone dangereuse
          </Title>
          {blocking.length ? (
            <>
              <Text size="sm">Ce club ne peut pas être supprimé, il compte encore :</Text>
              <List size="sm">
                {blocking.map((line) => (
                  <List.Item key={line}>{line}</List.Item>
                ))}
              </List>
            </>
          ) : (
            <Text size="sm">Ce club est vide : il peut être supprimé définitivement.</Text>
          )}
          <Group>
            <Button
              color="red"
              variant="outline"
              disabled={blocking.length > 0}
              onClick={() => setDeleteOpen(true)}
            >
              Supprimer le club
            </Button>
            {blocking.length > 0 && !disabled && (
              <Button variant="light" color="red" onClick={() => setStatusOpen(true)}>
                Désactiver à la place
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      <Title order={4}>Membres</Title>
      {c.members.length ? (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Nom</Table.Th>
              <Table.Th>Email</Table.Th>
              <Table.Th>Rôle</Table.Th>
              <Table.Th>Statut</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {c.members.map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/users/${m.id}`}>
                    {m.lastName} {m.firstName}
                  </Anchor>
                </Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{ROLE_LABELS[m.role]}</Table.Td>
                <Table.Td>
                  {m.disabledAt ? (
                    <Badge color="red" variant="light">
                      Désactivé
                    </Badge>
                  ) : (
                    'Actif'
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Text size="sm" c="dimmed">
          Aucun membre.
        </Text>
      )}
      {c.members.length < c.memberCount + c.clubAccountCount && (
        <Text size="xs" c="dimmed">
          Liste limitée aux {c.members.length} premiers membres.
        </Text>
      )}

      <Title order={4}>Historique admin</Title>
      {history.isError ? (
        <Alert color="red">Impossible de charger l'historique.</Alert>
      ) : history.data?.data.length ? (
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

      <Modal
        opened={pending !== null}
        onClose={() => setPending(null)}
        title="Confirmer les modifications"
      >
        {pending && (
          <Stack>
            <ChangeSummary
              before={Object.fromEntries(
                Object.keys(pending).map((k) => [k, c[k as keyof ClubForm]]),
              )}
              after={Object.fromEntries(Object.entries(pending))}
            />
            {pending.name !== undefined && (
              <Text size="sm">
                Le nouveau nom sera reporté sur les fiches des membres, leurs licences et les
                compétitions organisées par ce club.
              </Text>
            )}
            {save.isError && (
              <Alert color="red">{apiErrorMessage(save.error, "Échec de l'enregistrement")}</Alert>
            )}
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

      <Modal
        opened={statusOpen}
        onClose={() => setStatusOpen(false)}
        title={disabled ? 'Réactiver ce club' : 'Désactiver ce club'}
      >
        <Stack>
          <Text size="sm">
            {disabled
              ? 'Les comptes Club de ce club pourront de nouveau se connecter.'
              : 'Les comptes Club de ce club sont déconnectés immédiatement et ne peuvent plus se connecter. Ses licenciés ne sont pas affectés.'}
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

      <Modal opened={deleteOpen} onClose={closeDelete} title="Supprimer ce club">
        <Stack>
          <Text size="sm">Le club « {c.name} » sera supprimé définitivement.</Text>
          {remove.isError && (
            <Alert color="red" title={apiErrorMessage(remove.error, 'Suppression impossible')}>
              {deleteBlockers.length > 0 && (
                <List size="sm">
                  {deleteBlockers.map((line) => (
                    <List.Item key={line}>{line}</List.Item>
                  ))}
                </List>
              )}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              Annuler
            </Button>
            {deleteBlockers.length > 0 && !disabled ? (
              <Button color="red" variant="light" onClick={() => setStatusOpen(true)}>
                Désactiver à la place
              </Button>
            ) : (
              <Button color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
                Supprimer définitivement
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
