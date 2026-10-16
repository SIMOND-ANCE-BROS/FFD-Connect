import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExtraModels,
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
import { AdminRefundsDueQueryService } from "./admin-refunds-due-query.service";
import {
  AdminRefundsDueFilterDto,
  AdminRefundsDuePageDto,
  ListAdminRefundsDueQueryDto,
} from "./dto/admin-refund-due.dto";

/**
 * Refunds owed by every organising club (#627), for the federal
 * administrator. Guards and role on the CLASS: no route can be exposed by
 * omission. The store-review account (ADMIN) gets an empty page.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@ApiExtraModels(AdminRefundsDueFilterDto)
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/refunds-due")
export class AdminRefundsDueController {
  constructor(private readonly query: AdminRefundsDueQueryService) {}

  @StoreReviewRead(simulatedEmptyPage)
  @Get()
  @ApiOperation({
    summary: "Remboursements dus, tous clubs confondus",
    description:
      "Réservations de place pour lesquelles un club organisateur doit rembourser un ou plusieurs paiements HelloAsso " +
      "(payé après expiration, sur une intention remplacée, ou en double), avec le club organisateur. " +
      "Paginée (take ≤ 50), plus anciens d'abord par défaut. Lecture seule : la ligne disparaît quand HelloAsso " +
      "notifie le paiement remboursé.",
  })
  @ApiResponse({ status: 200, type: AdminRefundsDuePageDto })
  list(
    @Query() query: ListAdminRefundsDueQueryDto,
  ): Promise<AdminRefundsDuePageDto> {
    return this.query.list(query);
  }
}
