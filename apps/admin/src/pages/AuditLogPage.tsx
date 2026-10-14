import { Anchor, Group, Pagination, Paper, Select, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import type { AuditLogEntryDto } from '../api/generated/types.gen';
import { auditQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import {
  type AuditAction,
  auditFilter,
  type AuditTargetType,
  readAuditParams,
  TARGET_TYPE_LABELS,
  writeAuditParams,
} from '../lib/auditList';
import { ACTION_LABELS } from '../lib/auditLabels';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';

const PAGE_SIZE = 50;

const DELETIONS: AuditLogEntryDto['action'][] = ['USER_DELETE', 'CLUB_DELETE', 'TRACK_DELETE'];

const TARGET_LINKS: Record<AuditLogEntryDto['targetType'], { path: string; label: string }> = {
  USER: { path: 'users', label: 'Voir la fiche' },
  CLUB: { path: 'clubs', label: 'Voir le club' },
  TRACK_CORRECTION: { path: 'moderation', label: 'Voir la proposition' },
  TRACK: { path: 'tracks', label: 'Voir la musique' },
  LICENSE_RENEWAL: { path: 'license-renewals', label: 'Voir la demande' },
};

/**
 * Moderation rows carry the track id for the audit trail only: shown as a raw
 * `uuid → uuid` line it says nothing (the proposal link gives the context), so
 * it is hidden when unchanged or when it is the only key (a rejection).
 */
function visibleChange(entry: AuditLogEntryDto) {
  const before = { ...(entry.before ?? {}) };
  const after = { ...(entry.after ?? {}) };
  if (entry.targetType === 'TRACK_CORRECTION') {
    const sole = Object.keys(after).length === 1;
    if (sole || before.trackId === after.trackId) {
      delete before.trackId;
      delete after.trackId;
    }
  }
  // A renewal approval logs the licence's end of validity: shown as the Paris day.
  if (entry.targetType === 'LICENSE_RENEWAL') {
    for (const side of [before, after]) {
      if (typeof side.validUntil === 'string') {
        side.validUntil = formatLicenseValidUntil(side.validUntil);
      }
    }
  }
  // A deletion only records `before`: show what was deleted against "—".
  if (DELETIONS.includes(entry.action) && Object.keys(after).length === 0) {
    for (const key of Object.keys(before)) after[key] = null;
  }
  return Object.keys(after).length > 0 ? { before, after } : null;
}

function Target({ entry }: { entry: AuditLogEntryDto }) {
  if (DELETIONS.includes(entry.action)) {
    return (
      <Text size="sm" c="dimmed">
        Supprimé
      </Text>
    );
  }
  const link = TARGET_LINKS[entry.targetType];
  return (
    <Anchor component={Link} to={`/${link.path}/${entry.targetId}`}>
      {link.label}
    </Anchor>
  );
}

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }));
const TARGET_OPTIONS = Object.entries(TARGET_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const createdAt = (e: AuditLogEntryDto) => dayjs(e.createdAt).format('DD/MM/YYYY HH:mm');
const actor = (e: AuditLogEntryDto) => e.actorName ?? 'admin supprimé';
const actionLabel = (e: AuditLogEntryDto) => ACTION_LABELS[e.action] ?? e.action;

function Detail({ entry }: { entry: AuditLogEntryDto }) {
  const change = visibleChange(entry);
  return change && <ChangeSummary before={change.before} after={change.after} />;
}

export function AuditLogPage() {
  const [state, update] = useListParams(readAuditParams, writeAuditParams);
  const log = useQuery({
    ...auditQuery(auditFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = log.data?.meta.total ?? 0;

  // The journal sorts on its date only.
  const onSortChange = (sort: SortState | null) =>
    update({ sort: sort?.by === 'createdAt' ? { by: 'createdAt', order: sort.order } : null });

  const columns: DataTableColumn<AuditLogEntryDto>[] = [
    {
      key: 'createdAt',
      minWidth: 150,
      priority: 0,
      label: 'Date',
      sortField: 'createdAt',
      cell: createdAt,
    },
    { key: 'actor', minWidth: 130, weight: 0.8, priority: 2, label: 'Admin', cell: actor },
    {
      key: 'action',
      minWidth: 180,
      weight: 1.5,
      label: 'Action',
      required: true,
      cell: actionLabel,
      filter: {
        active: state.action !== null,
        content: (
          <Select
            aria-label="Action"
            placeholder="Action"
            clearable
            searchable
            comboboxProps={{ withinPortal: false }}
            data={ACTION_OPTIONS}
            value={state.action}
            onChange={(v) => update({ action: v as AuditAction | null })}
          />
        ),
      },
    },
    {
      key: 'target',
      minWidth: 150,
      priority: 1,
      label: 'Cible',
      cell: (e) => <Target entry={e} />,
      filter: {
        active: state.targetType !== null,
        content: (
          <Select
            aria-label="Type de cible"
            placeholder="Type de cible"
            clearable
            comboboxProps={{ withinPortal: false }}
            data={TARGET_OPTIONS}
            value={state.targetType}
            onChange={(v) => update({ targetType: v as AuditTargetType | null })}
          />
        ),
      },
    },
    {
      key: 'detail',
      minWidth: 360,
      weight: 5,
      priority: 3,
      wrap: true,
      label: 'Détail',
      cell: (e) => <Detail entry={e} />,
    },
  ];

  return (
    <Stack>
      <PageHeader
        title="Journal d'audit"
        description="Chaque modification faite depuis le back-office, la plus récente en premier."
      />
      <DataTable
        tableId="audit-log"
        columns={columns}
        rows={log.data?.data ?? []}
        rowKey={(e) => e.id}
        sort={state.sort}
        onSortChange={onSortChange}
        onResetFilters={() => update({ action: null, targetType: null })}
        loading={!log.data && !log.isError}
        error={log.isError && 'Impossible de charger le journal.'}
        empty={
          state.action || state.targetType ? (
            <EmptyState title="Aucune entrée">
              Aucune modification ne correspond à ces filtres.
            </EmptyState>
          ) : (
            <EmptyState title="Journal vide">Aucune modification n'a encore été faite.</EmptyState>
          )
        }
        renderCard={(e) => (
          <Paper withBorder p="sm">
            <Stack gap={6}>
              <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                <Text fw={600} size="sm">
                  {actionLabel(e)}
                </Text>
                <Text size="xs" c="dimmed" className="app-tabular" style={{ whiteSpace: 'nowrap' }}>
                  {createdAt(e)}
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                Par {actor(e)}
              </Text>
              <Detail entry={e} />
              <Target entry={e} />
            </Stack>
          </Paper>
        )}
      />
      {!log.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
