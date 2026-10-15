import { Anchor, Badge, Group, Pagination, Paper, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import type { AdminRefundDueDto } from '../api/generated/types.gen';
import { refundsDueQuery } from '../api/queries';
import { operatorFilters } from '../components/ColumnFilterEditor';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { apiErrorMessage } from '../lib/apiError';
import type { SortState } from '../lib/listSort';
import {
  clubLabel,
  clubPath,
  formatAmount,
  readRefundsDueParams,
  REFUNDS_DUE_FILTERS,
  REFUNDS_DUE_SORT_FIELDS,
  refundsDueFilter,
  type RefundsDueSortField,
  totalCents,
  writeRefundsDueParams,
} from '../lib/refundsDue';
import { useListParams } from '../lib/useListParams';

const PAGE_SIZE = 50;

type Refund = AdminRefundDueDto;

const isSortField = (value: string): value is RefundsDueSortField =>
  REFUNDS_DUE_SORT_FIELDS.some((f) => f === value);

const day = (iso: string) => dayjs(iso).format('DD/MM/YYYY');
const since = (r: Refund) => dayjs(r.refundOwedAt).format('DD/MM/YYYY HH:mm');
const dancer = (r: Refund) => `${r.dancer.firstName} ${r.dancer.lastName}`;
const seat = (r: Refund) => (r.seatNumber === null ? '—' : `Place ${r.seatNumber}`);
const references = (r: Refund) => r.helloAssoCheckoutIntentIds.join(', ');

function Amount({ refund }: { refund: Refund }) {
  const count = refund.helloAssoCheckoutIntentIds.length;
  return (
    <>
      <Text size="sm" className="app-tabular">
        {formatAmount(totalCents(refund))}
      </Text>
      {count > 1 && (
        <Text size="xs" c="dimmed">
          {count} paiements de {formatAmount(refund.amountCents)}
        </Text>
      )}
    </>
  );
}

function Club({ refund }: { refund: Refund }) {
  const path = clubPath(refund);
  return path ? (
    <Anchor component={Link} to={path} size="sm">
      {clubLabel(refund)}
    </Anchor>
  ) : (
    <Text size="sm">{clubLabel(refund)}</Text>
  );
}

/**
 * Refunds owed by every organising club (#627), read-only: a line goes away
 * when HelloAsso confirms the refund (ADR-0022), never by hand here.
 */
export function RefundsDuePage() {
  const [state, update] = useListParams(readRefundsDueParams, writeRefundsDueParams);
  const list = useQuery({
    ...refundsDueQuery(refundsDueFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const ops = operatorFilters(REFUNDS_DUE_FILTERS, state.filters, (filters) => update({ filters }));
  const total = list.data?.meta.total ?? 0;

  const onSortChange = (sort: SortState | null) =>
    update({ sort: sort && isSortField(sort.by) ? { by: sort.by, order: sort.order } : null });

  const columns: DataTableColumn<Refund>[] = [
    {
      key: 'club',
      minWidth: 160,
      weight: 1.5,
      label: 'Club',
      required: true,
      sortField: 'club',
      cell: (r) => <Club refund={r} />,
      filter: ops.filter('club'),
    },
    {
      key: 'competition',
      minWidth: 180,
      weight: 2,
      wrap: true,
      priority: 1,
      label: 'Compétition',
      sortField: 'competition',
      cell: (r) => r.competition.title,
      filter: ops.filter('competition'),
    },
    {
      key: 'competitionDate',
      minWidth: 120,
      priority: 5,
      label: 'Date',
      sortField: 'competitionDate',
      cell: (r) => day(r.competition.date),
      filter: ops.filter('competitionDate'),
    },
    {
      key: 'seat',
      minWidth: 90,
      weight: 0.6,
      priority: 6,
      label: 'Place',
      cell: seat,
    },
    {
      key: 'dancer',
      minWidth: 150,
      priority: 4,
      label: 'Payé par',
      cell: dancer,
      filter: ops.filter('dancer'),
    },
    {
      key: 'amount',
      minWidth: 120,
      priority: 2,
      wrap: true,
      label: 'Montant',
      sortField: 'amount',
      cell: (r) => <Amount refund={r} />,
    },
    {
      key: 'references',
      minWidth: 160,
      weight: 1.2,
      priority: 3,
      wrap: true,
      label: 'Référence HelloAsso',
      cell: references,
    },
    {
      key: 'refundOwedAt',
      minWidth: 150,
      label: 'Dû depuis',
      required: true,
      sortField: 'refundOwedAt',
      cell: since,
      filter: ops.filter('refundOwedAt'),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Remboursements dus"
        description="Paiements HelloAsso qu'un club organisateur doit rembourser (payé trop tard, en double ou sur un paiement remplacé), le plus ancien en premier."
      />
      <Paper withBorder p="sm">
        <Text size="sm" c="dimmed">
          Lecture seule : le club rembourse depuis son espace HelloAsso, et la ligne disparaît
          d'elle-même quand HelloAsso confirme le remboursement.
        </Text>
      </Paper>
      <DataTable
        tableId="refunds-due"
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(r) => r.bookingId}
        rowHref={clubPath}
        sort={state.sort}
        onSortChange={onSortChange}
        onResetFilters={() => update({ filters: [] })}
        filterChips={ops.chips}
        loading={list.isPending}
        error={
          list.isError && apiErrorMessage(list.error, 'Impossible de charger les remboursements.')
        }
        summary={
          <Text size="sm" c="dimmed">
            {total > 1 ? `${total} remboursements dus` : `${total} remboursement dû`}
          </Text>
        }
        empty={
          state.filters.length > 0 ? (
            <EmptyState title="Aucun remboursement">
              Aucun remboursement dû ne correspond à ces filtres.
            </EmptyState>
          ) : (
            <EmptyState title="Aucun remboursement dû">
              Aucun club n'a de paiement HelloAsso à rembourser.
            </EmptyState>
          )
        }
        renderCard={(r) => {
          const body = (
            <>
              <RecordLine label="Compétition">
                {r.competition.title} ({day(r.competition.date)})
              </RecordLine>
              <RecordLine label="Place">{seat(r)}</RecordLine>
              <RecordLine label="Payé par">{dancer(r)}</RecordLine>
              <RecordLine label="Montant">
                <Amount refund={r} />
              </RecordLine>
              <RecordLine label="Référence HelloAsso">{references(r)}</RecordLine>
              <RecordLine label="Dû depuis">{since(r)}</RecordLine>
            </>
          );
          const path = clubPath(r);
          return path ? (
            <RecordCard to={path} title={clubLabel(r)}>
              {body}
            </RecordCard>
          ) : (
            <Paper withBorder p="sm">
              <Stack gap={6}>
                <Group>
                  <Text fw={600}>{clubLabel(r)}</Text>
                  <Badge variant="light" color="gray">
                    Club non relié
                  </Badge>
                </Group>
                {body}
              </Stack>
            </Paper>
          );
        }}
      />
      {!list.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
