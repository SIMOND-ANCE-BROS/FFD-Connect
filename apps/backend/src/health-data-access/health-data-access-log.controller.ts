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
import { simulatedEmptyPage } from "../auth/store-review/store-review-responses";
import { StoreReviewRead } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import {
  HealthDataAccessLogPageDto,
  ListHealthDataAccessLogQueryDto,
} from "./dto/health-data-access-log.dto";
import { HealthDataAccessLogQueryService } from "./health-data-access-log.query-service";

/**
 * Access journal for health data (#63), read by the administrator. Guards and
 * role on the CLASS: no route can be exposed by omission. The store-review
 * account (ADMIN) gets an empty page.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/health-data-access-log")
export class HealthDataAccessLogController {
  constructor(private readonly query: HealthDataAccessLogQueryService) {}

  @StoreReviewRead(simulatedEmptyPage)
  @Get()
  @ApiOperation({
    summary: "Journal des accès aux données de santé",
    description:
      "Qui a consulté, téléchargé, exporté ou supprimé un certificat médical ou une demande de renouvellement, en quelle qualité, quand et par quelle route (RGPD art. 32). Identifiants seulement, jamais le contenu. Plus récents d'abord, paginé (take ≤ 100). Conservé 1 an.",
  })
  @ApiResponse({ status: 200, type: HealthDataAccessLogPageDto })
  list(
    @Query() query: ListHealthDataAccessLogQueryDto,
  ): Promise<HealthDataAccessLogPageDto> {
    return this.query.list(query);
  }
}
