// apps/backend/src/clubs/clubs-helloasso.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ClubRegistrationMode, UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import { SecretDecryptionError } from "../common/crypto/secret-cipher";
import { SecretCipherService } from "../common/crypto/secret-cipher.service";
import { clubHelloAssoSecretContext } from "../common/crypto/secret-contexts";
import {
  clubHelloAssoCredentialsSelect,
  clubHelloAssoStatusSelect,
  clubIdNameSelect,
  competitionOrganizerSelect,
  userRolesClubSelect,
} from "../utils/prisma-selects";
import { resolveOrganizerClubId } from "../competitions/competition-organizer";
import { PrismaService } from "../prisma/prisma.service";
import { ClubsService } from "./clubs.service";
import type { ConnectHelloAssoDto } from "./dto/connect-helloasso.dto";

@Injectable()
export class ClubsHelloAssoService {
  private readonly logger = new Logger(ClubsHelloAssoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clubsService: ClubsService,
    private readonly secretCipher: SecretCipherService,
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
      ? await this.prisma.club.findUnique({
          where: { id: user.clubId },
          select: clubHelloAssoStatusSelect,
        })
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
      ? await this.prisma.club.findUnique({
          where: { id: user.clubId },
          select: clubIdNameSelect,
        })
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
        // Encrypted at rest (#389); plaintext only while no key is configured.
        helloAssoClientSecret: this.secretCipher.encrypt(
          dto.clientSecret,
          clubHelloAssoSecretContext(club.id),
        ),
        helloAssoOrgSlug: dto.organizationSlug,
      },
    });

    return {
      clubName: club.name,
      helloAssoConnected: true,
    };
  }

  /**
   * Récupère les identifiants HelloAsso du club organisateur d'une compétition
   * (`organizerClubId`, repli sur le libellé tant que la ligne n'est pas reliée,
   * jamais sur un nom ambigu — #408). Utilisé par le flux de paiement.
   */
  async getHelloAssoCredentialsForCompetition(competitionId: string): Promise<{
    clientId: string;
    clientSecret: string;
    organizationSlug: string;
  } | null> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionOrganizerSelect,
    });
    if (!competition) return null;
    const clubId = await resolveOrganizerClubId(this.prisma, competition);
    if (!clubId) return null;

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: clubHelloAssoCredentialsSelect,
    });
    if (
      !club?.helloAssoClientId ||
      !club.helloAssoClientSecret ||
      !club.helloAssoOrgSlug
    ) {
      return null;
    }

    let clientSecret: string;
    let needsReEncryption: boolean;
    try {
      ({ plaintext: clientSecret, needsReEncryption } =
        this.secretCipher.decrypt(
          club.helloAssoClientSecret,
          clubHelloAssoSecretContext(club.id),
        ));
    } catch (error) {
      // Never log the stored value. Without readable credentials the club is
      // treated as not connected (same as before it connected HelloAsso).
      this.logger.error(
        `HelloAsso secret of club ${club.id} could not be decrypted: ${
          error instanceof SecretDecryptionError
            ? error.message
            : "unexpected error"
        }`,
      );
      return null;
    }
    if (needsReEncryption) {
      await this.reEncryptSecret(
        club.id,
        club.helloAssoClientSecret,
        clientSecret,
      );
    }

    return {
      clientId: club.helloAssoClientId,
      clientSecret,
      organizationSlug: club.helloAssoOrgSlug,
    };
  }

  /**
   * Lazy migration (#389): rewrites a legacy plaintext secret (or one
   * encrypted with the previous key) with the current key. Compare-and-set on
   * the stored value so a concurrent `connectHelloAsso` is never overwritten.
   * Best effort: a failure is logged and never breaks the payment flow.
   */
  private async reEncryptSecret(
    clubId: string,
    storedValue: string,
    plaintext: string,
  ): Promise<void> {
    try {
      await this.prisma.club.updateMany({
        where: { id: clubId, helloAssoClientSecret: storedValue },
        data: {
          helloAssoClientSecret: this.secretCipher.encrypt(
            plaintext,
            clubHelloAssoSecretContext(clubId),
          ),
        },
      });
    } catch (error) {
      this.logger.warn(
        // Error name only: a Prisma error message can echo the query
        // arguments, i.e. the secret.
        `HelloAsso secret of club ${clubId} could not be re-encrypted (${
          error instanceof Error ? error.name : "unknown error"
        })`,
      );
    }
  }
}
