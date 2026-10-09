import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrackStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { AdminPageMetaDto } from "../../admin/dto/admin-audit.dto";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";

/** Bounds of the catalogue search (track title or artist). */
export const ADMIN_TRACK_SEARCH_MIN_LENGTH = 2;
export const ADMIN_TRACK_SEARCH_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/**
 * Query-string flag: only the strings "true" and "false" (what the generated
 * clients send for a boolean). `@Type(() => Boolean)` would read "false" as
 * true; any other value stays a string and fails @IsBoolean.
 */
const toFlag = ({ value }: { value: unknown }): unknown =>
  value === "true" ? true : value === "false" ? false : value;

/**
 * Admin catalogue filters. Unlike GET /tracks, no library filter: blacklisted,
 * pending, failed and ambiance tracks are listed too.
 */
export class ListAdminTracksQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({
    description:
      "Recherche dans le titre ou l'artiste, sans tenir compte de la casse",
    minLength: ADMIN_TRACK_SEARCH_MIN_LENGTH,
    maxLength: ADMIN_TRACK_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(ADMIN_TRACK_SEARCH_MIN_LENGTH)
  @MaxLength(ADMIN_TRACK_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({ enum: TrackStatus, enumName: "TrackStatus" })
  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      "true : seulement les musiques blacklistées ; false : seulement les autres",
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  blacklisted?: boolean;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      "true : seulement les titres masqués ; false : seulement les autres",
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  titleMasked?: boolean;

  @ApiPropertyOptional({
    description: "Danse (libellé exact, sans tenir compte de la casse)",
    maxLength: 64,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  style?: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      "true : seulement l'ambiance (style ou artiste « Ambiance ») ; false : tout sauf l'ambiance",
  })
  @IsOptional()
  @Transform(toFlag)
  @IsBoolean()
  ambiance?: boolean;
}

/** One track as the back-office sees it (real title, moderation flags, status). */
export class AdminTrackDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "Titre réel, même masqué" }) title!: string;
  @ApiProperty() artist!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Danse (texte libre ; « Ambiance » pour la musique de pause)",
  })
  style!: string | null;
  @ApiProperty({ description: "Tempo en MPM (mesures par minute)" })
  bpm!: number;
  @ApiProperty({ description: "Tempo brut détecté (BPM), 0 si inconnu" })
  rawBpm!: number;
  @ApiProperty({
    type: [Number],
    description: "Paso doble : timecodes (secondes) des clashs",
  })
  clashTimecodes!: number[];
  @ApiProperty() titleMasked!: boolean;
  @ApiProperty() blacklisted!: boolean;
  @ApiProperty({ enum: TrackStatus, enumName: "TrackStatus" })
  status!: TrackStatus;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Source track-prep (ex. apple:1091542189)",
  })
  sourceKey!: string | null;
  @ApiProperty({
    description:
      "Fichier audio, servi par GET /uploads/{filename} (hors préfixe /api/v1)",
  })
  filename!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Pochette, servie par GET /uploads/{artwork}",
  })
  artwork!: string | null;
  @ApiProperty({ type: String, format: "date-time" }) createdAt!: Date;
  @ApiProperty({ description: "Propositions de correction en attente" })
  pendingCorrections!: number;
}

export class AdminTracksPageDto {
  @ApiProperty({ type: [AdminTrackDto] }) data!: AdminTrackDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
