// apps/backend/src/clubs/clubs.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import {
  type LegacyClubResolution,
  resolveActiveClubByName,
} from "../competitions/competition-organizer";
import { userRolesClubSelect } from "../utils/prisma-selects";
import { PrismaService } from "./../prisma/prisma.service";

/** Refusals of a club account whose club cannot be determined (#743). */
export const CLUB_ACCOUNT_UNRESOLVED_MESSAGES: Readonly<
  Record<Exclude<LegacyClubResolution["kind"], "match"> | "noName", string>
> = {
  noName:
    "Ce compte club n'est rattaché à aucun club. Contactez la fédération pour le rattacher.",
  none: "Aucun club ne correspond au nom de ce compte club. Contactez la fédération pour le rattacher.",
  ambiguous:
    "Plusieurs clubs portent le nom de ce compte club. Contactez la fédération pour le rattacher au bon club.",
  disabled: "Le club de ce compte est désactivé. Contactez la fédération.",
};

@Injectable()
export class ClubsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retourne l'ID du club de l'organisateur (CLUB role). Lance si pas de club.
   */
  async getClubIdForOrganizer(
    organizerUserId: string,
    notClubMessage = "Only club role can manage club data",
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!user) throw new NotFoundException("User not found");
    if (!hasRole(user, UserRole.CLUB)) {
      throw new BadRequestException(notClubMessage);
    }
    return this.clubIdOfClubAccount(user);
  }

  /**
   * The club a club account administers (#743). A linked account is its
   * `clubId` (the foreign key guarantees the club exists). A legacy account
   * without `clubId` is resolved by its name to the ONE active club it
   * designates — the same rule as the organiser rights (`organizerActorOf`).
   * No club, homonyms or a disabled club → 400: nothing is guessed, and no
   * club is ever created from `User.clubName`.
   */
  async clubIdOfClubAccount(user: {
    clubId: string | null;
    clubName: string | null;
  }): Promise<string> {
    if (user.clubId) return user.clubId;
    if (!user.clubName?.trim()) {
      throw new BadRequestException(CLUB_ACCOUNT_UNRESOLVED_MESSAGES.noName);
    }
    const resolved = await resolveActiveClubByName(this.prisma, user.clubName);
    if (resolved.kind === "match") return resolved.clubId;
    throw new BadRequestException(
      CLUB_ACCOUNT_UNRESOLVED_MESSAGES[resolved.kind],
    );
  }
}
