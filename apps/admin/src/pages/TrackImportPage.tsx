import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  List,
  Loader,
  NumberInput,
  Paper,
  Progress,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { adminTracksControllerCheck, adminTracksControllerCreate } from '../api/generated/sdk.gen';
import { unwrap } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { droppedFiles, sha256Hex } from '../lib/files';
import { readId3 } from '../lib/id3';
import {
  buildRow,
  type CheckItem,
  findExisting,
  type ImportRow,
  importSummary,
  isSendable,
  ISSUE_LABELS,
  markBatchDuplicates,
  MAX_PARALLEL_UPLOADS,
  rowIssue,
  runPool,
  sortFiles,
  summaryText,
  uploadBody,
  type UploadOutcome,
  uploadOutcome,
  withStyle,
  withUniqueKeys,
} from '../lib/trackImport';
import { STYLE_OPTIONS, type StyleOption } from '../lib/tracks';

type CheckState = 'idle' | 'running' | 'ok' | 'error';

const checkItems = (items: CheckItem[]) =>
  unwrap(adminTracksControllerCheck({ body: { items } })).then((result) => result.items);

function outcomePatch(outcome: UploadOutcome): Partial<ImportRow> {
  if (outcome.state === 'done')
    return { state: 'done', trackId: outcome.trackId, error: undefined };
  if (outcome.state === 'duplicate') {
    return { state: 'idle', existing: { trackId: outcome.trackId }, error: undefined };
  }
  return { state: 'failed', error: outcome.error };
}

function RowStatus({ row }: { row: ImportRow }) {
  if (row.skip) {
    return (
      <Text size="sm" c="dimmed">
        Ignorée
      </Text>
    );
  }
  if (row.state === 'done') {
    return (
      <Group gap={4}>
        <Text size="sm">✅ Importée</Text>
        {row.trackId && (
          <Anchor component={Link} to={`/tracks/${row.trackId}`} size="sm">
            Voir
          </Anchor>
        )}
      </Group>
    );
  }
  if (row.state === 'sending') {
    return (
      <Group gap={4}>
        <Loader size="xs" />
        <Text size="sm">Envoi…</Text>
      </Group>
    );
  }
  if (row.state === 'failed') {
    return (
      <Text size="sm" c="red">
        ⛔ Échec : {row.error}
      </Text>
    );
  }
  const issue = rowIssue(row);
  if (!issue) return <Text size="sm">✅ Prête</Text>;
  const { icon, label } = ISSUE_LABELS[issue];
  return (
    <Group gap={4}>
      <Text size="sm">
        {icon} {label}
      </Text>
      {row.existing?.trackId && (
        <Anchor component={Link} to={`/tracks/${row.existing.trackId}`} size="sm">
          Voir
        </Anchor>
      )}
    </Group>
  );
}

