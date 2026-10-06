import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
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
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import {
  MyTrackCorrectionDto,
  MyTrackCorrectionPageDto,
  TrackCorrectionAdminDto,
  TrackCorrectionAdminPageDto,
  TrackCorrectionPendingCountDto,
} from "./dto/track-correction-response.dto";
import {
  ApproveTrackCorrectionDto,
  CreateTrackCorrectionDto,
  ListTrackCorrectionsQueryDto,
  RejectTrackCorrectionDto,
} from "./dto/track-correction.dto";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";
import { TrackCorrectionsService } from "./track-corrections.service";

/**
 * Propositions de correction des métadonnées des musiques. Préfixe distinct
 * de `tracks` pour ne pas entrer en conflit avec GET /tracks/:id.
 */
@ApiTags("track-corrections")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@Controller("track-corrections")
export class TrackCorrectionsController {
  constructor(
    private readonly service: TrackCorrectionsService,
    private readonly queryService: TrackCorrectionsQueryService,
  ) {}

  /**
   * Limité à 10 propositions par minute et par utilisateur, en plus du
   * plafond métier de propositions en attente par piste (429 également).
   */
  @Post()
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiOperation({
    summary: "Propose une correction des informations d'une musique",
    description:
      "Ouvert à tout utilisateur authentifié. Seules les valeurs qui diffèrent de la musique actuelle sont retenues ; il faut au moins l'une d'elles ou un message (400 sinon). Chaque administrateur est notifié. 429 si l'utilisateur a déjà trop de propositions en attente sur cette musique.",
  })
  @ApiBody({ type: CreateTrackCorrectionDto })
  @ApiResponse({
    status: 201,
    description: "Proposition enregistrée",
    type: MyTrackCorrectionDto,
  })
  @ApiResponse({ status: 404, description: "Musique non trouvée" })
  @ApiResponse({
    status: 429,
    description: "Trop de propositions en attente",
  })
  async create(
    @Body() dto: CreateTrackCorrectionDto,
    @Req() req: RequestWithUser,
  ): Promise<MyTrackCorrectionDto> {
    return this.service.create(
      req.user.userId,
      dto,
      req.user.role === UserRole.ADMIN,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "File de modération des propositions de correction",
    description:
      "Réservé aux administrateurs. Chaque proposition est accompagnée des valeurs ACTUELLES de la musique (diff), du nom de son auteur et du relecteur. En attente : de la plus ancienne à la plus récente ; sinon de la plus récente à la plus ancienne.",
  })
  @ApiResponse({
    status: 200,
    description: "Page de propositions",
    type: TrackCorrectionAdminPageDto,
  })
  async list(
    @Query() query: ListTrackCorrectionsQueryDto,
  ): Promise<TrackCorrectionAdminPageDto> {
    return this.queryService.listForAdmin(query);
  }

  @Get("mine")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Mes propositions de correction",
    description:
      "Les propositions de l'appelant, de la plus récente à la plus ancienne, avec leur statut et le commentaire de l'administrateur.",
  })
  @ApiResponse({
    status: 200,
    description: "Page de propositions",
    type: MyTrackCorrectionPageDto,
  })
  async listMine(
    @Query() pagination: PaginationParamsDto,
    @Req() req: RequestWithUser,
  ): Promise<MyTrackCorrectionPageDto> {
    return this.queryService.listMine(req.user.userId, pagination);
  }

  @Get("pending-count")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Nombre de propositions en attente",
    description:
      "Réservé aux administrateurs (badge de l'écran de modération).",
  })
  @ApiResponse({
    status: 200,
    description: "Compteur",
    type: TrackCorrectionPendingCountDto,
  })
  async pendingCount(): Promise<TrackCorrectionPendingCountDto> {
    return { count: await this.queryService.countPending() };
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Valide une proposition et l'applique à la musique",
    description:
      "Réservé aux administrateurs. Les valeurs fournies remplacent celles de la proposition avant application. L'auteur est notifié. 409 si la proposition a déjà été traitée.",
  })
  @ApiParam({ name: "id", description: "UUID de la proposition" })
  @ApiBody({ type: ApproveTrackCorrectionDto })
  @ApiResponse({
    status: 200,
    description: "Proposition validée",
    type: TrackCorrectionAdminDto,
  })
  @ApiResponse({ status: 404, description: "Proposition non trouvée" })
  @ApiResponse({ status: 409, description: "Proposition déjà traitée" })
  async approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveTrackCorrectionDto,
    @Req() req: RequestWithUser,
  ): Promise<TrackCorrectionAdminDto> {
    return this.service.approve(id, req.user.userId, dto);
  }

  @Post(":id/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Refuse une proposition",
    description:
      "Réservé aux administrateurs. L'auteur est notifié avec le commentaire éventuel. 409 si la proposition a déjà été traitée.",
  })
  @ApiParam({ name: "id", description: "UUID de la proposition" })
  @ApiBody({ type: RejectTrackCorrectionDto })
  @ApiResponse({
    status: 200,
    description: "Proposition refusée",
    type: TrackCorrectionAdminDto,
  })
  @ApiResponse({ status: 404, description: "Proposition non trouvée" })
  @ApiResponse({ status: 409, description: "Proposition déjà traitée" })
  async reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectTrackCorrectionDto,
    @Req() req: RequestWithUser,
  ): Promise<TrackCorrectionAdminDto> {
    return this.service.reject(id, req.user.userId, dto);
  }
}
