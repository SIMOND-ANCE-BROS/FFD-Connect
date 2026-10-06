import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, RegistrationStatus, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { computeSoloAgeGroup, getReferenceYear } from "../common/age-group";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import {
  deviceTokenExportSelect,
  licenseRenewalDocumentFileSelect,
  notificationPreferenceExportSelect,
} from "../utils/prisma-selects";

/**
 * Borne de la lecture des documents de renouvellement à purger : un brouillon
 * porte au plus un document par type, quelques demandes par saison.
 */
export const MAX_RENEWAL_DOCUMENTS_TO_PURGE = 200;

/** Champs de base récupérés pour tout utilisateur. */
const USER_BASE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  category: true,
  ageGroup: true,
  competitionLevel: true,
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
}): {
  min: string;
  nationality?: string | null;
  licenseType?: string | null;
  ageGroup?: string | null;
  expiresOn?: string | null;
} | null {
  if (!user.wdsfMin?.trim()) return null;
  return {
    min: user.wdsfMin.trim(),
    nationality: user.wdsfNationality ?? null,
    licenseType: user.wdsfLicenseType ?? null,
    ageGroup: user.wdsfAgeGroup ?? null,
    expiresOn: user.wdsfExpiresOn ? user.wdsfExpiresOn.toISOString() : null,
  };
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private renewalDocumentFiles: RenewalDocumentFileCleaner,
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
      select: { role: true, clubId: true, clubName: true },
    });

    if (organizer?.role !== UserRole.CLUB) {
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
          role: UserRole.LICENSEE,
        },
      }),
      this.prisma.user.findMany({
        where: {
          ...sameClubCondition,
          role: UserRole.LICENSEE, // Only fetch dancers/members
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
        birthDate: true,
        nationalRanking: true,
        license: {
          select: {
            id: true,
            number: true,
            validUntil: true,
            category: true,
            clubName: true,
            qrCodeSignature: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        // Exclure le password explicitement
      },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const wdsf = buildWdsfFromUser(user);
    return { ...user, wdsf };
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

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        wdsfMin: data.min.trim(),
        wdsfNationality: data.nationality?.trim() ?? null,
        wdsfLicenseType: data.licenseType?.trim() ?? null,
        wdsfAgeGroup: data.ageGroup?.trim() ?? null,
        wdsfExpiresOn: expiresOnDate,
      },
    });
    return this.findOne(userId);
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
      },
    });
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable");
    }
    return {
      format: "ffd-connect-export-v1",
      exportedAt: new Date().toISOString(),
      data: user,
    };
  }

  /**
   * Droit à l'oubli (RGPD art. 17) + exigence Apple 5.1.1(v) : suppression
   * de compte in-app. Le mot de passe courant est vérifié (un token volé ne
   * suffit pas), puis tout est supprimé en transaction.
   *
   * Cascades Prisma (schéma) : refreshTokens, passwordResetTokens,
   * deviceTokens, notificationPrefs, partnerships, soloTeamMemberships,
   * licenseRenewalRequests (et leurs licenseRenewalDocuments).
   * SetNull : licence (reste propriété fédération), tracks soumis.
   * Inscriptions d'autrui en tant que partenaire : anonymisées explicitement
   * (partnerUserId ET partnerName, copie du nom complet → null ; null est
   * déjà géré partout à l'affichage).
   * Suppressions explicites (FK sans onDelete → RESTRICT) : registrations,
   * seatBookings, notifications ; bugReports (userId sans FK).
   * ImpersonationLog est conservé (piste d'audit).
   *
   * Fichiers des documents de renouvellement (certificat médical — donnée de
   * santé, RGPD art. 9 — et certificat de licence) : leurs références sont
   * lues AVANT la transaction (la cascade efface les lignes), puis les
   * fichiers sont supprimés APRÈS son succès (en parallèle). Cette purge est
   * best-effort : un échec n'annule pas la suppression du compte (déjà
   * effective en base) ; il est remonté en erreur + Sentry (référence du
   * fichier uniquement) pour nettoyage manuel (RenewalDocumentFileCleaner).
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
    const documents = await this.prisma.licenseRenewalDocument.findMany({
      where: { request: { userId } },
      select: licenseRenewalDocumentFileSelect,
      take: MAX_RENEWAL_DOCUMENTS_TO_PURGE,
    });
    if (documents.length === MAX_RENEWAL_DOCUMENTS_TO_PURGE) {
      // Plafond atteint : des fichiers au-delà resteraient orphelins en
      // stockage. Pas d'identifiant utilisateur dans le log.
      this.logger.warn(
        `Account deletion: renewal document read hit the ${MAX_RENEWAL_DOCUMENTS_TO_PURGE} cap — remaining files may be orphaned, run scripts/list-orphan-renewal-blobs.ts`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.seatBooking.deleteMany({ where: { userId } }),
      this.prisma.registration.deleteMany({ where: { userId } }),
      // Inscriptions d'autrui où l'utilisateur est partenaire : la FK passerait
      // en SetNull, mais partnerName garde une copie de son nom complet.
      this.prisma.registration.updateMany({
        where: { partnerUserId: userId },
        data: { partnerUserId: null, partnerName: null },
      }),
      // BugReport.userId n'a pas de FK (report.prisma) : suppression explicite.
      this.prisma.bugReport.deleteMany({ where: { userId } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
    await this.renewalDocumentFiles.deleteFiles(
      documents.map((d) => d.filePath),
      "account-deletion",
    );
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
