import { Prisma } from "@prisma/client";
import {
  CLUB_MEMBER_BODY_MARKERS,
  ClubMemberNotificationType,
  PARTNERSHIP_LABEL_END,
  PARTNERSHIP_LABEL_JOIN,
  PARTNERSHIP_MEMBER_DATA_KEYS,
  UNKNOWN_COUPLE_LABEL,
  UNKNOWN_MEMBER_LABEL,
} from "../notifications/member-name-copy";
import { DELETED_PARTNER_LABEL } from "./partner-name-scrub.utils";

/**
 * Pure helpers behind the scrubbing of a deleted account's NAME from the
 * notifications sent to OTHER users (club organisers, #423).
 *
 * The caller has already selected the row by a structural link (the user's
 * registration, partnership, or member id in `data`); these helpers then
 * locate the name by the notification's FORMAT (member-name-copy.ts), not by
 * matching the current name — a name edited since the notification was sent
 * is replaced all the same.
 */

/** Neutral label that replaces a deleted member's name in a notification. */
export const DELETED_MEMBER_LABEL = "Membre supprimé";

/**
 * Body written when a linked notification's format is not recognised:
 * rather than leave a name in place, the whole text goes.
 */
export const DELETED_MEMBER_NOTIFICATION_BODY =
  "Cette notification concernait un membre dont le compte a été supprimé.";

/**
 * `Alex MARTIN s'est inscrit à …` → `Membre supprimé s'est inscrit à …`.
 * Returns null when there is nothing to change (the body names nobody, or
 * is already scrubbed).
 */
export function scrubClubMemberNotificationBody(
  body: string,
  type: ClubMemberNotificationType,
): string | null {
  const end = body.indexOf(CLUB_MEMBER_BODY_MARKERS[type]);
  if (end <= 0) {
    return body === DELETED_MEMBER_NOTIFICATION_BODY
      ? null
      : DELETED_MEMBER_NOTIFICATION_BODY;
  }
  const name = body.slice(0, end);
  if (name === UNKNOWN_MEMBER_LABEL || name === DELETED_MEMBER_LABEL) {
    return null;
  }
  return `${DELETED_MEMBER_LABEL}${body.slice(end)}`;
}

/**
 * `Alex MARTIN & Sam PETIT : …` → the half at `position` (0 = user1,
 * 1 = user2, label order) becomes « Partenaire supprimé », as in couple
 * result labels (#395). A label that does not split in two halves is
 * replaced as a whole (never guess which part is the person). Returns null
 * when there is nothing to change.
 */
export function scrubCoupleNotificationBody(
  body: string,
  position: 0 | 1,
): string | null {
  const end = body.indexOf(PARTNERSHIP_LABEL_END);
  if (end <= 0) {
    return body === DELETED_MEMBER_NOTIFICATION_BODY
      ? null
      : DELETED_MEMBER_NOTIFICATION_BODY;
  }
  const label = body.slice(0, end);
  const rest = body.slice(end);
  if (label === UNKNOWN_COUPLE_LABEL) return null;
  const halves = label.split(PARTNERSHIP_LABEL_JOIN);
  if (halves.length !== 2) return `${UNKNOWN_COUPLE_LABEL}${rest}`;
  if (halves[position] === DELETED_PARTNER_LABEL) return null;
  halves[position] = DELETED_PARTNER_LABEL;
  return `${halves.join(PARTNERSHIP_LABEL_JOIN)}${rest}`;
}

/**
 * Copy of `data` without the member keys that hold the deleted user's id,
 * or null when none does (nothing to write).
 */
export function withoutDeletedMemberIds(
  data: Prisma.JsonValue,
  userId: string,
): Prisma.InputJsonObject | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const kept: Record<string, Prisma.InputJsonValue> = {};
  let dropped = false;
  for (const [key, value] of Object.entries(data)) {
    if (
      (PARTNERSHIP_MEMBER_DATA_KEYS as readonly string[]).includes(key) &&
      value === userId
    ) {
      dropped = true;
      continue;
    }
    if (value !== null && value !== undefined) kept[key] = value;
  }
  return dropped ? kept : null;
}
