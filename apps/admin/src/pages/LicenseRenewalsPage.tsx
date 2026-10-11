import { PageHeader } from '../components/PageHeader';
import { EmptyState, ListSkeleton } from '../components/ListStates';
import { RecordCard, RecordLine, RecordList } from '../components/RecordCard';
import { useIsMobile } from '../lib/useIsMobile';
import {
  Alert,
  Anchor,
  Badge,
  Pagination,
  SegmentedControl,
  Stack,
  Table,
  Text,
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
  const isMobile = useIsMobile();
  const decided = state.status !== 'PENDING';

  return (
    <Stack>
      <PageHeader
        title="Renouvellements"
        description="Examiner les demandes de licence et retrouver les décisions prises."
      />
      <SegmentedControl
        w={{ base: '100%', sm: 'fit-content' }}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        data={TAB_OPTIONS}
        value={state.status}
        onChange={(v) => update({ status: v as RenewalTab })}
      />
      {list.isError ? (
        <Alert color="red">
          {apiErrorMessage(list.error, 'Impossible de charger les demandes.')}
        </Alert>
      ) : list.isPending ? (
        <ListSkeleton />
      ) : (
        <>
          <Text size="sm" c="dimmed">
            {total} demande{total > 1 ? 's' : ''}
          </Text>
          {total === 0 ? (
            <EmptyState title="Aucune demande">
              Aucun renouvellement dans cette catégorie.
            </EmptyState>
          ) : isMobile ? (
            <RecordList>
              {(list.data?.data ?? []).map((r) => (
                <RecordCard
                  key={r.id}
                  to={`/license-renewals/${r.id}${search}`}
                  title={`${r.user.firstName} ${r.user.lastName}`}
                  badges={
                    <Badge variant="light">{decided ? 'Voir la décision' : 'À traiter'}</Badge>
                  }
                >
                  <RecordLine label="N° de licence">{r.user.license?.number ?? '—'}</RecordLine>
                  <RecordLine label="Fin de validité">
                    {r.user.license ? formatLicenseValidUntil(r.user.license.validUntil) : '—'}
                  </RecordLine>
                  <RecordLine label="Documents">
                    {r.documents.length
                      ? r.documents.map((d) => DOCUMENT_LABELS[d.type]).join(', ')
                      : 'Aucun'}
                  </RecordLine>
                  <RecordLine label="Soumise le">{dateTime(r.submittedAt)}</RecordLine>
                  {decided && (
                    <>
                      <RecordLine label="Traitée le">{dateTime(r.reviewedAt)}</RecordLine>
                      <RecordLine label="Par">
                        {r.reviewedBy
                          ? `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}`
                          : 'Validation automatique'}
                      </RecordLine>
                    </>
                  )}
                </RecordCard>
              ))}
            </RecordList>
          ) : (
            <Table.ScrollContainer minWidth={820}>
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
                        <Anchor
                          component={Link}
                          to={`/license-renewals/${r.id}${search}`}
                          size="sm"
                        >
                          {decided ? 'Voir' : 'Traiter'}
                        </Anchor>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
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
