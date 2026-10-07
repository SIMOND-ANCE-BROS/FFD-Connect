import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminReferenceService } from "./admin-reference.service";
import { AuditLogPageDto, ListAuditLogQueryDto } from "./dto/admin-audit.dto";
import {
  AdminUserDetailDto,
  AdminUsersPageDto,
  ListAdminUsersQueryDto,
} from "./dto/admin-users.dto";
import {
  AdminClubOptionDto,
  AdminReferenceDataDto,
} from "./dto/admin-reference.dto";

/**
 * Admin back-office API. Guards and role are set on the CLASS so that no
 * route of this controller can be exposed to a non-admin by omission.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly audit: AdminAuditService,
    private readonly reference: AdminReferenceService,
    private readonly usersQuery: AdminUsersQueryService,
  ) {}

  @Get("reference-data")
  @ApiOperation({ summary: "Listes de valeurs du back-office" })
  @ApiResponse({ status: 200, type: AdminReferenceDataDto })
  referenceData(): AdminReferenceDataDto {
    return this.reference.referenceData();
  }

  @Get("clubs")
  @ApiOperation({ summary: "Clubs (id + nom) pour les listes déroulantes" })
  @ApiResponse({ status: 200, type: [AdminClubOptionDto] })
  clubs(): Promise<AdminClubOptionDto[]> {
    return this.reference.clubs();
  }

  @Get("audit-log")
  @ApiOperation({ summary: "Journal des actions admin" })
  @ApiResponse({ status: 200, type: AuditLogPageDto })
  auditLog(@Query() query: ListAuditLogQueryDto): Promise<AuditLogPageDto> {
    return this.audit.list(query);
  }

  @Get("users")
  @ApiOperation({ summary: "Liste paginée des inscrits" })
  @ApiResponse({ status: 200, type: AdminUsersPageDto })
  listUsers(
    @Query() query: ListAdminUsersQueryDto,
  ): Promise<AdminUsersPageDto> {
    return this.usersQuery.list(query);
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Fiche d'un inscrit" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  getUser(@Param("id", ParseUUIDPipe) id: string): Promise<AdminUserDetailDto> {
    return this.usersQuery.detail(id);
  }
}
