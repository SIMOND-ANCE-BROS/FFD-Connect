import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, RegistrationStatus, UserRole } from "@prisma/client";
import { hasRole, rolesOf, withActiveRole } from "../auth/roles";
import { userRolesClubSelect } from "../utils/prisma-selects";
import * as bcrypt from "bcrypt";
import { computeSoloAgeGroup, getReferenceYear } from "../common/age-group";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { LicenseQrService } from "../licenses/qr/license-qr.service";
import { AppleWalletPassGenerator } from "../licenses/wallet/apple-wallet-pass.generator";
import { PrismaService } from "../prisma/prisma.service";
import { publicTrackName } from "../tracks/track-visibility.util";
import {
  competitionLevelsSelect,
  deviceTokenExportSelect,
  licenseBaseSelect,
  notificationPreferenceExportSelect,
  trackCorrectionExportSelect,
} from "../utils/prisma-selects";
import { WdsfService } from "../wdsf/wdsf.service";
import { resolveWdsfFederation, wdsfNameMatches } from "../wdsf/wdsf.utils";
import { AccountDeletionService } from "./account-deletion.service";

/** Champs de base récupérés pour tout utilisateur. */
const USER_BASE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  category: true,
  ageGroup: true,
  // Per-discipline levels + deprecated single level (kept for older clients).
  ...competitionLevelsSelect,
  clubName: true,
  createdAt: true,
  updatedAt: true,
  passportLevelLatin: true,
  passportLevelStandard: true,
  wdsfMin: true,
  wdsfNationality: true,
  wdsfLicenseType: true,
  wdsfAgeGroup: true,
  wdsfExpiresOn: true,
  wdsfFederation: true,
} satisfies Prisma.UserSelect;

/** Export RGPD : inscriptions avec le contexte compétition/épreuve. */
const EXPORT_REGISTRATION_SELECT = {
  id: true,
  status: true,
  partnerName: true,
  bibNumber: true,
  checkedIn: true,
  feePaid: true,
  coupleAgeGroup: true,
  createdAt: true,
  event: {
    select: {
      category: true,
      ageGroup: true,
      level: true,
      eventType: true,
      competition: { select: { title: true, date: true } },
    },
  },
} satisfies Prisma.RegistrationSelect;

/** Export RGPD : partenariats (sans données du partenaire — RGPD tiers). */
const EXPORT_PARTNERSHIP_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
} satisfies Prisma.PartnershipSelect;

