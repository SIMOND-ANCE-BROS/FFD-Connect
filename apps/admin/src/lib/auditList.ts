import type { AuditLogEntryDto, AuditLogFilterDto } from '../api/generated/types.gen';
import type { AuditFilter } from '../api/queries';
import { ACTION_LABELS } from './auditLabels';
import {
  type ActiveFilter,
  type FilterSpecs,
  filtersQuery,
  readFilters,
  writeFilters,
} from './listFilters';
import { readSort, type SortState, sortQuery, writeSort } from './listSort';

export type AuditAction = AuditLogEntryDto['action'];
export type AuditTargetType = AuditLogEntryDto['targetType'];
export type AuditSortField = NonNullable<AuditFilter['sortBy']>;
export const AUDIT_SORT_FIELDS = ['createdAt'] as const satisfies readonly AuditSortField[];

/** Exactly the generated union: a target type added on the backend fails the typecheck. */
export const TARGET_TYPE_LABELS: Record<AuditTargetType, string> = {
  USER: 'Utilisateur',
  CLUB: 'Club',
  TRACK_CORRECTION: 'Proposition de correction',
  TRACK: 'Musique',
  LICENSE_RENEWAL: 'Renouvellement de licence',
};

export type AuditFilterField = AuditLogFilterDto['field'];

/** Column filters with operators (#557): exactly the API's whitelist. */
export const AUDIT_FILTERS: FilterSpecs<AuditFilterField> = {
  createdAt: { label: 'Date', kind: 'date' },
  actor: { label: 'Admin', kind: 'text' },
  action: {
    label: 'Action',
    kind: 'enum',
    options: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
  },
  targetType: {
    label: 'Cible',
    kind: 'enum',
    options: Object.entries(TARGET_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  },
};

export interface AuditUrlState {
  filters: ActiveFilter<AuditFilterField>[];
  page: number;
  /** Date sort; null: newest first. */
  sort: SortState<AuditSortField> | null;
}

/** Filters kept in the URL (#443, #557): `?f.action=in:USER_DELETE&f.targetType=in:USER&sort=createdAt&order=asc&page=2`. */
export function readAuditParams(params: URLSearchParams): AuditUrlState {
  const page = Number(params.get('page'));
  return {
    filters: readFilters(params, AUDIT_FILTERS),
    page: Number.isInteger(page) && page > 1 ? page : 1,
    sort: readSort(params, AUDIT_SORT_FIELDS),
  };
}

/** New params with `patch` applied; any change but the page goes back to the first page. */
export function writeAuditParams(
  current: URLSearchParams,
  patch: Partial<AuditUrlState>,
): URLSearchParams {
  const next = { ...readAuditParams(current), ...patch };
  if (patch.page === undefined) next.page = 1;
  const params = new URLSearchParams();
  writeFilters(params, next.filters);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one journal page of `take` rows. */
export function auditFilter(state: AuditUrlState, take: number): AuditFilter {
  return {
    ...filtersQuery(state.filters),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
