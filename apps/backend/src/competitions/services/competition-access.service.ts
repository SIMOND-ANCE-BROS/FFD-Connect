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
import {
  CompetitionOrganizerRef,
  findClubIdByName,
  organizerActorOf,
  organizerMatcher,
} from "../competition-organizer";

/** The authenticated caller, as set on `req.user` by the JWT strategy. */
export interface CompetitionActor {
  userId: string;
  role: string;
  roles?: readonly UserRole[];
}

/** Organising club stamped on a competition created by a CLUB account. */
export interface NewCompetitionOrganizer {
  /** Display label (the club's name). */
  organizer: string;
  /** Link to the club (#408); null only for an unresolvable legacy account. */
  organizerClubId: string | null;
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
   * Publishing or removing a competition's results (#690), which name third
   * parties: STAFF and ADMIN on any competition; a CLUB account only when it
   * is LINKED to an active club (`clubId`, club not disabled) and that club is
   * the one the competition resolves to (`organizerClubId`, or the one club
   * its label names). Stricter than `assertCanManageCompetition`: never the
   * legacy match of an unlinked account on a club name.
   */
  async assertCanManageResults(
    competitionId: string,
    actor: CompetitionActor,
  ): Promise<void> {
    return this.assertOrganizerOrStaff(competitionId, actor, {
      requireActiveClubLink: true,
    });
  }

  /**
   * Organizer to stamp on a competition created through the API: `undefined`
   * for STAFF/ADMIN (unchanged behaviour), the caller's club for a CLUB
   * account — its name as label and its id as link (#408) — so it can edit
   * its competition afterwards and cannot create one on behalf of another
   * club. A CLUB account without a club is refused. A legacy account without
   * `clubId` is linked to the club its name unambiguously designates, if any.
   */
  async organizerForNewCompetition(
    actor: CompetitionActor,
  ): Promise<NewCompetitionOrganizer | undefined> {
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
    const organizerClubId =
      user.clubId ?? (await findClubIdByName(this.prisma, clubName));
    return { organizer: clubName, organizerClubId };
  }

  private isStaffOrAdmin(actor: CompetitionActor): boolean {
    const subject = { roles: actor.roles ?? rolesOf({ role: actor.role }) };
    return hasRole(subject, UserRole.STAFF) || hasRole(subject, UserRole.ADMIN);
  }

  /**
   * Organiser check (#408). An unlinked competition seen by a linked account
   * is resolved to the ONE club its label names: a label shared by homonym
   * clubs (same name up to case) grants nobody — never a case-insensitive
   * name match that would let both homonyms in. A linked competition is
   * matched on ids only, a legacy account being resolved to its club first
   * (`organizerActorOf`, #625). Shares `organizerMatcher` with the club list
   * and the `isOrganizedByMyClub` flag, so they agree.
   */
  private async isOrganizer(
    competition: CompetitionOrganizerRef,
    user: {
      clubId: string | null;
      clubName: string | null;
      club: { name: string } | null;
    },
  ): Promise<boolean> {
    const isMine = await organizerMatcher(
      this.prisma,
      [competition],
      await organizerActorOf(this.prisma, user),
    );
    return isMine(competition);
  }

  private async assertOrganizerOrStaff(
    competitionId: string,
    actor: CompetitionActor,
    options: { requireActiveClubLink?: boolean } = {},
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
    const unlinked =
      options.requireActiveClubLink === true &&
      (!user?.clubId || user.club?.disabledAt !== null);
    if (
      !user ||
      unlinked ||
      !hasRole(user, UserRole.CLUB) ||
      !(await this.isOrganizer(competition, user))
    ) {
      throw new ForbiddenException(
        "Réservé aux organisateurs de la compétition",
      );
    }
  }
}
