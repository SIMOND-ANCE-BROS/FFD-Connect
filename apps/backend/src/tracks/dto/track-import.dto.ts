import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { TRACK_STYLE_OPTIONS, type TrackStyleOption } from "../dance-labels";

/** At most this many files per duplicate check (the SPA sends batches). */
export const TRACK_CHECK_MAX_ITEMS = 200;
export const TRACK_IMPORT_TEXT_MAX_LENGTH = 200;
export const TRACK_SOURCE_KEY_MAX_LENGTH = 100;
export const TRACK_TEMPO_MAX = 400;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Multipart fields arrive as strings: an empty optional field means "absent". */
const optionalText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * Number from a multipart string. Not `@Type(() => Number)`: it would turn
 * an empty field into 0 before this transform runs. "abc" becomes NaN and
 * fails the number validators.
 */
const optionalNumber = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
};

const lowerHex = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class CheckTrackItemDto {
  @ApiPropertyOptional({
    maxLength: TRACK_SOURCE_KEY_MAX_LENGTH,
    example: "apple:1091542189",
  })
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Length(1, TRACK_SOURCE_KEY_MAX_LENGTH)
  sourceKey?: string;

  @ApiProperty({
    description: "SHA-256 du fichier audio (hexadécimal)",
    pattern: "^[0-9a-f]{64}$",
  })
  @Transform(lowerHex)
  @IsString()
  @Matches(SHA256_HEX)
  sha256!: string;
}

export class CheckTracksDto {
  @ApiProperty({
    type: [CheckTrackItemDto],
    minItems: 1,
    maxItems: TRACK_CHECK_MAX_ITEMS,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TRACK_CHECK_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CheckTrackItemDto)
  items!: CheckTrackItemDto[];
}

export class TrackCheckResultDto {
  @ApiProperty({
    description: "Une musique existe déjà (même source ou même fichier)",
  })
  exists!: boolean;

  @ApiPropertyOptional({ description: "La musique existante" })
  trackId?: string;
}

export class CheckTracksResultDto {
  @ApiProperty({
    type: [TrackCheckResultDto],
    description: "Une réponse par élément, dans l'ordre de la requête",
  })
  items!: TrackCheckResultDto[];
}

/**
 * Text fields of POST /admin/tracks (multipart). The OpenAPI body, files
 * included, is described on the controller (@ApiBody schema).
 */
export class ImportTrackDto {
  @Transform(trim)
  @IsString()
  @Length(1, TRACK_IMPORT_TEXT_MAX_LENGTH)
  title!: string;

  @Transform(trim)
  @IsString()
  @Length(1, TRACK_IMPORT_TEXT_MAX_LENGTH)
  artist!: string;

  @IsOptional()
  @Transform(optionalText)
  @IsIn(TRACK_STYLE_OPTIONS)
  style?: TrackStyleOption;

  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  @Max(TRACK_TEMPO_MAX)
  mpm?: number;

  @IsOptional()
  @Transform(optionalNumber)
  @IsNumber()
  @Min(1)
  @Max(TRACK_TEMPO_MAX)
  rawBpm?: number;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Length(1, TRACK_SOURCE_KEY_MAX_LENGTH)
  sourceKey?: string;

  @Transform(lowerHex)
  @IsString()
  @Matches(SHA256_HEX)
  sha256!: string;
}
