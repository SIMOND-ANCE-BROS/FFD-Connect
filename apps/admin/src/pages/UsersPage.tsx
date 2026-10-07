import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UserRole } from '../api/generated/types.gen';
import { clubOptionsQuery, referenceQuery, usersQuery, type UsersFilter } from '../api/queries';

const PAGE_SIZE = 50;

const LICENSE_LABEL: Record<'ACTIVE' | 'EXPIRED', string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expirée',
};

export function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [role, setRole] = useState<UserRole | null>(null);
  const [clubId, setClubId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [pageIndex, setPageIndex] = useState(1);

  const filters: UsersFilter = {
    ...(debounced && { search: debounced }),
    ...(role && { role }),
    ...(clubId && { clubId }),
    ...(category && { category }),
    ...(range[0] && { createdFrom: dayjs(range[0]).format('YYYY-MM-DD') }),
    ...(range[1] && { createdTo: dayjs(range[1]).format('YYYY-MM-DD') }),
  };
  // Any filter change goes back to the first page.
  const filterKey = JSON.stringify(filters);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPageIndex(1);
  }

  const users = useQuery({
    ...usersQuery({
      ...filters,
      skip: (pageIndex - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const clubs = useQuery(clubOptionsQuery(clubId));
  const reference = useQuery(referenceQuery);
  const total = users.data?.meta.total ?? 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Inscrits</Title>
        <Button component={Link} to="/club-accounts/new">
          Nouveau compte Club
        </Button>
      </Group>
      <Group grow>
        <TextInput
          placeholder="Nom, prénom ou email"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Select
          placeholder="Rôle"
          clearable
          data={reference.data?.roles ?? []}
          value={role}
          onChange={(v) => setRole(v as UserRole | null)}
        />
        <Select
          placeholder="Club"
          clearable
          searchable
          data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={clubId}
          onChange={setClubId}
        />
        <Select
          placeholder="Catégorie"
          clearable
          data={reference.data?.categories ?? []}
          value={category}
          onChange={setCategory}
        />
        <DatePickerInput
          type="range"
          placeholder="Inscription entre…"
          clearable
          value={range}
          onChange={setRange}
        />
      </Group>
      {users.isError && <Alert color="red">Impossible de charger les inscrits.</Alert>}
      {users.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} inscrit{total > 1 ? 's' : ''}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nom</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Rôle</Table.Th>
                <Table.Th>Club</Table.Th>
                <Table.Th>Catégorie</Table.Th>
                <Table.Th>Classe d'âge</Table.Th>
                <Table.Th>Licence</Table.Th>
                <Table.Th>Inscription</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(users.data?.data ?? []).map((u) => (
                <Table.Tr
                  key={u.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/users/${u.id}`)}
                >
                  <Table.Td>
                    {u.lastName} {u.firstName}
                  </Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>
                    <Badge variant="light">{u.role}</Badge>
                  </Table.Td>
                  <Table.Td>{u.clubName ?? '—'}</Table.Td>
                  <Table.Td>{u.category ?? '—'}</Table.Td>
                  <Table.Td>{u.ageGroup ?? '—'}</Table.Td>
                  <Table.Td>{u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'}</Table.Td>
                  <Table.Td>{dayjs(u.createdAt).format('DD/MM/YYYY')}</Table.Td>
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
