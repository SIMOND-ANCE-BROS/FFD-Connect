import { Prisma, UserRole } from "@prisma/client";
import { withRole } from "../auth/roles";

/**
 * Club names are copied as free text (User.clubName, License.clubName,
 * Competition.organizer) and compared case-insensitively across the codebase.
 */
export function sameClubName(name: string): Prisma.StringFilter {
  return { equals: name, mode: "insensitive" };
}

/**
 * Competitions organised by `club` (#408): linked to it by id, or — while a
 * row is unlinked — whose `organizer` label is its name. Linked rows of a
 * homonym club (same name, other case) are not counted.
 */
export function organizedByClubOrLabel(club: {
  id: string;
  name: string;
}): Prisma.CompetitionWhereInput {
  return {
    OR: [
      { organizerClubId: club.id },
      { organizerClubId: null, organizer: sameClubName(club.name) },
    ],
  };
}

/** What still points at a club. A club can be deleted only when all are 0. */
export interface ClubUsage {
  memberCount: number;
  clubAccountCount: number;
  competitionCount: number;
  partnershipCount: number;
  soloTeamCount: number;
}

/**
 * Sequential on purpose: also called inside interactive transactions, which
 * run on one connection. Partnerships and solo teams are counted because the
 * schema deletes them in cascade with the club (couples of former members).
 */
export async function clubUsage(
  db: Prisma.TransactionClient,
  club: { id: string; name: string },
): Promise<ClubUsage> {
  const memberCount = await db.user.count({
    where: { clubId: club.id, NOT: withRole(UserRole.CLUB) },
  });
  const clubAccountCount = await db.user.count({
    where: { clubId: club.id, ...withRole(UserRole.CLUB) },
  });
  const competitionCount = await db.competition.count({
    where: organizedByClubOrLabel(club),
  });
  const partnershipCount = await db.partnership.count({
    where: { clubId: club.id },
  });
  const soloTeamCount = await db.soloTeam.count({
    where: { clubId: club.id },
  });
  return {
    memberCount,
    clubAccountCount,
    competitionCount,
    partnershipCount,
    soloTeamCount,
  };
}

export function isClubEmpty(usage: ClubUsage): boolean {
  return Object.values(usage).every((n) => n === 0);
}
