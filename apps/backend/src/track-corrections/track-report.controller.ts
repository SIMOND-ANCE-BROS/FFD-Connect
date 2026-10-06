import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { ReportTrackDto } from "../tracks/dto/report-track.dto";
import { TrackCorrectionsService } from "./track-corrections.service";

/**
 * Route historique POST /tracks/:id/report, appelée par les versions de
 * l'application déjà installées. Contrat inchangé (corps, 204, 404).
 *
 * Elle vit dans ce module, et non dans TracksController, parce qu'elle écrit
 * désormais une proposition de correction : TracksModule ne peut pas dépendre
 * de ce module, qui dépend lui-même de TracksService (application des
 * corrections validées). L'operationId historique est conservé pour que le
 * client OpenAPI généré garde le même nom de fonction.
 */
@ApiTags("tracks")
@ApiCommonErrorResponses()
@Controller("tracks")
export class TrackReportController {
  constructor(private readonly service: TrackCorrectionsService) {}

  /**
   * Même borne que POST /track-corrections : 10 par minute et par
   * utilisateur. Le plafond métier (propositions en attente) reste silencieux
   * ici (204) pour ne pas imposer un nouveau code d'échec aux anciens clients.
   */
  @Post(":id/report")
  @UseGuards(JwtAuthGuard, ThrottlerUserGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    operationId: "TracksController_report",
    summary: "Signale un problème sur une musique",
    description:
      "Ouvert à tout utilisateur authentifié. Enregistre le signalement dans la file des propositions de correction (motif + message éventuel) et notifie chaque administrateur. Remplacé par POST /track-corrections, qui permet de proposer les valeurs corrigées.",
  })
  @ApiParam({ name: "id", description: "UUID de la musique" })
  @ApiBody({ type: ReportTrackDto })
  @ApiResponse({ status: 204, description: "Signalement envoyé" })
  @ApiResponse({ status: 404, description: "Musique non trouvée" })
  async report(
    @Param("id") id: string,
    @Body() dto: ReportTrackDto,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.service.createFromLegacyReport(
      id,
      dto.reason,
      dto.message,
      req.user.userId,
    );
  }
}
