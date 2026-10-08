import { Injectable, NotFoundException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { withActiveRole } from "../auth/roles";
import { PrismaService } from "../prisma/prisma.service";
import { CareerQueryService } from "./career-query.service";

export type {
  CareerPartnership,
  CareerRegistration,
  CareerResult,
  CareerResponse,
  CareerSearchMember,
} from "./career.types";

@Injectable()
export class CareerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly careerQueryService: CareerQueryService,
  ) {}

  private readonly SEARCH_MEMBERS_LIMIT = 20;

  /**
   * Recherche des licenciés (par nom/prénom) pour consulter leur carrière.
   *
   * Recherche GLOBALE : tout utilisateur authentifié peut chercher parmi TOUS
   * les licenciés, sans restriction de club. Les palmarès/résultats de
   * compétition sont publics, donc consultables par tous. Min 2 caractères.
   */
  async searchMembers(_requesterUserId: string, query: string) {
    const q = query.trim();
    if (!q || q.length < 2) return [];

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          withActiveRole(UserRole.LICENSEE),
          {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { lastName: { contains: q, mode: "insensitive" as const } },
            ],
          },
        ],
      },
      take: this.SEARCH_MEMBERS_LIMIT,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        clubName: true,
      },
    });

    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      clubName: u.clubName,
    }));
  }

  /**
   * Récupère la carrière d'un utilisateur par son ID (pour consultation par un autre rôle).
   * Lance NotFoundException si l'utilisateur n'existe pas.
   */
  async getCareerForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("Utilisateur non trouvé");
    return this.getMyCareer(userId);
  }

  /**
   * Récupère la carrière du licencié : partenariats, inscriptions aux compétitions, et résultats.
   */
  async getMyCareer(userId: string) {
    const [partnerships, registrations] = await Promise.all([
      this.careerQueryService.getPartnershipsForUser(userId),
      this.careerQueryService.getRegistrationsWithCompetition(userId),
    ]);

    const results = await this.careerQueryService.getResultsForUser(
      userId,
      registrations,
    );

    return { partnerships, registrations, results };
  }
}
