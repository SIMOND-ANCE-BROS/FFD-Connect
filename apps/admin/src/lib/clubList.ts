import type { AdminClubsFilterDto } from '../api/generated/types.gen';
import type { ClubsFilter } from '../api/queries';
import { REGISTRATION_MODE_LABELS } from './labels';
import {
  type ActiveFilter,
  type FilterSpecs,
  filtersQuery,
  readFilters,
  writeFilters,
} from './listFilters';
import { readSort, type SortState, sortQuery, writeSort } from './listSort';

export type ClubsSortField = NonNullable<ClubsFilter['sortBy']>;
export const CLUBS_SORT_FIELDS = [
  'name',
  'registrationMode',
  'createdAt',
] as const satisfies readonly ClubsSortField[];

export type ClubsFilterField = AdminClubsFilterDto['field'];

/** Column filters with operators (#557): exactly the API's whitelist. */
export const CLUBS_FILTERS: FilterSpecs<ClubsFilterField> = {
  name: { label: 'Club', kind: 'text' },
  status: {
    label: 'Statut',
    kind: 'enum',
    options: [
      { value: 'active', label: 'Actif' },
      { value: 'disabled', label: 'Désactivé' },
    ],
  },
  registrationMode: {
    label: 'Inscriptions',
    kind: 'enum',
    options: Object.entries(REGISTRATION_MODE_LABELS).map(([value, label]) => ({ value, label })),
  },
  createdAt: { label: 'Création', kind: 'date' },
};

/** The API refuses a longer search (400). */
const MAX_SEARCH_LENGTH = 100;

export interface ClubsUrlState {
  q: string;
  filters: ActiveFilter<ClubsFilterField>[];
  page: number;
  sort: SortState<ClubsSortField> | null;
}

/** Filters kept in the URL (#443, #557): `?q=paris&f.status=in:disabled&sort=createdAt&order=desc&page=2`. */
export function readClubsParams(params: URLSearchParams): ClubsUrlState {
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    filters: readFilters(params, CLUBS_FILTERS),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    sort: readSort(params, CLUBS_SORT_FIELDS),
  };
}

/** New params with `patch` applied; any change but the page goes back to the first page. */
export function writeClubsParams(
  current: URLSearchParams,
  patch: Partial<ClubsUrlState>,
): URLSearchParams {
  const next = { ...readClubsParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  writeFilters(params, next.filters);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows. */
export function clubsFilter(state: ClubsUrlState, take: number): ClubsFilter {
  return {
    ...(state.q && { search: state.q }),
    ...filtersQuery(state.filters),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
