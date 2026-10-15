import { useQueries } from '@tanstack/react-query';
import { userNameQuery } from '../api/queries';

/** Label of an id whose account is gone (404 on its record). */
export const DELETED_ACCOUNT = 'Compte supprimé';

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { statusCode?: unknown }).statusCode === 404;

/**
 * Names of the given user ids, read from their back-office record (#606): the
 * health-data access journal returns ids only, and must never carry names.
 * Returns a lookup: the full name once loaded, « Compte supprimé » for an
 * account deleted since, « … » while loading, the short id on another error.
 */
export function useUserNames(ids: readonly string[]): (id: string) => string {
  const results = useQueries({ queries: ids.map((id) => userNameQuery(id)) });
  const names = new Map<string, string>();
  ids.forEach((id, i) => {
    const r = results[i];
    if (r?.data) names.set(id, `${r.data.firstName} ${r.data.lastName}`);
    else if (r?.isError) names.set(id, isNotFound(r.error) ? DELETED_ACCOUNT : id.slice(0, 8));
  });
  return (id) => names.get(id) ?? '…';
}
