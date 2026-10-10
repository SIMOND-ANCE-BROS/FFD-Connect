import { queryOptions } from '@tanstack/react-query';
import {
  adminControllerAuditLog,
  adminControllerClubOptions,
  adminControllerGetClub,
  adminControllerGetUser,
  adminControllerListClubs,
  adminControllerListUsers,
  adminControllerReferenceData,
  adminStatsControllerGet,
  adminUsageControllerGet,
  adminTracksControllerFindOne,
  adminTracksControllerList,
  trackCorrectionsControllerFindOne,
  trackCorrectionsControllerList,
  trackCorrectionsControllerPendingCount,
} from './generated/sdk.gen';
import type {
  AdminControllerAuditLogData,
  AdminControllerListClubsData,
  AdminControllerListUsersData,
  AdminTracksControllerListData,
  TrackCorrectionsControllerListData,
} from './generated/types.gen';
import type { StatsPeriod } from '../lib/stats';
import type { UsagePeriod, UsageSpace } from '../lib/usage';

export type UsersFilter = NonNullable<AdminControllerListUsersData['query']>;
export type ClubsFilter = NonNullable<AdminControllerListClubsData['query']>;
export type AuditFilter = NonNullable<AdminControllerAuditLogData['query']>;
export type ModerationFilter = NonNullable<TrackCorrectionsControllerListData['query']>;
export type TracksFilter = NonNullable<AdminTracksControllerListData['query']>;

/** Throws so React Query surfaces the error state (the generated client never throws). */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error !== undefined || data === undefined) {
    throw error ?? new Error('Réponse vide');
  }
  return data;
}

export const usersQuery = (q: UsersFilter) =>
  queryOptions({
    queryKey: ['admin', 'users', q],
    queryFn: () => unwrap(adminControllerListUsers({ query: q })),
  });

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'user', id],
    queryFn: () => unwrap(adminControllerGetUser({ path: { id } })),
  });

/** Active clubs for selects, plus `includeId` (the current value) even if disabled. */
export const clubOptionsQuery = (includeId?: string | null) =>
  queryOptions({
    queryKey: ['admin', 'clubs', 'options', includeId ?? null],
    queryFn: () =>
      unwrap(adminControllerClubOptions(includeId ? { query: { includeId } } : undefined)),
    staleTime: 5 * 60_000,
  });

export const referenceQuery = queryOptions({
  queryKey: ['admin', 'reference'],
  queryFn: () => unwrap(adminControllerReferenceData()),
  staleTime: Infinity,
});

export const auditQuery = (q: AuditFilter) =>
  queryOptions({
    queryKey: ['admin', 'audit', q],
    queryFn: () => unwrap(adminControllerAuditLog({ query: q })),
  });

/** For endpoints answering 204 (no body): rejects with the parsed error body, resolves otherwise. */
export async function ensureOk(
  p: Promise<{ error?: unknown; response?: Response }>,
): Promise<void> {
  const { error, response } = await p;
  if (error !== undefined || !response?.ok) {
    throw error ?? new Error('Requête refusée');
  }
}

export const clubsQuery = (q: ClubsFilter) =>
  queryOptions({
    queryKey: ['admin', 'clubs', 'list', q],
    queryFn: () => unwrap(adminControllerListClubs({ query: q })),
  });

export const clubQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'club', id],
    queryFn: () => unwrap(adminControllerGetClub({ path: { id } })),
  });

export const moderationListQuery = (q: ModerationFilter) =>
  queryOptions({
    queryKey: ['admin', 'moderation', 'list', q],
    queryFn: () => unwrap(trackCorrectionsControllerList({ query: q })),
  });

/**
 * Pending proposals, for the menu badge. Refetched on navigation and after a
 * decision only: no refetchInterval, the backend scales to zero.
 */
export const pendingCountQuery = queryOptions({
  queryKey: ['admin', 'moderation', 'pending-count'],
  queryFn: () => unwrap(trackCorrectionsControllerPendingCount()),
  // Never wake the scale-to-zero backend on a refocus, a reconnect or a retry.
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
});

export const correctionQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'moderation', 'item', id],
    queryFn: () => unwrap(trackCorrectionsControllerFindOne({ path: { id } })),
    // Same as the badge: a refocus, a reconnect or a retry would wake the scale-to-zero backend.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/**
 * Track catalogue. Same rule as the moderation queries: a refocus, a
 * reconnect or a retry would wake the scale-to-zero backend.
 */
export const tracksQuery = (q: TracksFilter) =>
  queryOptions({
    queryKey: ['admin', 'tracks', 'list', q],
    queryFn: () => unwrap(adminTracksControllerList({ query: q })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

export const trackQuery = (id: string) =>
  queryOptions({
    queryKey: ['admin', 'tracks', 'item', id],
    queryFn: () => unwrap(adminTracksControllerFindOne({ path: { id } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/** Stats are computed on demand: no refetch on focus or reconnect, no retry (lot 4). */
export const statsQuery = (period: StatsPeriod) =>
  queryOptions({
    queryKey: ['admin', 'stats', period],
    queryFn: () => unwrap(adminStatsControllerGet({ query: { period } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

/** Usage is computed on demand: no refetch on focus or reconnect, no retry (lot 5). */
export const usageQuery = (period: UsagePeriod, space?: UsageSpace) =>
  queryOptions({
    queryKey: ['admin', 'usage', period, space ?? 'ALL'],
    queryFn: () =>
      unwrap(adminUsageControllerGet({ query: space ? { period, space } : { period } })),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
