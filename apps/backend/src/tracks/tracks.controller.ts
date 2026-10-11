import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { hasRole } from "../auth/roles";
import type { Response } from "express";
import * as fs from "fs";
import { createReadStream } from "fs";
import * as path from "path";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { BlobStorageService } from "../storage/blob-storage.service";
import { TrackResponseDto } from "./dto/track-response.dto";
import {
  buildContentDisposition,
  contentTypeForFilename,
} from "./media-response.util";
import { UpdateTrackDto } from "./dto/update-track.dto";
import { TracksService } from "./tracks.service";
import { StoreReviewReadable } from "../auth/store-review/store-review.decorator";

@ApiTags("tracks")
@ApiCommonErrorResponses()
@Controller("tracks")
export class TracksController {
  constructor(
    private readonly tracksService: TracksService,
    private readonly blobStorage: BlobStorageService,
  ) {}

  @StoreReviewReadable()
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère toutes les musiques",
    description:
      "Retourne la liste de toutes les musiques disponibles dans la bibliothèque (status READY uniquement, Ambiance exclue).",
  })
  @ApiResponse({ status: 200, description: "Liste des musiques" })
  async findAll(
    @Query() pagination: PaginationParamsDto,
    @Req() req: RequestWithUser,
  ) {
    return this.tracksService.findAll(
      pagination,
      hasRole(req.user, UserRole.ADMIN),
    );
  }

  // Déclaré AVANT @Get(":id") : sinon "ambiance" serait capturé comme un id.
  @StoreReviewReadable()
  @Get("ambiance")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Récupère les musiques d'ambiance",
    description:
      "Musiques de pause du mode compétition : pistes READY non blacklistées dont le style ou l'artiste vaut « Ambiance » (insensible à la casse). Exclues de GET /tracks. Au plus 50 pistes, plus récentes d'abord.",
  })
  @ApiOkResponse({
    description: "Liste des musiques d'ambiance",
    type: [TrackResponseDto],
  })
  async findAmbiance(@Req() req: RequestWithUser): Promise<TrackResponseDto[]> {
    return this.tracksService.findAmbiance(hasRole(req.user, UserRole.ADMIN));
  }

  @Get("download/:token")
  @ApiOperation({ summary: "Télécharge un fichier audio" })
  @ApiParam({ name: "token", description: "Token de téléchargement sécurisé" })
  @ApiResponse({ status: 200, description: "Fichier audio" })
  @ApiResponse({ status: 404, description: "Fichier non trouvé" })
  async download(
    @Param("token") token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const safeToken = path.basename(token);

    // The route param is already percent-decoded; track names may contain
    // non-ASCII characters (e.g. the fullwidth bar "｜"), which Node refuses in
    // raw header values — hence the RFC 5987 encoding.
    res.set({
      "Content-Type": contentTypeForFilename(safeToken),
      "Content-Disposition": buildContentDisposition(safeToken),
    });

    // Try Blob Storage first, fall back to local disk
    if (this.blobStorage.isEnabled()) {
      const blobExists = await this.blobStorage.exists(safeToken);
      if (!blobExists) {
        throw new NotFoundException("File not found");
      }
      const stream = await this.blobStorage.downloadStream(safeToken);
      return new StreamableFile(stream);
    }

    const filePath = path.join(__dirname, "../../uploads", safeToken);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException("File not found");
    }
    const file = createReadStream(filePath);
    return new StreamableFile(file);
  }

  @StoreReviewReadable()
  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Récupère une musique par ID" })
  @ApiParam({ name: "id", description: "UUID de la musique" })
  @ApiResponse({ status: 200, description: "Musique trouvée" })
  @ApiResponse({ status: 404, description: "Musique non trouvée" })
  async findOne(@Param("id") id: string, @Req() req: RequestWithUser) {
    return this.tracksService.findOne(id, hasRole(req.user, UserRole.ADMIN));
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Met à jour les métadonnées d'une musique",
    description:
      "Réservé aux administrateurs. Permet de corriger titre, artiste, style et BPM après ajout. Champs absents = inchangés. Chaque modification appliquée est tracée dans le journal d'audit (TRACK_UPDATE). Une musique en erreur (tempo non détecté) passe en READY quand un MPM > 0 est saisi.",
  })
  @ApiParam({ name: "id", description: "UUID de la musique", format: "uuid" })
  @ApiBody({ type: UpdateTrackDto })
  @ApiResponse({ status: 200, description: "Track mise à jour" })
  @ApiResponse({
    status: 403,
    description: "Non autorisé à modifier cette track",
  })
  @ApiResponse({ status: 404, description: "Track non trouvée" })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackDto,
    @Req() req: RequestWithUser,
  ) {
    await this.tracksService.updateTrack(
      id,
      req.user.userId,
      hasRole(req.user, UserRole.ADMIN),
      dto,
    );
    return this.tracksService.findOne(id, hasRole(req.user, UserRole.ADMIN));
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Supprime une musique (modération)",
    description:
      "Réservé aux administrateurs. Supprime définitivement la piste de la bibliothèque partagée, puis son fichier audio et sa pochette. Refusé (409) tant que des propositions de correction sont en attente sur la musique. Tracé dans le journal d'audit (TRACK_DELETE).",
  })
  @ApiParam({ name: "id", description: "UUID de la musique", format: "uuid" })
  @ApiResponse({ status: 204, description: "Track supprimée" })
  @ApiResponse({ status: 403, description: "Non autorisé" })
  @ApiResponse({ status: 404, description: "Track non trouvée" })
  @ApiResponse({
    status: 409,
    description:
      "Propositions de correction en attente (pendingCorrections) : les traiter ou blacklister la musique",
  })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    await this.tracksService.deleteTrack(id, req.user.userId);
  }
}
