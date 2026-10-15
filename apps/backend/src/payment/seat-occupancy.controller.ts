import { Controller, Get, Param, Request, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt-auth.guard";
import { StoreReviewReadable } from "../auth/store-review/store-review.decorator";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { SeatOccupancyResponseDto } from "./dto/seat-occupancy.dto";
import { SeatOccupancyQueryService } from "./seat-occupancy-query.service";

/**
 * Seat-plan occupancy (#454), under `competitions/:id` like the competition
 * detail it complements — and with the same access: public, the token only
 * flags the caller's own seats.
 */
@ApiTags("competitions")
@ApiCommonErrorResponses()
@Controller("competitions")
export class SeatOccupancyController {
  constructor(private readonly occupancy: SeatOccupancyQueryService) {}

  // No personal data in the payload: readable as the public catalog.
  @StoreReviewReadable()
  @Get(":id/seat-occupancy")
  @UseGuards(OptionalJwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Places prises et en attente du plan de salle",
    description:
      "Pour chaque élément réservable du plan de la compétition : places payées (`takenSeats`), " +
      "places en attente de paiement non expirées (`heldSeats`) et places encore réservables (`available`). " +
      "Les réservations expirées ne comptent pas. Aucune donnée personnelle : seulement des indices et des compteurs. " +
      "Public comme le détail de la compétition ; authentifié, `mySeats` / `mine` signalent les places de l'utilisateur. " +
      "Non mis en cache : l'état reflète la base au moment de l'appel.",
  })
  @ApiParam({ name: "id", description: "ID de la compétition" })
  @ApiResponse({
    status: 200,
    description: "Occupation du plan de salle",
    type: SeatOccupancyResponseDto,
  })
  @ApiResponse({ status: 404, description: "Compétition non trouvée" })
  getSeatOccupancy(
    @Param("id") id: string,
    @Request() req: { user?: { userId: string } },
  ): Promise<SeatOccupancyResponseDto> {
    return this.occupancy.getOccupancy(id, req.user?.userId);
  }
}
