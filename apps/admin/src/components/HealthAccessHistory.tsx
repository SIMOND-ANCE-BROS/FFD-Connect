import { Alert, Anchor, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { healthAccessLogQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import {
  ACTOR_ROLE_LABELS,
  HEALTH_ACTION_LABELS,
  RESOURCE_LABELS,
  subjectJournalPath,
  userIdsOf,
} from '../lib/healthAccessLog';
import { useUserNames } from '../lib/useUserNames';

/** Latest accesses shown on the record; the journal has the rest. */
const LATEST = 10;

/**
 * « Qui a consulté ses données de santé » on a user record (#606): the latest
 * accesses to this person's medical certificates and renewal requests.
 */
export function HealthAccessHistory({ userId }: { userId: string }) {
  const log = useQuery(healthAccessLogQuery({ subjectUserId: userId, skip: 0, take: LATEST }));
  const rows = log.data?.data ?? [];
  // The subject is the record's own user: only the actors need a name.
  const nameOf = useUserNames(userIdsOf(rows).filter((id) => id !== userId));
  const total = log.data?.meta.total ?? 0;

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="baseline">
        <Title order={2} size="h4">
          Qui a consulté ses données de santé
        </Title>
        {total > 0 && (
          <Anchor component={Link} to={subjectJournalPath(userId)} size="sm">
            Voir tout le journal{total > LATEST ? ` (${total})` : ''}
          </Anchor>
        )}
      </Group>
      {log.isError ? (
        <Alert color="red">{apiErrorMessage(log.error, 'Impossible de charger les accès.')}</Alert>
      ) : log.isPending ? (
        <Text size="sm" c="dimmed">
          Chargement…
        </Text>
      ) : rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucun accès à ses données de santé.
        </Text>
      ) : (
        rows.map((e) => (
          <Card key={e.id} withBorder p="xs">
            <Text size="sm" fw={500}>
              {dayjs(e.createdAt).format('DD/MM/YYYY HH:mm')} — {HEALTH_ACTION_LABELS[e.action]} (
              {RESOURCE_LABELS[e.resourceType].toLowerCase()}) par{' '}
              {e.actorUserId === null
                ? 'le système'
                : e.actorUserId === userId
                  ? 'la personne elle-même'
                  : nameOf(e.actorUserId)}
            </Text>
            <Text size="xs" c="dimmed">
              {ACTOR_ROLE_LABELS[e.actorRole]}
            </Text>
          </Card>
        ))
      )}
    </Stack>
  );
}
