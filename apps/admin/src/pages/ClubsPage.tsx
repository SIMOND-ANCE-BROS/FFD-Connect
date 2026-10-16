import { Anchor, Badge, Button, Pagination, Stack, Text, TextInput } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import type { AdminClubListItemDto } from '../api/generated/types.gen';
import { clubsQuery } from '../api/queries';
import { operatorFilters } from '../components/ColumnFilterEditor';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { StoreReviewBadge } from '../components/StoreReview';
import { apiErrorMessage } from '../lib/apiError';
import {
  CLUBS_FILTERS,
  CLUBS_SORT_FIELDS,
  clubsFilter,
  type ClubsSortField,
  readClubsParams,
  writeClubsParams,
} from '../lib/clubList';
import { paymentConfigured, paymentProviderLabel, REGISTRATION_MODE_LABELS } from '../lib/labels';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
import { useUrlSearch } from '../lib/useUrlSearch';

const PAGE_SIZE = 50;

const isClubsSortField = (value: string): value is ClubsSortField =>
  CLUBS_SORT_FIELDS.some((f) => f === value);

/** Club connector (#665): green once its credentials are filled in. */
function PaymentBadge({ club }: { club: AdminClubListItemDto }) {
  const configured = paymentConfigured(club);
  const label = paymentProviderLabel(club.paymentProvider);
  return (
    <Badge
      color={configured ? 'green' : 'gray'}
      variant="light"
      title={configured === false ? `${label} non configuré` : undefined}
    >
      {configured === false ? `${label} · non configuré` : label}
    </Badge>
  );
}

export function ClubsPage() {
  const [state, update] = useListParams(readClubsParams, writeClubsParams);
  const [search, setSearch] = useUrlSearch(state.q, (q) => update({ q }, { replace: true }));

  const clubs = useQuery({
    ...clubsQuery(clubsFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const ops = operatorFilters(CLUBS_FILTERS, state.filters, (filters) => update({ filters }));
  const total = clubs.data?.meta.total ?? 0;
  const rows = clubs.data?.data ?? [];

  const onSortChange = (sort: SortState | null) =>
    update({ sort: sort && isClubsSortField(sort.by) ? { by: sort.by, order: sort.order } : null });

  const columns: DataTableColumn<AdminClubListItemDto>[] = [
    {
      key: 'name',
      minWidth: 180,
      weight: 2,
      label: 'Club',
      required: true,
      sortField: 'name',
      cell: (c) => (
        <>
          <Anchor component={Link} to={`/clubs/${c.id}`}>
            {c.name}
          </Anchor>
          {c.isStoreReview && <StoreReviewBadge />}
        </>
      ),
      filter: ops.filter('name'),
    },
    {
      key: 'status',
      minWidth: 100,
      priority: 1,
      label: 'Statut',
      cell: (c) =>
        c.disabledAt ? (
          <Badge color="red" variant="light">
            Désactivé
          </Badge>
        ) : (
          'Actif'
        ),
      filter: ops.filter('status'),
    },
    {
      key: 'memberCount',
      minWidth: 100,
      weight: 0.6,
      priority: 2,
      label: 'Membres',
      cell: (c) => c.memberCount,
    },
    {
      key: 'clubAccountCount',
      minWidth: 140,
      weight: 0.6,
      priority: 6,
      label: 'Comptes Club',
      cell: (c) => c.clubAccountCount,
    },
    {
      key: 'payment',
      minWidth: 110,
      priority: 5,
      label: 'Paiement',
      cell: (c) => <PaymentBadge club={c} />,
    },
    {
      key: 'registrationMode',
      minWidth: 130,
      priority: 3,
      label: 'Inscriptions',
      sortField: 'registrationMode',
      cell: (c) => REGISTRATION_MODE_LABELS[c.registrationMode],
      filter: ops.filter('registrationMode'),
    },
    {
      key: 'createdAt',
      minWidth: 110,
      priority: 4,
      label: 'Création',
      sortField: 'createdAt',
      cell: (c) => dayjs(c.createdAt).format('DD/MM/YYYY'),
      filter: ops.filter('createdAt'),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Clubs"
        actions={
          <Button component={Link} to="/clubs/new">
            Nouveau club
          </Button>
        }
      />
      <DataTable
        tableId="clubs"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        rowHref={(c) => `/clubs/${c.id}`}
        sort={state.sort}
        onSortChange={onSortChange}
        onResetFilters={() => update({ filters: [] })}
        filterChips={ops.chips}
        toolbar={
          <TextInput
            label="Rechercher un club"
            placeholder="Nom du club"
            maw={{ sm: 360 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        }
        loading={clubs.isPending}
        error={clubs.isError && apiErrorMessage(clubs.error, 'Impossible de charger les clubs.')}
        summary={
          <Text size="sm" c="dimmed">
            {total} club{total > 1 ? 's' : ''}
          </Text>
        }
        empty={<EmptyState title="Aucun club">Aucun club ne correspond à ces filtres.</EmptyState>}
        renderCard={(c) => (
          <RecordCard
            to={`/clubs/${c.id}`}
            title={c.name}
            badges={
              <>
                {c.disabledAt && (
                  <Badge color="red" variant="light">
                    Désactivé
                  </Badge>
                )}
                <PaymentBadge club={c} />
                {c.isStoreReview && <StoreReviewBadge />}
              </>
            }
          >
            <RecordLine label="Membres">
              {c.memberCount} (comptes Club : {c.clubAccountCount})
            </RecordLine>
            <RecordLine label="Inscriptions">
              {REGISTRATION_MODE_LABELS[c.registrationMode]}
            </RecordLine>
            <RecordLine label="Création">{dayjs(c.createdAt).format('DD/MM/YYYY')}</RecordLine>
          </RecordCard>
        )}
      />
      {!clubs.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
