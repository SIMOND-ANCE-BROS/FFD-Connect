import {
  Badge,
  Button,
  CloseButton,
  Group,
  List,
  Modal,
  Pagination,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminControllerUpdateUser } from '../api/generated/sdk.gen';
import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { clubQuery, unwrap, usersQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { ROLE_LABELS } from '../lib/labels';
import {
  holdsClubRole,
  leavesAnotherClub,
  linkEach,
  type LinkOutcome,
  linkSummary,
  MAX_LINK_SELECTION,
} from '../lib/linkMembers';
import type { SortState } from '../lib/listSort';
import { useMemoryListParams } from '../lib/useListParams';
import {
  readUsersParams,
  USERS_FILTERS,
  USERS_FILTERS_CLEARED,
  USERS_SORT_FIELDS,
  type UsersSortField,
  usersFilter,
  writeUsersParams,
} from '../lib/userList';
import { useUrlSearch } from '../lib/useUrlSearch';
import { operatorFilters } from './ColumnFilterEditor';
import { DataTable, type RowSelection } from './DataTable';
import { EmptyState } from './ListStates';
import { ExtraRoles, userColumns } from './userColumns';

const PAGE_SIZE = 20;

type Club = { id: string; name: string };

interface Props {
  club: Club;
  opened: boolean;
  onClose: () => void;
}

const fullName = (u: AdminUserListItemDto) => `${u.firstName} ${u.lastName}`;
const accounts = (n: number) => `${n} compte${n > 1 ? 's' : ''}`;
const isUsersSortField = (value: string): value is UsersSortField =>
  USERS_SORT_FIELDS.some((f) => f === value);

/**
 * Attaches existing accounts to this club (#447, #558): the admin browses the
 * user list (same table, filters and sort as the Users page), ticks accounts
 * across pages and searches, reviews them once, and each one is linked by its
 * own audited PATCH clubId. A refused account never cancels the others.
 */
export function LinkMemberModal({ club, opened, onClose }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title="Lier des membres" size="72rem">
      <LinkMemberBody club={club} onClose={onClose} />
    </Modal>
  );
}

function LinkMemberBody({ club, onClose }: Omit<Props, 'opened'>) {
  const qc = useQueryClient();
  // Insertion-ordered, keyed by id: survives every page, sort, search and filter.
  const [selected, setSelected] = useState<ReadonlyMap<string, AdminUserListItemDto>>(new Map());
  const [step, setStep] = useState<'select' | 'confirm' | 'done'>('select');

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

  /** Ticks or unticks `users`, never past {@link MAX_LINK_SELECTION}. */
  const choose = (users: AdminUserListItemDto[], tick: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const user of users) {
        if (!tick) next.delete(user.id);
        else if (next.size < MAX_LINK_SELECTION) next.set(user.id, user);
      }
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
      <MemberTable
        club={club}
        selection={{
          isSelected: (u) => selected.has(u.id),
          isSelectable: (u) => u.clubId !== club.id,
          onChange: choose,
          label: (u) => `Sélectionner ${fullName(u)}`,
          disabledLabel: (u) => `${fullName(u)} : déjà membre`,
          full: selected.size >= MAX_LINK_SELECTION,
        }}
      />

      {selection.length > 0 && (
        <Paper withBorder p="sm">
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={500}>
              {selection.length > 1
                ? `${accounts(selection.length)} sélectionnés`
                : '1 compte sélectionné'}
            </Text>
            <Button variant="subtle" size="compact-sm" onClick={() => setSelected(new Map())}>
              Tout désélectionner
            </Button>
          </Group>
          {selected.size >= MAX_LINK_SELECTION && (
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
                    onClick={() => choose([u], false)}
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

/**
 * The user list of the back-office, in the dialog: search, operator filters,
 * sort and pages, kept in memory (the page URL stays the club's).
 */
function MemberTable({
  club,
  selection,
}: {
  club: Club;
  selection: RowSelection<AdminUserListItemDto>;
}) {
  const [state, update] = useMemoryListParams(readUsersParams, writeUsersParams);
  const [search, setSearch] = useUrlSearch(state.q, (q) => update({ q }));
  const users = useQuery({
    ...usersQuery(usersFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const ops = operatorFilters(USERS_FILTERS, state.filters, (filters) => update({ filters }));
  const total = users.data?.meta.total ?? 0;

  return (
    <>
      <DataTable
        tableId="link-members"
        columns={userColumns({ filter: ops.filter, recordLinks: false, memberOf: club.id })}
        rows={users.data?.data ?? []}
        rowKey={(u) => u.id}
        sort={state.sort}
        onSortChange={(sort: SortState | null) =>
          update({
            sort: sort && isUsersSortField(sort.by) ? { by: sort.by, order: sort.order } : null,
          })
        }
        onResetFilters={() => update(USERS_FILTERS_CLEARED)}
        filterChips={ops.chips}
        selection={selection}
        toolbar={
          <TextInput
            label="Rechercher un utilisateur"
            placeholder="Nom, prénom ou email"
            maw={{ sm: 360 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            data-autofocus
          />
        }
        loading={users.isPending}
        error={
          users.isError && apiErrorMessage(users.error, 'Impossible de charger les utilisateurs.')
        }
        summary={
          <Text size="sm" c="dimmed">
            {total} utilisateur{total > 1 ? 's' : ''}
          </Text>
        }
        empty={
          <EmptyState title="Aucun utilisateur">
            Aucun compte ne correspond à ces filtres.
          </EmptyState>
        }
        renderCard={(u) => (
          <Paper withBorder p="sm">
            <Text size="sm" fw={600}>
              {u.lastName} {u.firstName}
            </Text>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {u.email}
            </Text>
            <Group gap={4} mt={4}>
              <Badge variant="light" size="sm">
                {ROLE_LABELS[u.role]}
              </Badge>
              <ExtraRoles user={u} />
              {u.clubId === club.id ? (
                <Badge variant="light" color="gray" size="sm">
                  Déjà membre
                </Badge>
              ) : (
                <Text size="xs">{u.clubName ?? 'Sans club'}</Text>
              )}
            </Group>
          </Paper>
        )}
      />
      {!users.isError && total > PAGE_SIZE && (
        <Pagination
          size="sm"
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </>
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
