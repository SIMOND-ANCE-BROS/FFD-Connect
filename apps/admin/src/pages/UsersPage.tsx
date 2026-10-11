import {
  Alert,
  Badge,
  Button,
  Group,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UserRole } from '../api/generated/types.gen';
import { FilterPanel } from '../components/FilterPanel';
import { EmptyState, ListSkeleton } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine, RecordList } from '../components/RecordCard';
import { StoreReviewBadge } from '../components/StoreReview';
import { apiErrorMessage } from '../lib/apiError';
import { disciplineOptions, formatDiscipline } from '../lib/discipline';
import { useIsMobile } from '../lib/useIsMobile';
import {
  extraRoleLabels,
  ROLE_LABELS,
  STATUS_FILTER_OPTIONS,
  type StatusChoice,
} from '../lib/labels';
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
  const [status, setStatus] = useState<StatusChoice>('all');
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [pageIndex, setPageIndex] = useState(1);

  const filters: UsersFilter = {
    ...(debounced && { search: debounced }),
    ...(role && { role }),
    ...(clubId && { clubId }),
    ...(category && { category }),
    ...(status !== 'all' && { status }),
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
  const rows = users.data?.data ?? [];
  const isMobile = useIsMobile();
  // Search stays out of the count: it is always visible above the panel.
  const activeFilters = [
    role,
    clubId,
    category,
    status !== 'all' || null,
    range[0] ?? range[1],
  ].filter(Boolean).length;
  const resetFilters = () => {
    setRole(null);
    setClubId(null);
    setCategory(null);
    setStatus('all');
    setRange([null, null]);
  };

  const searchInput = (
    <TextInput
      placeholder="Nom, prénom ou email"
      value={search}
      onChange={(e) => setSearch(e.currentTarget.value)}
    />
  );
  const secondaryFilters = (
    <>
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
        data={disciplineOptions(reference.data?.categories ?? [])}
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
    </>
  );
  const statusControl = (
    <SegmentedControl
      w={{ base: '100%', xs: 'fit-content' }}
      data={STATUS_FILTER_OPTIONS}
      value={status}
      onChange={(v) => setStatus(v as StatusChoice)}
    />
  );

  return (
    <Stack>
      <PageHeader
        title="Utilisateurs"
        actions={
          <Button component={Link} to="/users/new">
            Nouvel utilisateur
          </Button>
        }
      />
      {isMobile ? (
        <>
          {searchInput}
          <FilterPanel activeCount={activeFilters} onReset={resetFilters}>
            {secondaryFilters}
            {statusControl}
          </FilterPanel>
        </>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, xs: 2, lg: 5 }} spacing="sm">
            {searchInput}
            {secondaryFilters}
          </SimpleGrid>
          {statusControl}
        </>
      )}
      {users.isError ? (
        <Alert color="red">
          {apiErrorMessage(users.error, 'Impossible de charger les utilisateurs.')}
        </Alert>
      ) : users.isPending ? (
        <ListSkeleton />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} utilisateur{total > 1 ? 's' : ''}
          </Text>
          {rows.length === 0 ? (
            <EmptyState title="Aucun utilisateur">
              Aucun compte ne correspond à ces filtres.
            </EmptyState>
          ) : isMobile ? (
            <RecordList>
              {rows.map((u) => (
                <RecordCard
                  key={u.id}
                  to={`/users/${u.id}`}
                  title={`${u.lastName} ${u.firstName}`}
                  badges={
                    <>
                      <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>
                      {u.disabledAt && (
                        <Badge color="red" variant="light">
                          Désactivé
                        </Badge>
                      )}
                      {u.isStoreReview && <StoreReviewBadge />}
                    </>
                  }
                >
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    {u.email}
                  </Text>
                  {u.extraRoles.length > 0 && (
                    <Group gap={4}>
                      {extraRoleLabels(u.extraRoles).map((l) => (
                        <Badge key={l} variant="outline" size="sm">
                          {l}
                        </Badge>
                      ))}
                    </Group>
                  )}
                  {u.clubName && <RecordLine label="Club">{u.clubName}</RecordLine>}
                  {u.category && (
                    <RecordLine label="Catégorie">
                      {formatDiscipline(u.category)}
                      {u.ageGroup && ` · ${u.ageGroup}`}
                    </RecordLine>
                  )}
                  <RecordLine label="Licence">
                    {u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'} · inscrit le{' '}
                    {dayjs(u.createdAt).format('DD/MM/YYYY')}
                  </RecordLine>
                </RecordCard>
              ))}
            </RecordList>
          ) : (
            <Table.ScrollContainer minWidth={960}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nom</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Rôle principal</Table.Th>
                    <Table.Th>Rôles supplémentaires</Table.Th>
                    <Table.Th>Club</Table.Th>
                    <Table.Th>Catégorie</Table.Th>
                    <Table.Th>Classe d'âge</Table.Th>
                    <Table.Th>Licence</Table.Th>
                    <Table.Th>Inscription</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((u) => (
                    <Table.Tr
                      key={u.id}
                      className="app-row-link"
                      onClick={() => navigate(`/users/${u.id}`)}
                    >
                      <Table.Td>
                        {u.lastName} {u.firstName}
                        {u.disabledAt && (
                          <Badge color="red" variant="light" ml="xs">
                            Désactivé
                          </Badge>
                        )}
                        {u.isStoreReview && <StoreReviewBadge />}
                      </Table.Td>
                      <Table.Td>{u.email}</Table.Td>
                      <Table.Td>
                        <Badge variant="light">{ROLE_LABELS[u.role]}</Badge>
                      </Table.Td>
                      <Table.Td>
                        {u.extraRoles.length ? (
                          <Group gap={4}>
                            {extraRoleLabels(u.extraRoles).map((l) => (
                              <Badge key={l} variant="outline" size="sm">
                                {l}
                              </Badge>
                            ))}
                          </Group>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>{u.clubName ?? '—'}</Table.Td>
                      <Table.Td>{u.category ? formatDiscipline(u.category) : '—'}</Table.Td>
                      <Table.Td>{u.ageGroup ?? '—'}</Table.Td>
                      <Table.Td>{u.licenseStatus ? LICENSE_LABEL[u.licenseStatus] : '—'}</Table.Td>
                      <Table.Td>{dayjs(u.createdAt).format('DD/MM/YYYY')}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
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
