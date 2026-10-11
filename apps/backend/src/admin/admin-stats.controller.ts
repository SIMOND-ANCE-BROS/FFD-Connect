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
import { AdminStatsQueryService } from "./admin-stats.query-service";
import { AdminStatsDto, AdminStatsQueryDto } from "./dto/admin-stats.dto";

/** Back-office stats (lot 4). Guards on the CLASS, like AdminController. */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/stats")
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsQueryService) {}

  @Get()
  @ApiOperation({
    summary: "Database statistics for the back-office (read-only)",
  })
  @ApiResponse({ status: 200, type: AdminStatsDto })
  get(@Query() q: AdminStatsQueryDto): Promise<AdminStatsDto> {
    return this.stats.get(q.period ?? "12w");
  }
}
