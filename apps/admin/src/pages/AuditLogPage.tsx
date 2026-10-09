import { Alert, Anchor, Loader, Pagination, Stack, Table, Text, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AuditLogEntryDto } from '../api/generated/types.gen';
import { auditQuery } from '../api/queries';
import { ChangeSummary } from '../components/ChangeSummary';
import { ACTION_LABELS } from '../lib/auditLabels';

const PAGE_SIZE = 50;

const DELETIONS: AuditLogEntryDto['action'][] = ['USER_DELETE', 'CLUB_DELETE'];

const TARGET_LINKS: Record<AuditLogEntryDto['targetType'], { path: string; label: string }> = {
  USER: { path: 'users', label: 'Voir la fiche' },
  CLUB: { path: 'clubs', label: 'Voir le club' },
  TRACK_CORRECTION: { path: 'moderation', label: 'Voir la proposition' },
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
  const log = useQuery({
    ...auditQuery({
      skip: (pageIndex - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  if (log.isError) {
    return <Alert color="red">Impossible de charger le journal.</Alert>;
  }
  if (!log.data) return <Loader />;
  const total = log.data.meta.total;
  return (
    <Stack>
      <Title order={2}>Journal d'audit</Title>
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
          {log.data.data.map((e) => {
            const change = visibleChange(e);
            return (
              <Table.Tr key={e.id}>
                <Table.Td>{dayjs(e.createdAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
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
