import type { ClubsFilter } from '../api/queries';
import type { StatusChoice } from './labels';
import { readSort, type SortState, sortQuery, writeSort } from './listSort';
import { isStatusChoice } from './userList';

export type ClubsSortField = NonNullable<ClubsFilter['sortBy']>;
export const CLUBS_SORT_FIELDS = [
  'name',
  'registrationMode',
  'createdAt',
] as const satisfies readonly ClubsSortField[];

/** The API refuses a longer search (400). */
const MAX_SEARCH_LENGTH = 100;

export interface ClubsUrlState {
  q: string;
  status: StatusChoice;
  page: number;
  sort: SortState<ClubsSortField> | null;
}

/** Filters kept in the URL (#443): `?q=paris&status=disabled&sort=createdAt&order=desc&page=2`. */
export function readClubsParams(params: URLSearchParams): ClubsUrlState {
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    status: isStatusChoice(status) ? status : 'all',
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
  if (next.status !== 'all') params.set('status', next.status);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one list page of `take` rows. */
export function clubsFilter(state: ClubsUrlState, take: number): ClubsFilter {
  return {
    ...(state.q && { search: state.q }),
    ...(state.status !== 'all' && { status: state.status }),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
