import {
  Alert,
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
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
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

  // The search reaches the URL (and the API) once debounced and long enough.
  useEffect(() => {
    const next = debounced.length >= MIN_SEARCH_LENGTH ? debounced : '';
    if (next === readModerationParams(params).q) return;
    setParams(writeModerationParams(params, { q: next }), { replace: true });
  }, [debounced, params, setParams]);

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
              {(list.data?.data ?? []).map((c) => (
                <Table.Tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/moderation/${c.id}${locationSearch}`)}
                >
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {c.track.title}
                      </Text>
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
