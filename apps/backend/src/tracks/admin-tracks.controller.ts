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
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import {
  AdminTrackDto,
  AdminTracksPageDto,
  ListAdminTracksQueryDto,
} from "./dto/admin-track.dto";

/**
 * Back-office track catalogue and import. Guards and role are set on the
 * CLASS (as AdminController): no route can be exposed by omission. Edits and
 * deletions go through PATCH / DELETE /tracks/:id, shared with the mobile app.
 */
@ApiTags("admin")
@ApiCommonErrorResponses()
@ApiBearerAuth("JWT-auth")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/tracks")
export class AdminTracksController {
  constructor(private readonly query: AdminTracksQueryService) {}

  @Get()
  @ApiOperation({
    summary: "Catalogue des musiques (vue administrateur)",
    description:
      "Toutes les musiques, y compris blacklistées, en attente, en erreur et d'ambiance (pas de filtre bibliothèque). Plus récentes d'abord. Filtres : q (titre ou artiste, 2 à 100 caractères), status, blacklisted, titleMasked, style, ambiance.",
  })
  @ApiResponse({ status: 200, type: AdminTracksPageDto })
  list(@Query() query: ListAdminTracksQueryDto): Promise<AdminTracksPageDto> {
    return this.query.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Une musique (vue administrateur)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiResponse({ status: 200, type: AdminTrackDto })
  @ApiResponse({ status: 404, description: "Musique introuvable" })
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<AdminTrackDto> {
    return this.query.detail(id);
  }
}
