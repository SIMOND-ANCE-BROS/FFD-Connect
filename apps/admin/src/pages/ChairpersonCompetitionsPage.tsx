import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminTopTurnierControllerCompetitions } from '../api/generated/sdk.gen';
import { topTurnierStatusQuery, unwrap } from '../api/queries';
import { EmptyState, ListSkeleton } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { ImportError, ReportTable } from '../components/ResultsImportReport';
import { TopTurnierUrlImport } from '../components/TopTurnierUrlImport';
import { apiErrorMessage, isConflict } from '../lib/apiError';
import { useIsMobile } from '../lib/useIsMobile';
import {
  type ChairpersonItem,
  formatDay,
  isDisabled,
  listSummary,
  MATCH_BADGES,
  targetCompetition,
  type YearChoice,
  yearOptions,
  yearParam,
} from '../lib/chairperson';

const DISABLED_NOTICE = (
  <Alert color="gray" title="Fonction désactivée sur cet environnement">
    La lecture de la liste des compétitions récentes du site chairperson n’est pas activée ici.
    L’import reste possible depuis la fiche de chaque compétition (export TopTurnier ou CSV).
  </Alert>
);

interface Opened {
  competitionId: string;
  title: string;
  exportUrl: string;
}

function MatchCell({
  item,
  picked,
  onPick,
}: {
  item: ChairpersonItem;
  picked: string | null;
  onPick: (id: string | null) => void;
}) {
  const { match } = item;
  if (match.status === 'MATCHED' && match.competitionId) {
    return (
      <Anchor component={Link} to={`/competitions/${match.competitionId}`} size="sm">
        Voir la compétition
      </Anchor>
    );
  }
  if (match.status === 'AMBIGUOUS') {
    return (
      <Select
        aria-label={`Compétition de l’app pour « ${item.title} »`}
        placeholder="Choisir la compétition"
        data={match.candidates.map((c) => ({ value: c.id, label: c.title }))}
        value={picked}
        onChange={onPick}
        size="xs"
        maw={280}
        allowDeselect
      />
    );
  }
  return (
    <Text size="sm" c="dimmed">
      Aucune compétition correspondante dans l’app
    </Text>
  );
}

/**
 * TEMPORARY (#801, with #787): recent competitions of the TopTurnier site
 * (chairperson), matched to the competitions of the app, each one imported
 * through the existing URL import (dry run, then import). The list is read
 * ONLY when the staff clicks « Lire la liste » — never on page load.
 */
