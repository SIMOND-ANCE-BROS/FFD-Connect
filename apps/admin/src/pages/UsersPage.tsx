import { Badge, Button, Pagination, Stack, Text, TextInput } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { usersQuery } from '../api/queries';
import { operatorFilters } from '../components/ColumnFilterEditor';
import { DataTable } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { StoreReviewBadge } from '../components/StoreReview';
import { ExtraRoles, formatDay, LICENSE_LABEL, userColumns } from '../components/userColumns';
import { apiErrorMessage } from '../lib/apiError';
import { formatDiscipline } from '../lib/discipline';
import { ROLE_LABELS } from '../lib/labels';
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

const isUsersSortField = (value: string): value is UsersSortField =>
  USERS_SORT_FIELDS.some((f) => f === value);

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

  const columns = userColumns({ filter: ops.filter });

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
              {formatDay(u.createdAt)}
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
