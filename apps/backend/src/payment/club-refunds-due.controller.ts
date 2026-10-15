import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { StoreReviewRead } from "../auth/store-review/store-review.decorator";
import { simulatedEmptyPage } from "../auth/store-review/store-review-responses";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { ClubRefundsDueQueryService } from "./club-refunds-due-query.service";
import {
  ClubRefundsDuePageDto,
  ListClubRefundsDueQueryDto,
} from "./dto/club-refund-due.dto";

/**
 * Refunds owed by the organising club (#516). Kept apart from ClubsController
 * (clubs module) because the data belongs to the payment domain; guards and
 * role are set on the CLASS so no route can be exposed by omission.
 */
@ApiTags("clubs")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLUB)
@Controller("clubs")
export class ClubRefundsDueController {
  constructor(private readonly query: ClubRefundsDueQueryService) {}

  // Store-review account: not on the read allowlist, an empty page.
  @StoreReviewRead(simulatedEmptyPage)
  @Get("me/refunds-due")
  @ApiOperation({
    summary: "Remboursements dus par le club organisateur",
    description:
      "Réservations de place des compétitions organisées par le club du compte pour lesquelles un paiement HelloAsso " +
      "doit être remboursé (payé après expiration, sur une intention remplacée, ou en double). " +
      "Paginée (take ≤ 50), plus anciens d'abord. Lecture seule : le remboursement se fait depuis l'espace HelloAsso " +
      "du club, et la ligne disparaît quand HelloAsso notifie le paiement remboursé.",
  })
  @ApiResponse({ status: 200, type: ClubRefundsDuePageDto })
  @ApiResponse({ status: 403, description: "Compte non club" })
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListClubRefundsDueQueryDto,
  ): Promise<ClubRefundsDuePageDto> {
    return this.query.listForClubManager(
      req.user.userId,
      query.skip,
      query.take,
    );
  }
}
