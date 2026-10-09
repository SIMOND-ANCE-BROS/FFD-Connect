import {
  Alert,
  Anchor,
  Badge,
  Chip,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
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
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { TrackCorrectionReason, TrackCorrectionStatus } from '../api/generated/types.gen';
import { moderationListQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import {
  MIN_SEARCH_LENGTH,
  moderationFilter,
  type ModerationUrlState,
  proposalSummary,
  readModerationParams,
  REASON_LABELS,
  REASONS,
  STATUS_OPTIONS,
  writeModerationParams,
} from '../lib/moderation';

const PAGE_SIZE = 50;

export function ModerationPage() {
  const navigate = useNavigate();
  const { search: locationSearch } = useLocation();
  const [params, setParams] = useSearchParams();
  const state = readModerationParams(params);
  const [search, setSearch] = useState(state.q);
  const [debounced] = useDebouncedValue(search.trim(), 300);

  // The search reaches the URL (and the API) once debounced and long enough,
  // and only when the debounced input itself changed.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;
  const written = useRef(state.q);
  useEffect(() => {
    const next = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    if (next === readModerationParams(paramsRef.current).q) return;
    written.current = next;
    setParamsRef.current(writeModerationParams(paramsRef.current, { q: next }), {
      replace: true,
    });
  }, [debounced]);

  // Back/Forward (or any outside change of `q`) moves the input with it.
  useEffect(() => {
    if (state.q === written.current) return;
    written.current = state.q;
    setSearch(state.q);
  }, [state.q]);

  const update = (patch: Partial<ModerationUrlState>) =>
    setParams(writeModerationParams(params, patch));

  const list = useQuery({
    ...moderationListQuery(moderationFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;

  return (
    <Stack>
      <Title order={2}>Modération</Title>
      {state.trackId && (
        <Alert color="blue" title="Propositions d'une seule musique">
          <Group gap="md">
            <Anchor component={Link} to={`/tracks/${state.trackId}`} size="sm">
              Voir la musique
            </Anchor>
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => update({ trackId: undefined })}
            >
              Toutes les musiques
            </Anchor>
          </Group>
        </Alert>
      )}
      <SegmentedControl
        w="fit-content"
        data={STATUS_OPTIONS}
        value={state.status}
        onChange={(v) => update({ status: v as TrackCorrectionStatus })}
      />
      <Chip.Group
        multiple
        value={state.reasons}
        onChange={(v) => update({ reasons: v as TrackCorrectionReason[] })}
      >
        <Group gap="xs">
          {REASONS.map((reason) => (
            <Chip key={reason} value={reason} size="sm">
              {REASON_LABELS[reason]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <TextInput
        placeholder="Titre ou artiste"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les propositions.')}
        </Alert>
      ) : list.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} proposition{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Musique</Table.Th>
                <Table.Th>Motif</Table.Th>
                <Table.Th>Proposée par</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Changements proposés</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>Aucune proposition</Table.Td>
                </Table.Tr>
              )}
              {(list.data?.data ?? []).map((c) => (
                <Table.Tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/moderation/${c.id}${locationSearch}`)}
                >
                  <Table.Td>
                    <Group gap="xs">
                      <Anchor
                        component={Link}
                        to={`/moderation/${c.id}${locationSearch}`}
                        size="sm"
                        fw={500}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.track.title}
                      </Anchor>
                      {c.track.titleMasked && (
                        <Badge size="xs" color="gray" variant="light">
                          Titre masqué
                        </Badge>
                      )}
                      {c.track.blacklisted && (
                        <Badge size="xs" color="red" variant="light">
                          Retirée
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {c.track.artist}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{REASON_LABELS[c.reason]}</Badge>
                  </Table.Td>
                  <Table.Td>{c.proposer?.name ?? 'Compte supprimé'}</Table.Td>
                  <Table.Td>{dayjs(c.createdAt).format('DD/MM/YYYY HH:mm')}</Table.Td>
                  <Table.Td>{proposalSummary(c.proposed)}</Table.Td>
                </Table.Tr>
              ))}
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
