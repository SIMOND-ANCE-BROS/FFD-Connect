import { Alert, Badge, Button, FileButton, Group, Stack, Table, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { competitionsControllerImportTopTurnierResults } from '../api/generated/sdk.gen';
import { invalidateCompetitionResults, unwrap } from '../api/queries';
import type { ImportReportCounts } from '../lib/resultsImport';
import {
  archiveSizeError,
  eventMappings,
  mappingSummary,
  STATUS_BADGES,
  type TopTurnierEventMapping,
} from '../lib/topturnierImport';

export function MappingTable({ events }: { events: readonly TopTurnierEventMapping[] }) {
  if (events.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text size="sm">{mappingSummary(events)}</Text>
      <Table withTableBorder aria-label="Correspondance des épreuves">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Épreuve TopTurnier</Table.Th>
            <Table.Th>État</Table.Th>
            <Table.Th>Épreuve du programme</Table.Th>
            <Table.Th ta="right">Lignes</Table.Th>
            <Table.Th>Remarque</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {events.map((e) => (
            <Table.Tr key={e.folder}>
              <Table.Td>{e.label}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_BADGES[e.status].color} variant="light">
                  {STATUS_BADGES[e.status].label}
                </Badge>
              </Table.Td>
              <Table.Td>{e.eventName ?? '—'}</Table.Td>
              <Table.Td ta="right">{e.rows}</Table.Td>
              <Table.Td>
                {[
                  e.exact === false ? 'classes d’âge réunies : vérifier l’épreuve' : null,
                  e.message,
                ]
                  .filter(Boolean)
                  .join(' ; ') || '—'}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

interface Props {
  competitionId: string;
  /** Report table of the usual counts (shared with the CSV import). */
  renderReport: (report: ImportReportCounts, title: string) => ReactNode;
  /** Error block of a refused import (message + line errors). */
  renderError: (error: unknown, fallback: string) => ReactNode;
}

/**
 * Import of a TopTurnier export (#786): the zip archive of the export is
 * checked (dry run: event mapping + counts, nothing written), then imported.
 */
export function TopTurnierImport({ competitionId, renderReport, renderError }: Props) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const send = (archive: File, dryRun: boolean) =>
    unwrap(
      competitionsControllerImportTopTurnierResults({
        path: { id: competitionId },
        query: { dryRun },
        body: { file: archive },
      }),
    );
  const check = useMutation({ mutationFn: (archive: File) => send(archive, true) });
  const save = useMutation({
    mutationFn: (archive: File) => send(archive, false),
    onSuccess: () => {
      invalidateCompetitionResults(qc, competitionId);
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  const pick = (picked: File | null) => {
    check.reset();
    save.reset();
    if (!picked) return;
    const tooBig = archiveSizeError(picked);
    setFileError(tooBig);
    setFile(tooBig ? null : picked);
  };

  // « Importer » only sends the very archive a dry run accepted.
  const verified = file !== null && check.isSuccess && check.variables === file;
  const imported = file !== null && save.isSuccess && save.variables === file;

  return (
    <Stack>
      <Text size="sm">
        Choisissez l’archive zip de l’export HTML de TopTurnier (la page de la compétition index.htm
        et un dossier par épreuve), vérifiez-la, puis importez-la. Chaque épreuve TopTurnier est
        rapprochée d’une épreuve du programme ; une épreuve non reconnue ou ambiguë n’est jamais
        devinée : elle est signalée et ignorée. Réimporter l’export met les lignes à jour sans
        doublon.
      </Text>
      <Group>
        <FileButton onChange={pick} accept=".zip,application/zip,application/x-zip-compressed">
          {(props) => (
            <Button variant="default" {...props}>
              Choisir l’archive .zip
            </Button>
          )}
        </FileButton>
        <Text size="sm" c="dimmed">
          {file ? file.name : 'Aucune archive choisie'}
        </Text>
      </Group>
      {fileError && (
        <Text size="sm" c="red" role="alert">
          {fileError}
        </Text>
      )}
      <Group>
        <Button
          variant="light"
          disabled={!file}
          loading={check.isPending}
          onClick={() => {
            if (!file) return;
            save.reset();
            check.mutate(file);
          }}
        >
          Vérifier l’export
        </Button>
        <Button
          disabled={!verified || imported}
          loading={save.isPending}
          onClick={() => file && save.mutate(file)}
        >
          Importer l’export
        </Button>
      </Group>
      {check.isError && check.variables === file && (
        <>
          {renderError(check.error, 'Vérification impossible.')}
          <MappingTable events={eventMappings(check.error)} />
        </>
      )}
      {verified && !imported && !save.isError && (
        <Alert color="blue" title="Export valide : rien n’a encore été importé">
          <Stack>
            <MappingTable events={check.data.events} />
            {renderReport(check.data, 'Aperçu de l’import TopTurnier')}
          </Stack>
        </Alert>
      )}
      {save.isError && (
        <>
          {renderError(save.error, 'Import impossible.')}
          <MappingTable events={eventMappings(save.error)} />
        </>
      )}
      {imported && (
        <Alert color="green" title="Résultats importés">
          <Stack>
            <MappingTable events={save.data.events} />
            {renderReport(save.data, 'Bilan de l’import TopTurnier')}
          </Stack>
        </Alert>
      )}
    </Stack>
  );
}
