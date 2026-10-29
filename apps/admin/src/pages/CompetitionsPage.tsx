import { Anchor, Badge, Pagination, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { competitionsQuery, competitionsResultsStatusQuery } from '../api/queries';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { apiErrorMessage } from '../lib/apiError';
import type { CompetitionResultsStatusDto } from '../api/generated/types.gen';
import {
  COMPETITION_STATUS_BADGES,
  competitionDates,
  RESULTS_STATUS_BADGES,
  resultsStatusDetail,
  type CompetitionSummary,
} from '../lib/competitions';
import { useListParams } from '../lib/useListParams';

const PAGE_SIZE = 50;

interface CompetitionsUrlState {
  page: number;
}

const readParams = (params: URLSearchParams): CompetitionsUrlState => {
  const page = Number(params.get('page'));
  return { page: Number.isInteger(page) && page > 1 ? page : 1 };
};

const writeParams = (_current: URLSearchParams, patch: CompetitionsUrlState) =>
  new URLSearchParams(patch.page > 1 ? { page: String(patch.page) } : {});

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const badge = COMPETITION_STATUS_BADGES[status] ?? { label: status, color: 'gray' };
  return (
    <Badge variant="light" color={badge.color}>
      {badge.label}
    </Badge>
  );
}

/** « Importés / Partiels / Aucun » (#846); nothing while unknown. */
function ResultsBadge({ status }: { status: CompetitionResultsStatusDto | undefined }) {
  if (!status) return null;
  const badge = RESULTS_STATUS_BADGES[status.resultsStatus];
  const detail = resultsStatusDetail(status);
  const counts =
    status.resultsStatus === 'PARTIAL' ? ` ${status.eventsWithResults}/${status.eventCount}` : '';
  return (
    <Badge variant="light" color={badge.color} title={detail}>
      {badge.label}
      {counts}
    </Badge>
  );
}

export function CompetitionsPage() {
  const [state, update] = useListParams(readParams, writeParams);
  const list = useQuery({
    ...competitionsQuery({ skip: (state.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.total ?? 0;
  const rows = list.data?.rows ?? [];
  const results = useQuery({
    ...competitionsResultsStatusQuery(rows.map((c) => c.id)),
    placeholderData: keepPreviousData,
  });
  const resultsOf = (c: CompetitionSummary) => results.data?.get(c.id);

  const columns: DataTableColumn<CompetitionSummary>[] = [
    {
      key: 'title',
      minWidth: 220,
      weight: 2.5,
      label: 'Compétition',
      required: true,
      cell: (c) => (
        <Anchor component={Link} to={`/competitions/${c.id}`} size="sm" fw={500}>
          {c.title}
        </Anchor>
      ),
    },
    { key: 'date', minWidth: 130, priority: 1, label: 'Dates', cell: competitionDates },
    {
      key: 'place',
      minWidth: 160,
      weight: 1.5,
      priority: 3,
      label: 'Lieu',
      cell: (c) => c.place ?? '—',
    },
    {
      key: 'status',
      minWidth: 110,
      priority: 2,
      label: 'Statut',
      cell: (c) => <StatusBadge status={c.status} />,
    },
    {
      key: 'results',
      minWidth: 110,
      priority: 2,
      label: 'Résultats',
      cell: (c) => <ResultsBadge status={resultsOf(c)} />,
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Compétitions"
        description="Compétitions synchronisées depuis la FFD ou créées par les clubs, par date."
      />
      <DataTable
        tableId="competitions"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        rowHref={(c) => `/competitions/${c.id}`}
        sort={null}
        onSortChange={() => undefined}
        loading={list.isPending}
        error={
          list.isError && apiErrorMessage(list.error, 'Impossible de charger les compétitions.')
        }
        summary={
          <Text size="sm" c="dimmed">
            {total} compétition{total > 1 ? 's' : ''}
          </Text>
        }
        empty={<EmptyState title="Aucune compétition" />}
        renderCard={(c) => (
          <RecordCard
            to={`/competitions/${c.id}`}
            title={c.title}
            badges={<StatusBadge status={c.status} />}
          >
            <RecordLine label="Dates">{competitionDates(c)}</RecordLine>
            {c.place && <RecordLine label="Lieu">{c.place}</RecordLine>}
            {resultsOf(c) && (
              <RecordLine label="Résultats">
                <ResultsBadge status={resultsOf(c)} />
              </RecordLine>
            )}
          </RecordCard>
        )}
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
