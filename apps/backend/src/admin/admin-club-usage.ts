import { Prisma, UserRole } from "@prisma/client";

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
    where: { clubId: club.id, role: { not: UserRole.CLUB } },
  });
  const clubAccountCount = await db.user.count({
    where: { clubId: club.id, role: UserRole.CLUB },
  });
  // Competition.organizer holds a copy of the club name, not an id.
  const competitionCount = await db.competition.count({
    where: { organizer: club.name },
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
