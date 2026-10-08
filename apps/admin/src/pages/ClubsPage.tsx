import {
  Alert,
  Anchor,
  Badge,
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
import { useState } from 'react';
import { Link } from 'react-router';
import { apiErrorMessage } from '../lib/apiError';
import { clubsQuery, type ClubsFilter } from '../api/queries';
import { REGISTRATION_MODE_LABELS, STATUS_FILTER_OPTIONS, type StatusChoice } from '../lib/labels';

const PAGE_SIZE = 50;

export function ClubsPage() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<StatusChoice>('all');
  const [pageIndex, setPageIndex] = useState(1);

  const filters: ClubsFilter = {
    ...(debounced && { search: debounced }),
    ...(status !== 'all' && { status }),
  };
  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPageIndex(1);
  }

  const clubs = useQuery({
    ...clubsQuery({ ...filters, skip: (pageIndex - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const total = clubs.data?.meta.total ?? 0;

  return (
    <Stack>
      <Title order={2}>Clubs</Title>
      <Group>
        <TextInput
          placeholder="Nom du club"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <SegmentedControl
          data={STATUS_FILTER_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as StatusChoice)}
        />
      </Group>
      {clubs.isError ? (
        <Alert color="red">
          {apiErrorMessage(clubs.error, 'Impossible de charger les clubs.')}
        </Alert>
      ) : clubs.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} club{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Club</Table.Th>
                <Table.Th>Membres</Table.Th>
                <Table.Th>Comptes Club</Table.Th>
                <Table.Th>Paiement</Table.Th>
                <Table.Th>Inscriptions</Table.Th>
                <Table.Th>Création</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(clubs.data?.data ?? []).map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/clubs/${c.id}`}>
                      {c.name}
                    </Anchor>
                    {c.disabledAt && (
                      <Badge color="red" variant="light" ml="xs">
                        Désactivé
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{c.memberCount}</Table.Td>
                  <Table.Td>{c.clubAccountCount}</Table.Td>
                  <Table.Td>
                    {c.helloAssoConfigured ? (
                      <Badge color="green" variant="light">
                        HelloAsso
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>{REGISTRATION_MODE_LABELS[c.registrationMode]}</Table.Td>
                  <Table.Td>{dayjs(c.createdAt).format('DD/MM/YYYY')}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {total > PAGE_SIZE && (
            <Pagination
              total={Math.ceil(total / PAGE_SIZE)}
              value={pageIndex}
              onChange={setPageIndex}
            />
          )}
        </>
      )}
    </Stack>
  );
}
