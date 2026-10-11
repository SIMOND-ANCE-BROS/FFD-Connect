import { Alert, Anchor, Loader, Pagination, Stack, Table, Tabs, Text, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { renewalsListQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import {
  DOCUMENT_TYPE_LABELS,
  fullName,
  readRenewalsParams,
  reviewerLabel,
  RENEWAL_TABS,
  type RenewalTab,
  writeRenewalsParams,
} from '../lib/renewals';

const PAGE_SIZE = 50;

const formatDate = (value: string | null): string =>
  value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '—';

export function RenewalsPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const state = readRenewalsParams(params);
  const pending = state.status === 'PENDING';

  const list = useQuery({
    ...renewalsListQuery({
      status: state.status,
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;
  const columns = pending ? 4 : 6;

  return (
    <Stack>
      <Title order={2}>Renouvellements de licence</Title>
      <Tabs
        value={state.status}
        onChange={(v) => v && setParams(writeRenewalsParams(params, { status: v as RenewalTab }))}
      >
        <Tabs.List>
          {RENEWAL_TABS.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les demandes.')}
        </Alert>
      ) : list.isPending ? (
        <Loader />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} demande{total > 1 ? 's' : ''}
            {pending && ', les plus anciennes en premier'}
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Licencié</Table.Th>
                <Table.Th>Licence actuelle</Table.Th>
                <Table.Th>Soumise le</Table.Th>
                <Table.Th>Documents</Table.Th>
                {!pending && <Table.Th>Traitée le</Table.Th>}
                {!pending && <Table.Th>Par</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={columns}>Aucune demande</Table.Td>
                </Table.Tr>
              )}
              {(list.data?.data ?? []).map((r) => (
                <Table.Tr
                  key={r.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/license-renewals/${r.id}${search}`)}
                >
                  <Table.Td>
                    <Anchor
                      component={Link}
                      to={`/license-renewals/${r.id}${search}`}
                      size="sm"
                      fw={500}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {fullName(r.user)}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    {r.user.license
                      ? `${r.user.license.number} (jusqu'au ${dayjs(r.user.license.validUntil).format('DD/MM/YYYY')})`
                      : 'Aucune'}
                  </Table.Td>
                  <Table.Td>{formatDate(r.submittedAt)}</Table.Td>
                  <Table.Td>
                    {r.documents.map((d) => DOCUMENT_TYPE_LABELS[d.type]).join(', ') || '—'}
                  </Table.Td>
                  {!pending && <Table.Td>{formatDate(r.reviewedAt)}</Table.Td>}
                  {!pending && <Table.Td>{reviewerLabel(r)}</Table.Td>}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {total > PAGE_SIZE && (
            <Pagination
              total={Math.ceil(total / PAGE_SIZE)}
              value={state.page}
              onChange={(page) => setParams(writeRenewalsParams(params, { page }))}
            />
          )}
        </>
      )}
    </Stack>
  );
}
