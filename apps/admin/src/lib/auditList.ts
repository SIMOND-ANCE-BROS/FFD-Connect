import type { AuditLogEntryDto } from '../api/generated/types.gen';
import type { AuditFilter } from '../api/queries';
import { ACTION_LABELS } from './auditLabels';
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

export interface AuditUrlState {
  action: AuditAction | null;
  targetType: AuditTargetType | null;
  page: number;
  /** Date sort; null: newest first. */
  sort: SortState<AuditSortField> | null;
}

const isAction = (value: string | null): value is AuditAction =>
  value !== null && Object.keys(ACTION_LABELS).includes(value);
const isTargetType = (value: string | null): value is AuditTargetType =>
  value !== null && Object.keys(TARGET_TYPE_LABELS).includes(value);

/** Filters kept in the URL (#443): `?action=USER_DELETE&target=USER&sort=createdAt&order=asc&page=2`. */
export function readAuditParams(params: URLSearchParams): AuditUrlState {
  const action = params.get('action');
  const target = params.get('target');
  const page = Number(params.get('page'));
  return {
    action: isAction(action) ? action : null,
    targetType: isTargetType(target) ? target : null,
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
  if (next.action) params.set('action', next.action);
  if (next.targetType) params.set('target', next.targetType);
  writeSort(params, next.sort);
  if (next.page > 1) params.set('page', String(next.page));
  return params;
}

/** API filter of one journal page of `take` rows. */
export function auditFilter(state: AuditUrlState, take: number): AuditFilter {
  return {
    ...(state.action && { action: state.action }),
    ...(state.targetType && { targetType: state.targetType }),
    ...sortQuery(state.sort),
    skip: (state.page - 1) * take,
    take,
  };
}
