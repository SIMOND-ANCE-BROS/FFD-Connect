import {
  Alert,
  Anchor,
  Badge,
  Button,
  Chip,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { TrackStatus } from '../api/generated/types.gen';
import { tracksQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { MIN_SEARCH_LENGTH } from '../lib/moderation';
import {
  DANCE_LABELS,
  MAX_SEARCH_LENGTH,
  readTracksParams,
  TRACK_STATUS_BADGES,
  TRACK_STATUS_FILTERS,
  tracksFilter,
  type TracksUrlState,
  writeTracksParams,
} from '../lib/tracks';

const PAGE_SIZE = 50;

type Flag = 'blacklisted' | 'titleMasked' | 'ambiance';

const FLAGS: { key: Flag; label: string }[] = [
  { key: 'blacklisted', label: 'Blacklistées' },
  { key: 'titleMasked', label: 'Titre masqué' },
  { key: 'ambiance', label: 'Ambiance' },
];

export function TracksPage() {
  const [params, setParams] = useSearchParams();
  const state = readTracksParams(params);
  const [search, setSearch] = useState(state.q);
  const [debounced] = useDebouncedValue(search.trim(), 300);

  // Same debounce as the moderation queue: the search reaches the URL (and the
  // API) once debounced and long enough, and only when the input changed.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const written = useRef(state.q);
  useEffect(() => {
    const next = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    if (next === readTracksParams(paramsRef.current).q) return;
    written.current = next;
    setParamsRef.current(writeTracksParams(paramsRef.current, { q: next }), { replace: true });
  }, [debounced]);

  // Back/Forward (or any outside change of `q`) moves the input with it.
  useEffect(() => {
    if (state.q === written.current) return;
    written.current = state.q;
    setSearch(state.q);
  }, [state.q]);

  const update = (patch: Partial<TracksUrlState>) => setParams(writeTracksParams(params, patch));

  const list = useQuery({
    ...tracksQuery(tracksFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Musiques</Title>
        <Button component={Link} to="/tracks/import">
          Importer des musiques
        </Button>
      </Group>
      <SegmentedControl
        w="fit-content"
        data={TRACK_STATUS_FILTERS}
        value={state.status ?? 'ALL'}
        onChange={(v) => update({ status: v === 'ALL' ? null : (v as TrackStatus) })}
      />
      <Group>
        <Chip.Group
          multiple
          value={FLAGS.filter((f) => state[f.key]).map((f) => f.key)}
          onChange={(v) =>
            update({
              blacklisted: v.includes('blacklisted'),
              titleMasked: v.includes('titleMasked'),
              ambiance: v.includes('ambiance'),
            })
          }
        >
          <Group gap="xs">
            {FLAGS.map((f) => (
              <Chip key={f.key} value={f.key} size="sm">
                {f.label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Select
          aria-label="Danse"
          placeholder="Danse"
          clearable
          w={200}
          data={DANCE_LABELS}
          value={state.style || null}
          onChange={(v) => update({ style: v ?? '' })}
        />
      </Group>
      <TextInput
        aria-label="Rechercher"
        maxLength={MAX_SEARCH_LENGTH}
        placeholder="Titre ou artiste"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les musiques.')}
        </Alert>
      ) : list.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} musique{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Titre</Table.Th>
                <Table.Th>Artiste</Table.Th>
                <Table.Th>Danse</Table.Th>
                <Table.Th>MPM</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th>Ajoutée le</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>Aucune musique</Table.Td>
                </Table.Tr>
              )}
              {(list.data?.data ?? []).map((t) => {
                const badge = TRACK_STATUS_BADGES[t.status];
                return (
                  <Table.Tr key={t.id}>
                    <Table.Td>
                      <Group gap="xs">
                        <Anchor component={Link} to={`/tracks/${t.id}`} size="sm" fw={500}>
                          {t.title}
                        </Anchor>
                        {t.titleMasked && (
                          <Badge size="xs" color="gray" variant="light">
                            Titre masqué
                          </Badge>
                        )}
                        {t.blacklisted && (
                          <Badge size="xs" color="red" variant="light">
                            Blacklistée
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{t.artist}</Table.Td>
                    <Table.Td>{t.style ?? '—'}</Table.Td>
                    <Table.Td>{t.bpm}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={badge.color}>
                        {badge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{dayjs(t.createdAt).format('DD/MM/YYYY')}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
          {total > PAGE_SIZE && (
            <Pagination
              total={Math.ceil(total / PAGE_SIZE)}
              value={state.page}
              onChange={(pageIndex) => update({ page: pageIndex })}
            />
          )}
        </>
      )}
    </Stack>
  );
}
