import { getSessionGeneration } from "../api/tokenStore";

/**
 * Guards a server-cache write against an identity change (#892).
 *
 * The cache is cleared at every end of a session (logout, expired session,
 * either end of a support access), but a request already in flight still
 * settles afterwards. Its mutation callbacks (`onError` rollback, `onSuccess`
 * write, invalidation…) would then put the previous account's data back into
 * the emptied cache — and its persisted copy — for the next account to see.
 *
 * Usage: record `currentSessionGeneration()` when the work starts (in
 * `onMutate`, or before the request), then write only if
 * `isSameSession(recorded)`.
 */
export function currentSessionGeneration(): number {
  return getSessionGeneration();
}

/**
 * Whether the identity is still the one `startedIn` was recorded under. An
 * unknown generation (no context: `onMutate` threw) counts as changed.
 */
export function isSameSession(startedIn: number | undefined): boolean {
  return startedIn !== undefined && startedIn === getSessionGeneration();
}