/** Construit l'objet wdsf pour l'API à partir des champs User. */
function buildWdsfFromUser(user: {
  wdsfMin: string | null;
  wdsfNationality: string | null;
  wdsfLicenseType: string | null;
  wdsfAgeGroup: string | null;
  wdsfExpiresOn: Date | null;
  wdsfFederation?: string | null;
}): {
  min: string;
  nationality?: string | null;
  licenseType?: string | null;
  ageGroup?: string | null;
  expiresOn?: string | null;
  federation: string | null;
} | null {
  if (!user.wdsfMin?.trim()) return null;
  return {
    min: user.wdsfMin.trim(),
    nationality: user.wdsfNationality ?? null,
    licenseType: user.wdsfLicenseType ?? null,
    ageGroup: user.wdsfAgeGroup ?? null,
    expiresOn: user.wdsfExpiresOn ? user.wdsfExpiresOn.toISOString() : null,
    // National federation read from WDSF when linked; licenses linked before
    // it was stored fall back on the nationality (France ⇒ FFD).
    federation:
      user.wdsfFederation?.trim() ||
      resolveWdsfFederation(null, user.wdsfNationality) ||
      null,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private accountDeletion: AccountDeletionService,
    private licenseQrService: LicenseQrService,
    private appleWalletPassGenerator: AppleWalletPassGenerator,
    private wdsfService: WdsfService,
  ) {}

  /**
   * Récupère tous les membres d'un club pour un organisateur
   *
   * Cette méthode récupère tous les utilisateurs (dancers) qui appartiennent
   * au même club que l'organisateur spécifié. Elle inclut les informations
   * de licence et les inscriptions de chaque membre, ainsi que le nom du
   * partenaire le plus fréquent pour les danses de couple.
   *
   * @param organizerId - ID de l'organisateur dont on veut récupérer les membres du club
   * @param pagination - Paramètres de pagination
   * @returns Liste paginée des membres du club avec leurs informations, licences et inscriptions
   * @throws NotFoundException si l'organisateur n'existe pas, n'a pas le rôle ORGANIZER, ou n'a pas de club assigné
   *
   * @example
   * ```typescript
   * const members = await usersService.findClubMembers('org-123', { skip: 0, take: 10 });
   * ```
   */
  async findClubMembers(
    organizerId: string,
    pagination: PaginationParamsDto = new PaginationParamsDto(),
  ) {
    const { skip, take } = pagination;

    // 1. Fetch Organizer to get their club (clubId or clubName)
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerId },
      select: userRolesClubSelect,
    });

    if (!organizer || !hasRole(organizer, UserRole.CLUB)) {
      throw new NotFoundException("Organizer not found or invalid role");
    }

    const sameClubCondition = organizer.clubId
      ? { clubId: organizer.clubId }
      : organizer.clubName
        ? { clubName: organizer.clubName }
        : null;
    if (!sameClubCondition) {
      throw new NotFoundException("Organizer has no club assigned");
    }

    // 2. Fetch all users of the same club (by clubId or clubName) with pagination
    const [total, members] = await Promise.all([
      this.prisma.user.count({
        where: {
          ...sameClubCondition,
          ...withActiveRole(UserRole.LICENSEE),
        },
      }),
      this.prisma.user.findMany({
        where: {
          ...sameClubCondition,
          ...withActiveRole(UserRole.LICENSEE), // Only fetch dancers/members
        },
        skip,
        take,
        select: {
          ...USER_BASE_SELECT,
          license: {
            select: {
              number: true,
              validUntil: true,
            },
          },
          registrations: {
            where: {
              status: {
                in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
              },
            },
            select: {
              id: true,
              partnerName: true,
            },
          },
        },
        orderBy: {
          lastName: "asc",
        },
      }),
    ]);

    const membersWithPartner = members.map((member) => {
      let partnerName = undefined;
      if (member.registrations.length > 0) {
        // Count occurances of partner names
        const counts: Record<string, number> = {};
        for (const Reg of member.registrations) {
          if (Reg.partnerName) {
            counts[Reg.partnerName] = (counts[Reg.partnerName] || 0) + 1;
          }
        }
        // Find max
        let max = 0;
        for (const [name, count] of Object.entries(counts)) {
          if (count > max) {
            max = count;
            partnerName = name;
          }
        }
      }
      const { registrations: _, ...rest } = member;
      return {
        ...rest,
        partnerName,
        wdsf: buildWdsfFromUser(member),
      };
    });

    return createPaginatedResponse(
      membersWithPartner,
      total,
      skip ?? 0,
      take ?? 10,
    );
  }

  /**
   * Récupère un utilisateur par son ID
   *
   * Cette méthode récupère les informations d'un utilisateur incluant sa licence.
   * Le mot de passe est automatiquement exclu du résultat pour des raisons de sécurité.
   *
   * @param id - ID de l'utilisateur à récupérer
   * @returns Informations de l'utilisateur (sans mot de passe) avec sa licence
   * @throws NotFoundException si l'utilisateur n'existe pas
   *
   * @example
   * ```typescript
   * const user = await usersService.findOne('user-123');
   * this.logger.log(`Utilisateur: ${user.firstName} ${user.lastName}`);
   * if (user.license) {
   *   this.logger.log(`Licence valide jusqu'au: ${user.license.validUntil}`);
   * }
   * ```
   */
  async findOne(id: string) {
    // Utiliser select au lieu de include pour optimiser la requête
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_BASE_SELECT,
        // Own data only: never in USER_BASE_SELECT, which also feeds the
        // club members list (data minimisation).
        extraRoles: true,
        birthDate: true,
        nationalRanking: true,
        club: { select: { disabledAt: true } },
        license: { select: licenseBaseSelect },
        // Exclure le password explicitement
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // The club status only feeds rolesOf; it must not leak into the payload.
    const { club, ...profile } = user;
    const wdsf = buildWdsfFromUser(profile);
    // Signed QR content of the license (#168) — null when signing is off.
    const license = profile.license
      ? {
          ...profile.license,
          qrCode: this.licenseQrService.buildQrCode(profile.license),
          // The app shows "Add to Apple Wallet" only when true (#162).
          appleWalletAvailable: this.appleWalletPassGenerator.isAvailable(),
        }
      : null;
    return {
      ...profile,
      license,
      roles: rolesOf({ ...profile, club }),
      wdsf,
    };
  }

  /**
   * Met à jour la licence WDSF liée au compte de l'utilisateur (MIN + snapshot).
   * Appelé par le client après une vérification WDSF réussie (GET /wdsf/athlete/:min).
   */
  async updateWdsf(
    userId: string,
    data: {
      min: string;
      nationality?: string | null;
      licenseType?: string | null;
      ageGroup?: string | null;
      expiresOn?: string | null;
    } | null,
  ) {
    if (!data) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          wdsfMin: null,
          wdsfNationality: null,
          wdsfLicenseType: null,
          wdsfAgeGroup: null,
          wdsfExpiresOn: null,
          wdsfFederation: null,
        },
      });
      return this.findOne(userId);
    }

    const expiresOnDate =
      typeof data.expiresOn === "string" && data.expiresOn.trim()
        ? new Date(data.expiresOn)
        : null;
    if (expiresOnDate && Number.isNaN(expiresOnDate.getTime())) {
      throw new Error("Invalid wdsf.expiresOn date");
    }

    const athlete = await this.assertWdsfNameMatchesAccount(
      userId,
      data.min.trim(),
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        wdsfMin: data.min.trim(),
        wdsfNationality: data.nationality?.trim() ?? null,
        wdsfLicenseType: data.licenseType?.trim() ?? null,
        wdsfAgeGroup: data.ageGroup?.trim() ?? null,
        wdsfExpiresOn: expiresOnDate,
        // Read server-side from WDSF, never trusted from the client payload.
        wdsfFederation: athlete.structure?.trim() || null,
      },
    });
    return this.findOne(userId);
  }

  /**
   * Refuse de lier un MIN WDSF dont le titulaire ne porte pas le nom du compte
   * (celui de la licence FFD). Le MIN est relu côté serveur auprès de la WDSF :
   * on ne fait jamais confiance au nom envoyé par le client.
   * Renvoie la fiche WDSF relue (fédération nationale comprise).
   */
  private async assertWdsfNameMatchesAccount(
    userId: string,
    min: string,
  ): Promise<{ structure?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    if (!user) {
      throw new NotFoundException("Utilisateur non trouvé");
    }
    const athlete = await this.wdsfService.getAthleteByMin(min);
    const wdsfName = `${athlete.firstName} ${athlete.lastName}`;
    if (!wdsfNameMatches(wdsfName, user.firstName, user.lastName)) {
      throw new BadRequestException({
        message:
          "Cette licence WDSF n'est pas à votre nom : le nom et le prénom doivent correspondre à ceux de votre licence FFD.",
        code: "WDSF_NAME_MISMATCH",
      });
    }
    return athlete;
  }

  /**
   * Met à jour la classe d'âge du licencié à partir de sa date de naissance
   * (règlement FFDanse Article 5 – Solo, année civile en cours).
   *
   * @param userId - ID de l'utilisateur
   * @param referenceYear - Année de référence (défaut: année en cours)
   * @returns La nouvelle classe d'âge ou null si pas de birthDate
   */
  async updateAgeGroupFromBirthDate(
    userId: string,
    referenceYear?: number,
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { birthDate: true },
    });
    if (!user?.birthDate) return null;
    const year = referenceYear ?? getReferenceYear(null);
    const ageGroup = computeSoloAgeGroup(user.birthDate, year);
    if (!ageGroup) return null;
    await this.prisma.user.update({
      where: { id: userId },
      data: { ageGroup },
    });
    return ageGroup;
  }

  /**
   * Export RGPD (portabilité des données, art. 20) : toutes les données
   * personnelles de l'utilisateur en un seul JSON. Jamais de secrets
   * (password, valeur des tokens) ni de données de tiers (partenaires).
   *
   * Les appareils enregistrés pour le push apparaissent en métadonnées
   * (plateforme, dates) : la donnée personnelle est déclarée, sans exposer la
   * valeur du token FCM qui permettrait de détourner la livraison.
   */
  async exportMyData(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...USER_BASE_SELECT,
        extraRoles: true,
        birthDate: true,
        license: {
          select: {
            number: true,
            category: true,
            clubName: true,
            validUntil: true,
            createdAt: true,
          },
        },
        registrations: {
          select: EXPORT_REGISTRATION_SELECT,
          orderBy: { createdAt: "desc" },
          take: 500,
        },
        partnershipsAsUser1: { select: EXPORT_PARTNERSHIP_SELECT, take: 100 },
        partnershipsAsUser2: { select: EXPORT_PARTNERSHIP_SELECT, take: 100 },
        notifications: {
          select: { title: true, body: true, isRead: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 500,
        },
        // Appareils enregistrés pour les notifications push : un token FCM est
        // un identifiant d'appareil, donc une donnée personnelle au sens de
        // l'art. 15. On exporte les MÉTADONNÉES sans la valeur du token —
        // l'exporter en clair créerait un vecteur de fuite (quiconque connaît un
        // token peut le ré-attribuer à son compte via POST /device-token).
        deviceTokens: {
          select: deviceTokenExportSelect,
          orderBy: { lastSeenAt: "desc" },
          take: 50,
        },
        // Réglages de notification explicitement enregistrés. L'absence de
        // ligne n'est pas une donnée manquante : elle signifie « défaut du
        // catalogue » (cf. notification-catalog.ts), ce que l'export reflète
        // honnêtement en ne listant que les choix réellement exprimés.
        notificationPrefs: {
          select: notificationPreferenceExportSelect,
          orderBy: { updatedAt: "desc" },
          take: 50,
        },
        // Propositions de correction de musiques : le contenu soumis (valeurs,
        // commentaire) et la décision, sans l'identité de l'administrateur.
        trackCorrectionsProposed: {
          select: trackCorrectionExportSelect,
          orderBy: { createdAt: "desc" },
          take: 500,
        },
      },
    });
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    // Nom des pistes visées par les propositions : filtré comme partout côté
    // non-admin. L'export ne doit pas démasquer une piste modérée (titre
    // masqué ou piste blacklistée) que l'utilisateur a pu cibler.
    const { trackCorrectionsProposed, ...rest } = user;
    return {
      format: "ffd-connect-export-v1",
      exportedAt: new Date().toISOString(),
      data: {
        ...rest,
        trackCorrectionsProposed: trackCorrectionsProposed.map(
          ({ track, ...correction }) => ({
            ...correction,
            track: publicTrackName(track),
          }),
        ),
      },
    };
  }

  /**
   * Droit à l'oubli (RGPD art. 17) + exigence Apple 5.1.1(v) : suppression
   * de compte in-app. Le mot de passe courant est vérifié (un token volé ne
   * suffit pas), puis le cœur partagé efface tout (AccountDeletionService).
   */
  async deleteMyAccount(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException("Mot de passe incorrect");
    }
    await this.accountDeletion.deleteAccount(userId);
  }

  /**
   * Recherche d'utilisateurs (admin/staff) pour l'impersonation (#545) :
   * par email, prénom, nom ou numéro de licence. Résultat borné, sans secret.
   */
  async searchUsers(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { license: { number: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        clubName: true,
        license: { select: { number: true } },
      },
      orderBy: { lastName: "asc" },
      take: 20,
    });
  }
}
