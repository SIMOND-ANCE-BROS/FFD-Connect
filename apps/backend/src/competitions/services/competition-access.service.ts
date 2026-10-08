import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { hasRole, rolesOf } from "../../auth/roles";
import { PrismaService } from "../../prisma/prisma.service";
import {
  competitionOrganizerSelect,
  userRolesClubNameSelect,
} from "../../utils/prisma-selects";
import { isOrganizedByClub } from "../competition-organizer";

/** The authenticated caller, as set on `req.user` by the JWT strategy. */
export interface CompetitionActor {
  userId: string;
  role: string;
  roles?: readonly UserRole[];
}

/** Access rules on a single competition (reads only, never writes). */
@Injectable()
export class CompetitionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check-in operations (scanner, volunteer links): STAFF and ADMIN on any
   * competition, a CLUB account only on a competition its club organizes.
   */
  async assertCanManageCheckIn(
    competitionId: string,
    actor: CompetitionActor,
  ): Promise<void> {
    const roles = actor.roles ?? rolesOf({ role: actor.role });
    if (roles.includes(UserRole.STAFF) || roles.includes(UserRole.ADMIN)) {
      return;
    }

    const [competition, user] = await Promise.all([
      this.prisma.competition.findUnique({
        where: { id: competitionId },
        select: competitionOrganizerSelect,
      }),
      this.prisma.user.findUnique({
        where: { id: actor.userId },
        select: userRolesClubNameSelect,
      }),
    ]);
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }
    if (
      !user ||
      !hasRole(user, UserRole.CLUB) ||
      !isOrganizedByClub(competition.organizer, [
        user.clubName,
        user.club?.name,
      ])
    ) {
      throw new ForbiddenException(
        "Réservé aux organisateurs de la compétition",
      );
    }
  }
}
