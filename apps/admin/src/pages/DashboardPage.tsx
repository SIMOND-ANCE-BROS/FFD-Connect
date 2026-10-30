import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { AdminStatsDto } from '../api/generated/types.gen';
import {
  auditQuery,
  pendingCountQuery,
  pendingRenewalsCountQuery,
  statsQuery,
} from '../api/queries';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { ACTION_LABELS } from '../lib/auditLabels';
import { seriesTotal } from '../lib/stats';
import { useSession } from '../session/sessionStore';
import { formatParisDateTime } from '../lib/parisDate';

/** The shortest stats period: the key figures are about "now", not a trend. */
const STATS_PERIOD = '12w';
const RECENT_ACTIVITY = 5;

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack component="section" gap="sm" aria-label={title}>
      <Group justify="space-between" wrap="wrap">
        <Title order={2} size="h3">
          {title}
        </Title>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

/** A queue waiting for a decision: the whole card opens it. `null`: count unavailable. */
function QueueCard({ to, label, count }: { to: string; label: string; count?: number | null }) {
  return (
    <Card withBorder padding="md" component={Link} to={to}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{label}</Text>
        {count === undefined ? (
          <Skeleton h={28} w={40} />
        ) : count === null ? (
          <Badge size="xl" color="gray" variant="light">
            —
          </Badge>
        ) : (
          <Badge
            size="xl"
            // Work waiting, not an incident: red stays for errors (DESIGN.md).
            color={count > 0 ? 'ffd' : 'gray'}
            variant={count > 0 ? 'filled' : 'light'}
          >
            {count}
          </Badge>
        )}
      </Group>
      {typeof count === 'number' && (
        <Text size="sm" c="dimmed" mt={4}>
          {count === 0 ? 'Rien à traiter' : 'En attente de décision'}
        </Text>
      )}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <Card withBorder padding="sm">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl" className="app-tabular">
        {value}
      </Text>
    </Card>
  );
}

export function keyFigures(s: AdminStatsDto): { label: string; value: number }[] {
  return [
    { label: 'Comptes', value: s.users.total },
    { label: 'Actifs 7 jours', value: s.users.active7d },
    { label: 'Licences valides', value: s.licences.valid },
    { label: 'Licences expirant sous 30 jours', value: s.licences.expiring30d },
    {
      label: 'Compétitions à venir',
      value: s.competitions.byStatus.UPCOMING + s.competitions.byStatus.LIVE,
    },
    { label: 'Inscriptions sur 12 semaines', value: seriesTotal(s.users.signups) },
  ];
}

function KeyFigures() {
  const stats = useQuery(statsQuery(STATS_PERIOD));
  if (stats.isError) return <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>;
  return (
    <SimpleGrid cols={{ base: 2, sm: 3 }}>
      {stats.data
        ? keyFigures(stats.data).map((f) => <Figure key={f.label} {...f} />)
        : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={68} radius="md" />)}
    </SimpleGrid>
  );
}

function RecentActivity() {
  const log = useQuery(auditQuery({ skip: 0, take: RECENT_ACTIVITY }));
  if (log.isError) return <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>;
  if (!log.data) {
    return (
      <Stack gap="xs" role="status" aria-label="Chargement…">
        {Array.from({ length: RECENT_ACTIVITY }, (_, i) => (
          <Skeleton key={i} h={40} radius="sm" />
        ))}
      </Stack>
    );
  }
  if (log.data.data.length === 0) return <EmptyState title="Aucune action enregistrée" />;
  return (
    <Card withBorder padding={0}>
      <Stack gap={0} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
        {log.data.data.map((entry, i) => (
          <Group
            key={entry.id}
            component="li"
            justify="space-between"
            wrap="nowrap"
            px="md"
            py="sm"
            style={
              i > 0 ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined
            }
          >
            <Stack gap={0} miw={0}>
              <Text size="sm" fw={500} truncate>
                {ACTION_LABELS[entry.action]}
              </Text>
              <Text size="sm" c="dimmed" truncate>
                {entry.actorName ?? 'Système'}
              </Text>
            </Stack>
            <Text size="sm" c="dimmed" className="app-tabular" style={{ whiteSpace: 'nowrap' }}>
              {formatParisDateTime(entry.createdAt)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

/**
 * Home of the back-office: what waits for a decision first, then the key
 * figures and the latest actions. Loaded on open only, never polled: every
 * request wakes the scale-to-zero backend.
 */
export function DashboardPage() {
  const firstName = useSession((s) => s.user?.firstName);
  // Same cache entries as the menu badges: no extra request.
  const moderation = useQuery(pendingCountQuery);
  const renewals = useQuery(pendingRenewalsCountQuery);
  return (
    <Stack gap="xl">
      <PageHeader
        title="Tableau de bord"
        description={firstName ? `Bonjour ${firstName}` : undefined}
      />
      <Section title="À traiter">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <QueueCard
            to="/moderation"
            label="Propositions de correction"
            count={moderation.isError ? null : moderation.data?.count}
          />
          <QueueCard
            to="/license-renewals"
            label="Renouvellements de licence"
            count={renewals.isError ? null : renewals.data?.count}
          />
        </SimpleGrid>
      </Section>
      <Section
        title="Chiffres clés"
        action={
          <Anchor component={Link} to="/stats" size="sm">
            Voir les statistiques
          </Anchor>
        }
      >
        <KeyFigures />
      </Section>
      <Section
        title="Activité récente"
        action={
          <Anchor component={Link} to="/audit-log" size="sm">
            Voir le journal
          </Anchor>
        }
      >
        <RecentActivity />
      </Section>
      <Section title="Raccourcis">
        <Group gap="sm" wrap="wrap">
          <Button component={Link} to="/users/new" variant="light">
            Nouvel utilisateur
          </Button>
          <Button component={Link} to="/clubs/new" variant="light">
            Nouveau club
          </Button>
          <Button component={Link} to="/tracks/import" variant="light">
            Importer des musiques
          </Button>
        </Group>
      </Section>
    </Stack>
  );
}
