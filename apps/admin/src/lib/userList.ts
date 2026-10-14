import type { AdminUsersFilterDto } from '../api/generated/types.gen';
import type { UsersFilter } from '../api/queries';
import { ROLE_LABELS } from './labels';
import {
  type ActiveFilter,
  type FilterSpecs,
  filtersQuery,
  readFilters,
  writeFilters,
} from './listFilters';
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

export type UsersFilterField = AdminUsersFilterDto['field'];

/** Column filters with operators (#557): exactly the API's whitelist. */
export const USERS_FILTERS: FilterSpecs<UsersFilterField> = {
  name: { label: 'Nom', kind: 'text' },
  email: { label: 'Email', kind: 'text' },
  role: {
    label: 'Rôle (principal ou supplémentaire)',
    kind: 'enum',
    options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
  },
  status: {
    label: 'Compte',
    kind: 'enum',
    options: [
      { value: 'active', label: 'Actif' },
      { value: 'disabled', label: 'Désactivé' },
    ],
  },
  club: { label: 'Club', kind: 'text' },
  category: { label: 'Catégorie', kind: 'text' },
  ageGroup: { label: "Classe d'âge", kind: 'text' },
  licenseNumber: { label: 'N° de licence', kind: 'text' },
  createdAt: { label: 'Inscription', kind: 'date' },
  lastLoginAt: { label: 'Dernière connexion', kind: 'date', nullable: true },
};

/** The API refuses a longer search (400). */
const MAX_SEARCH_LENGTH = 100;

export interface UsersUrlState {
  q: string;
  filters: ActiveFilter<UsersFilterField>[];
  page: number;
  sort: SortState<UsersSortField> | null;
}

/**
 * Filters kept in the URL (#443, #557):
 * `?q=mar&f.role=in:CLUB,ADMIN&f.createdAt=between:2026-09-01,2026-09-30&sort=name&order=asc&page=2`.
 */
export function readUsersParams(params: URLSearchParams): UsersUrlState {
  const page = Number(params.get('page'));
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    filters: readFilters(params, USERS_FILTERS),
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
  writeFilters(params, next.filters);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** Column filters cleared (the search, always visible, is not one). */
export const USERS_FILTERS_CLEARED: Partial<UsersUrlState> = { filters: [] };

/** API filter of one list page of `take` rows. */
export function usersFilter(state: UsersUrlState, take: number): UsersFilter {
  return {
    ...(state.q && { search: state.q }),
    ...filtersQuery(state.filters),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
