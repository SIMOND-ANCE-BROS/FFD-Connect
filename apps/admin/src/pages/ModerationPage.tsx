import {
  Alert,
  Anchor,
  Badge,
  Checkbox,
  Group,
  Pagination,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useLocation, useNavigate } from 'react-router';
import type {
  TrackCorrectionAdminDto,
  TrackCorrectionReason,
  TrackCorrectionStatus,
} from '../api/generated/types.gen';
import { moderationListQuery } from '../api/queries';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { apiErrorMessage } from '../lib/apiError';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
import {
  MIN_SEARCH_LENGTH,
  MODERATION_SORT_FIELDS,
  moderationFilter,
  type ModerationSortField,
  proposalSummary,
  readModerationParams,
  REASON_LABELS,
  REASONS,
  STATUS_OPTIONS,
  writeModerationParams,
} from '../lib/moderation';
import { useUrlSearch } from '../lib/useUrlSearch';

const PAGE_SIZE = 50;

const isModerationSortField = (value: string): value is ModerationSortField =>
  MODERATION_SORT_FIELDS.some((f) => f === value);

const proposer = (c: TrackCorrectionAdminDto) => c.proposer?.name ?? 'Compte supprimé';
const createdAt = (c: TrackCorrectionAdminDto) => dayjs(c.createdAt).format('DD/MM/YYYY HH:mm');

export function ModerationPage() {
  const navigate = useNavigate();
  const { search: locationSearch } = useLocation();
  const [state, update] = useListParams(readModerationParams, writeModerationParams);
  const [search, setSearch] = useUrlSearch(
    state.q,
    (q) => update({ q }, { replace: true }),
    MIN_SEARCH_LENGTH,
  );

  const list = useQuery({
    ...moderationListQuery(moderationFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;
  const detailPath = (c: TrackCorrectionAdminDto) => `/moderation/${c.id}${locationSearch}`;

  const onSortChange = (sort: SortState | null) =>
    update({
      sort: sort && isModerationSortField(sort.by) ? { by: sort.by, order: sort.order } : null,
    });

  const columns: DataTableColumn<TrackCorrectionAdminDto>[] = [
    {
      key: 'track',
      label: 'Musique',
      required: true,
      sortField: 'track',
      cell: (c) => (
        <>
          <Group gap="xs">
            <Anchor
              component={Link}
              to={detailPath(c)}
              size="sm"
              fw={500}
              onClick={(e) => e.stopPropagation()}
            >
              {c.track.title}
            </Anchor>
            {c.track.blacklisted && (
              <Badge size="xs" color="red" variant="light">
                Retirée
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {c.track.artist}
          </Text>
        </>
      ),
    },
    {
      key: 'reason',
      label: 'Motif',
      sortField: 'reason',
      cell: (c) => <Badge variant="light">{REASON_LABELS[c.reason]}</Badge>,
      filter: {
        active: state.reasons.length > 0,
        content: (
          <Checkbox.Group
            aria-label="Motifs"
            value={state.reasons}
            onChange={(v) => update({ reasons: v as TrackCorrectionReason[] })}
          >
            <Stack gap="xs">
              {REASONS.map((reason) => (
                <Checkbox key={reason} value={reason} label={REASON_LABELS[reason]} />
              ))}
            </Stack>
          </Checkbox.Group>
        ),
      },
    },
    { key: 'proposer', label: 'Proposée par', cell: proposer },
    { key: 'createdAt', label: 'Date', sortField: 'createdAt', nowrap: true, cell: createdAt },
    {
      key: 'summary',
      label: 'Changements proposés',
      cell: (c) => proposalSummary(c.proposed, c.reason),
    },
    {
      key: 'message',
      label: 'Message',
      hiddenByDefault: true,
      cell: (c) => c.message ?? '—',
    },
    {
      key: 'reviewedAt',
      label: 'Traitée le',
      hiddenByDefault: true,
      nowrap: true,
      cell: (c) => (c.reviewedAt ? dayjs(c.reviewedAt).format('DD/MM/YYYY HH:mm') : '—'),
    },
    {
      key: 'reviewer',
      label: 'Traitée par',
      hiddenByDefault: true,
      cell: (c) => c.reviewer?.name ?? '—',
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Modération"
        description="Corrections de musiques proposées par les utilisateurs."
      />
      {state.trackId && (
        <Alert color="blue" title="Propositions d'une seule musique">
          <Group gap="md">
            <Anchor component={Link} to={`/tracks/${state.trackId}`} size="sm">
              Voir la musique
            </Anchor>
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => update({ trackId: undefined })}
            >
              Toutes les musiques
            </Anchor>
          </Group>
        </Alert>
      )}
      <ScrollArea type="never">
        <SegmentedControl
          data={STATUS_OPTIONS}
          value={state.status}
          onChange={(v) => update({ status: v as TrackCorrectionStatus })}
        />
      </ScrollArea>
      <DataTable
        tableId="moderation"
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(c) => c.id}
        sort={state.sort ?? null}
        onSortChange={onSortChange}
        onResetFilters={() => update({ reasons: [] })}
        onRowClick={(c) => navigate(detailPath(c))}
        minWidth={820}
        toolbar={
          <TextInput
            label="Rechercher une proposition"
            placeholder="Titre ou artiste"
            maw={{ sm: 360 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        }
        loading={list.isPending}
        error={
          list.isError && apiErrorMessage(list.error, 'Impossible de charger les propositions.')
        }
        summary={
          <Text size="sm" c="dimmed">
            {total} proposition{total > 1 ? 's' : ''}
          </Text>
        }
        empty={
          <EmptyState title="Aucune proposition">
            Aucune correction ne correspond à ces filtres.
          </EmptyState>
        }
        renderCard={(c) => (
          <RecordCard
            to={detailPath(c)}
            title={c.track.title}
            badges={
              <>
                <Badge variant="light">{REASON_LABELS[c.reason]}</Badge>
                {c.track.blacklisted && <Badge color="red">Retirée</Badge>}
              </>
            }
          >
            <Text size="sm" c="dimmed">
              {c.track.artist}
            </Text>
            <RecordLine label="Proposée par">{proposer(c)}</RecordLine>
            <RecordLine label="Date">{createdAt(c)}</RecordLine>
            <RecordLine label="Changements">{proposalSummary(c.proposed, c.reason)}</RecordLine>
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