export function ChairpersonCompetitionsPage() {
  const status = useQuery(topTurnierStatusQuery);
  const [year, setYear] = useState<YearChoice>('both');
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const isMobile = useIsMobile();
  const [opened, setOpened] = useState<Opened | null>(null);
  // A mutation, not a query: never refetched on focus, reconnect or remount
  // (each read reaches the third-party site).
  const read = useMutation({
    mutationFn: (choice: YearChoice) =>
      unwrap(adminTopTurnierControllerCompetitions({ query: { year: yearParam(choice) } })),
    onSuccess: () => setPicked({}),
  });

  const disabled = status.data?.enabled === false || (read.isError && isDisabled(read.error));

  const open = (item: ChairpersonItem) => {
    const competitionId = targetCompetition(item, picked[item.exportUrl]);
    if (competitionId === null) return;
    setOpened({ competitionId, title: item.title, exportUrl: item.exportUrl });
  };

  const matchBadges = (item: ChairpersonItem) => {
    const badge = MATCH_BADGES[item.match.status];
    return (
      <Group gap={4}>
        <Badge color={badge.color} variant="light">
          {badge.label}
        </Badge>
        {item.resultsAlreadyImported && (
          <Badge color="blue" variant="light">
            Résultats déjà présents
          </Badge>
        )}
      </Group>
    );
  };
  const matchCell = (item: ChairpersonItem) => (
    <MatchCell
      item={item}
      picked={picked[item.exportUrl] ?? null}
      onPick={(id) => setPicked((current) => ({ ...current, [item.exportUrl]: id }))}
    />
  );
  const verifyButton = (item: ChairpersonItem, fullWidth: boolean) =>
    item.match.status === 'NONE' ? null : (
      <Button
        size={fullWidth ? 'sm' : 'xs'}
        fullWidth={fullWidth}
        variant="light"
        disabled={targetCompetition(item, picked[item.exportUrl]) === null}
        onClick={() => open(item)}
        aria-label={`Vérifier « ${item.title} »`}
      >
        Vérifier
      </Button>
    );

  return (
    <Stack>
      <PageHeader
        title="Compétitions récentes (chairperson)"
        description="Liste publique des résultats publiés sur le site chairperson, rapprochée des compétitions de l’app : vérifiez puis importez les résultats d’une compétition sans chercher l’adresse de son export."
        badges={<Badge color="yellow">Temporaire</Badge>}
      />
      <Alert color="yellow" title="Solution temporaire">
        En attendant un accès officiel aux données de la FFD. Le site n’est lu que lorsque vous
        cliquez sur « Lire la liste » (deux pages au plus), jamais automatiquement. Une compétition
        n’est rapprochée que si une seule compétition de l’app a lieu le même jour au même endroit ;
        sinon, choisissez-la vous-même ou passez par la fiche de la compétition.
      </Alert>
      {status.isPending ? (
        <ListSkeleton rows={2} />
      ) : disabled ? (
        DISABLED_NOTICE
      ) : (
        <>
          <Group align="flex-end">
            <Select
              label="Année"
              data={yearOptions()}
              value={year}
              onChange={(value) => value && setYear(value as YearChoice)}
              allowDeselect={false}
              w={180}
            />
            <Button loading={read.isPending} onClick={() => read.mutate(year)}>
              Lire la liste
            </Button>
          </Group>
          {read.isPending && <ListSkeleton rows={6} />}
          {read.isError && (
            <Alert color={isConflict(read.error) ? 'orange' : 'red'}>
              {apiErrorMessage(read.error, 'Lecture de la liste impossible.')}
            </Alert>
          )}
          {read.isIdle && (
            <Text size="sm" c="dimmed">
              Choisissez l’année puis cliquez sur « Lire la liste ».
            </Text>
          )}
          {read.isSuccess && read.data.items.length === 0 && (
            <EmptyState title="Aucune compétition sur le site pour cette période" />
          )}
          {read.isSuccess && read.data.items.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                {listSummary(read.data.items)}
                {read.data.truncated && ' — liste tronquée par le site'}
              </Text>
              {isMobile ? (
                // Phone: one card per competition, the action inside it (the
                // table would push « Vérifier » off screen).
                <Stack gap="xs" role="list" aria-label="Compétitions récentes du site chairperson">
                  {read.data.items.map((item) => (
                    <Paper key={item.exportUrl} withBorder p="sm" role="listitem">
                      <Stack gap={6}>
                        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
                          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                            {item.title}
                          </Text>
                          <Text
                            size="sm"
                            c="dimmed"
                            className="app-tabular"
                            style={{ whiteSpace: 'nowrap' }}
                          >
                            {formatDay(item.date)}
                          </Text>
                        </Group>
                        {item.category && (
                          <Text size="sm" c="dimmed">
                            {item.category}
                          </Text>
                        )}
                        {matchBadges(item)}
                        {matchCell(item)}
                        {verifyButton(item, true)}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Table.ScrollContainer minWidth={760}>
                  <Table striped aria-label="Compétitions récentes du site chairperson">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Date</Table.Th>
                        <Table.Th>Compétition (site)</Table.Th>
                        <Table.Th>Rapprochement</Table.Th>
                        <Table.Th>Compétition de l’app</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {read.data.items.map((item) => (
                        <Table.Tr key={item.exportUrl}>
                          <Table.Td>{formatDay(item.date)}</Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {item.title}
                            </Text>
                            {item.category && (
                              <Text size="sm" c="dimmed">
                                {item.category}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>{matchBadges(item)}</Table.Td>
                          <Table.Td>{matchCell(item)}</Table.Td>
                          <Table.Td>{verifyButton(item, false)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Stack>
          )}
        </>
      )}
      <Modal
        opened={opened !== null}
        onClose={() => setOpened(null)}
        title={opened ? `Import des résultats — ${opened.title}` : ''}
        size="xl"
      >
        {opened && (
          <Stack>
            <Anchor component={Link} to={`/competitions/${opened.competitionId}`} size="sm">
              Ouvrir la fiche de la compétition de l’app
            </Anchor>
            <TopTurnierUrlImport
              key={`${opened.competitionId} ${opened.exportUrl}`}
              competitionId={opened.competitionId}
              initialUrl={opened.exportUrl}
              readOnlyUrl
              autoCheck
              renderReport={(report, title) => <ReportTable report={report} title={title} />}
              renderError={(error, fallback) => <ImportError error={error} fallback={fallback} />}
            />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
