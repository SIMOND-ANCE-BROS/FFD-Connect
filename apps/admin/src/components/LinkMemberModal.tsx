import {
  Alert,
  Badge,
  Button,
  Checkbox,
  CloseButton,
  Group,
  List,
  Loader,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminControllerUpdateUser } from '../api/generated/sdk.gen';
import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { clubQuery, unwrap, usersQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { extraRoleLabels, ROLE_LABELS } from '../lib/labels';
import {
  holdsClubRole,
  leavesAnotherClub,
  linkEach,
  type LinkOutcome,
  linkSummary,
  MAX_LINK_SELECTION,
} from '../lib/linkMembers';

const MIN_SEARCH_LENGTH = 2;
const RESULTS = 10;

type Club = { id: string; name: string };

interface Props {
  club: Club;
  opened: boolean;
  onClose: () => void;
}

const fullName = (u: AdminUserListItemDto) => `${u.firstName} ${u.lastName}`;
const accounts = (n: number) => `${n} compte${n > 1 ? 's' : ''}`;

/**
 * Attaches existing accounts to this club (#447): the admin ticks accounts across
 * several searches, reviews them once, and each one is linked by its own audited
 * PATCH clubId. A refused account never cancels the others.
 */
export function LinkMemberModal({ club, opened, onClose }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title="Lier des membres" size="lg">
      <LinkMemberBody club={club} onClose={onClose} />
    </Modal>
  );
}

