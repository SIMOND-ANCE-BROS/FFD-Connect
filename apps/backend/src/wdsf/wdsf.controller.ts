import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { WdsfService } from "./wdsf.service";

@ApiTags("wdsf")
@ApiCommonErrorResponses()
@Controller("wdsf")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class WdsfController {
  constructor(private readonly wdsfService: WdsfService) {}

  @Get("athlete/:min")
  @ApiOperation({
    summary: "Récupère les informations d'un athlète WDSF",
    description:
      "Récupère les informations d'un athlète WDSF à partir de son numéro MIN (Member Identification Number)",
  })
  @ApiParam({
    name: "min",
    description: "Numéro MIN (Member Identification Number) de l'athlète",
    type: String,
    example: "123456",
  })
  @ApiResponse({
    status: 200,
    description: "Informations de l'athlète récupérées avec succès",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Athlète non trouvé" })
  getAthlete(@Param("min") min: string) {
    return this.wdsfService.getAthleteByMin(min);
  }
}