export function TrackImportPage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>('idle');
  const [checkError, setCheckError] = useState<unknown>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState(false);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [manifestInvalid, setManifestInvalid] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    // Not a React prop: set as an attribute so the picker selects a whole folder.
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  const running = progress !== null;
  const busy = running || reading !== null || check === 'running';

  const patchRow = (key: string, patch: Partial<ImportRow>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const runCheck = async (list: readonly ImportRow[]) => {
    setCheck('running');
    try {
      const found = await findExisting(list, checkItems);
      setRows((current) =>
        current.map((r) =>
          found.has(r.key) ? { ...r, existing: { trackId: found.get(r.key) } } : r,
        ),
      );
      setCheck('ok');
    } catch (error) {
      setCheckError(error);
      setCheck('error');
    }
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setRows([]);
    setFinished(false);
    setReadError(null);
    setCheck('idle');
    try {
      const picked = await sortFiles(files);
      setIgnored(picked.ignored);
      setManifestInvalid(picked.manifestInvalid);
      setReading({ done: 0, total: picked.audio.length });
      const built: ImportRow[] = [];
      // One file at a time: hashing reads the whole MP3 in memory.
      for (const file of picked.audio) {
        built.push(await buildRow(file, picked, { readTags: readId3, hash: sha256Hex }));
        setReading({ done: built.length, total: picked.audio.length });
      }
      const list = markBatchDuplicates(withUniqueKeys(built));
      setRows(list);
      setReading(null);
      if (list.length > 0) await runCheck(list);
    } catch {
      setReading(null);
      setReadError('Lecture des fichiers impossible.');
    }
  };

  const send = async (targets: ImportRow[]) => {
    if (targets.length === 0) return;
    setFinished(false);
    setProgress({ done: 0, total: targets.length });
    await runPool(targets, MAX_PARALLEL_UPLOADS, async (row) => {
      patchRow(row.key, { state: 'sending', error: undefined });
      let outcome: UploadOutcome;
      try {
        outcome = uploadOutcome(await adminTracksControllerCreate({ body: uploadBody(row) }));
      } catch (error) {
        outcome = uploadOutcome({ error });
      }
      patchRow(row.key, outcomePatch(outcome));
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    });
    setProgress(null);
    setFinished(true);
    void qc.invalidateQueries({ queryKey: ['admin', 'tracks', 'list'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };

  const pick = (input: HTMLInputElement) => {
    const list = Array.from(input.files ?? []);
    input.value = '';
    void addFiles(list);
  };

  const summary = importSummary(rows);
  const ready = rows.filter(isSendable).length;
  const failures = rows.filter((r) => r.state === 'failed' && !r.skip);

  return (
    <Stack>
      <Anchor component={Link} to="/tracks">
        Retour au catalogue
      </Anchor>
      <Title order={2}>Importer des musiques</Title>
      <Paper
        withBorder
        p="xl"
        radius="md"
        data-testid="drop-zone"
        style={{ borderStyle: 'dashed' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void droppedFiles(e.dataTransfer).then(addFiles);
        }}
      >
        <Stack align="center" gap="xs">
          <Text ta="center">
            Déposez ici le dossier de sortie de track-prep, ou des fichiers MP3 avec leurs pochettes
            (JPEG, PNG) et leur manifest.json.
          </Text>
          <Group>
            <Button variant="light" disabled={busy} onClick={() => folderRef.current?.click()}>
              Choisir un dossier
            </Button>
            <Button variant="light" disabled={busy} onClick={() => filesRef.current?.click()}>
              Choisir des fichiers
            </Button>
          </Group>
        </Stack>
        <input
          ref={filesRef}
          data-testid="files-input"
          type="file"
          multiple
          accept=".mp3,.jpg,.jpeg,.png,.json"
          hidden
          onChange={(e) => pick(e.currentTarget)}
        />
        <input
          ref={folderRef}
          data-testid="folder-input"
          type="file"
          multiple
          hidden
          onChange={(e) => pick(e.currentTarget)}
        />
      </Paper>

      {reading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="sm">
            Lecture des fichiers… {reading.done} / {reading.total}
          </Text>
        </Group>
      )}
      {readError && <Alert color="red">{readError}</Alert>}
      {manifestInvalid && (
        <Alert color="orange">
          manifest.json illisible : le tableau est pré-rempli depuis les tags et les noms de
          fichiers.
        </Alert>
      )}
      {ignored.length > 0 && (
        <Text size="sm" c="dimmed">
          Fichiers ignorés : {ignored.join(', ')}
        </Text>
      )}
      {check === 'error' && (
        <Alert color="red" title="Vérification des doublons impossible">
          <Stack gap="xs">
            <Text size="sm">{apiErrorMessage(checkError, 'Réessayez dans un instant.')}</Text>
            <Group>
              <Button size="xs" variant="light" onClick={() => void runCheck(rowsRef.current)}>
                Vérifier à nouveau
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}

      {rows.length > 0 && (
        <>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Fichier</Table.Th>
                <Table.Th>Titre</Table.Th>
                <Table.Th>Artiste</Table.Th>
                <Table.Th>Danse</Table.Th>
                <Table.Th>MPM</Table.Th>
                <Table.Th>Pochette</Table.Th>
                <Table.Th>Ignorer</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const locked = running || row.state === 'done';
                return (
                  <Table.Tr key={row.key}>
                    <Table.Td>
                      <RowStatus row={row} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{row.key}</Text>
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Titre — ${row.key}`}
                        value={row.title}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { title: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`Artiste — ${row.key}`}
                        value={row.artist}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { artist: e.currentTarget.value })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={`Danse — ${row.key}`}
                        data={STYLE_OPTIONS}
                        value={row.style || null}
                        clearable
                        disabled={locked}
                        onChange={(v) =>
                          setRows((current) =>
                            current.map((r) =>
                              r.key === row.key ? withStyle(r, (v ?? '') as StyleOption | '') : r,
                            ),
                          )
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`MPM — ${row.key}`}
                        placeholder="auto"
                        min={1}
                        max={400}
                        allowDecimal={false}
                        w={90}
                        value={row.mpm}
                        disabled={locked}
                        onChange={(v) =>
                          patchRow(row.key, {
                            mpm: typeof v === 'number' ? v : '',
                            mpmTouched: true,
                          })
                        }
                      />
                    </Table.Td>
                    <Table.Td>{row.artwork ? 'Oui' : '—'}</Table.Td>
                    <Table.Td>
                      <Checkbox
                        aria-label={`Ignorer ${row.key}`}
                        checked={row.skip}
                        disabled={locked}
                        onChange={(e) => patchRow(row.key, { skip: e.currentTarget.checked })}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          <Group>
            <Button
              disabled={busy || check !== 'ok' || ready === 0}
              loading={running}
              onClick={() => void send(rowsRef.current.filter(isSendable))}
            >
              Importer
            </Button>
            <Text size="sm" c="dimmed">
              {ready} musique{ready > 1 ? 's' : ''} prête{ready > 1 ? 's' : ''} à importer
            </Text>
          </Group>
          {progress && (
            <Stack gap={4}>
              <Progress
                value={(progress.done / progress.total) * 100}
                aria-label="Progression de l'import"
              />
              <Text size="sm">
                Envoi : {progress.done} / {progress.total}
              </Text>
            </Stack>
          )}
          {finished && (
            <Alert color={summary.failed > 0 ? 'orange' : 'green'} title={summaryText(summary)}>
              <Stack gap="xs">
                {failures.length > 0 && (
                  <>
                    <List size="sm">
                      {failures.map((r) => (
                        <List.Item key={r.key}>
                          {r.key} : {r.error}
                        </List.Item>
                      ))}
                    </List>
                    <Group>
                      <Button
                        size="xs"
                        onClick={() =>
                          void send(
                            rowsRef.current.filter((r) => r.state === 'failed' && isSendable(r)),
                          )
                        }
                      >
                        Réessayer les échecs
                      </Button>
                    </Group>
                  </>
                )}
                <Anchor component={Link} to="/tracks" size="sm">
                  Voir le catalogue
                </Anchor>
              </Stack>
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
