import { queryOptions } from '@tanstack/react-query';
import {
  adminControllerAuditLog,
  adminControllerClubOptions,
  adminControllerGetUser,
  adminControllerListClubs,
  adminControllerListUsers,
  adminControllerReferenceData,
} from './generated/sdk.gen';
import type {
  AdminControllerAuditLogData,
  AdminControllerListClubsData,
  AdminControllerListUsersData,
} from './generated/types.gen';

export type UsersFilter = NonNullable<AdminControllerListUsersData['query']>;
export type ClubsFilter = NonNullable<AdminControllerListClubsData['query']>;
export type AuditFilter = NonNullable<AdminControllerAuditLogData['query']>;

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
