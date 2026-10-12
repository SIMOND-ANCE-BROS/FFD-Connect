/**
 * Format of the notifications that carry a member's NAME in their body while
 * being sent to someone else (club organisers). Shared by the producers
 * (RegistrationNotificationService, PartnershipService) and by the account
 * deletion scrub (#423), which finds these rows by a structural link and
 * rewrites the name part — so the two sides cannot drift apart.
 */

/** Body prefix used when the member's name is unknown: names nobody. */
export const UNKNOWN_MEMBER_LABEL = "Un licencié";

/**
 * Organiser notifications about a member's registration: the body is
 * `<member name><marker>"<competition>" - <event>.` — the marker locates the
 * end of the name. Keys are the `data.type` of the notification.
 */
export const CLUB_MEMBER_BODY_MARKERS = {
  club_member_auto_registered: " s'est inscrit à ",
  club_member_pending_registration: " a une inscription en attente pour ",
  club_member_unregistered: " s'est désinscrit de ",
} as const;

export type ClubMemberNotificationType = keyof typeof CLUB_MEMBER_BODY_MARKERS;

export function isClubMemberNotificationType(
  type: unknown,
): type is ClubMemberNotificationType {
  return (
    typeof type === "string" &&
    Object.prototype.hasOwnProperty.call(CLUB_MEMBER_BODY_MARKERS, type)
  );
}

/** `Alex MARTIN s'est inscrit à "Open de Paris" - Latines Adulte.` */
export function clubMemberNotificationBody(
  type: ClubMemberNotificationType,
  memberName: string,
  competitionTitle: string,
  eventLabel: string,
): string {
  return `${memberName}${CLUB_MEMBER_BODY_MARKERS[type]}"${competitionTitle}" - ${eventLabel}.`;
}

/**
 * Inter-club partnership notifications: the body starts with the couple
 * label `<user1> & <user2>` (user1 first, as in the Partnership row), then
 * PARTNERSHIP_LABEL_END.
 */
export const PARTNERSHIP_NOTIFICATION_TYPES = [
  "partnership_interclub_request",
  "partnership_interclub_ended",
  "partnership_interclub_accepted",
  "partnership_interclub_rejected",
] as const;

export function isPartnershipNotificationType(type: unknown): boolean {
  return (
    typeof type === "string" &&
    (PARTNERSHIP_NOTIFICATION_TYPES as readonly string[]).includes(type)
  );
}

export const PARTNERSHIP_LABEL_JOIN = " & ";
export const PARTNERSHIP_LABEL_END = " : ";
/** Couple label when a member's name is unknown: names nobody. */
export const UNKNOWN_COUPLE_LABEL = "Un couple";

/** `Alex MARTIN & Sam PETIT`, or UNKNOWN_COUPLE_LABEL when a name is missing. */
export function coupleNotificationLabel(
  user1: { firstName: string | null; lastName: string | null },
  user2: { firstName: string | null; lastName: string | null },
): string {
  const name1 = `${user1.firstName ?? ""} ${user1.lastName ?? ""}`.trim();
  const name2 = `${user2.firstName ?? ""} ${user2.lastName ?? ""}`.trim();
  return name1 && name2
    ? `${name1}${PARTNERSHIP_LABEL_JOIN}${name2}`
    : UNKNOWN_COUPLE_LABEL;
}

/**
 * `data` keys naming the two members of the couple, in label order (#423).
 * They keep the link to each member after the Partnership row is gone (it
 * cascades away with the first member's account), so the second member's
 * name can still be scrubbed when that account is deleted in turn.
 */
export const PARTNERSHIP_MEMBER_DATA_KEYS = [
  "member1UserId",
  "member2UserId",
] as const;
