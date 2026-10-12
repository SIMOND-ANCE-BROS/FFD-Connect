import type { AdminUserListItemDto } from '../api/generated/types.gen';
import { apiErrorMessage } from './apiError';

/** Most accounts linked in one go: each one is its own audited PATCH, run in turn. */
export const MAX_LINK_SELECTION = 50;

export const LINK_FAILED_MESSAGE = "Impossible d'ajouter ce membre";

/** True when the user's current club (id or legacy name) is another club. */
export const leavesAnotherClub = (
  user: AdminUserListItemDto,
  club: { id: string; name: string },
) =>
  user.clubId
    ? user.clubId !== club.id
    : Boolean(user.clubName) && user.clubName?.toLowerCase() !== club.name.toLowerCase();

/** A CLUB-role holder linked to a club becomes its manager. */
export const holdsClubRole = (user: AdminUserListItemDto) =>
  user.role === 'CLUB' || user.extraRoles.includes('CLUB');

export type LinkOutcome =
  | { user: AdminUserListItemDto; ok: true }
  | { user: AdminUserListItemDto; ok: false; error: string };

/**
 * Links each user in turn and reports every outcome: a refused account never
 * stops the others. Sequential on purpose, so the batch stays gentle on the API
 * and each link keeps its own audit entry (the per-user PATCH audits it).
 */
export async function linkEach(
  users: readonly AdminUserListItemDto[],
  link: (user: AdminUserListItemDto) => Promise<unknown>,
): Promise<LinkOutcome[]> {
  const outcomes: LinkOutcome[] = [];
  for (const user of users) {
    try {
      await link(user);
      outcomes.push({ user, ok: true });
    } catch (error) {
      outcomes.push({ user, ok: false, error: apiErrorMessage(error, LINK_FAILED_MESSAGE) });
    }
  }
  return outcomes;
}

/** "1 membre ajouté" / "3 membres ajoutés", plus the refused count when any. */
export function linkSummary(outcomes: readonly LinkOutcome[]): string {
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  const added = `${ok} membre${ok > 1 ? 's' : ''} ajouté${ok > 1 ? 's' : ''}`;
  return failed === 0 ? added : `${added}, ${failed} refusé${failed > 1 ? 's' : ''}`;
}
