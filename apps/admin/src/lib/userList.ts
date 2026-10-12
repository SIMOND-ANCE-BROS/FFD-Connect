import type { UserRole } from '../api/generated/types.gen';
import type { UsersFilter } from '../api/queries';
import { ROLE_LABELS, type StatusChoice } from './labels';
import { readSort, type SortState, sortQuery, writeSort } from './listSort';

export type UsersSortField = NonNullable<UsersFilter['sortBy']>;
export const USERS_SORT_FIELDS = [
  'name',
  'email',
  'role',
  'club',
  'category',
  'ageGroup',
  'createdAt',
  'lastLoginAt',
] as const satisfies readonly UsersSortField[];

/** The API refuses a longer search or category (400). */
const MAX_SEARCH_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 50;

export interface UsersUrlState {
  q: string;
  role: UserRole | null;
  clubId: string | null;
  category: string | null;
  status: StatusChoice;
  /** Inclusive sign-up range, `YYYY-MM-DD`. */
  createdFrom: string | null;
  createdTo: string | null;
  page: number;
  sort: SortState<UsersSortField> | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRole = (value: string | null): value is UserRole =>
  value !== null && Object.keys(ROLE_LABELS).includes(value);

export const isStatusChoice = (value: string | null): value is StatusChoice =>
  value === 'all' || value === 'active' || value === 'disabled';

const day = (value: string | null): string | null => (value && DAY.test(value) ? value : null);

/**
 * Filters kept in the URL (#443):
 * `?q=mar&role=CLUB&club=<uuid>&category=Latin&status=disabled&from=2026-09-01&to=2026-09-30&sort=name&order=asc&page=2`.
 */
export function readUsersParams(params: URLSearchParams): UsersUrlState {
  const role = params.get('role');
  const club = params.get('club');
  const category = (params.get('category') ?? '').trim();
  const status = params.get('status');
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    role: isRole(role) ? role : null,
    clubId: club && UUID.test(club) ? club : null,
    category: category && category.length <= MAX_CATEGORY_LENGTH ? category : null,
    status: isStatusChoice(status) ? status : 'all',
    createdFrom: day(params.get('from')),
    createdTo: day(params.get('to')),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    sort: readSort(params, USERS_SORT_FIELDS),
  };
}

/** New params with `patch` applied; any change but the page goes back to the first page. */
export function writeUsersParams(
  current: URLSearchParams,
  patch: Partial<UsersUrlState>,
): URLSearchParams {
  const next = { ...readUsersParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.role) params.set('role', next.role);
  if (next.clubId) params.set('club', next.clubId);
  if (next.category) params.set('category', next.category);
  if (next.status !== 'all') params.set('status', next.status);
  if (next.createdFrom) params.set('from', next.createdFrom);
  if (next.createdTo) params.set('to', next.createdTo);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** Column filters set (the search, always visible, is not one). */
export const USERS_FILTERS_CLEARED: Partial<UsersUrlState> = {
  role: null,
  clubId: null,
  category: null,
  status: 'all',
  createdFrom: null,
  createdTo: null,
};

/** API filter of one list page of `take` rows. */
export function usersFilter(state: UsersUrlState, take: number): UsersFilter {
  return {
    ...(state.q && { search: state.q }),
    ...(state.role && { role: state.role }),
    ...(state.clubId && { clubId: state.clubId }),
    ...(state.category && { category: state.category }),
    ...(state.status !== 'all' && { status: state.status }),
    ...(state.createdFrom && { createdFrom: state.createdFrom }),
    ...(state.createdTo && { createdTo: state.createdTo }),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
