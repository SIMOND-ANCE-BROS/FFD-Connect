import { Anchor, Badge, Pagination, SegmentedControl, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useLocation } from 'react-router';
import type { AdminLicenseRenewalListItemDto } from '../api/generated/types.gen';
import { licenseRenewalsQuery } from '../api/queries';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { EmptyState } from '../components/ListStates';
import { PageHeader } from '../components/PageHeader';
import { RecordCard, RecordLine } from '../components/RecordCard';
import { apiErrorMessage } from '../lib/apiError';
import { formatLicenseValidUntil } from '../lib/licenseDate';
import {
  DOCUMENT_LABELS,
  listFilter,
  readRenewalParams,
  RENEWALS_SORT_FIELDS,
  type RenewalsSortField,
  reviewerLabel,
  type RenewalTab,
  TAB_OPTIONS,
  writeRenewalParams,
} from '../lib/licenseRenewals';
import type { SortState } from '../lib/listSort';
import { useListParams } from '../lib/useListParams';
import { useIsMobile } from '../lib/useIsMobile';

const PAGE_SIZE = 50;

type Renewal = AdminLicenseRenewalListItemDto;

const dateTime = (iso: string | null) => (iso ? dayjs(iso).format('DD/MM/YYYY HH:mm') : '—');
const isRenewalsSortField = (value: string): value is RenewalsSortField =>
  RENEWALS_SORT_FIELDS.some((f) => f === value);

const validUntil = (r: Renewal) =>
  r.user.license ? formatLicenseValidUntil(r.user.license.validUntil) : '—';
const documents = (r: Renewal) =>
  r.documents.length > 0 ? r.documents.map((d) => DOCUMENT_LABELS[d.type]).join(', ') : 'Aucun';

/** Queue of licence renewals (#267): nothing here reads a document. */
export function LicenseRenewalsPage() {
  const { search } = useLocation();
  const [state, update] = useListParams(readRenewalParams, writeRenewalParams);
  const list = useQuery({
    ...licenseRenewalsQuery(listFilter(state, PAGE_SIZE)),
    placeholderData: keepPreviousData,
  });
  const total = list.data?.meta.total ?? 0;
  const isMobile = useIsMobile();
  const decided = state.status !== 'PENDING';
  const detailPath = (r: Renewal) => `/license-renewals/${r.id}${search}`;

  const onSortChange = (sort: SortState | null) =>
    update({
      sort: sort && isRenewalsSortField(sort.by) ? { by: sort.by, order: sort.order } : null,
    });

  const columns: DataTableColumn<Renewal>[] = [
    {
      key: 'name',
      minWidth: 170,
      weight: 1.5,
      label: 'Licencié',
      required: true,
      sortField: 'name',
      cell: (r) => (
        <Anchor component={Link} to={`/users/${r.user.id}`} size="sm">
          {r.user.firstName} {r.user.lastName}
        </Anchor>
      ),
    },
    {
      key: 'licenseNumber',
      minWidth: 130,
      priority: 1,
      label: 'N° de licence',
      sortField: 'licenseNumber',
      cell: (r) => r.user.license?.number ?? '—',
    },
    {
      key: 'validUntil',
      minWidth: 140,
      priority: 3,
      label: 'Fin de validité',
      sortField: 'validUntil',
      cell: validUntil,
    },
    {
      key: 'documents',
      minWidth: 160,
      weight: 1.5,
      priority: 4,
      label: 'Documents',
      cell: documents,
    },
    {
      key: 'submittedAt',
      minWidth: 150,
      priority: 2,
      label: 'Soumise le',
      sortField: 'submittedAt',
      cell: (r) => dateTime(r.submittedAt),
    },
    // A pending request has no decision yet: these columns would be empty.
    ...(decided
      ? [
          {
            key: 'reviewedAt',
            minWidth: 150,
            priority: 5,
            label: 'Traitée le',
            sortField: 'reviewedAt',
            cell: (r: Renewal) => dateTime(r.reviewedAt),
          },
          { key: 'reviewedBy', minWidth: 150, priority: 6, label: 'Par', cell: reviewerLabel },
        ]
      : []),
    {
      key: 'open',
      minWidth: 80,
      weight: 0.4,
      label: '',
      required: true,
      cell: (r) => (
        <Anchor component={Link} to={detailPath(r)} size="sm">
          {decided ? 'Voir' : 'Traiter'}
        </Anchor>
      ),
    },
  ];

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
      <DataTable
        tableId="license-renewals"
        columns={columns}
        rows={list.data?.data ?? []}
        rowKey={(r) => r.id}
        sort={state.sort}
        onSortChange={onSortChange}
        loading={list.isPending}
        error={list.isError && apiErrorMessage(list.error, 'Impossible de charger les demandes.')}
        summary={
          <Text size="sm" c="dimmed">
            {total} demande{total > 1 ? 's' : ''}
          </Text>
        }
        empty={
          <EmptyState title="Aucune demande">Aucun renouvellement dans cette catégorie.</EmptyState>
        }
        renderCard={(r) => (
          <RecordCard
            to={detailPath(r)}
            title={`${r.user.firstName} ${r.user.lastName}`}
            badges={<Badge variant="light">{decided ? 'Voir la décision' : 'À traiter'}</Badge>}
          >
            <RecordLine label="N° de licence">{r.user.license?.number ?? '—'}</RecordLine>
            <RecordLine label="Fin de validité">{validUntil(r)}</RecordLine>
            <RecordLine label="Documents">{documents(r)}</RecordLine>
            <RecordLine label="Soumise le">{dateTime(r.submittedAt)}</RecordLine>
            {decided && (
              <>
                <RecordLine label="Traitée le">{dateTime(r.reviewedAt)}</RecordLine>
                <RecordLine label="Par">{reviewerLabel(r)}</RecordLine>
              </>
            )}
          </RecordCard>
        )}
      />
      {!list.isError && total > PAGE_SIZE && (
        <Pagination
          total={Math.ceil(total / PAGE_SIZE)}
          value={state.page}
          onChange={(page) => update({ page })}
        />
      )}
    </Stack>
  );
}
