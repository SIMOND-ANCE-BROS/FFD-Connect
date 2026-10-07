import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrackCorrectionReason, TrackCorrectionStatus } from "@prisma/client";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";

/** Longueur maximale du commentaire libre (auteur ou administrateur). */
export const TRACK_CORRECTION_MESSAGE_MAX_LENGTH = 500;

/**
 * Nombre maximal de timecodes de clash. Aligné sur `UpdateTrackDto` (PATCH
 * /tracks/:id) : une valeur validée ici doit rester ré-éditable par l'admin.
 */
export const TRACK_CORRECTION_MAX_CLASHES = 10;

/** Timecode maximal d'un clash (secondes) : une musique de compétition dure ~2 min. */
export const TRACK_CORRECTION_MAX_CLASH_SECONDS = 3600;

/**
 * Valeurs de métadonnées proposables pour une piste. Partagé par la
 * proposition (utilisateur) et la validation (admin, qui peut ajuster les
 * valeurs avant d'appliquer). Champ absent = pas de proposition sur ce champ.
 */
export class TrackCorrectionValuesDto {
  @ApiPropertyOptional({ description: "Titre proposé", maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: "Artiste proposé", maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  artist?: string;

  @ApiPropertyOptional({
    description: "Danse proposée (texte libre, ex. Rumba, Tango)",
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  style?: string;

  @ApiPropertyOptional({
    description: "Tempo proposé, en MPM (mesures par minute)",
    minimum: 1,
    maximum: 400,
    example: 31,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(400)
  bpm?: number;

  @ApiPropertyOptional({
    description:
      "Paso doble — timecodes (secondes) des clashs proposés. Remplace entièrement la liste ; une liste vide propose « aucun clash ».",
    type: [Number],
    maxItems: TRACK_CORRECTION_MAX_CLASHES,
    example: [12.5, 40.0, 68.3],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TRACK_CORRECTION_MAX_CLASHES)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true })
  @Min(0, { each: true })
  @Max(TRACK_CORRECTION_MAX_CLASH_SECONDS, { each: true })
  clashTimecodes?: number[];
}

/**
 * Proposition de correction d'une piste. Ouverte à tout utilisateur
 * authentifié ; il faut au moins une valeur qui diffère de la piste actuelle
 * ou un message.
 */
export class CreateTrackCorrectionDto extends TrackCorrectionValuesDto {
  @ApiProperty({ description: "UUID de la musique concernée" })
  @IsUUID()
  trackId!: string;

  @ApiProperty({
    enum: TrackCorrectionReason,
    enumName: "TrackCorrectionReason",
    description: "Métadonnée jugée incorrecte",
  })
  @IsEnum(TrackCorrectionReason)
  reason!: TrackCorrectionReason;

  @ApiPropertyOptional({
    description: "Précisions libres pour l'administrateur",
    maxLength: TRACK_CORRECTION_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TRACK_CORRECTION_MESSAGE_MAX_LENGTH)
  message?: string;
}

/**
 * Validation d'une proposition (ADMIN). Les valeurs fournies remplacent
 * celles de la proposition avant application à la piste.
 */
export class ApproveTrackCorrectionDto extends TrackCorrectionValuesDto {
  @ApiPropertyOptional({
    description: "Commentaire transmis à l'auteur de la proposition",
    maxLength: TRACK_CORRECTION_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TRACK_CORRECTION_MESSAGE_MAX_LENGTH)
  comment?: string;
}

/** Refus d'une proposition (ADMIN). */
export class RejectTrackCorrectionDto {
  @ApiPropertyOptional({
    description: "Motif du refus, transmis à l'auteur de la proposition",
    maxLength: TRACK_CORRECTION_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(TRACK_CORRECTION_MESSAGE_MAX_LENGTH)
  comment?: string;
}

/**
 * Filtre + pagination de la file de modération. Sans statut : toutes les
 * propositions. Hérite de la pagination plutôt que de la combiner en second
 * `@Query()` : `forbidNonWhitelisted` rejetterait alors les champs de l'autre.
 */
export class ListTrackCorrectionsQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({
    enum: TrackCorrectionStatus,
    enumName: "TrackCorrectionStatus",
    description: "Statut à afficher (PENDING pour la file à traiter)",
  })
  @IsOptional()
  @IsEnum(TrackCorrectionStatus)
  status?: TrackCorrectionStatus;
}
