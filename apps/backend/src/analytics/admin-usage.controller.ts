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
import { AdminUsageQueryService } from "./admin-usage.query-service";
import { AdminUsageDto, AdminUsageQueryDto } from "./dto/admin-usage.dto";

/** Back-office usage dashboard (lot 5). Guards on the CLASS. */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/usage")
export class AdminUsageController {
  constructor(private readonly usage: AdminUsageQueryService) {}

  @Get()
  @ApiOperation({
    summary: "Anonymous app usage for the back-office (aggregates)",
  })
  @ApiResponse({ status: 200, type: AdminUsageDto })
  get(@Query() q: AdminUsageQueryDto): Promise<AdminUsageDto> {
    return this.usage.get(q.period ?? "30d", q.space);
  }
}
