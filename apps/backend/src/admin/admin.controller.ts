import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { AdminAuditService } from "./admin-audit.service";
import { AdminClubAccountsService } from "./admin-club-accounts.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";
import { AdminReferenceService } from "./admin-reference.service";
import { DeleteAdminUserDto, SetActiveDto } from "./dto/admin-actions.dto";
import { AuditLogPageDto, ListAuditLogQueryDto } from "./dto/admin-audit.dto";
import {
  AdminUserDetailDto,
  AdminUsersPageDto,
  ListAdminUsersQueryDto,
} from "./dto/admin-users.dto";
import {
  ClubAccountCreatedDto,
  CreateClubAccountDto,
  InvitationResultDto,
} from "./dto/club-account.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";
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
    private readonly users: AdminUsersService,
    private readonly clubAccounts: AdminClubAccountsService,
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
  @ApiOperation({ summary: "Liste paginée des utilisateurs" })
  @ApiResponse({ status: 200, type: AdminUsersPageDto })
  listUsers(
    @Query() query: ListAdminUsersQueryDto,
  ): Promise<AdminUsersPageDto> {
    return this.usersQuery.list(query);
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Fiche d'un utilisateur" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  getUser(@Param("id", ParseUUIDPipe) id: string): Promise<AdminUserDetailDto> {
    return this.usersQuery.detail(id);
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Modifier la fiche d'un utilisateur" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  updateUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminUserDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminUserDetailDto> {
    return this.users.update(req.user.userId, id, dto);
  }

  @Post("users/:id/status")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Activer ou désactiver un utilisateur" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminUserDetailDto })
  @ApiResponse({ status: 403, description: "Son propre compte" })
  setUserStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @Req() req: RequestWithUser,
  ): Promise<AdminUserDetailDto> {
    return this.users.setStatus(req.user.userId, id, dto.active);
  }

  @Delete("users/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Supprimer définitivement un utilisateur (RGPD)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 204, description: "Compte supprimé" })
  @ApiResponse({ status: 400, description: "L'email saisi ne correspond pas" })
  @ApiResponse({ status: 403, description: "Son propre compte" })
  deleteUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DeleteAdminUserDto,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.users.delete(req.user.userId, id, dto.confirmEmail);
  }

  @Post("club-accounts")
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: "Créer un compte Club et envoyer l'invitation" })
  @ApiResponse({ status: 201, type: ClubAccountCreatedDto })
  @ApiResponse({
    status: 409,
    description: "Email ou nom de club déjà utilisé",
  })
  createClubAccount(
    @Body() dto: CreateClubAccountDto,
    @Req() req: RequestWithUser,
  ): Promise<ClubAccountCreatedDto> {
    return this.clubAccounts.create(req.user.userId, dto);
  }

  @Post("users/:id/resend-invitation")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({
    summary: "Renvoyer l'invitation d'un compte jamais connecté",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: InvitationResultDto })
  resendInvitation(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<InvitationResultDto> {
    return this.clubAccounts.resendInvitation(req.user.userId, id);
  }
}