function LinkMemberBody({ club, onClose }: Omit<Props, 'opened'>) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  // Insertion-ordered, keyed by id: survives every new search.
  const [selected, setSelected] = useState<ReadonlyMap<string, AdminUserListItemDto>>(new Map());
  const [step, setStep] = useState<'select' | 'confirm' | 'done'>('select');
  const searching = debounced.length >= MIN_SEARCH_LENGTH;
  const results = useQuery({
    ...usersQuery({ search: debounced, skip: 0, take: RESULTS }),
    enabled: searching,
  });

  const link = useMutation({
    mutationFn: (users: AdminUserListItemDto[]) =>
      linkEach(users, (user) =>
        unwrap(adminControllerUpdateUser({ path: { id: user.id }, body: { clubId: club.id } })),
      ),
    onSuccess: (outcomes) => {
      setStep('done');
      const failed = outcomes.some((o) => !o.ok);
      notifications.show({ color: failed ? 'orange' : 'green', message: linkSummary(outcomes) });
      if (outcomes.some((o) => o.ok)) {
        void qc.invalidateQueries({ queryKey: clubQuery(club.id).queryKey });
        void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'user'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'clubs'] });
        void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      }
    },
  });

  const selection = [...selected.values()];
  const full = selected.size >= MAX_LINK_SELECTION;

  const toggle = (user: AdminUserListItemDto) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });

  if (step === 'done' && link.data) {
    const outcomes = link.data;
    const failed = outcomes.filter((o) => !o.ok).map((o) => o.user);
    return (
      <Stack>
        <Text fw={500}>{linkSummary(outcomes)}</Text>
        <OutcomeList outcomes={outcomes} />
        <Group justify="flex-end">
          {failed.length > 0 && (
            <Button
              variant="default"
              onClick={() => {
                // Keep only the refused accounts, to fix and retry them.
                setSelected(new Map(failed.map((u) => [u.id, u])));
                link.reset();
                setStep('select');
              }}
            >
              Revenir aux refusés
            </Button>
          )}
          <Button onClick={onClose}>Fermer</Button>
        </Group>
      </Stack>
    );
  }

  if (step === 'confirm') {
    return (
      <Stack>
        <Text>
          Ajouter {accounts(selection.length)} à {club.name} :
        </Text>
        <List spacing="xs">
          {selection.map((u) => (
            <List.Item key={u.id}>
              <Text size="sm" fw={500}>
                {fullName(u)}
              </Text>
              {holdsClubRole(u) && (
                <Text size="sm" c="orange">
                  {fullName(u)} deviendra gestionnaire de {club.name}
                </Text>
              )}
              {leavesAnotherClub(u, club) && (
                <Text size="sm" c="orange">
                  {fullName(u)} quitte {u.clubName} pour {club.name}
                </Text>
              )}
            </List.Item>
          ))}
        </List>
        <Group justify="flex-end">
          <Button variant="default" disabled={link.isPending} onClick={() => setStep('select')}>
            Annuler
          </Button>
          <Button loading={link.isPending} onClick={() => link.mutate(selection)}>
            Confirmer
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack>
      <TextInput
        label="Rechercher un utilisateur"
        placeholder="Nom, prénom ou email"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        data-autofocus
      />
      {!searching ? (
        <Text size="sm" c="dimmed">
          Saisissez au moins {MIN_SEARCH_LENGTH} caractères.
        </Text>
      ) : results.isError ? (
        <Alert color="red">
          {apiErrorMessage(results.error, 'Impossible de charger les utilisateurs.')}
        </Alert>
      ) : results.isPending ? (
        <Loader size="sm" />
      ) : results.data.data.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun utilisateur trouvé.
        </Text>
      ) : (
        <>
          <Table>
            <Table.Tbody>
              {results.data.data.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td w={40}>
                    {u.clubId !== club.id && (
                      <Checkbox
                        checked={selected.has(u.id)}
                        disabled={full && !selected.has(u.id)}
                        onChange={() => toggle(u)}
                        aria-label={`Sélectionner ${fullName(u)}`}
                      />
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {u.lastName} {u.firstName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {u.email}
                    </Text>
                    <Group gap={4} mt={4}>
                      <Badge variant="light" size="sm">
                        {ROLE_LABELS[u.role]}
                      </Badge>
                      {extraRoleLabels(u.extraRoles).map((l) => (
                        <Badge key={l} variant="outline" size="sm">
                          {l}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {u.clubId === club.id ? (
                      <Text size="sm" c="dimmed">
                        Déjà membre
                      </Text>
                    ) : (
                      (u.clubName ?? 'Sans club')
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {results.data.meta.total > results.data.data.length && (
            <Text size="sm" c="dimmed">
              Affinez la recherche
            </Text>
          )}
        </>
      )}

      {selection.length > 0 && (
        <Paper withBorder p="sm">
          <Text size="sm" fw={500} mb="xs">
            {selection.length > 1
              ? `${accounts(selection.length)} sélectionnés`
              : '1 compte sélectionné'}
          </Text>
          {full && (
            <Text size="xs" c="dimmed" mb="xs">
              {MAX_LINK_SELECTION} comptes au plus par ajout.
            </Text>
          )}
          <Group gap="xs">
            {selection.map((u) => (
              <Badge
                key={u.id}
                variant="light"
                size="lg"
                tt="none"
                rightSection={
                  <CloseButton
                    size="xs"
                    onClick={() => toggle(u)}
                    aria-label={`Retirer ${fullName(u)}`}
                  />
                }
              >
                {fullName(u)}
              </Badge>
            ))}
          </Group>
        </Paper>
      )}

      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Fermer
        </Button>
        <Button disabled={selection.length === 0} onClick={() => setStep('confirm')}>
          {selection.length > 0 ? `Ajouter ${accounts(selection.length)}` : 'Ajouter'}
        </Button>
      </Group>
    </Stack>
  );
}

function OutcomeList({ outcomes }: { outcomes: readonly LinkOutcome[] }) {
  return (
    <Table>
      <Table.Tbody>
        {outcomes.map((o) => (
          <Table.Tr key={o.user.id}>
            <Table.Td>
              <Text size="sm" fw={500}>
                {fullName(o.user)}
              </Text>
              {!o.ok && (
                <Text size="xs" c="red">
                  {o.error}
                </Text>
              )}
            </Table.Td>
            <Table.Td w={100}>
              <Badge color={o.ok ? 'green' : 'red'} variant="light">
                {o.ok ? 'Ajouté' : 'Refusé'}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
