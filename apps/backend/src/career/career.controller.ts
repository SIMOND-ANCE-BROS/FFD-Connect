import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  CareerResponse,
  CareerSearchMember,
  CareerService,
} from "./career.service";
import { StoreReviewOwnData } from "../auth/store-review/store-review.decorator";

@ApiTags("career")
@ApiCommonErrorResponses()
@Controller("career")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth("JWT-auth")
export class CareerController {
  constructor(private readonly careerService: CareerService) {}

  @StoreReviewOwnData()
  @Get("me")
  @ApiOperation({
    summary: "Ma carrière",
    description:
      "Retourne les partenariats, inscriptions aux compétitions et résultats du licencié connecté.",
  })
  @ApiResponse({
    status: 200,
    description: "Carrière récupérée avec succès",
    schema: {
      type: "object",
      properties: {
        partnerships: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              startDate: { type: "string", format: "date-time" },
              endDate: { type: "string", format: "date-time", nullable: true },
              partner: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  firstName: { type: "string" },
                  lastName: { type: "string" },
                  clubName: { type: "string", nullable: true },
                },
              },
              clubName: { type: "string" },
              secondaryClubName: { type: "string", nullable: true },
              isCurrent: { type: "boolean" },
            },
          },
        },
        registrations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              bibNumber: { type: "number", nullable: true },
              partnerName: { type: "string", nullable: true },
              event: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  category: { type: "string" },
                  ageGroup: { type: "string" },
                  level: { type: "string", nullable: true },
                },
              },
              competition: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  date: { type: "string", format: "date-time" },
                  location: { type: "string" },
                  status: { type: "string" },
                },
              },
            },
          },
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              eventId: { type: "string" },
              round: { type: "string" },
              ranking: { type: "number" },
              participantLabel: { type: "string", nullable: true },
              event: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  ageGroup: { type: "string" },
                },
              },
              competition: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  date: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Non autorisé",
  })
  getMyCareer(@Request() req: RequestWithUser): Promise<CareerResponse> {
    return this.careerService.getMyCareer(req.user.userId);
  }

  @Get("search-members")
  @ApiOperation({
    summary: "Rechercher des membres (pour voir leur carrière)",
    description:
      "Retourne une liste de licenciés dont le nom ou prénom contient la requête. Licence/Club : même club ; Staff/Admin : tous les licenciés.",
  })
  @ApiQuery({
    name: "q",
    required: false,
    description: "Recherche par prénom ou nom (min. 2 caractères)",
  })
  @ApiResponse({
    status: 200,
    description: "Liste de membres (id, firstName, lastName, clubName)",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  searchMembers(
    @Request() req: RequestWithUser,
    @Query("q") q?: string,
  ): Promise<CareerSearchMember[]> {
    return this.careerService.searchMembers(req.user.userId, q ?? "");
  }

  @Get("user/:userId")
  @ApiOperation({
    summary: "Carrière d’un utilisateur",
    description:
      "Retourne les partenariats, inscriptions et résultats d’un utilisateur par son ID. Accessible à tout rôle connecté.",
  })
  @ApiParam({ name: "userId", description: "ID de l’utilisateur" })
  @ApiResponse({
    status: 200,
    description: "Carrière récupérée avec succès",
  })
  @ApiResponse({ status: 401, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Utilisateur non trouvé" })
  getCareerByUserId(
    @Param("userId", ParseUUIDPipe) userId: string,
  ): Promise<CareerResponse> {
    return this.careerService.getCareerForUser(userId);
  }
}
