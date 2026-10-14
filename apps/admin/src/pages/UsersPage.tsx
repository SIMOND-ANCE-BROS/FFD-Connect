import { Anchor, Badge, Button, Group, Pagination, Stack, Text, TextInput } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router';
import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { usersQuery } from '../api/queries';
import { operatorFilters } from '../components/ColumnFilterEditor';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { StoreReviewBadge } from '../components/StoreReview';
import { apiErrorMessage } from '../lib/apiError';
import { formatDiscipline } from '../lib/discipline';
import { extraRoleLabels, ROLE_LABELS } from '../lib/labels';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
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

const PAGE_SIZE = 50;

const LICENSE_LABEL: Record<'ACTIVE' | 'EXPIRED', string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
};

const date = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY') : '—');
const isUsersSortField = (value: string): value is UsersSortField =>
  USERS_SORT_FIELDS.some((f) => f === value);

function ExtraRoles({ user }: { user: AdminUserListItemDto }) {
  if (user.extraRoles.length === 0) return <>—</>;
  return (
    <Group gap={4}>
      {extraRoleLabels(user.extraRoles).map((l) => (
        <Badge key={l} variant="outline" size="sm">
          {l}
        </Badge>
      ))}
    </Group>
  );
}

export function UsersPage() {
  const navigate = useNavigate();
  const [state, update] = useListParams(readUsersParams, writeUsersParams);
  const [search, setSearch] = useUrlSearch(state.q, (q) => update({ q }, { replace: true }));

  const users = useQuery({
    ...usersQuery(usersFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const ops = operatorFilters(USERS_FILTERS, state.filters, (filters) => update({ filters }));
  const total = users.data?.meta.total ?? 0;
  const rows = users.data?.data ?? [];

  const onSortChange = (sort: SortState | null) =>
    update({ sort: sort && isUsersSortField(sort.by) ? { by: sort.by, order: sort.order } : null });

  const columns: DataTableColumn<AdminUserListItemDto>[] = [
    {
      key: 'name',
      minWidth: 170,
      weight: 2,
      label: 'Nom',
      required: true,
      sortField: 'name',
      cell: (u) => (
        <>
          <Anchor
            component={Link}
            to={`/users/${u.id}`}
            onClick={(event) => event.stopPropagation()}
            fw={600}
          >
            {u.lastName} {u.firstName}
          </Anchor>
          {u.isStoreReview && <StoreReviewBadge />}
        </>
      ),
      filter: ops.filter('name'),
    },
    {
      key: 'email',
      minWidth: 170,
      weight: 2,
      priority: 1,
      label: 'Email',
      sortField: 'email',
      cell: (u) => u.email,
      filter: ops.filter('email'),
    },
    {
      key: 'role',
      minWidth: 165,
      priority: 2,
      label: 'Rôle principal',
      sortField: 'role',
      cell: (u) => <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>,
      filter: ops.filter('role'),
    },
    {
      key: 'extraRoles',
      minWidth: 170,
      weight: 1.5,
      priority: 9,
      wrap: true,
      label: 'Rôles supplémentaires',
      cell: (u) => <ExtraRoles user={u} />,
    },
    {
      key: 'status',
      minWidth: 120,
      priority: 4,
      label: 'Compte',
      cell: (u) =>
        u.disabledAt ? (
          <Badge color="red" variant="light">
            Désactivé
          </Badge>
        ) : (
          'Actif'
        ),
      filter: ops.filter('status'),
    },
    {
      key: 'club',
      minWidth: 140,
      weight: 1.5,
      priority: 3,
      label: 'Club',
      sortField: 'club',
      cell: (u) => u.clubName ?? '—',
      filter: ops.filter('club'),
    },
    {
      key: 'category',
      minWidth: 145,
      priority: 5,
      label: 'Catégorie',
      sortField: 'category',
      cell: (u) => (u.category ? formatDiscipline(u.category) : '—'),
      filter: ops.filter('category'),
    },
    {
      key: 'ageGroup',
      minWidth: 140,
      priority: 8,
      label: "Classe d'âge",
      sortField: 'ageGroup',
      cell: (u) => u.ageGroup ?? '—',
      filter: ops.filter('ageGroup'),
    },
    {
      key: 'license',
      minWidth: 90,
      priority: 7,
      label: 'Licence',
      cell: (u) => (u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'),
    },
    {
      key: 'licenseNumber',
      minWidth: 130,
      priority: 10,
      label: 'N° de licence',
      hiddenByDefault: true,
      cell: (u) => u.licenseNumber ?? '—',
      filter: ops.filter('licenseNumber'),
    },
    {
      key: 'createdAt',
      minWidth: 155,
      priority: 6,
      label: 'Inscription',
      sortField: 'createdAt',
      cell: (u) => date(u.createdAt),
      filter: ops.filter('createdAt'),
    },
    {
      key: 'lastLoginAt',
      minWidth: 160,
      priority: 11,
      label: 'Dernière connexion',
      sortField: 'lastLoginAt',
      hiddenByDefault: true,
      cell: (u) => date(u.lastLoginAt),
      filter: ops.filter('lastLoginAt'),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Utilisateurs"
        actions={
          <Button component={Link} to="/users/new">
            Nouvel utilisateur
          </Button>
        }
      />
      <DataTable
        tableId="users"
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        sort={state.sort}
        onSortChange={onSortChange}
        onResetFilters={() => update(USERS_FILTERS_CLEARED)}
        filterChips={ops.chips}
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        toolbar={
          <TextInput
            label="Rechercher un utilisateur"
            placeholder="Nom, prénom ou email"
            maw={{ sm: 360 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
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
          <RecordCard
            to={`/users/${u.id}`}
            title={`${u.lastName} ${u.firstName}`}
            badges={
              <>
                <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>
                {u.disabledAt && (
                  <Badge color="red" variant="light">
                    Désactivé
                  </Badge>
                )}
                {u.isStoreReview && <StoreReviewBadge />}
              </>
            }
          >
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {u.email}
            </Text>
            {u.extraRoles.length > 0 && <ExtraRoles user={u} />}
            {u.clubName && <RecordLine label="Club">{u.clubName}</RecordLine>}
            {u.category && (
              <RecordLine label="Catégorie">
                {formatDiscipline(u.category)}
                {u.ageGroup && ` · ${u.ageGroup}`}
              </RecordLine>
            )}
            <RecordLine label="Licence">
              {u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'} · inscrit le{' '}
              {date(u.createdAt)}
            </RecordLine>
          </RecordCard>
        )}
      />
      {!users.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
