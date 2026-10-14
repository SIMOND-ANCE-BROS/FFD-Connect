import {
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import type { AdminTrackDto, TrackStatus } from '../api/generated/types.gen';
import { tracksQuery } from '../api/queries';
import { operatorFilters } from '../components/ColumnFilterEditor';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { apiErrorMessage } from '../lib/apiError';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
import { MIN_SEARCH_LENGTH } from '../lib/moderation';
import {
  DANCE_LABELS,
  MAX_SEARCH_LENGTH,
  readTracksParams,
  TRACK_STATUS_BADGES,
  TRACK_STATUS_FILTERS,
  TRACKS_FILTERS,
  TRACKS_SORT_FIELDS,
  tracksFilter,
  type TracksSortField,
  type TracksUrlState,
  writeTracksParams,
} from '../lib/tracks';
import { useUrlSearch } from '../lib/useUrlSearch';

const PAGE_SIZE = 50;

const isTracksSortField = (value: string): value is TracksSortField =>
  TRACKS_SORT_FIELDS.some((f) => f === value);

const FILTERS_CLEARED: Partial<TracksUrlState> = {
  status: null,
  blacklisted: false,
  ambiance: false,
  style: '',
  filters: [],
};

function TitleBadges({ track, size }: { track: AdminTrackDto; size?: 'xs' }) {
  return (
    <>
      {track.blacklisted && (
        <Badge size={size} color="red" variant="light">
          Blacklistée
        </Badge>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: TrackStatus }) {
  const badge = TRACK_STATUS_BADGES[status];
  return (
    <Badge variant="light" color={badge.color}>
      {badge.label}
    </Badge>
  );
}

export function TracksPage() {
  const [state, update] = useListParams(readTracksParams, writeTracksParams);
  // Same debounce as the moderation queue.
  const [search, setSearch] = useUrlSearch(
    state.q,
    (q) => update({ q }, { replace: true }),
    MIN_SEARCH_LENGTH,
  );

  const list = useQuery({
    ...tracksQuery(tracksFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const ops = operatorFilters(TRACKS_FILTERS, state.filters ?? [], (filters) =>
    update({ filters }),
  );
  const total = list.data?.meta.total ?? 0;
  const rows = list.data?.data ?? [];

  const onSortChange = (sort: SortState | null) =>
    update({
      sort: sort && isTracksSortField(sort.by) ? { by: sort.by, order: sort.order } : null,
    });

  const columns: DataTableColumn<AdminTrackDto>[] = [
    {
      key: 'title',
      minWidth: 200,
      weight: 2.5,
      label: 'Titre',
      required: true,
      sortField: 'title',
      cell: (t) => (
        <Group gap="xs">
          <Anchor component={Link} to={`/tracks/${t.id}`} size="sm" fw={500}>
            {t.title}
          </Anchor>
          <TitleBadges track={t} size="xs" />
        </Group>
      ),
      filter: {
        active: state.blacklisted,
        content: (
          <Stack gap="xs">
            <Checkbox
              label="Blacklistées"
              checked={state.blacklisted}
              onChange={(e) => update({ blacklisted: e.currentTarget.checked })}
            />
          </Stack>
        ),
      },
    },
    {
      key: 'artist',
      minWidth: 150,
      weight: 1.5,
      priority: 1,
      label: 'Artiste',
      sortField: 'artist',
      cell: (t) => t.artist,
      filter: ops.filter('artist'),
    },
    {
      key: 'style',
      minWidth: 125,
      priority: 2,
      label: 'Danse',
      sortField: 'style',
      cell: (t) => t.style ?? '—',
      filter: {
        active: Boolean(state.style) || state.ambiance,
        content: (
          <Stack gap="xs">
            <Select
              aria-label="Danse"
              placeholder="Danse"
              clearable
              comboboxProps={{ withinPortal: false }}
              data={DANCE_LABELS}
              value={state.style || null}
              onChange={(v) => update({ style: v ?? '' })}
            />
            <Checkbox
              label="Ambiance"
              checked={state.ambiance}
              onChange={(e) => update({ ambiance: e.currentTarget.checked })}
            />
          </Stack>
        ),
      },
    },
    {
      key: 'bpm',
      minWidth: 80,
      weight: 0.5,
      priority: 4,
      label: 'MPM',
      sortField: 'bpm',
      cell: (t) => t.bpm,
      filter: ops.filter('bpm'),
    },
    {
      key: 'status',
      minWidth: 135,
      priority: 3,
      label: 'Statut',
      sortField: 'status',
      cell: (t) => <StatusBadge status={t.status} />,
      filter: {
        active: state.status !== null,
        content: (
          <SegmentedControl
            orientation="vertical"
            fullWidth
            aria-label="Statut"
            data={TRACK_STATUS_FILTERS}
            value={state.status ?? 'ALL'}
            onChange={(v) => update({ status: v === 'ALL' ? null : (v as TrackStatus) })}
          />
        ),
      },
    },
    {
      key: 'pendingCorrections',
      minWidth: 200,
      priority: 6,
      label: 'Propositions en attente',
      hiddenByDefault: true,
      cell: (t) => t.pendingCorrections,
    },
    {
      key: 'createdAt',
      minWidth: 120,
      priority: 5,
      label: 'Ajoutée le',
      sortField: 'createdAt',
      cell: (t) => dayjs(t.createdAt).format('DD/MM/YYYY'),
      filter: ops.filter('createdAt'),
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Musiques"
        actions={
          <Button component={Link} to="/tracks/import">
            Importer des musiques
          </Button>
        }
      />
      <DataTable
        tableId="tracks"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        sort={state.sort ?? null}
        onSortChange={onSortChange}
        onResetFilters={() => update(FILTERS_CLEARED)}
        filterChips={ops.chips}
        toolbar={
          <TextInput
            aria-label="Rechercher"
            maxLength={MAX_SEARCH_LENGTH}
            placeholder="Titre ou artiste"
            maw={{ sm: 360 }}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        }
        loading={list.isPending}
        error={list.isError && apiErrorMessage(list.error, 'Impossible de charger les musiques.')}
        summary={
          <Text size="sm" c="dimmed">
            {total} musique{total > 1 ? 's' : ''}
          </Text>
        }
        empty={
          <EmptyState title="Aucune musique">
            Aucune musique ne correspond à ces filtres.
          </EmptyState>
        }
        renderCard={(t) => (
          <RecordCard
            to={`/tracks/${t.id}`}
            title={t.title}
            badges={
              <>
                <StatusBadge status={t.status} />
                <TitleBadges track={t} />
              </>
            }
          >
            <Text size="sm">{t.artist}</Text>
            <RecordLine label="Danse">
              {t.style ?? '—'} · {t.bpm} MPM
            </RecordLine>
            <RecordLine label="Ajoutée le">{dayjs(t.createdAt).format('DD/MM/YYYY')}</RecordLine>
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
