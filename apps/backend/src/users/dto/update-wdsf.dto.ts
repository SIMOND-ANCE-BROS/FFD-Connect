import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsOptional,
  IsString,
  IsDateString,
  ValidateNested,
  ValidateIf,
} from "class-validator";

export class WdsfDataDto {
  @ApiPropertyOptional({ description: "Numéro MIN WDSF", example: "10117265" })
  @IsString()
  min!: string;

  @ApiPropertyOptional({ description: "Nationalité", example: "France" })
  @IsOptional()
  @IsString()
  nationality?: string;

  @ApiPropertyOptional({
    description: "Type de licence",
    example: "General Athlete",
  })
  @IsOptional()
  @IsString()
  licenseType?: string;

  @ApiPropertyOptional({ description: "Classe d'âge WDSF", example: "Adult" })
  @IsOptional()
  @IsString()
  ageGroup?: string;

  @ApiPropertyOptional({
    description: "Date d'expiration (ISO)",
    example: "2025-12-31",
  })
  @IsOptional()
  @IsDateString()
  expiresOn?: string;
}

/**
 * DTO pour mettre à jour la licence WDSF liée au compte (PATCH /users/me).
 * Envoyer wdsf: null pour dissocier la licence WDSF.
 */
export class UpdateWdsfDto {
  @ApiPropertyOptional({
    description: "Données WDSF (null pour supprimer le lien)",
    type: WdsfDataDto,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v != null)
  @ValidateNested()
  @Type(() => WdsfDataDto)
  wdsf?: WdsfDataDto | null;
}
