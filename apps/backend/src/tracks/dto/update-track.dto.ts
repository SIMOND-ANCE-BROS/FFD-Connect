import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * DTO pour la mise à jour d'une track (édition par l'utilisateur depuis la modale d'ajout).
 * Tous les champs sont optionnels — seuls les champs fournis sont mis à jour.
 */
export class UpdateTrackDto {
  @ApiPropertyOptional({ description: "Titre de la musique" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: "Artiste" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  artist?: string;

  @ApiPropertyOptional({
    description: "Style de danse (texte libre, ex. Rumba, Tango)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  style?: string;

  @ApiPropertyOptional({ description: "BPM/MPM corrigé par l'utilisateur" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  bpm?: number;

  @ApiPropertyOptional({
    description:
      "Modération (ADMIN) — masque le titre réel pour les clients non-admin.",
  })
  @IsOptional()
  @IsBoolean()
  titleMasked?: boolean;

  @ApiPropertyOptional({
    description:
      "Modération (ADMIN) — blackliste la piste : elle disparaît de la bibliothèque partagée.",
  })
  @IsOptional()
  @IsBoolean()
  blacklisted?: boolean;

  @ApiPropertyOptional({
    description:
      "Paso doble (ADMIN) — timecodes (secondes) des appels/coups affichés sur le lecteur. Remplace entièrement la liste existante.",
    type: [Number],
    example: [12.5, 40.0, 68.3],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  clashTimecodes?: number[];
}
