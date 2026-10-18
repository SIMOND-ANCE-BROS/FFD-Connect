import { BadRequestException, Injectable } from "@nestjs/common";
import { PartnershipStatus, Prisma, UserRole } from "@prisma/client";
import { hasRole, withActiveRole } from "../auth/roles";
import { withDerivedCompetitionLevel } from "../common/competition-level";
import {
  competitionLevelsSelect,
  userRolesClubSelect,
} from "../utils/prisma-selects";
import { PrismaService } from "../prisma/prisma.service";
import { clubMembersScopeOf } from "../competitions/competition-organizer";
import { ClubsService } from "./clubs.service";

@Injectable()
export class PartnershipQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getPartnerships(organizerUserId: string, activeOnly = true) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    const where: {
      endDate?: null;
      OR?: { clubId?: string; secondaryClubId?: string }[];
    } = {
      OR: [{ clubId }, { secondaryClubId: clubId }],
    };
    if (activeOnly) where.endDate = null;
    const partnerships = await this.prisma.partnership.findMany({
      where,
      include: {
        user1: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        user2: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        secondaryClub: { select: { id: true, name: true } },
      },
      orderBy: [{ endDate: "asc" }, { startDate: "desc" }],
      take: 200,
    });
    return { partnerships, myClubId: clubId };
  }

  async getClubsForPartnership(organizerUserId: string) {
    const clubId =
      await this.clubsService.getClubIdForOrganizer(organizerUserId);
    return this.prisma.club.findMany({
      where: { id: { not: clubId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    });
  }

  async getMembersForPartnership(
    organizerUserId: string,
    secondaryClubId?: string,
  ) {
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!organizer || !hasRole(organizer, UserRole.CLUB)) {
      throw new BadRequestException("Only club role can manage club data");
    }

    // The account's club, by id (#749): a legacy account resolving to no
    // single active club (homonyms…) lists nobody — never a bare name match.
    const scope = await clubMembersScopeOf(this.prisma, organizer);
    if (!scope) return [];

    const orConditions: Prisma.UserWhereInput[] = [scope.members];
    if (secondaryClubId && secondaryClubId !== scope.clubId) {
      orConditions.push({ clubId: secondaryClubId });
    }

    const members = await this.prisma.user.findMany({
      where: {
        AND: [withActiveRole(UserRole.LICENSEE), { OR: orConditions }],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        category: true,
        ageGroup: true,
        ...competitionLevelsSelect,
        clubName: true,
        passportLevelLatin: true,
        passportLevelStandard: true,
        license: {
          select: {
            number: true,
            validUntil: true,
          },
        },
      },
      orderBy: { lastName: "asc" },
      take: 500,
    });

    const seen = new Set<string>();
    const deduped = members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const valid = deduped.filter(
      (m) => m.firstName.trim().length > 0 && m.lastName.trim().length > 0,
    );

    if (valid.length === 0) {
      return [];
    }

    const memberIds = valid.map((m) => m.id);
    const activePartnerships = await this.prisma.partnership.findMany({
      where: {
        endDate: null,
        status: {
          in: [PartnershipStatus.ACTIVE, PartnershipStatus.PENDING_SECOND_CLUB],
        },
        OR: [{ user1Id: { in: memberIds } }, { user2Id: { in: memberIds } }],
      },
      select: { user1Id: true, user2Id: true },
    });

    const busyIds = new Set<string>();
    for (const p of activePartnerships) {
      busyIds.add(p.user1Id);
      busyIds.add(p.user2Id);
    }

    // Deprecated single level derived for older app versions (#239).
    return valid
      .filter((m) => !busyIds.has(m.id))
      .map((m) => withDerivedCompetitionLevel(m));
  }
}
