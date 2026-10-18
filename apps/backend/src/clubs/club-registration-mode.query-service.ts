import { Injectable } from "@nestjs/common";
import { ClubRegistrationMode } from "@prisma/client";
import { findClubIdByName } from "../competitions/competition-organizer";
import { PrismaService } from "../prisma/prisma.service";
import {
  clubRegistrationModeSelect,
  userClubRefSelect,
} from "../utils/prisma-selects";

/**
 * The registration mode of the connected user's club (#665), read on its own
 * rather than through the HelloAsso status: it is a club setting, whatever
 * the payment connector. Used by the club settings (club account) and by the
 * « S'inscrire » button (licensee).
 */
@Injectable()
export class ClubRegistrationModeQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The mode of the user's club: by `clubId`, else (legacy account) the ONE
   * club its name designates. `null` when there is no such club (no club,
   * unknown name, homonyms): never another club's setting.
   */
  async getMyClubRegistrationMode(
    userId: string,
  ): Promise<ClubRegistrationMode | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userClubRefSelect,
    });
    if (!user) return null;
    const clubId =
      user.clubId ?? (await findClubIdByName(this.prisma, user.clubName));
    if (!clubId) return null;
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: clubRegistrationModeSelect,
    });
    return club?.registrationMode ?? null;
  }
}
