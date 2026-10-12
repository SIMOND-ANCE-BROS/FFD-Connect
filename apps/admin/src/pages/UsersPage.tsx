import {
  Anchor,
  Badge,
  Button,
  Group,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router';
import type { AdminUserListItemDto, UserRole } from '../api/generated/types.gen';
import { clubOptionsQuery, referenceQuery, usersQuery } from '../api/queries';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { StoreReviewBadge } from '../components/StoreReview';
import { apiErrorMessage } from '../lib/apiError';
import { disciplineOptions, formatDiscipline } from '../lib/discipline';
import {
  extraRoleLabels,
  ROLE_LABELS,
  STATUS_FILTER_OPTIONS,
  type StatusChoice,
} from '../lib/labels';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
import {
  readUsersParams,
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

// Selects and date pickers inside a header menu keep their dropdown in the
// menu: a portal would count as a click outside and close it.
const IN_MENU = { withinPortal: false } as const;

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
  const clubs = useQuery(clubOptionsQuery(state.clubId));
  const reference = useQuery(referenceQuery);
  const total = users.data?.meta.total ?? 0;
  const rows = users.data?.data ?? [];

  const onSortChange = (sort: SortState | null) =>
    update({ sort: sort && isUsersSortField(sort.by) ? { by: sort.by, order: sort.order } : null });

  const columns: DataTableColumn<AdminUserListItemDto>[] = [
    {
      key: 'name',
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
    },
    { key: 'email', label: 'Email', sortField: 'email', cell: (u) => u.email },
    {
      key: 'role',
      label: 'Rôle principal',
      sortField: 'role',
      cell: (u) => <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>,
      filter: {
        active: state.role !== null,
        content: (
          <Select
            label="Rôle (principal ou supplémentaire)"
            placeholder="Rôle"
            clearable
            comboboxProps={IN_MENU}
            data={Object.entries(ROLE_LABELS)
              .filter(([value]) => reference.data?.roles.includes(value))
              .map(([value, label]) => ({ value, label }))}
            value={state.role}
            onChange={(v) => update({ role: v as UserRole | null })}
          />
        ),
      },
    },
    {
      key: 'extraRoles',
      label: 'Rôles supplémentaires',
      cell: (u) => <ExtraRoles user={u} />,
    },
    {
      key: 'status',
      label: 'Compte',
      cell: (u) =>
        u.disabledAt ? (
          <Badge color="red" variant="light">
            Désactivé
          </Badge>
        ) : (
          'Actif'
        ),
      filter: {
        active: state.status !== 'all',
        content: (
          <SegmentedControl
            orientation="vertical"
            fullWidth
            aria-label="Statut du compte"
            data={STATUS_FILTER_OPTIONS}
            value={state.status}
            onChange={(v) => update({ status: v as StatusChoice })}
          />
        ),
      },
    },
    {
      key: 'club',
      label: 'Club',
      sortField: 'club',
      cell: (u) => u.clubName ?? '—',
      filter: {
        active: state.clubId !== null,
        content: (
          <Select
            aria-label="Club"
            placeholder="Club"
            clearable
            searchable
            comboboxProps={IN_MENU}
            data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={state.clubId}
            onChange={(v) => update({ clubId: v })}
          />
        ),
      },
    },
    {
      key: 'category',
      label: 'Catégorie',
      sortField: 'category',
      cell: (u) => (u.category ? formatDiscipline(u.category) : '—'),
      filter: {
        active: state.category !== null,
        content: (
          <Select
            aria-label="Catégorie"
            placeholder="Catégorie"
            clearable
            comboboxProps={IN_MENU}
            data={disciplineOptions(reference.data?.categories ?? [])}
            value={state.category}
            onChange={(v) => update({ category: v })}
          />
        ),
      },
    },
    {
      key: 'ageGroup',
      label: "Classe d'âge",
      sortField: 'ageGroup',
      cell: (u) => u.ageGroup ?? '—',
    },
    {
      key: 'license',
      label: 'Licence',
      cell: (u) => (u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'),
    },
    {
      key: 'licenseNumber',
      label: 'N° de licence',
      hiddenByDefault: true,
      cell: (u) => u.licenseNumber ?? '—',
    },
    {
      key: 'createdAt',
      label: 'Inscription',
      sortField: 'createdAt',
      nowrap: true,
      cell: (u) => date(u.createdAt),
      filter: {
        active: Boolean(state.createdFrom ?? state.createdTo),
        content: (
          <DatePickerInput
            type="range"
            label="Date d’inscription"
            placeholder="Inscription entre…"
            clearable
            popoverProps={IN_MENU}
            value={[state.createdFrom, state.createdTo]}
            onChange={([from, to]) =>
              update({
                createdFrom: from ? dayjs(from).format('YYYY-MM-DD') : null,
                createdTo: to ? dayjs(to).format('YYYY-MM-DD') : null,
              })
            }
          />
        ),
      },
    },
    {
      key: 'lastLoginAt',
      label: 'Dernière connexion',
      sortField: 'lastLoginAt',
      hiddenByDefault: true,
      nowrap: true,
      cell: (u) => date(u.lastLoginAt),
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
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        minWidth={960}
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
