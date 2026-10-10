import '@mantine/charts/styles.css';
import { BarChart } from '@mantine/charts';
import {
  Alert,
  Box,
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
  VisuallyHidden,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { AdminUsageDto } from '../api/generated/types.gen';
import { usageQuery } from '../api/queries';
import { UNAVAILABLE_MESSAGE } from '../lib/apiError';
import { bucketLabel } from '../lib/stats';
import {
  DAY_LABELS,
  formatMinutes,
  frDate,
  heatLevel,
  parseUsagePeriod,
  parseUsageSpace,
  share,
  USAGE_PERIOD_OPTIONS,
  USAGE_SPACE_OPTIONS,
} from '../lib/usage';

const FOOTER =
  "Données anonymes : un identifiant d'installation renouvelé chaque mois, sans lien avec les comptes. Les utilisateurs qui ont désactivé la mesure d'audience n'apparaissent pas.";
const HEAT = [
  'var(--mantine-color-gray-1)',
  'var(--mantine-color-blue-2)',
  'var(--mantine-color-blue-4)',
  'var(--mantine-color-blue-6)',
  'var(--mantine-color-blue-8)',
];
const EVENT_SERIES = [
  { name: 'login', label: 'Connexions', color: 'blue.6' },
  { name: 'login_biometric', label: 'Biométrie', color: 'cyan.6' },
  { name: 'login_guest', label: 'Invités', color: 'gray.6' },
  { name: 'register', label: 'Inscriptions', color: 'teal.6' },
  { name: 'license_scan', label: 'Scans de licence', color: 'orange.6' },
  { name: 'license_wallet_add', label: 'Ajouts Wallet', color: 'grape.6' },
];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

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

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(0, ...grid.flat());
  return (
    <Stack gap={4}>
      <Text fw={500}>Jour × heure</Text>
      <Box style={{ overflowX: 'auto' }}>
        <Box
          aria-hidden="true"
          style={{
            display: 'grid',
            gridTemplateColumns: '3rem repeat(24, minmax(14px, 1fr))',
            gap: 2,
            minWidth: 420,
          }}
        >
          <span />
          {HOURS.map((h) => (
            <Text key={h} size="xs" c="dimmed" ta="center">
              {h % 3 === 0 ? h : ''}
            </Text>
          ))}
          {grid.map((row, d) => [
            <Text key={`label-${d}`} size="xs" c="dimmed">
              {DAY_LABELS[d]}
            </Text>,
            ...row.map((value, h) => {
              const level = heatLevel(value, max);
              return (
                <div
                  key={`${d}-${h}`}
                  title={`${DAY_LABELS[d]} ${h} h : ${value}`}
                  data-level={level}
                  style={{ height: 18, borderRadius: 3, background: HEAT[level] }}
                />
              );
            }),
          ])}
        </Box>
      </Box>
      <VisuallyHidden>
        <table aria-label="Usage par jour et heure">
          <thead>
            <tr>
              <th>Jour</th>
              {HOURS.map((h) => (
                <th key={h}>{h} h</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={d}>
                <th>{DAY_LABELS[d]}</th>
                {row.map((v, h) => (
                  <td key={h}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </VisuallyHidden>
    </Stack>
  );
}

const isEmpty = (u: AdminUsageDto) =>
  u.screens.length === 0 && u.heatmap.every((row) => row.every((v) => v === 0));

function UsageContent({ u }: { u: AdminUsageDto }) {
  const platformTotal = u.platforms.ios + u.platforms.android;
  const viewTotal = u.screens.reduce((s, r) => s + r.views, 0);
  const events = u.events.map((e) => ({
    ...e,
    label: bucketLabel(e.start, u.bucket === 'month' ? 'month' : 'week'),
  }));
  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        <Figure
          label="Installations actives / jour"
          value={decimal.format(u.activeInstallsPerDay)}
        />
        <Figure label="Installations actives ce mois" value={u.activeInstallsThisMonth} />
        <Figure label="Sessions" value={u.sessions ?? '—'} />
        <Figure label="Durée médiane d'une session" value={formatMinutes(u.medianSessionMinutes)} />
        <Figure
          label="iOS / Android"
          value={
            platformTotal
              ? `${share(u.platforms.ios, platformTotal)} / ${share(u.platforms.android, platformTotal)}`
              : '—'
          }
        />
      </SimpleGrid>

      {isEmpty(u) ? (
        <Text c="dimmed">Aucune donnée d'usage sur la période.</Text>
      ) : (
        <>
          <Heatmap grid={u.heatmap} />
          <Stack gap={4}>
            <Text fw={500}>Événements clés</Text>
            <div aria-hidden="true">
              <BarChart
                h={200}
                data={events}
                dataKey="label"
                type="stacked"
                series={EVENT_SERIES}
                withLegend
              />
            </div>
          </Stack>
        </>
      )}

      <Stack gap="xs">
        <Title order={3}>Écrans</Title>
        <Table.ScrollContainer minWidth={420}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Écran</Table.Th>
                <Table.Th>Vues</Table.Th>
                <Table.Th>Temps total</Table.Th>
                <Table.Th>Part</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.screens.map((s) => (
                <Table.Tr key={s.screen}>
                  <Table.Td>{s.screen}</Table.Td>
                  <Table.Td>{s.views}</Table.Td>
                  <Table.Td>{formatMinutes(Math.round(s.durationSec / 6) / 10)}</Table.Td>
                  <Table.Td>{share(s.views, viewTotal)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Stack gap="xs">
          <Title order={3}>Versions (7 derniers jours)</Title>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Version</Table.Th>
                <Table.Th>Installations</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.versions.map((v) => (
                <Table.Tr key={v.appVersion}>
                  <Table.Td>{v.appVersion}</Table.Td>
                  <Table.Td>{v.installs}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
        <Stack gap="xs">
          <Title order={3}>Compétitions les plus vues</Title>
          {u.period === '12m' ? (
            <Text size="sm" c="dimmed">
              90 derniers jours
            </Text>
          ) : null}
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Compétition</Table.Th>
                <Table.Th>Vues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {u.competitions.map((c) => (
                <Table.Tr key={c.competitionId}>
                  <Table.Td>{c.title ?? 'Compétition supprimée'}</Table.Td>
                  <Table.Td>{c.views}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </SimpleGrid>

      <Text size="sm" c="dimmed">
        {FOOTER}
      </Text>
    </Stack>
  );
}

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const period = parseUsagePeriod(params.get('period'));
  const space = parseUsageSpace(params.get('space'));
  const usage = useQuery(usageQuery(period, space));
  const update = (key: 'period' | 'space', value: string) => {
    const next = new URLSearchParams(params);
    if (key === 'period') next.set('period', value);
    if (key === 'space') {
      if (!next.has('period')) next.set('period', period);
      if (value === 'ALL') next.delete('space');
      else next.set('space', value);
    }
    setParams(next);
  };
  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Usage de l'app</Title>
        <Group wrap="wrap">
          <SegmentedControl
            value={period}
            data={USAGE_PERIOD_OPTIONS}
            onChange={(v) => update('period', v)}
          />
          <Button variant="default" onClick={() => void usage.refetch()} loading={usage.isFetching}>
            Actualiser
          </Button>
        </Group>
      </Group>
      <Group wrap="wrap" gap="xs">
        <Text size="sm">Écrans de l'espace :</Text>
        <SegmentedControl
          size="xs"
          value={space ?? 'ALL'}
          data={USAGE_SPACE_OPTIONS}
          onChange={(v) => update('space', v)}
        />
      </Group>
      {usage.data?.period === '12m' && usage.data.aggregatedUntil ? (
        <Text size="sm" c="dimmed">
          Données agrégées jusqu'au {frDate(usage.data.aggregatedUntil)}
        </Text>
      ) : null}
      {usage.isError ? (
        <Alert color="red">{UNAVAILABLE_MESSAGE}</Alert>
      ) : usage.data ? (
        <UsageContent u={usage.data} />
      ) : (
        <Stack>
          <Skeleton h={80} />
          <Skeleton h={200} />
        </Stack>
      )}
    </Stack>
  );
}
