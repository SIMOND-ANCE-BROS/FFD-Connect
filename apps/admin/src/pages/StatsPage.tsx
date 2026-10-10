import '@mantine/charts/styles.css';
import { BarChart, LineChart } from '@mantine/charts';
import {
  Alert,
  Anchor,
  Button,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import type { AdminStatsDto } from '../api/generated/types.gen';
import { statsQuery } from '../api/queries';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import {
  bucketLabel,
  durationLabel,
  parseStatsPeriod,
  rateLabel,
  seriesTotal,
  STATS_PERIOD_OPTIONS,
} from '../lib/stats';

const HISTORY_NOTE =
  "Les comptes supprimés (dont la purge après 3 ans d'inactivité) ne figurent plus dans les chiffres passés.";

const generatedFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

const ROLE_SERIES = [
  { name: 'LICENSEE', label: 'Licenciés', color: 'blue.6' },
  { name: 'CLUB', label: 'Clubs', color: 'teal.6' },
  { name: 'STAFF', label: 'Staff', color: 'orange.6' },
  { name: 'ADMIN', label: 'Admins', color: 'grape.6' },
];
const REGISTRATION_SERIES = [
  { name: 'PENDING', label: 'En attente', color: 'yellow.6' },
  { name: 'CONFIRMED', label: 'Confirmées', color: 'teal.6' },
  { name: 'CANCELLED', label: 'Annulées', color: 'gray.6' },
];
const CORRECTION_SERIES = [
  { name: 'TITLE', label: 'Titre', color: 'blue.6' },
  { name: 'ARTIST', label: 'Artiste', color: 'cyan.6' },
  { name: 'DANCE', label: 'Danse', color: 'teal.6' },
  { name: 'MPM', label: 'MPM', color: 'orange.6' },
  { name: 'PASO_CLASH', label: 'Clashes paso', color: 'red.6' },
  { name: 'OTHER', label: 'Autre', color: 'gray.6' },
];

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} size="xl">
        {value}
      </Text>
    </Card>
  );
}

/** Chart with a text summary; the SVG itself is hidden from screen readers. */
function Chart({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={4}>
      <Text fw={500}>{title}</Text>
      <Text size="sm" c="dimmed">
        {summary}
      </Text>
      <div aria-hidden="true">{children}</div>
    </Stack>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack component="section" gap="sm">
      <Title order={3}>{title}</Title>
      {children}
    </Stack>
  );
}

