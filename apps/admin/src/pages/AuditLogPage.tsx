import { Alert, Anchor, Group, Pagination, Paper, Stack, Table, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AuditLogEntryDto } from '../api/generated/types.gen';
import { auditQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { EmptyState, ListSkeleton } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { ACTION_LABELS } from '../lib/auditLabels';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import { useIsMobile } from '../lib/useIsMobile';

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

export function AuditLogPage() {
  const [pageIndex, setPageIndex] = useState(1);
  const isMobile = useIsMobile();
  const log = useQuery({
    ...auditQuery({
      skip: (pageIndex - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const header = (
    <PageHeader
      title="Journal d'audit"
      description="Chaque modification faite depuis le back-office, la plus récente en premier."
    />
  );
  if (log.isError) {
    return (
      <Stack>
        {header}
        <Alert color="red">Impossible de charger le journal.</Alert>
      </Stack>
    );
  }
  if (!log.data) {
    return (
      <Stack>
        {header}
        <ListSkeleton />
      </Stack>
    );
  }
  const total = log.data.meta.total;
  const entries = log.data.data;
  return (
    <Stack>
      {header}
      {entries.length === 0 ? (
        <EmptyState title="Journal vide">Aucune modification n'a encore été faite.</EmptyState>
      ) : isMobile ? (
        <Stack gap="xs">
          {entries.map((e) => {
            const change = visibleChange(e);
            return (
              <Paper key={e.id} withBorder p="sm">
                <Stack gap={6}>
                  <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
                    <Text fw={600} size="sm">
                      {ACTION_LABELS[e.action] ?? e.action}
                    </Text>
                    <Text
                      size="xs"
                      c="dimmed"
                      className="app-tabular"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {dayjs(e.createdAt).format('DD/MM/YYYY HH:mm')}
                    </Text>
                  </Group>
                  <Text size="sm" c="dimmed">
                    Par {e.actorName ?? 'admin supprimé'}
                  </Text>
                  {change && <ChangeSummary before={change.before} after={change.after} />}
                  <Target entry={e} />
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Admin</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Cible</Table.Th>
                <Table.Th>Détail</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((e) => {
                const change = visibleChange(e);
                return (
                  <Table.Tr key={e.id}>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      {dayjs(e.createdAt).format('DD/MM/YYYY HH:mm')}
                    </Table.Td>
                    <Table.Td>{e.actorName ?? 'admin supprimé'}</Table.Td>
                    <Table.Td>{ACTION_LABELS[e.action] ?? e.action}</Table.Td>
                    <Table.Td>
                      <Target entry={e} />
                    </Table.Td>
                    <Table.Td>
                      {change && <ChangeSummary before={change.before} after={change.after} />}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={pageIndex}
          onChange={setPageIndex}
        />
      )}
    </Stack>
  );
}
