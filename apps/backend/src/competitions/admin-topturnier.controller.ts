import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { StoreReviewRead } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import {
  ListTopTurnierCompetitionsQueryDto,
  TopTurnierCompetitionsDto,
  TopTurnierIndexStatusDto,
} from "./dto/topturnier-index.dto";
import { CompetitionTopTurnierIndexQueryService } from "./services/competition-topturnier-index-query.service";

/**
 * TEMPORARY (#801, with #787): the list of recent competitions of the
 * TopTurnier site, for the back-office. Remove with the URL import once the
 * FFD gives access to its results data (#651).
 *
 * Guards and roles on the CLASS: STAFF and ADMIN only, never impersonated.
 * The store-review account (ADMIN) gets empty answers (not on the read
 * allowlist), so it never triggers a request to the site.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard)
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller("admin/topturnier")
export class AdminTopTurnierController {
  constructor(private readonly index: CompetitionTopTurnierIndexQueryService) {}

  @StoreReviewRead(() => ({ enabled: false }))
  @Get("status")
  @ApiOperation({
    summary:
      "TEMPORAIRE — la liste des compétitions récentes TopTurnier est-elle disponible ?",
    description:
      "Lit seulement la configuration (drapeau TOPTURNIER_URL_IMPORT_ENABLED, site dans TOPTURNIER_ALLOWED_HOSTS) : aucune requête vers le site. Sert au back-office à afficher ou masquer la page.",
  })
  @ApiResponse({ status: 200, type: TopTurnierIndexStatusDto })
  status(): TopTurnierIndexStatusDto {
    return { enabled: this.index.isAvailable() };
  }

  @StoreReviewRead(() => ({ years: [], items: [], truncated: false }))
  @Get("competitions")
  @UseGuards(ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  @ApiOperation({
    summary:
      "TEMPORAIRE — compétitions récentes du site TopTurnier, rapprochées de celles de l'app",
    description:
      "Solution temporaire (#801, avec #787) en attendant un accès aux données de la FFD (#651). STAFF et ADMIN, jamais en « connecté en tant que », à la demande uniquement : chaque appel lit au plus 2 pages publiques (année en cours et précédente, ou l'année demandée) de chairperson.ddsbagnols.com, jamais planifié, préchargé ni mis en cache. Désactivé sauf `TOPTURNIER_URL_IMPORT_ENABLED=true` et le site dans `TOPTURNIER_ALLOWED_HOSTS` (404 sinon). Mêmes protections réseau que l'import par adresse (https, contrôle des adresses, redirections dans la liste, espacement, disjoncteur, délai, taille) et même verrou par site (409 pendant un import depuis ce site). Rapprochement explicite : même jour ET même lieu (ville du dossier de l'export ou début du titre contre ville, lieu ou titre de la compétition) ; une seule compétition → MATCHED, plusieurs → AMBIGUOUS (à choisir), aucune → NONE. L'import reste `POST /competitions/:id/results/import/topturnier-url` (essai à blanc puis import).",
  })
  @ApiResponse({ status: 200, type: TopTurnierCompetitionsDto })
  @ApiResponse({
    status: 400,
    description: "Année hors de l'année en cours et de la précédente",
  })
  @ApiResponse({
    status: 403,
    description:
      "Réservé au staff et aux admins, hors « connecté en tant que »",
  })
  @ApiResponse({ status: 404, description: "Fonction désactivée" })
  @ApiResponse({
    status: 409,
    description: "Un import ou une lecture de ce site est déjà en cours",
  })
  @ApiResponse({ status: 429, description: "Trop de lectures" })
  @ApiResponse({ status: 502, description: "Site injoignable ou en erreur" })
  @ApiResponse({
    status: 503,
    description: "Site momentanément coupé par le disjoncteur",
  })
  competitions(
    @Query() query: ListTopTurnierCompetitionsQueryDto,
  ): Promise<TopTurnierCompetitionsDto> {
    return this.index.list(query.year);
  }
}
