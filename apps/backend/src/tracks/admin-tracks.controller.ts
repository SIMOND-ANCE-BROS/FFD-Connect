import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { Roles } from "../auth/decorators/roles.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ApiCommonErrorResponses } from "../common/decorators/api-error-responses.decorator";
import { createMemoryUploadStorage } from "../utils/upload-storage.util";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import { TRACK_STYLE_OPTIONS } from "./dance-labels";
import {
  AdminTrackDto,
  AdminTracksPageDto,
  ListAdminTracksQueryDto,
} from "./dto/admin-track.dto";
import {
  CheckTracksDto,
  CheckTracksResultDto,
  ImportTrackDto,
  TRACK_IMPORT_TEXT_MAX_LENGTH,
  TRACK_SOURCE_KEY_MAX_LENGTH,
  TRACK_TEMPO_MAX,
} from "./dto/track-import.dto";
import {
  TRACK_IMPORT_MULTIPART_LIMITS,
  TrackImportService,
} from "./track-import.service";

interface ImportTrackFiles {
  audio?: Express.Multer.File[];
  artwork?: Express.Multer.File[];
}

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
  constructor(
    private readonly query: AdminTracksQueryService,
    private readonly importer: TrackImportService,
  ) {}

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

  @Post("check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Doublons avant import",
    description:
      "Pour chaque élément (200 au plus), indique si une musique existe déjà avec la même source (sourceKey) ou le même fichier audio (SHA-256). Réponses dans l’ordre de la requête.",
  })
  @ApiResponse({ status: 200, type: CheckTracksResultDto })
  check(@Body() dto: CheckTracksDto): Promise<CheckTracksResultDto> {
    return this.importer.check(dto.items);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "audio", maxCount: 1 },
        { name: "artwork", maxCount: 1 },
      ],
      {
        storage: createMemoryUploadStorage(),
        limits: TRACK_IMPORT_MULTIPART_LIMITS,
      },
    ),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["audio", "title", "artist", "sha256"],
      properties: {
        audio: {
          type: "string",
          format: "binary",
          description: "MP3, 20 Mo au plus",
        },
        artwork: {
          type: "string",
          format: "binary",
          description: "Pochette JPEG ou PNG, 2 Mo au plus",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: TRACK_IMPORT_TEXT_MAX_LENGTH,
        },
        artist: {
          type: "string",
          minLength: 1,
          maxLength: TRACK_IMPORT_TEXT_MAX_LENGTH,
        },
        style: {
          type: "string",
          enum: [...TRACK_STYLE_OPTIONS],
          description: "Danse (libellé canonique) ou « Ambiance »",
        },
        mpm: {
          type: "integer",
          minimum: 1,
          maximum: TRACK_TEMPO_MAX,
          description: "Tempo dansé (MPM) ; sinon calculé selon la danse",
        },
        rawBpm: {
          type: "number",
          minimum: 1,
          maximum: TRACK_TEMPO_MAX,
          description: "Tempo brut (BPM) ; sinon détecté par le serveur",
        },
        sourceKey: {
          type: "string",
          maxLength: TRACK_SOURCE_KEY_MAX_LENGTH,
          description: "Source track-prep (ex. apple:1091542189)",
        },
        sha256: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description:
            "SHA-256 du fichier audio (hexadécimal), recalculé par le serveur",
        },
      },
    },
  })
  @ApiOperation({
    summary: "Importer une musique",
    description:
      "Un fichier par requête. MP3 reconnu par son contenu ; noms de stockage générés par le serveur ; tempo analysé si rawBpm est absent ; statut ERROR si aucun tempo n'est connu. Tracé dans le journal d'audit (TRACK_CREATE).",
  })
  @ApiResponse({ status: 201, type: AdminTrackDto })
  @ApiResponse({
    status: 400,
    description: "Fichier ou champ invalide, empreinte SHA-256 différente",
  })
  @ApiResponse({
    status: 409,
    description: "Doublon (même source ou même fichier) : existingTrackId",
  })
  @ApiResponse({
    status: 413,
    description: "Fichier audio > 20 Mo ou pochette > 2 Mo",
  })
  create(
    @Req() req: RequestWithUser,
    @Body() dto: ImportTrackDto,
    @UploadedFiles() files: ImportTrackFiles | undefined,
  ): Promise<AdminTrackDto> {
    return this.importer.importTrack(
      req.user.userId,
      dto,
      files?.audio?.[0],
      files?.artwork?.[0],
    );
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
