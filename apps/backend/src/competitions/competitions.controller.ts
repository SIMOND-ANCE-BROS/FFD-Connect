import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { ThrottleByIp } from "../common/decorators/throttle-by-ip.decorator";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NoImpersonationGuard } from "../auth/no-impersonation.guard";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { CompetitionAccessService } from "./services/competition-access.service";
import { CompetitionManagementService } from "./services/competition-management.service";
import { CompetitionProgramQueryService } from "./services/competition-program-query.service";
import { CompetitionProgramService } from "./services/competition-program.service";
import { CompetitionQueryService } from "./services/competition-query.service";
import { CompetitionRegistrationService } from "./services/competition-registration.service";
import { CompetitionResultsService } from "./services/competition-results.service";
import { CheckInDto, CheckInResponseDto } from "./dto/checkin.dto";
import { CompetitionResultDto } from "./dto/competition-result.dto";
import {
  ApiActiveCompetitionResponse,
  CompetitionDetailDto,
  CompetitionPageDto,
} from "./dto/competition-response.dto";
import {
  CompetitionProgramDto,
  ReplaceCompetitionProgramDto,
} from "./dto/competition-program.dto";
import {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "./dto/competition-management.dto";
import { RegisterEventDto } from "./dto/register-event.dto";
import {
  DeleteEventResultsQueryDto,
  DeleteEventResultsReportDto,
  ImportResultsDto,
  ImportResultsQueryDto,
  ImportResultsReportDto,
  ImportTopTurnierUrlDto,
  TopTurnierImportReportDto,
} from "./dto/results-import.dto";
import { CompetitionResultsImportService } from "./services/competition-results-import.service";
import {
  CompetitionTopTurnierImportService,
  TOPTURNIER_MAX_ARCHIVE_BYTES,
} from "./services/competition-topturnier-import.service";
import { CompetitionTopTurnierUrlImportService } from "./services/competition-topturnier-url-import.service";
import { createMemoryUploadStorage } from "../utils/upload-storage.util";
import { RegisterMemberDto } from "./dto/register-member.dto";
import { UnregisterEventDto } from "./dto/unregister-event.dto";
import { UnregisterMemberDto } from "./dto/unregister-member.dto";
import {
  GenerateVolunteerTokenDto,
  VolunteerCheckInDto,
} from "./dto/volunteer-token.dto";
import {
  StoreReviewOwnData,
  StoreReviewRead,
  StoreReviewReadable,
  StoreReviewSimulation,
} from "../auth/store-review/store-review.decorator";
import {
  simulatedCheckIn,
  simulatedEmptyList,
  simulatedVolunteerToken,
} from "../auth/store-review/store-review-responses";

@ApiTags("competitions")
@ApiCommonErrorResponses()
@Controller("competitions")
export class CompetitionsController {
  constructor(
    private readonly queryService: CompetitionQueryService,
    private readonly registrationService: CompetitionRegistrationService,
    private readonly resultsService: CompetitionResultsService,
    private readonly managementService: CompetitionManagementService,
    private readonly accessService: CompetitionAccessService,
    private readonly programQueryService: CompetitionProgramQueryService,
    private readonly programService: CompetitionProgramService,
    private readonly resultsImportService: CompetitionResultsImportService,
    private readonly topTurnierImportService: CompetitionTopTurnierImportService,
    private readonly topTurnierUrlImportService: CompetitionTopTurnierUrlImportService,
  ) {}

  @StoreReviewReadable()
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: "Récupère toutes les compétitions",
    description:
      "Retourne la liste des compétitions. Public (sans auth) : données de base. Authentifié : inclut les inscriptions de l'utilisateur.",
  })
  @ApiResponse({
    status: 200,
    description: "Liste paginée des compétitions récupérée avec succès",
    type: CompetitionPageDto,
  })
  findAll(
    @Request() req: { user?: { userId: string } },
    @Query() pagination: PaginationParamsDto,
  ) {
    return this.queryService.findAll(req.user?.userId, pagination);
  }

  @Get("active")
  @ApiOperation({
    summary: "Récupère la compétition du jour",
    description:
      "Retourne la première compétition dont la date de début (`date`) tombe aujourd'hui (heure du serveur), avec ses épreuves, ou `null` s'il n'y en a aucune. Pas de 404.",
  })
  @ApiActiveCompetitionResponse()
  findActive() {
    return this.queryService.findActiveCompetition();
  }

  @Post("sync")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Lance la synchronisation des compétitions depuis l'API FFD",
    description:
      "Crée un job de sync en background. Retourne immédiatement avec jobId. Utiliser GET /competitions/sync/status pour suivre la progression. Retourne 409 si une sync est déjà en cours.",
  })
  @ApiResponse({
    status: 202,
    description: "Job de sync créé",
    schema: {
      type: "object",
      properties: { jobId: { type: "string", example: "1" } },
    },
  })
  @ApiResponse({ status: 409, description: "Sync déjà en cours" })
  sync() {
    return this.managementService.enqueueSyncFFD();
  }

  @StoreReviewRead(simulatedEmptyList)
  @Get("club/pending-registrations")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Inscriptions en attente de validation (club)",
    description:
      "Retourne les inscriptions PENDING des membres du club pour les compétitions organisées par le club. Vide si le mode est CLUB_ONLY (à masquer côté client).",
  })
  @ApiResponse({
    status: 200,
    description: "Liste des inscriptions en attente",
  })
  getClubPendingRegistrations(@Request() req: RequestWithUser) {
    return this.queryService.getPendingRegistrationsForClub(req.user.userId);
  }

  @Get("club/mine")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Compétitions organisées par le club du compte",
    description:
      "Compétitions dont l'organisateur est le club du compte (nom comparé sans tenir compte de la casse), de la plus récente à la plus ancienne, 100 au plus. Vide pour un compte sans rôle club actif ou sans club.",
  })
  @ApiResponse({
    status: 200,
    description: "Compétitions du club (champs de base, plan de salle inclus)",
    schema: { type: "array", items: { type: "object" } },
  })
  getClubCompetitions(@Request() req: RequestWithUser) {
    return this.queryService.findOrganizedByClub(req.user.userId);
  }

  @Post("register-member")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Inscrire un membre du club (organisateur)",
    description:
      "Inscrit un licencié du club à un événement. L'inscription est directement confirmée.",
  })
  @ApiBody({ type: RegisterMemberDto })
  @ApiResponse({ status: 201, description: "Inscription créée" })
  @ApiResponse({
    status: 403,
    description:
      "Compétition non organisée par votre club, ou date limite d'inscription dépassée",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 403 },
        message: {
          type: "string",
          example:
            "Les inscriptions à cette compétition sont closes depuis le 15 octobre 2026 à 23:59.",
        },
        error: { type: "string", example: "Forbidden" },
      },
    },
  })
  registerMember(
    @Request() req: RequestWithUser,
    @Body() body: RegisterMemberDto,
  ) {
    return this.registrationService.registerMember(
      req.user.userId,
      body.eventId,
      body.userId,
      body.partnerName,
      {
        coupleAgeGroup: body.coupleAgeGroup,
        coupleDisciplineLatin: body.coupleDisciplineLatin,
        coupleDisciplineStandard: body.coupleDisciplineStandard,
        partnerUserId: body.partnerUserId,
        registrantLevel: body.registrantLevel,
      },
    );
  }

  @Post("unregister-member")
  // Frees a (possibly paid) seat and notifies the member: never from a
  // support session (#761).
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Désinscrire un membre du club (organisateur)",
    description:
      "Désinscrit un licencié du club. Le membre reçoit une notification. " +
      "Refusé (403) pendant un accès support (« se connecter en tant que »).",
  })
  @ApiBody({ type: UnregisterMemberDto })
  @ApiResponse({ status: 200, description: "Désinscription effectuée" })
  @ApiResponse({
    status: 403,
    description: "Compétition non organisée par votre club",
  })
  unregisterMember(
    @Request() req: RequestWithUser,
    @Body() body: UnregisterMemberDto,
  ) {
    return this.registrationService.unregisterMember(
      req.user.userId,
      body.eventId,
      body.userId,
    );
  }

  @Post("registrations/:registrationId/confirm")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Valider une inscription en attente",
    description:
      "Passe une inscription PENDING en CONFIRMED. Réservé à l'organisateur du club.",
  })
  @ApiParam({ name: "registrationId", description: "ID de l'inscription" })
  @ApiResponse({ status: 200, description: "Inscription validée" })
  @ApiResponse({
    status: 403,
    description: "Inscription ne relevant pas de votre club",
  })
  confirmRegistration(
    @Param("registrationId") registrationId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.registrationService.confirmRegistration(
      registrationId,
      req.user.userId,
    );
  }

  @Get("regulation")
  @ApiOperation({
    summary: "Référentiel règlement (Articles 8 et 9)",
    description:
      "Retourne les types de compétition, natures d’épreuves et niveaux pour les inscriptions et la conformité au règlement FFDanse.",
  })
  @ApiResponse({
    status: 200,
    description: "Référentiel récupéré",
    schema: {
      type: "object",
      properties: {
        competitionTypes: { type: "array", items: { type: "string" } },
        eventKinds: { type: "array", items: { type: "string" } },
        competitionLevels: { type: "array", items: { type: "string" } },
      },
    },
  })
  getRegulationConstants() {
    return this.managementService.getRegulationConstants();
  }

  @StoreReviewOwnData()
  @Get("user/registrations")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère les inscriptions de l'utilisateur connecté",
    description:
      "Retourne toutes les inscriptions de l'utilisateur authentifié à différents événements de compétitions.",
  })
  @ApiResponse({
    status: 200,
    description: "Inscriptions récupérées avec succès",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          eventId: { type: "string" },
          eventName: { type: "string" },
          competitionId: { type: "string" },
          competitionName: { type: "string" },
          partnerName: { type: "string", nullable: true },
          status: {
            type: "string",
            enum: ["PENDING", "CONFIRMED", "CANCELLED"],
          },
          registeredAt: { type: "string", format: "date-time" },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé",
  })
  getUserRegistrations(@Request() req: RequestWithUser) {
    return this.resultsService.getUserRegistrations(req.user.userId);
  }

  @StoreReviewRead(simulatedEmptyList)
  @Get("event/:eventId/registrations")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère les inscriptions d'un événement",
    description:
      "Retourne la liste de tous les participants inscrits à un événement spécifique. Nécessite les permissions d'organisateur.",
  })
  @ApiParam({
    name: "eventId",
    description: "ID de l'événement",
    example: "event-456",
  })
  @ApiResponse({
    status: 200,
    description: "Liste des inscriptions récupérée avec succès",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          userId: { type: "string" },
          userName: { type: "string" },
          partnerName: { type: "string", nullable: true },
          status: {
            type: "string",
            enum: ["PENDING", "CONFIRMED", "CANCELLED"],
          },
          checkedIn: { type: "boolean" },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé",
  })
  @ApiResponse({
    status: 403,
    description: "Permissions insuffisantes - Organisateur requis",
  })
  @ApiResponse({
    status: 404,
    description: "Événement non trouvé",
  })
  getEventRegistrations(@Param("eventId") eventId: string) {
    return this.resultsService.getEventRegistrations(eventId);
  }

  @StoreReviewReadable()
  @Get(":id/for-user")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Détail compétition avec éligibilité par épreuve",
    description:
      "Retourne le détail de la compétition avec pour chaque épreuve un indicateur d'éligibilité (eligible, reason) pour l'utilisateur connecté. À utiliser pour n'afficher « S'inscrire » que si eligible.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({
    status: 200,
    description: "Compétition avec events[].eligibility",
  })
  @ApiResponse({ status: 401, description: "Non authentifié" })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  findOneForUser(@Param("id") id: string, @Request() req: RequestWithUser) {
    return this.queryService.findOneForUser(id, req.user.userId);
  }

  @StoreReviewReadable()
  @Get("sync/status")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Statut de la dernière synchronisation FFD",
    description:
      "Retourne le statut du dernier job de sync (idle, pending, active, completed, failed).",
  })
  @ApiResponse({
    status: 200,
    description: "Statut de la sync",
    schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["idle", "pending", "active", "completed", "failed"],
        },
        jobId: { type: "string" },
        stats: {
          type: "object",
          properties: {
            competitionsAdded: { type: "number" },
            competitionsUpdated: { type: "number" },
          },
        },
        error: { type: "string" },
      },
    },
  })
  getSyncStatus() {
    return this.managementService.getSyncStatus();
  }

  @Get(":id/program")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Programme de la compétition pour l'éditeur club",
    description:
      "Épreuves et planning tels que saisis dans l'éditeur (ordre de saisie, heures `HH:MM`, Open multi-classes). STAFF et ADMIN : toute compétition. Compte club : seulement une compétition organisée par son club.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({ status: 200, type: CompetitionProgramDto })
  @ApiResponse({
    status: 403,
    description: "Compétition organisée par un autre club",
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  async getProgram(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<CompetitionProgramDto> {
    await this.accessService.assertCanManageCompetition(id, req.user);
    return this.programQueryService.getProgram(id);
  }

  @Put(":id/program")
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Enregistre le programme (épreuves + planning) d'une compétition",
    description:
      "Remplace tout le programme saisi dans l'éditeur club, en une transaction. Une épreuve envoyée avec son `id` est conservée ou mise à jour, sans `id` elle est créée, absente elle est supprimée. Une épreuve qui a des inscriptions ou des résultats n'est jamais supprimée ni modifiée : 409, rien n'est enregistré. Pour une compétition importée de la FFD, la synchronisation ne remplace plus ensuite ses épreuves.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: ReplaceCompetitionProgramDto })
  @ApiResponse({
    status: 200,
    description: "Programme enregistré, relu tel qu'il est stocké",
    type: CompetitionProgramDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Épreuve contraire au règlement (nature, classe d'âge, niveau) ou identifiant inconnu",
  })
  @ApiResponse({
    status: 403,
    description: "Compétition organisée par un autre club",
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  @ApiResponse({
    status: 409,
    description:
      "Une épreuve retirée ou modifiée a des inscriptions ou des résultats",
  })
  async replaceProgram(
    @Param("id") id: string,
    @Body() body: ReplaceCompetitionProgramDto,
    @Request() req: RequestWithUser,
  ): Promise<CompetitionProgramDto> {
    await this.accessService.assertCanManageCompetition(id, req.user);
    return this.programService.replaceProgram(id, body);
  }

  @Get(":id")
  @ApiOperation({
    summary: "Récupère les détails d'une compétition",
    description:
      "Retourne les informations détaillées d'une compétition spécifique, avec ses épreuves et son planning.",
  })
  @ApiParam({
    name: "id",
    description: "ID unique de la compétition",
    example: "comp-123",
  })
  @ApiResponse({
    status: 200,
    description: "Détails de la compétition récupérés avec succès",
    type: CompetitionDetailDto,
  })
  @ApiResponse({
    status: 404,
    description: "Compétition non trouvée",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: {
          type: "string",
          example: "Competition not found",
        },
      },
    },
  })
  findOne(@Param("id") id: string) {
    return this.queryService.findOne(id);
  }

  @Post(":id/register")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // 5 inscriptions/min per user
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Inscrit un utilisateur à un événement de compétition",
    description:
      "Permet à un utilisateur de s'inscrire à un événement spécifique d'une compétition. Le partenaire est optionnel pour les danses de couple.",
  })
  @ApiParam({
    name: "id",
    description: "ID de la compétition",
    example: "comp-123",
  })
  @ApiBody({
    type: RegisterEventDto,
    examples: {
      solo: {
        summary: "Inscription solo",
        value: {
          eventId: "event-456",
        },
      },
      couple: {
        summary: "Inscription en couple",
        value: {
          eventId: "event-456",
          partnerName: "Jean Dupont",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Inscription réussie",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", example: "registration-789" },
        eventId: { type: "string", example: "event-456" },
        userId: { type: "string", example: "user-123" },
        partnerName: { type: "string", nullable: true, example: "Jean Dupont" },
        status: {
          type: "string",
          enum: ["PENDING", "CONFIRMED", "CANCELLED"],
          example: "PENDING",
        },
        createdAt: {
          type: "string",
          format: "date-time",
          example: "2026-02-12T10:00:00.000Z",
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "L'utilisateur est déjà inscrit à cet événement",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 400 },
        message: {
          type: "string",
          example: "User is already registered to this event",
        },
        error: { type: "string", example: "Bad Request" },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description:
      "Inscription refusée : date limite d'inscription dépassée, ou club en mode inscriptions par le club uniquement",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 403 },
        message: {
          type: "string",
          example:
            "Les inscriptions à cette compétition sont closes depuis le 15 octobre 2026 à 23:59.",
        },
        error: { type: "string", example: "Forbidden" },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Événement non trouvé",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: { type: "string", example: "Event not found" },
        error: { type: "string", example: "Not Found" },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non authentifié - Token JWT invalide ou expiré",
  })
  @ApiResponse({
    status: 403,
    description: "Accès interdit - Permissions insuffisantes",
  })
  register(
    @Param("id") _competitionId: string,
    @Request() req: RequestWithUser,
    @Body() body: RegisterEventDto,
  ) {
    return this.registrationService.register(
      body.eventId,
      req.user.userId,
      body.partnerName,
      {
        byOrganizer: false,
        coupleAgeGroup: body.coupleAgeGroup,
        coupleDisciplineLatin: body.coupleDisciplineLatin,
        coupleDisciplineStandard: body.coupleDisciplineStandard,
        partnerUserId: body.partnerUserId,
        registrantLevel: body.registrantLevel,
      },
    );
  }

  @Get(":id/results")
  @ApiOperation({
    summary: "Récupère les résultats d'une compétition",
    description:
      "Endpoint public. Retourne tous les résultats et classements d'une compétition, épreuve par épreuve, classés par rang. Aucun identifiant de compte n'est exposé.",
  })
  @ApiParam({
    name: "id",
    description: "ID de la compétition",
    example: "comp-123",
  })
  @ApiResponse({
    status: 200,
    description: "Résultats récupérés avec succès",
    type: [CompetitionResultDto],
  })
  @ApiResponse({
    status: 404,
    description: "Compétition non trouvée",
  })
  getResults(@Param("id") id: string): Promise<CompetitionResultDto[]> {
    return this.resultsService.getResults(id);
  }

  @Post(":id/results/import")
  @HttpCode(HttpStatus.OK)
  // Never through « connecté en tant que » (#545): the audit row names the
  // real author of an import that publishes third parties' names.
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Importe les résultats publiés d'une compétition (CSV)",
    description:
      "STAFF et ADMIN : toute compétition ; compte club : seulement une compétition organisée par son club (#690). Importe le classement publié (une ligne par couple, épreuve et tour). La colonne `epreuve` porte l'identifiant de l'épreuve ou son nom (spécialité + classe d'âge + niveau) ; un nom qui désigne plusieurs épreuves est refusé. `?dryRun=true` valide le fichier et renvoie les compteurs sans rien écrire (aperçu). Rejouable : un couple déjà importé pour la même épreuve et le même tour est mis à jour, jamais dupliqué. Tout ou rien : une ligne invalide, une épreuve inconnue ou un couple en double rejette le fichier (400, lignes en erreur), rien n'est écrit. Chaque couple est rattaché aux comptes de ses numéros de licence (jamais un numéro retiré) ; une ligne sans licence l'est à l'inscription portant le même dossard. Un résultat anonymisé par une suppression de compte n'est jamais réécrit ni recréé avec le nom ; une ligne portant la licence d'un compte supprimé est écrite anonymisée. Chaque import est tracé au journal d'audit (auteur, rôle, compteurs). Déclenche la notification « Résultats disponibles » (une seule fois par compétition).",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: ImportResultsDto })
  @ApiResponse({ status: 200, type: ImportResultsReportDto })
  @ApiResponse({
    status: 400,
    description: "Fichier invalide : liste des lignes en erreur",
  })
  @ApiResponse({
    status: 403,
    description:
      "Rôle insuffisant, compétition organisée par un autre club ou session « connecté en tant que »",
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  @ApiResponse({
    status: 503,
    description: "Clé de pseudonymisation des résultats non configurée",
  })
  async importResults(
    @Param("id") id: string,
    @Query() query: ImportResultsQueryDto,
    @Body() body: ImportResultsDto,
    @Request() req: RequestWithUser,
  ): Promise<ImportResultsReportDto> {
    // Organising club resolved from the path id only, never from the body.
    await this.accessService.assertCanManageResults(id, req.user);
    return this.resultsImportService.importCsv(id, body.csv, req.user, {
      dryRun: query.dryRun === true,
    });
  }

  @Post(":id/results/import/topturnier")
  @HttpCode(HttpStatus.OK)
  // Same rights and guards as the CSV import (#786).
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: createMemoryUploadStorage(),
      limits: { fileSize: TOPTURNIER_MAX_ARCHIVE_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiBearerAuth("JWT-auth")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary:
      "Importe les résultats d'une compétition depuis son export TopTurnier (archive zip)",
    description:
      "Mêmes droits, garde-fous et règles que l'import CSV (#786) : STAFF et ADMIN, ou le club organisateur ; jamais en « connecté en tant que » ; essai à blanc avec `?dryRun=true` ; tout ou rien ; pseudonymisation, audit (source TOPTURNIER_UPLOAD) et notification différée identiques. L'archive zip contient l'export HTML de TopTurnier (index.htm de la compétition et un dossier par épreuve avec son classement final erg.htm), à la racine ou dans un dossier. Chaque épreuve TopTurnier (« Nat, Adults Avancé Latin », « OC, Sen.I/II Standard »…) est rapprochée d'une épreuve du programme (spécialité, solo/couple, classes d'âge, niveau, classificatrice/open) ; une épreuve non reconnue ou ambiguë n'est jamais devinée : elle est signalée dans `events` et ignorée. Limites : archive de 10 Mo, 300 épreuves, 500 lignes par classement, 2 Mo par page, 20 Mo décompressés. Aucun numéro de licence dans l'export : les couples sont rattachés par dossard aux inscriptions de l'épreuve.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "Archive zip de l'export TopTurnier",
        },
      },
    },
  })
  @ApiResponse({ status: 200, type: TopTurnierImportReportDto })
  @ApiResponse({
    status: 400,
    description:
      "Archive ou export invalide, aucune épreuve reconnue, ou classement illisible : message, lignes en erreur et correspondance des épreuves",
  })
  @ApiResponse({
    status: 403,
    description:
      "Rôle insuffisant, compétition organisée par un autre club ou session « connecté en tant que »",
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  @ApiResponse({ status: 413, description: "Archive trop volumineuse" })
  @ApiResponse({
    status: 503,
    description: "Clé de pseudonymisation des résultats non configurée",
  })
  async importTopTurnierResults(
    @Param("id") id: string,
    @Query() query: ImportResultsQueryDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: RequestWithUser,
  ): Promise<TopTurnierImportReportDto> {
    // Organising club resolved from the path id only, never from the body.
    await this.accessService.assertCanManageResults(id, req.user);
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException("Archive zip de l'export requise");
    }
    return this.topTurnierImportService.importArchive(
      id,
      file.buffer,
      req.user,
      { dryRun: query.dryRun === true },
    );
  }

  /**
   * TEMPORARY (#787): remove with the service once the FFD gives access to
   * its results data (#651).
   */
  @Post(":id/results/import/topturnier-url")
  @HttpCode(HttpStatus.OK)
  // Back-office staff only: never a club, never impersonated.
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary:
      "TEMPORAIRE — importe les résultats depuis l'adresse publique d'un export TopTurnier",
    description:
      "Solution temporaire (#787) en attendant un accès aux données de la FFD (#651). STAFF et ADMIN uniquement, jamais en « connecté en tant que », à la demande uniquement (aucun relevé planifié). Désactivée sauf `TOPTURNIER_URL_IMPORT_ENABLED=true` (404 sinon). Seuls les sites de `TOPTURNIER_ALLOWED_HOSTS` sont lus, en http/https sur le port standard, jamais une adresse privée, de bouclage ou lien-local ; redirections (2 au plus) dans la liste seulement ; pages lues une à une, espacées de 500 ms, 151 pages au plus, chacune bornée (délai, disjoncteur, 2 Mo). Ensuite, mêmes lecture, correspondance des épreuves, règles et réponse que l'import de l'archive (`/results/import/topturnier`) ; l'audit porte la source TOPTURNIER_URL et l'hôte + chemin de l'adresse.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: ImportTopTurnierUrlDto })
  @ApiResponse({ status: 200, type: TopTurnierImportReportDto })
  @ApiResponse({
    status: 400,
    description:
      "Adresse refusée (site non autorisé, adresse privée, port, redirection), export invalide ou aucune épreuve reconnue",
  })
  @ApiResponse({
    status: 403,
    description:
      "Réservé au staff et aux admins, hors « connecté en tant que »",
  })
  @ApiResponse({
    status: 404,
    description: "Compétition non trouvée, ou import par adresse désactivé",
  })
  @ApiResponse({ status: 502, description: "Site de l'export injoignable" })
  @ApiResponse({
    status: 503,
    description:
      "Site momentanément coupé par le disjoncteur, ou clé de pseudonymisation absente",
  })
  async importTopTurnierUrlResults(
    @Param("id") id: string,
    @Query() query: ImportResultsQueryDto,
    @Body() dto: ImportTopTurnierUrlDto,
    @Request() req: RequestWithUser,
  ): Promise<TopTurnierImportReportDto> {
    await this.accessService.assertCanManageResults(id, req.user);
    return this.topTurnierUrlImportService.importUrl(id, dto.url, req.user, {
      dryRun: query.dryRun === true,
    });
  }

  @Delete(":id/results")
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Supprime les résultats importés d'une épreuve",
    description:
      "Annule un import (#690). Mêmes droits que l'import : STAFF et ADMIN, ou le club organisateur ; jamais en « connecté en tant que ». Supprime les résultats importés de l'épreuve (pas ceux créés autrement). Les lignes qui portent un effacement RGPD (compte supprimé, partenaire supprimé) sont gardées, pour qu'un nouvel import ne recrée jamais un couple effacé avec son nom. Tracé au journal d'audit (auteur, rôle, compteurs). La notification « Résultats disponibles » n'est pas renvoyée par un nouvel import.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({ status: 200, type: DeleteEventResultsReportDto })
  @ApiResponse({
    status: 403,
    description:
      "Rôle insuffisant, compétition organisée par un autre club ou session « connecté en tant que »",
  })
  @ApiResponse({
    status: 404,
    description: "Compétition ou épreuve non trouvée",
  })
  async deleteEventResults(
    @Param("id") id: string,
    @Query() query: DeleteEventResultsQueryDto,
    @Request() req: RequestWithUser,
  ): Promise<DeleteEventResultsReportDto> {
    // Organising club resolved from the path id only, never from the body.
    await this.accessService.assertCanManageResults(id, req.user);
    return this.resultsImportService.deleteEventResults(
      id,
      query.eventId,
      req.user,
    );
  }

  @Post(":id/unregister")
  // Frees a (possibly paid) seat: never from a support session (#761).
  @UseGuards(JwtAuthGuard, NoImpersonationGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // 5 désinscriptions/min per user
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Désinscrit un utilisateur d'un événement de compétition",
    description:
      "Permet à un utilisateur de se désinscrire d'un événement auquel il était inscrit. " +
      "Refusé (403) pendant un accès support (« se connecter en tant que »).",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: UnregisterEventDto })
  @ApiResponse({
    status: 200,
    description: "Désinscription réussie",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        eventId: { type: "string" },
        userId: { type: "string" },
      },
    },
  })
  @ApiResponse({ status: 404, description: "Inscription non trouvée" })
  unregister(
    @Request() req: RequestWithUser,
    @Body() body: UnregisterEventDto,
  ) {
    return this.registrationService.unregister(
      body.eventId,
      req.user.userId,
      {},
    );
  }

  @StoreReviewSimulation(simulatedCheckIn)
  @Post(":id/checkin")
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerUserGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @Throttle({ default: { ttl: 60_000, limit: 30 } }) // 30 check-ins/min per user (scanner)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Effectue le check-in d'un participant",
    description:
      "Permet de checker un participant à une compétition en scannant son QR code. Le QR code contient les informations nécessaires pour identifier le participant et l'événement.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: CheckInDto })
  @ApiResponse({
    status: 201,
    description:
      "Check-in effectué. `qrVerification` indique si le QR signé a été vérifié (#168) : `warning` non nul = QR accepté mais non vérifié (mode warn), à afficher au staff.",
    type: CheckInResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      "Données QR code invalides, ou QR non vérifié refusé (mode enforce : non signé, signature invalide ou licence expirée)",
  })
  @ApiResponse({ status: 404, description: "Inscription non trouvée" })
  async checkIn(
    @Param("id") competitionId: string,
    @Body() body: CheckInDto,
    @Request() req: RequestWithUser,
  ) {
    await this.accessService.assertCanManageCheckIn(competitionId, req.user);
    return this.resultsService.checkIn(
      competitionId,
      body.qrData,
      body.scannedAt,
    );
  }

  @StoreReviewSimulation(simulatedVolunteerToken)
  @Post(":id/volunteer/token")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Génère un jeton d'accès pour un bénévole",
    description:
      "Crée un lien d'accès temporaire (24h) permettant à un bénévole de faire le check-in sans compte.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiBody({ type: GenerateVolunteerTokenDto })
  @ApiResponse({
    status: 201,
    description: "Jeton généré avec succès",
  })
  async generateVolunteerToken(
    @Param("id") competitionId: string,
    @Body() body: GenerateVolunteerTokenDto,
    @Request() req: RequestWithUser,
  ) {
    await this.accessService.assertCanManageCheckIn(competitionId, req.user);
    return this.resultsService.generateVolunteerToken(competitionId, body.name);
  }

  // Per IP, not per volunteer link (#633): the link is only checked against
  // the database inside the handler, and keying on an unchecked body token
  // would give each guessed token a fresh budget. The few scanners at a venue
  // entrance fit this route's own per-IP budget.
  @Post("checkin/volunteer")
  @ThrottleByIp()
  @ApiOperation({
    summary: "Effectue le check-in en tant que bénévole",
    description:
      "Utilise un jeton d'accès bénévole valide pour checker un participant.",
  })
  @ApiBody({ type: VolunteerCheckInDto })
  @ApiResponse({
    status: 201,
    description:
      "Check-in effectué (même réponse que le check-in staff). En mode enforce, un QR non vérifié est refusé en 400.",
    type: CheckInResponseDto,
  })
  @ApiResponse({ status: 401, description: "Jeton invalide ou expiré" })
  checkInAsVolunteer(@Body() body: VolunteerCheckInDto) {
    return this.resultsService.checkInAsVolunteer(
      body.competitionId,
      body.token,
      body.qrData,
      body.scannedAt,
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Crée une nouvelle compétition",
    description:
      "Créée par un compte club, la compétition a pour organisateur le club du compte.",
  })
  @ApiResponse({ status: 201, description: "Compétition créée avec succès" })
  @ApiResponse({
    status: 403,
    description: "Compte club sans club rattaché",
  })
  async create(
    @Body() body: CreateCompetitionDto,
    @Request() req: RequestWithUser,
  ) {
    const organizer = await this.accessService.organizerForNewCompetition(
      req.user,
    );
    return this.managementService.create(body, organizer);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Met à jour une compétition",
    description:
      "STAFF et ADMIN : toute compétition. Compte club : seulement une compétition organisée par son club.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({
    status: 200,
    description: "Compétition mise à jour avec succès",
  })
  @ApiResponse({
    status: 403,
    description: "Compétition organisée par un autre club",
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  async update(
    @Param("id") id: string,
    @Body() body: UpdateCompetitionDto,
    @Request() req: RequestWithUser,
  ) {
    await this.accessService.assertCanManageCompetition(id, req.user);
    return this.managementService.update(id, body);
  }
}
