import type { AdminRefundDueDto, AdminRefundsDueFilterDto } from '../api/generated/types.gen';
import type { RefundsDueFilter } from '../api/queries';
import {
  type ActiveFilter,
  type FilterSpecs,
  filtersQuery,
  readFilters,
  writeFilters,
} from './listFilters';
import { readSort, type SortState, sortQuery, writeSort } from './listSort';

export type RefundsDueSortField = NonNullable<RefundsDueFilter['sortBy']>;
export const REFUNDS_DUE_SORT_FIELDS = [
  'club',
  'competition',
  'competitionDate',
  'amount',
  'refundOwedAt',
] as const satisfies readonly RefundsDueSortField[];

export type RefundsDueFilterField = AdminRefundsDueFilterDto['field'];

/** Column filters with operators (#557): exactly the API's whitelist. */
export const REFUNDS_DUE_FILTERS: FilterSpecs<RefundsDueFilterField> = {
  club: { label: 'Club', kind: 'text', nullable: true },
  competition: { label: 'Compétition', kind: 'text' },
  competitionDate: { label: 'Date de la compétition', kind: 'date' },
  dancer: { label: 'Payé par', kind: 'text' },
  refundOwedAt: { label: 'Dû depuis', kind: 'date' },
};

export interface RefundsDueUrlState {
  filters: ActiveFilter<RefundsDueFilterField>[];
  page: number;
  /** Column sort; null: the longest-waiting payer first. */
  sort: SortState<RefundsDueSortField> | null;
}

/** Filters kept in the URL (#443): `?f.club=contains:lyon&sort=amount&order=desc&page=2`. */
export function readRefundsDueParams(params: URLSearchParams): RefundsDueUrlState {
  const page = Number(params.get('page'));
  return {
    filters: readFilters(params, REFUNDS_DUE_FILTERS),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    sort: readSort(params, REFUNDS_DUE_SORT_FIELDS),
  };
}

/** New params with `patch` applied; any change but the page goes back to the first page. */
export function writeRefundsDueParams(
  current: URLSearchParams,
  patch: Partial<RefundsDueUrlState>,
): URLSearchParams {
  const next = { ...readRefundsDueParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  writeFilters(params, next.filters);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one page of `take` rows. */
export const refundsDueFilter = (state: RefundsDueUrlState, take: number): RefundsDueFilter => ({
  ...filtersQuery(state.filters),
  ...sortQuery(state.sort),
  skip: (state.page - 1) * take,
  take,
});

const PARIS = 'Europe/Paris';
const parisDay = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const parisTime = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS,
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * `DD/MM/YYYY` in Europe/Paris whatever the browser's time zone: the clubs,
 * the payers and the back-office are in France.
 */
export const formatParisDay = (iso: string): string => parisDay.format(new Date(iso));

/** `DD/MM/YYYY HH:mm` in Europe/Paris (see {@link formatParisDay}). */
export const formatParisDateTime = (iso: string): string => {
  const date = new Date(iso);
  return `${parisDay.format(date)} ${parisTime.format(date)}`;
};

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** Amount of ONE payment (the API's `amountCents`), « — » when unknown. */
export const formatAmount = (cents: number | null): string =>
  cents === null ? '—' : euros.format(cents / 100);

/**
 * Total to refund on a row: one payment per HelloAsso reference. Unknown
 * without a recorded price.
 */
export function totalCents(
  row: Pick<AdminRefundDueDto, 'amountCents' | 'helloAssoCheckoutIntentIds'>,
) {
  return row.amountCents === null ? null : row.amountCents * row.helloAssoCheckoutIntentIds.length;
}

/** Owing club's name; a competition with neither link nor label has none. */
export const clubLabel = (row: Pick<AdminRefundDueDto, 'club'>): string =>
  row.club.name ?? 'Club inconnu';

/** Back-office record of the owing club, when the competition is linked to one. */
export const clubPath = (row: Pick<AdminRefundDueDto, 'club'>): string | null =>
  row.club.id ? `/clubs/${row.club.id}` : null;
