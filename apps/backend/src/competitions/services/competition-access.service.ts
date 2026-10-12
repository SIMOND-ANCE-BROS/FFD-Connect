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

/** Access rules on competitions (reads only, never writes). */
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
    return this.assertOrganizerOrStaff(competitionId, actor);
  }

  /**
   * Editing a competition (details, seat layout and its `priceCents`, which
   * the HelloAsso checkout charges, #381): same rule as check-in — STAFF and
   * ADMIN on any competition, a CLUB account only on a competition its club
   * organizes.
   */
  async assertCanManageCompetition(
    competitionId: string,
    actor: CompetitionActor,
  ): Promise<void> {
    return this.assertOrganizerOrStaff(competitionId, actor);
  }

  /**
   * Organizer to stamp on a competition created through the API: `undefined`
   * for STAFF/ADMIN (unchanged behaviour), the caller's club name for a CLUB
   * account — so it can edit its competition afterwards and cannot create one
   * on behalf of another club. A CLUB account without a club is refused.
   */
  async organizerForNewCompetition(
    actor: CompetitionActor,
  ): Promise<string | undefined> {
    if (this.isStaffOrAdmin(actor)) return undefined;

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: userRolesClubNameSelect,
    });
    const clubName = (user?.club?.name ?? user?.clubName)?.trim();
    if (!user || !hasRole(user, UserRole.CLUB) || !clubName) {
      throw new ForbiddenException(
        "Seul un compte club rattaché à un club peut créer une compétition",
      );
    }
    return clubName;
  }

  private isStaffOrAdmin(actor: CompetitionActor): boolean {
    const subject = { roles: actor.roles ?? rolesOf({ role: actor.role }) };
    return hasRole(subject, UserRole.STAFF) || hasRole(subject, UserRole.ADMIN);
  }

  private async assertOrganizerOrStaff(
    competitionId: string,
    actor: CompetitionActor,
  ): Promise<void> {
    if (this.isStaffOrAdmin(actor)) return;

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
