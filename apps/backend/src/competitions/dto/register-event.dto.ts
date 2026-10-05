import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/**
 * DTO pour l'inscription à un événement de compétition
 */
export class RegisterEventDto {
  @ApiProperty({
    description: "ID de l'événement auquel s'inscrire",
    example: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  })
  @IsUUID(4, { message: "eventId doit être un UUID v4 valide" })
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({
    description: "Nom du partenaire (obligatoire pour épreuve couple)",
    example: "Jean Dupont",
    required: false,
    maxLength: 100,
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  partnerName?: string;

  @ApiProperty({
    description:
      "ID du partenaire licencié (optionnel ; si fourni, la classe d'âge couple est calculée automatiquement)",
    required: false,
  })
  @IsUUID(4)
  @IsOptional()
  partnerUserId?: string;

  @ApiProperty({
    description:
      "Classe d'âge du couple (sinon calculée si birthDate connus, ou celle de l'épreuve)",
    required: false,
  })
  @IsString()
  @MaxLength(50)
  @IsOptional()
  coupleAgeGroup?: string;

  @ApiProperty({
    description: "Le couple pratique la discipline Latine",
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  coupleDisciplineLatin?: boolean;

  @ApiProperty({
    description: "Le couple pratique la discipline Standard",
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  coupleDisciplineStandard?: boolean;

  @ApiProperty({
    description:
      "Niveau du couple/solo (obligatoire pour épreuves classificatrices : International, Avancé, Intermédiaire, Débutant)",
    required: false,
    enum: ["International", "Avancé", "Intermédiaire", "Débutant"],
  })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  registrantLevel?: string;
}
