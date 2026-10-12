import { Prisma, PrismaClient } from "@prisma/client";
import {
  isClubMemberNotificationType,
  isPartnershipNotificationType,
  PARTNERSHIP_MEMBER_DATA_KEYS,
} from "../notifications/member-name-copy";
import {
  idOnlySelect,
  notificationNameScrubSelect,
  partnershipMembersSelect,
} from "../utils/prisma-selects";
import {
  scrubClubMemberNotificationBody,
  scrubCoupleNotificationBody,
  withoutDeletedMemberIds,
} from "./notification-name-scrub.utils";
import type { PartnerNameScrubLogger } from "./partner-name-scrub";

/** Prisma delegates the scrub reads and writes (PrismaService or a script client). */
export type NotificationNameScrubPrisma = Pick<
  PrismaClient,
  "registration" | "partnership" | "notification"
>;

/**
 * Bound of each read below (registrations, partnerships, one page of
 * notifications). Hitting it is logged (rows beyond keep the name).
 */
export const MAX_NOTIFICATION_SCRUB_ROWS = 1000;

/**
 * Notifications are read page by page (up to 50 organisers per club are
 * notified for each registration): at most this many pages, i.e. 10 000
 * rows — far above any real member.
 */
export const MAX_NOTIFICATION_SCRUB_PAGES = 10;

/**
 * Droit à l'effacement (#423) : notifications reçues par D'AUTRES
 * utilisateurs (gestionnaires de club) dont le texte nomme la personne
 * supprimée. Elles ne lui appartiennent pas : elles restent dans le fil de
 * leur destinataire, mais son nom y est remplacé.
 *
 * Lien structurel d'abord, jamais le nom seul :
 * - inscription d'un membre (`data.registrationId` ∈ ses inscriptions) :
 *   « X s'est inscrit… » → « Membre supprimé s'est inscrit… » ;
 * - couple inter-club (`data.partnershipId` ∈ ses partenariats, ou
 *   `data.member1UserId` / `member2UserId` = son id, posés depuis #423) :
 *   sa moitié de « X & Y : … » → « Partenaire supprimé », et son id est
 *   retiré de `data`.
 *
 * Limite : une notification de couple antérieure à #423 (sans member ids)
 * dont le partenariat a déjà disparu — supprimé en cascade avec le compte de
 * l'autre membre ou avec le club principal — n'a plus de lien et garde le nom. Une notification push
 * déjà affichée sur un téléphone ne peut pas être reprise.
 *
 * Lectures AVANT la transaction (ses inscriptions y sont supprimées, ses
 * partenariats partent en cascade) ; renvoie les écritures à y ajouter.
 */
export async function buildNotificationNameScrubOps(
  prisma: NotificationNameScrubPrisma,
  userId: string,
  logger: PartnerNameScrubLogger,
): Promise<Prisma.PrismaPromise<unknown>[]> {
  const [registrations, partnerships] = await Promise.all([
    prisma.registration.findMany({
      where: { userId },
      select: idOnlySelect,
      take: MAX_NOTIFICATION_SCRUB_ROWS,
    }),
    prisma.partnership.findMany({
      where: { OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: partnershipMembersSelect,
      take: MAX_NOTIFICATION_SCRUB_ROWS,
    }),
  ]);
  const registrationIds = new Set(registrations.map((r) => r.id));
  const positionByPartnership = new Map<string, 0 | 1>(
    partnerships.map((p) => [p.id, p.user1Id === userId ? 0 : 1]),
  );

  const where: Prisma.NotificationWhereInput = {
    userId: { not: userId },
    OR: [
      ...[...registrationIds].map((id) => ({
        data: { path: ["registrationId"], equals: id },
      })),
      ...[...positionByPartnership.keys()].map((id) => ({
        data: { path: ["partnershipId"], equals: id },
      })),
      ...PARTNERSHIP_MEMBER_DATA_KEYS.map((key) => ({
        data: { path: [key], equals: userId },
      })),
    ],
  };
  const notifications: Prisma.NotificationGetPayload<{
    select: typeof notificationNameScrubSelect;
  }>[] = [];
  let pageFull = true;
  for (let page = 0; page < MAX_NOTIFICATION_SCRUB_PAGES && pageFull; page++) {
    const last = notifications.at(-1);
    const rows = await prisma.notification.findMany({
      where,
      select: notificationNameScrubSelect,
      orderBy: { id: "asc" },
      take: MAX_NOTIFICATION_SCRUB_ROWS,
      ...(last && { cursor: { id: last.id }, skip: 1 }),
    });
    notifications.push(...rows);
    pageFull = rows.length === MAX_NOTIFICATION_SCRUB_ROWS;
  }

  if (
    pageFull ||
    [registrations, partnerships].some(
      (rows) => rows.length === MAX_NOTIFICATION_SCRUB_ROWS,
    )
  ) {
    // No user identifier in the log.
    logger.warn(
      `Account deletion: a notification read hit the ${MAX_NOTIFICATION_SCRUB_ROWS} cap — some notifications may keep the name`,
    );
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const notification of notifications) {
    const data = readDataObject(notification.data);
    if (!data) continue;
    let body: string | null = null;
    if (
      isClubMemberNotificationType(data.type) &&
      typeof data.registrationId === "string" &&
      registrationIds.has(data.registrationId)
    ) {
      body = scrubClubMemberNotificationBody(notification.body, data.type);
    } else if (isPartnershipNotificationType(data.type)) {
      const position = couplePosition(data, userId, positionByPartnership);
      if (position === null) continue;
      body = scrubCoupleNotificationBody(notification.body, position);
    } else {
      continue;
    }
    const strippedData = withoutDeletedMemberIds(notification.data, userId);
    if (body === null && strippedData === null) continue;
    // updateMany: a row the recipient deleted in the meantime is skipped
    // instead of failing the whole account deletion (P2025).
    ops.push(
      prisma.notification.updateMany({
        where: { id: notification.id, userId: { not: userId } },
        data: {
          ...(body !== null && { body }),
          ...(strippedData !== null && { data: strippedData }),
        },
      }),
    );
  }
  return ops;
}

function readDataObject(data: Prisma.JsonValue): Prisma.JsonObject | null {
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}

/** The deleted user's half of the couple label, by structural link only. */
function couplePosition(
  data: Prisma.JsonObject,
  userId: string,
  positionByPartnership: ReadonlyMap<string, 0 | 1>,
): 0 | 1 | null {
  if (data.member1UserId === userId) return 0;
  if (data.member2UserId === userId) return 1;
  return typeof data.partnershipId === "string"
    ? (positionByPartnership.get(data.partnershipId) ?? null)
    : null;
}
