import { Alert, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { competitionsControllerImportTopTurnierUrlResults } from '../api/generated/sdk.gen';
import { invalidateCompetitionResults, unwrap } from '../api/queries';
import type { ImportReportCounts } from '../lib/resultsImport';
import { eventMappings } from '../lib/topturnierImport';
import { MappingTable } from './TopTurnierImport';

interface Props {
  competitionId: string;
  renderReport: (report: ImportReportCounts, title: string) => ReactNode;
  renderError: (error: unknown, fallback: string) => ReactNode;
  /** Address to start from (list of recent competitions, #801). */
  initialUrl?: string;
  /** The address cannot be edited (it comes from the list, #801). */
  readOnlyUrl?: boolean;
  /** Runs the dry run of `initialUrl` once, on mount (the staff clicked « Vérifier »). */
  autoCheck?: boolean;
}

/**
 * TEMPORARY (#787): import from the public URL of a TopTurnier export, until
 * the FFD gives access to its results data (#651). Same check-then-import
 * flow as the uploaded export; the server fetches the pages on demand.
 */
export function TopTurnierUrlImport({
  competitionId,
  renderReport,
  renderError,
  initialUrl,
  readOnlyUrl = false,
  autoCheck = false,
}: Props) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(initialUrl ?? '');
  const send = (address: string, dryRun: boolean) =>
    unwrap(
      competitionsControllerImportTopTurnierUrlResults({
        path: { id: competitionId },
        query: { dryRun },
        body: { url: address },
      }),
    );
  const check = useMutation({ mutationFn: (address: string) => send(address, true) });
  const save = useMutation({
    mutationFn: (address: string) => send(address, false),
    onSuccess: () => {
      invalidateCompetitionResults(qc, competitionId);
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  // Once per mount, even when an effect is replayed (StrictMode).
  const autoChecked = useRef(false);
  const { mutate: runCheck } = check;
  useEffect(() => {
    if (!autoCheck || autoChecked.current || !initialUrl) return;
    autoChecked.current = true;
    runCheck(initialUrl.trim());
  }, [autoCheck, initialUrl, runCheck]);

  const address = url.trim();
  // « Importer » only sends the very address a dry run accepted.
  const verified = address !== '' && check.isSuccess && check.variables === address;
  const imported = address !== '' && save.isSuccess && save.variables === address;

  return (
    <Stack>
      <Alert color="yellow" title="Solution temporaire">
        En attendant un accès officiel aux données de la FFD, le serveur peut lire l’export publié
        en ligne par TopTurnier (sites autorisés seulement). Les pages sont lues une à une : la
        vérification peut prendre une minute. Si l’import par adresse est désactivé ou que le site
        ne répond pas, téléversez l’archive de l’export.
      </Alert>
      <TextInput
        label="Adresse de l’export TopTurnier"
        description="Adresse de la page de la compétition (…/index.htm)"
        placeholder="https://…/index.htm"
        value={url}
        readOnly={readOnlyUrl}
        onChange={(e) => {
          setUrl(e.currentTarget.value);
          check.reset();
          save.reset();
        }}
        maw={640}
      />
      <Group>
        <Button
          variant="light"
          disabled={address === ''}
          loading={check.isPending}
          onClick={() => {
            save.reset();
            check.mutate(address);
          }}
        >
          Vérifier l’adresse
        </Button>
        <Button
          disabled={!verified || imported}
          loading={save.isPending}
          onClick={() => save.mutate(address)}
        >
          Importer depuis l’adresse
        </Button>
      </Group>
      {check.isError && check.variables === address && (
        <>
          {renderError(check.error, 'Vérification impossible.')}
          <MappingTable events={eventMappings(check.error)} />
        </>
      )}
      {verified && !imported && !save.isError && (
        <Alert color="blue" title="Export valide : rien n’a encore été importé">
          <Stack>
            <MappingTable events={check.data.events} />
            {renderReport(check.data, 'Aperçu de l’import par adresse')}
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
            {renderReport(save.data, 'Bilan de l’import par adresse')}
          </Stack>
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        Réservé au staff et aux administrateurs ; chaque import est tracé dans le journal d’audit.
      </Text>
    </Stack>
  );
}