function StatsContent({ s }: { s: AdminStatsDto }) {
  const label = <T extends { start: string }>(rows: T[]) =>
    rows.map((r) => ({ ...r, label: bucketLabel(r.start, s.bucket) }));
  const sum = (rows: Array<Record<string, number | string>>, noun: string) =>
    `${seriesTotal(rows)} ${noun} sur la période`;
  const u = s.users;
  const l = s.licences;
  const c = s.competitions;
  const t = s.content;
  return (
    <Stack gap="xl">
      <Block title="Utilisateurs">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Comptes" value={u.total} />
          <Figure label="Licenciés" value={u.byRole.LICENSEE} />
          <Figure label="Clubs" value={u.byRole.CLUB} />
          <Figure label="Staff" value={u.byRole.STAFF} />
          <Figure label="Admins" value={u.byRole.ADMIN} />
          <Figure label="Jamais connectés" value={u.neverLoggedIn} />
          <Figure label="Actifs 7 jours" value={u.active7d} />
          <Figure label="Actifs 30 jours" value={u.active30d} />
          <Figure label="Désactivés" value={u.disabled} />
        </SimpleGrid>
        <Chart title="Inscriptions" summary={sum(u.signups, 'inscriptions')}>
          <LineChart
            h={220}
            data={label(u.signups)}
            dataKey="label"
            series={ROLE_SERIES}
            withLegend
          />
        </Chart>
      </Block>

      <Block title="Licences et clubs">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Licences valides" value={l.valid} />
          <Figure label="Expirent sous 30 jours" value={l.expiring30d} />
          <Figure label="Expirent sous 60 jours" value={l.expiring60d} />
          <Figure label="Expirées" value={l.expired} />
          <Figure label="Renouvellements en attente" value={l.renewalsPending} />
          <Figure label="Clubs sans compte Club" value={l.clubsWithoutClubAccount} />
        </SimpleGrid>
        <Chart title="Licences créées" summary={sum(l.created, 'licences')}>
          <BarChart
            h={200}
            data={label(l.created)}
            dataKey="label"
            series={[{ name: 'count', label: 'Licences', color: 'blue.6' }]}
          />
        </Chart>
        <Table.ScrollContainer minWidth={480}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th>
                <Table.Th>Membres</Table.Th>
                <Table.Th>Comptes Club</Table.Th>
                <Table.Th>Licences valides</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {l.clubs.map((club) => (
                <Table.Tr key={club.id}>
                  <Table.Td>
                    <Anchor component={RouterLink} to={`/clubs/${club.id}`}>
                      {club.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{club.members}</Table.Td>
                  <Table.Td>{club.clubAccounts}</Table.Td>
                  <Table.Td>{club.validLicences}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Block>

      <Block title="Compétitions">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="À venir" value={c.byStatus.UPCOMING} />
          <Figure label="En cours" value={c.byStatus.LIVE} />
          <Figure label="Passées" value={c.byStatus.PAST} />
          <Figure label="Annulées" value={c.byStatus.CANCELLED} />
          <Figure label="Taux de pointage" value={rateLabel(c.pastCheckedIn, c.pastConfirmed)} />
          <Figure label="Taux de paiement" value={rateLabel(c.pastPaid, c.pastConfirmed)} />
        </SimpleGrid>
        <Chart
          title="Inscriptions aux épreuves"
          summary={sum(c.registrations, 'inscriptions aux épreuves')}
        >
          <BarChart
            h={220}
            data={label(c.registrations)}
            dataKey="label"
            type="stacked"
            series={REGISTRATION_SERIES}
            withLegend
          />
        </Chart>
      </Block>

      <Block title="Contenu et modération">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Figure label="Musiques prêtes" value={t.tracksByStatus.READY} />
          <Figure label="En attente" value={t.tracksByStatus.PENDING} />
          <Figure label="En erreur" value={t.tracksByStatus.ERROR} />
          <Figure label="Blacklistées" value={t.tracksBlacklisted} />
          <Figure label="Titre masqué" value={t.tracksMasked} />
          <Figure label="Propositions à traiter" value={t.correctionsPending} />
          <Figure
            label="Approuvées sur la période"
            value={rateLabel(t.correctionsApproved, t.correctionsApproved + t.correctionsRejected)}
          />
          <Figure label="Délai médian de traitement" value={durationLabel(t.medianReviewHours)} />
        </SimpleGrid>
        <Chart title="Propositions de correction" summary={sum(t.corrections, 'propositions')}>
          <BarChart
            h={220}
            data={label(t.corrections)}
            dataKey="label"
            type="stacked"
            series={CORRECTION_SERIES}
            withLegend
          />
        </Chart>
        <Chart title="Rapports de bug" summary={sum(t.bugReports, 'rapports')}>
          <BarChart
            h={180}
            data={label(t.bugReports)}
            dataKey="label"
            series={[{ name: 'count', label: 'Rapports', color: 'red.6' }]}
          />
        </Chart>
        <Chart title="Actions admin" summary={sum(t.adminActions, 'actions')}>
          <BarChart
            h={180}
            data={label(t.adminActions)}
            dataKey="label"
            series={[{ name: 'count', label: 'Actions', color: 'grape.6' }]}
          />
        </Chart>
      </Block>

      <Text size="sm" c="dimmed">
        {HISTORY_NOTE}
      </Text>
    </Stack>
  );
}

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const period = parseStatsPeriod(params.get('period'));
  const stats = useQuery(statsQuery(period));
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Statistiques</Title>
        <Group wrap="wrap">
          <SegmentedControl
            value={period}
            data={STATS_PERIOD_OPTIONS}
            onChange={(value) => setParams({ period: value })}
          />
          <Button variant="default" onClick={() => void stats.refetch()} loading={stats.isFetching}>
            Actualiser
          </Button>
        </Group>
      </Group>
      {stats.data ? (
        <Text size="sm" c="dimmed">
          Calculé le {generatedFormat.format(new Date(stats.data.generatedAt))}
        </Text>
      ) : null}
      {stats.isError ? (
        <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>
      ) : stats.data ? (
        <StatsContent s={stats.data} />
      ) : (
        <Stack>
          <Skeleton h={80} />
          <Skeleton h={220} />
        </Stack>
      )}
    </Stack>
  );
}
