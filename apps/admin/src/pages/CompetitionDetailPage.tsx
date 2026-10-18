import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  FileButton,
  Group,
  List,
  Modal,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import {
  competitionsControllerDeleteEventResults,
  competitionsControllerImportResults,
} from '../api/generated/sdk.gen';
import type { ProgramEventDto } from '../api/generated/types.gen';
import { competitionProgramQuery, competitionQuery, unwrap } from '../api/queries';
import { BackToList } from '../components/BackToList';
import { ListSkeleton } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { TopTurnierImport } from '../components/TopTurnierImport';
import { TopTurnierUrlImport } from '../components/TopTurnierUrlImport';
import { apiErrorMessage } from '../lib/apiError';
import { COMPETITION_STATUS_BADGES, competitionDates, eventLabel } from '../lib/competitions';
import { readText } from '../lib/files';
import {
  csvLengthError,
  deletionSummary,
  type ImportReportCounts,
  lineErrors,
  reportRows,
  RESULTS_CSV_COLUMNS,
} from '../lib/resultsImport';

function ReportTable({ report, title }: { report: ImportReportCounts; title: string }) {
  return (
    <Table withTableBorder maw={480} aria-label={title}>
      <Table.Tbody>
        {reportRows(report).map((row) => (
          <Table.Tr key={row.key}>
            <Table.Th scope="row" fw={500}>
              {row.label}
            </Table.Th>
            <Table.Td ta="right">{row.value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** A refused file: its line errors when the API lists them, its message otherwise. */
function ImportError({ error, fallback }: { error: unknown; fallback: string }) {
  const lines = lineErrors(error);
  return (
    <Alert color="red" title={apiErrorMessage(error, fallback)}>
      {lines.length > 0 && (
        <Table aria-label="Lignes en erreur" mt="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={80}>Ligne</Table.Th>
              <Table.Th>Erreur</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((e, i) => (
              <Table.Tr key={`${e.line}-${i}`}>
                <Table.Td>{e.line}</Table.Td>
                <Table.Td>{e.message}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Alert>
  );
}

type ImportMode = 'csv' | 'topturnier' | 'url';

function ResultsImport({ competitionId }: { competitionId: string }) {
  const [mode, setMode] = useState<ImportMode>('csv');
  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Résultats</Title>
        <SegmentedControl
          aria-label="Source des résultats"
          value={mode}
          onChange={(value) => setMode(value as ImportMode)}
          data={[
            { value: 'csv', label: 'Fichier CSV' },
            { value: 'topturnier', label: 'Export TopTurnier' },
            // TEMPORARY (#787), until the FFD gives access to its data (#651).
            { value: 'url', label: 'Adresse (temporaire)' },
          ]}
          maw={560}
        />
        {mode === 'csv' && <CsvResultsImport competitionId={competitionId} />}
        {mode === 'url' && (
          <TopTurnierUrlImport
            competitionId={competitionId}
            renderReport={(report, title) => <ReportTable report={report} title={title} />}
            renderError={(error, fallback) => <ImportError error={error} fallback={fallback} />}
          />
        )}
        {mode === 'topturnier' && (
          <TopTurnierImport
            competitionId={competitionId}
            renderReport={(report, title) => <ReportTable report={report} title={title} />}
            renderError={(error, fallback) => <ImportError error={error} fallback={fallback} />}
          />
        )}
      </Stack>
    </Card>
  );
}

function CsvResultsImport({ competitionId }: { competitionId: string }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const send = (text: string, dryRun: boolean) =>
    unwrap(
      competitionsControllerImportResults({
        path: { id: competitionId },
        query: { dryRun },
        body: { csv: text },
      }),
    );
  const check = useMutation({ mutationFn: (text: string) => send(text, true) });
  const save = useMutation({
    mutationFn: (text: string) => send(text, false),
    onSuccess: () => {
      // An event with results is locked in the programme; the import is audited.
      void qc.invalidateQueries({ queryKey: competitionProgramQuery(competitionId).queryKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const changeCsv = (text: string) => {
    setCsv(text);
    setFileError(null);
    check.reset();
    save.reset();
  };
  const pickFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await readText(file);
      const tooLong = csvLengthError(text);
      if (tooLong) {
        changeCsv('');
        setFileError(tooLong);
        return;
      }
      changeCsv(text);
    } catch {
      setFileError('Lecture du fichier impossible.');
    }
  };

  const lengthError = csvLengthError(csv);
  const empty = csv.trim() === '';
  // « Importer » only sends the very text a dry run accepted.
  const verified = check.isSuccess && check.variables === csv;
  const imported = save.isSuccess && save.variables === csv;

  return (
    <Stack>
      <Text size="sm">
        Collez le classement publié par l'organisateur (CSV, séparateur « ; » ou « , », ligne
        d'en-tête obligatoire) ou choisissez le fichier, vérifiez-le, puis importez-le. Un fichier
        invalide n'importe rien ; réimporter un fichier corrigé met les lignes à jour.
      </Text>
      <List size="sm" spacing={2}>
        {RESULTS_CSV_COLUMNS.map((c) => (
          <List.Item key={c.name}>
            <Code>{c.name}</Code>
            {c.required ? '' : ' (facultative)'} : {c.help}
          </List.Item>
        ))}
      </List>
      <Textarea
        label="Contenu CSV"
        placeholder={
          'epreuve;tour;classement;couple\nLatines Adultes Avancé;Finale;1;Martin / Durand'
        }
        autosize
        minRows={6}
        maxRows={16}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        value={csv}
        onChange={(e) => changeCsv(e.currentTarget.value)}
        error={lengthError ?? fileError}
      />
      <Group>
        <FileButton onChange={(f) => void pickFile(f)} accept=".csv,text/csv">
          {(props) => (
            <Button variant="default" {...props}>
              Choisir un fichier .csv
            </Button>
          )}
        </FileButton>
        <Button
          variant="light"
          disabled={empty || lengthError !== null}
          loading={check.isPending}
          onClick={() => {
            save.reset();
            check.mutate(csv);
          }}
        >
          Vérifier
        </Button>
        <Button
          disabled={!verified || imported}
          loading={save.isPending}
          onClick={() => save.mutate(csv)}
        >
          Importer
        </Button>
      </Group>
      {check.isError && check.variables === csv && (
        <ImportError error={check.error} fallback="Vérification impossible." />
      )}
      {verified && !imported && !save.isError && (
        <Alert color="blue" title="Fichier valide : rien n'a encore été importé">
          <Text size="sm" mb="xs">
            Aperçu de l'import :
          </Text>
          <ReportTable report={check.data} title="Aperçu de l'import" />
        </Alert>
      )}
      {save.isError && <ImportError error={save.error} fallback="Import impossible." />}
      {imported && (
        <Alert color="green" title="Résultats importés">
          <ReportTable report={save.data} title="Bilan de l'import" />
        </Alert>
      )}
    </Stack>
  );
}

interface Deletion {
  eventId: string;
  label: string;
  summary: string;
}

function EventsResults({ competitionId }: { competitionId: string }) {
  const qc = useQueryClient();
  const program = useQuery(competitionProgramQuery(competitionId));
  const [target, setTarget] = useState<ProgramEventDto | null>(null);
  const [done, setDone] = useState<Deletion | null>(null);
  const remove = useMutation({
    mutationFn: (event: ProgramEventDto) =>
      unwrap(
        competitionsControllerDeleteEventResults({
          path: { id: competitionId },
          query: { eventId: event.id },
        }),
      ),
    onSuccess: (report, event) => {
      setDone({ eventId: event.id, label: eventLabel(event), summary: deletionSummary(report) });
      setTarget(null);
      void qc.invalidateQueries({ queryKey: competitionProgramQuery(competitionId).queryKey });
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
  const close = () => {
    setTarget(null);
    remove.reset();
  };

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>Épreuves</Title>
        <Text size="sm" c="dimmed">
          L'identifiant ou le nom d'une épreuve remplit la colonne <Code>epreuve</Code>. Pour
          corriger un import, supprimez les résultats importés de l'épreuve puis réimportez le
          fichier corrigé.
        </Text>
        {done && (
          <Alert
            color="green"
            title={`Épreuve « ${done.label} »`}
            withCloseButton
            onClose={() => setDone(null)}
          >
            {done.summary}
          </Alert>
        )}
        {program.isError && (
          <Alert color="red">
            {apiErrorMessage(program.error, 'Impossible de charger les épreuves.')}
          </Alert>
        )}
        {program.isPending && <ListSkeleton rows={3} />}
        {program.data && program.data.events.length === 0 && (
          <Text size="sm">Cette compétition n'a aucune épreuve.</Text>
        )}
        {program.data?.events.map((event) => (
          <Paper key={event.id} withBorder p="sm">
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Stack gap={2} miw={0}>
                <Group gap="xs">
                  <Text fw={500}>{eventLabel(event)}</Text>
                  {event.locked && (
                    <Badge size="xs" variant="light" color="gray">
                      Inscriptions ou résultats
                    </Badge>
                  )}
                </Group>
                <Code style={{ overflowWrap: 'anywhere' }}>{event.id}</Code>
              </Stack>
              <Button
                variant="outline"
                color="red"
                size="xs"
                aria-label={`Supprimer les résultats importés : ${eventLabel(event)}`}
                onClick={() => {
                  remove.reset();
                  setTarget(event);
                }}
              >
                Supprimer les résultats importés
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
      <Modal opened={target !== null} onClose={close} title="Supprimer les résultats importés">
        {target && (
          <Stack>
            <Text size="sm">
              Les résultats importés de l'épreuve « {eventLabel(target)} » seront supprimés. Les
              lignes anonymisées (compte ou partenaire supprimé) sont conservées.
            </Text>
            {remove.isError && (
              <Alert color="red">{apiErrorMessage(remove.error, 'Suppression impossible.')}</Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Annuler
              </Button>
              <Button color="red" loading={remove.isPending} onClick={() => remove.mutate(target)}>
                Supprimer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Card>
  );
}

export function CompetitionDetailPage() {
  const { id = '' } = useParams();
  const competition = useQuery(competitionQuery(id));

  if (competition.isError) {
    return <Alert color="red">Compétition introuvable ou erreur serveur.</Alert>;
  }
  if (!competition.data) return <ListSkeleton rows={5} />;
  const c = competition.data;
  const status = c.status ? (COMPETITION_STATUS_BADGES[c.status] ?? null) : null;

  return (
    <Stack>
      <BackToList listPath="/competitions" />
      <PageHeader
        title={c.title}
        badges={
          status && (
            <Badge variant="light" color={status.color}>
              {status.label}
            </Badge>
          )
        }
      />
      <Card withBorder>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Text size="sm">Dates : {competitionDates(c)}</Text>
          <Text size="sm">Lieu : {c.place ?? '—'}</Text>
        </SimpleGrid>
      </Card>
      <ResultsImport competitionId={c.id} />
      <EventsResults competitionId={c.id} />
    </Stack>
  );
}
