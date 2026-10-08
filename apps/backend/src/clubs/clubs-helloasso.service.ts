// apps/backend/src/clubs/clubs-helloasso.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClubRegistrationMode, UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import { userRolesClubSelect } from "../utils/prisma-selects";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import type { ConnectHelloAssoDto } from "./dto/connect-helloasso.dto";

@Injectable()
export class ClubsHelloAssoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
  ) {}

  async getMyClubHelloAssoStatus(organizerUserId: string): Promise<{
    clubName: string;
    helloAssoConnected: boolean;
    organizationSlug: string | null;
    registrationMode: ClubRegistrationMode;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (!hasRole(user, UserRole.CLUB)) {
      throw new BadRequestException(
        "Only organizers can manage club HelloAsso",
      );
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : user.clubName?.trim()
        ? await this.clubsService.findOrCreateByName(user.clubName)
        : null;
    if (!club) {
      throw new BadRequestException(
        "Organizer has no club assigned. Set clubName on your profile first.",
      );
    }
    const helloAssoConnected = !!(
      club.helloAssoClientId &&
      club.helloAssoClientSecret &&
      club.helloAssoOrgSlug
    );

    return {
      clubName: club.name,
      helloAssoConnected,
      organizationSlug: helloAssoConnected ? club.helloAssoOrgSlug : null,
      registrationMode: club.registrationMode,
    };
  }

  /**
   * Récupère le mode d'inscription du club d'un utilisateur (par clubId ou clubName).
   * Retourne MEMBERS_AUTO_CONFIRM si l'utilisateur n'a pas de club ou si le club n'existe pas encore.
   */
  async getRegistrationModeForUser(
    userId: string,
  ): Promise<ClubRegistrationMode> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { clubId: true, clubName: true },
    });
    if (!user) {
      return ClubRegistrationMode.MEMBERS_AUTO_CONFIRM;
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({
          where: { id: user.clubId },
          select: { registrationMode: true },
        })
      : user.clubName?.trim()
        ? await this.prisma.club.findFirst({
            where: {
              name: { equals: user.clubName.trim(), mode: "insensitive" },
            },
            select: { registrationMode: true },
          })
        : null;
    return club?.registrationMode ?? ClubRegistrationMode.MEMBERS_AUTO_CONFIRM;
  }

  /**
   * Met à jour le mode d'inscription du club de l'organisateur.
   */
  async setRegistrationMode(
    organizerUserId: string,
    mode: ClubRegistrationMode,
  ): Promise<{ clubName: string; registrationMode: ClubRegistrationMode }> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (!hasRole(user, UserRole.CLUB)) {
      throw new BadRequestException(
        "Only organizers can set club registration mode",
      );
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : user.clubName?.trim()
        ? await this.clubsService.findOrCreateByName(user.clubName)
        : null;
    if (!club) {
      throw new BadRequestException(
        "Organizer has no club assigned. Set clubName on your profile first.",
      );
    }
    const updated = await this.prisma.club.update({
      where: { id: club.id },
      data: { registrationMode: mode },
    });
    return {
      clubName: updated.name,
      registrationMode: updated.registrationMode,
    };
  }

  /**
   * Connecte ou met à jour le compte HelloAsso du club de l'organisateur.
   */
  async connectHelloAsso(
    organizerUserId: string,
    dto: ConnectHelloAssoDto,
  ): Promise<{ clubName: string; helloAssoConnected: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: userRolesClubSelect,
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    if (!hasRole(user, UserRole.CLUB)) {
      throw new BadRequestException("Only organizers can connect HelloAsso");
    }
    const club = user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : user.clubName?.trim()
        ? await this.clubsService.findOrCreateByName(user.clubName)
        : null;
    if (!club) {
      throw new BadRequestException(
        "Organizer has no club assigned. Set clubName on your profile first.",
      );
    }
    await this.prisma.club.update({
      where: { id: club.id },
      data: {
        helloAssoClientId: dto.clientId,
        helloAssoClientSecret: dto.clientSecret,
        helloAssoOrgSlug: dto.organizationSlug,
      },
    });

    return {
      clubName: club.name,
      helloAssoConnected: true,
    };
  }

  /**
   * Récupère les identifiants HelloAsso du club associé à une compétition (via organizer).
   * Utilisé par le flux de paiement.
   */
  async getHelloAssoCredentialsForCompetition(competitionId: string): Promise<{
    clientId: string;
    clientSecret: string;
    organizationSlug: string;
  } | null> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: { organizer: true },
    });
    if (!competition?.organizer?.trim()) {
      return null;
    }

    const club = await this.prisma.club.findFirst({
      where: {
        name: { equals: competition.organizer.trim(), mode: "insensitive" },
      },
    });
    if (
      !club?.helloAssoClientId ||
      !club.helloAssoClientSecret ||
      !club.helloAssoOrgSlug
    ) {
      return null;
    }

    return {
      clientId: club.helloAssoClientId,
      clientSecret: club.helloAssoClientSecret,
      organizationSlug: club.helloAssoOrgSlug,
    };
  }
}
