import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import {
  CompetitionResultsStatusDto,
  CompetitionResultsStatusQueryDto,
  MAX_RESULTS_STATUS_IDS,
} from "./dto/competition-results-status.dto";
import { CompetitionResultsStatusQueryService } from "./services/competition-results-status-query.service";

/**
 * Back-office reads about competitions (#846). Guards and roles on the
 * CLASS: STAFF and ADMIN only. Not on the store-review read allowlist: that
 * account gets an empty list.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STAFF, UserRole.ADMIN)
@Controller("admin/competitions")
export class AdminCompetitionsController {
  constructor(
    private readonly resultsStatus: CompetitionResultsStatusQueryService,
  ) {}

  @Get("results-status")
  @ApiOperation({
    summary: "Résultats déjà importés, par compétition",
    description: `Pour chaque compétition demandée (1 à ${MAX_RESULTS_STATUS_IDS}, dans l'ordre demandé) : nombre d'épreuves, nombre d'épreuves ayant des résultats, et l'état NONE / PARTIAL / COMPLETE. Une compétition inconnue ou sans épreuve vaut NONE. Jamais mis en cache.`,
  })
  @ApiResponse({ status: 200, type: [CompetitionResultsStatusDto] })
  @ApiResponse({
    status: 400,
    description: "IDs absents, invalides ou trop nombreux",
  })
  @ApiResponse({ status: 403, description: "Réservé au staff et aux admins" })
  resultsStatusList(
    @Query() query: CompetitionResultsStatusQueryDto,
  ): Promise<CompetitionResultsStatusDto[]> {
    return this.resultsStatus.getStatuses(query.ids);
  }
}
