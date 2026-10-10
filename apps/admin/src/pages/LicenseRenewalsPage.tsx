import {
  Alert,
  Anchor,
  Loader,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useLocation, useSearchParams } from 'react-router';
import { licenseRenewalsQuery } from '../api/queries';
import { apiErrorMessage } from '../lib/apiError';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import {
  DOCUMENT_LABELS,
  listFilter,
  readRenewalParams,
  type RenewalsUrlState,
  type RenewalTab,
  TAB_OPTIONS,
  writeRenewalParams,
} from '../lib/licenseRenewals';

const PAGE_SIZE = 50;

const dateTime = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY HH:mm') : '—');

/** Queue of licence renewals (#267): nothing here reads a document. */
export function LicenseRenewalsPage() {
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const state = readRenewalParams(params);
  const update = (patch: Partial<RenewalsUrlState>) => setParams(writeRenewalParams(params, patch));
  const list = useQuery({
    ...licenseRenewalsQuery(listFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;
  const decided = state.status !== 'PENDING';

  return (
    <Stack>
      <Title order={2}>Renouvellements</Title>
      <SegmentedControl
        w="fit-content"
        data={TAB_OPTIONS}
        value={state.status}
        onChange={(v) => update({ status: v as RenewalTab })}
      />
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
          </Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Licencié</Table.Th>
                <Table.Th>N° de licence</Table.Th>
                <Table.Th>Fin de validité</Table.Th>
                <Table.Th>Documents</Table.Th>
                <Table.Th>Soumise le</Table.Th>
                {decided && <Table.Th>Traitée le</Table.Th>}
                {decided && <Table.Th>Par</Table.Th>}
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {total === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={decided ? 8 : 6}>Aucune demande</Table.Td>
                </Table.Tr>
              )}
              {(list.data?.data ?? []).map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`/users/${r.user.id}`} size="sm">
                      {r.user.firstName} {r.user.lastName}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{r.user.license?.number ?? '—'}</Table.Td>
                  <Table.Td>
                    {r.user.license ? formatLicenseValidUntil(r.user.license.validUntil) : '—'}
                  </Table.Td>
                  <Table.Td>
                    {r.documents.length > 0
                      ? r.documents.map((d) => DOCUMENT_LABELS[d.type]).join(', ')
                      : 'Aucun'}
                  </Table.Td>
                  <Table.Td>{dateTime(r.submittedAt)}</Table.Td>
                  {decided && <Table.Td>{dateTime(r.reviewedAt)}</Table.Td>}
                  {decided && (
                    <Table.Td>
                      {r.reviewedBy
                        ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}`
                        : 'Validation automatique'}
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Anchor component={Link} to={`/license-renewals/${r.id}${search}`} size="sm">
                      {decided ? 'Voir' : 'Traiter'}
                    </Anchor>
                  </Table.Td>
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
