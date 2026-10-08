import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { CompetitionManagementService } from "./services/competition-management.service";
import { CompetitionQueryService } from "./services/competition-query.service";
import { CompetitionRegistrationService } from "./services/competition-registration.service";
import { CompetitionResultsService } from "./services/competition-results.service";
import { CheckInDto, CheckInResponseDto } from "./dto/checkin.dto";
import {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "./dto/competition-management.dto";
import { RegisterEventDto } from "./dto/register-event.dto";
import { RegisterMemberDto } from "./dto/register-member.dto";
import { UnregisterEventDto } from "./dto/unregister-event.dto";
import { UnregisterMemberDto } from "./dto/unregister-member.dto";
import {
  GenerateVolunteerTokenDto,
  VolunteerCheckInDto,
} from "./dto/volunteer-token.dto";

@ApiTags("competitions")
@ApiCommonErrorResponses()
@Controller("competitions")
export class CompetitionsController {
  constructor(
    private readonly queryService: CompetitionQueryService,
    private readonly registrationService: CompetitionRegistrationService,
    private readonly resultsService: CompetitionResultsService,
    private readonly managementService: CompetitionManagementService,
  ) {}

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
    schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", example: "comp-123" },
              name: { type: "string", example: "Championnat de France 2026" },
              startDate: { type: "string", format: "date-time" },
              endDate: { type: "string", format: "date-time" },
              location: { type: "string", example: "Paris, France" },
              status: {
                type: "string",
                enum: ["UPCOMING", "ACTIVE", "COMPLETED"],
                example: "UPCOMING",
              },
            },
          },
        },
        meta: {
          type: "object",
          properties: {
            total: { type: "number", example: 100 },
            skip: { type: "number", example: 0 },
            take: { type: "number", example: 10 },
            hasMore: { type: "boolean", example: true },
          },
        },
      },
    },
  })
  findAll(
    @Request() req: { user?: { userId: string } },
    @Query() pagination: PaginationParamsDto,
  ) {
    return this.queryService.findAll(req.user?.userId, pagination);
  }

  @Get("active")
  @ApiOperation({
    summary: "Récupère la compétition active du jour",
    description:
      "Retourne la compétition qui est actuellement en cours (date du jour entre startDate et endDate).",
  })
  @ApiResponse({
    status: 200,
    description: "Compétition active trouvée",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        startDate: { type: "string", format: "date-time" },
        endDate: { type: "string", format: "date-time" },
        location: { type: "string" },
        status: { type: "string", enum: ["ACTIVE"] },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Aucune compétition active trouvée pour aujourd'hui",
    schema: {
      type: "object",
      properties: {
        statusCode: { type: "number", example: 404 },
        message: {
          type: "string",
          example: "No active competition found",
        },
      },
    },
  })
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Désinscrire un membre du club (organisateur)",
    description:
      "Désinscrit un licencié du club. Le membre reçoit une notification.",
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

  @Get(":id")
  @ApiOperation({
    summary: "Récupère les détails d'une compétition",
    description:
      "Retourne les informations détaillées d'une compétition spécifique, incluant tous ses événements et inscriptions.",
  })
  @ApiParam({
    name: "id",
    description: "ID unique de la compétition",
    example: "comp-123",
  })
  @ApiResponse({
    status: 200,
    description: "Détails de la compétition récupérés avec succès",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        startDate: { type: "string", format: "date-time" },
        endDate: { type: "string", format: "date-time" },
        location: { type: "string" },
        status: { type: "string" },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              category: { type: "string" },
              level: { type: "string" },
              registrations: { type: "array" },
            },
          },
        },
      },
    },
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
      "Retourne tous les résultats et classements pour une compétition donnée.",
  })
  @ApiParam({
    name: "id",
    description: "ID de la compétition",
    example: "comp-123",
  })
  @ApiResponse({
    status: 200,
    description: "Résultats récupérés avec succès",
    schema: {
      type: "object",
      properties: {
        competitionId: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              eventId: { type: "string" },
              eventName: { type: "string" },
              rankings: { type: "array" },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: "Compétition non trouvée",
  })
  getResults(@Param("id") id: string) {
    return this.resultsService.getResults(id);
  }

  @Post(":id/unregister")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // 5 désinscriptions/min per user
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Désinscrit un utilisateur d'un événement de compétition",
    description:
      "Permet à un utilisateur de se désinscrire d'un événement auquel il était inscrit.",
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

  @Post(":id/checkin")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
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
  checkIn(@Param("id") competitionId: string, @Body() body: CheckInDto) {
    return this.resultsService.checkIn(competitionId, body.qrData);
  }

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
  generateVolunteerToken(
    @Param("id") competitionId: string,
    @Body() body: GenerateVolunteerTokenDto,
  ) {
    return this.resultsService.generateVolunteerToken(competitionId, body.name);
  }

  @Post("checkin/volunteer")
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
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Crée une nouvelle compétition" })
  @ApiResponse({ status: 201, description: "Compétition créée avec succès" })
  create(@Body() body: CreateCompetitionDto) {
    return this.managementService.create(body);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CLUB, UserRole.STAFF, UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Met à jour une compétition" })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({
    status: 200,
    description: "Compétition mise à jour avec succès",
  })
  update(@Param("id") id: string, @Body() body: UpdateCompetitionDto) {
    return this.managementService.update(id, body);
  }
}
