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
 * DTO pour l'inscription d'un membre du club par l'organisateur.
 */
export class RegisterMemberDto {
  @ApiProperty({
    description: "ID de l'événement",
    example: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  })
  @IsUUID(4)
  @IsNotEmpty()
  eventId!: string;

  @ApiProperty({
    description: "ID du membre (licencié) à inscrire",
    example: "b1ffcd00-0d1c-5fg9-cc7e-7cc0ce491b22",
  })
  @IsUUID(4)
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: "Nom du partenaire (obligatoire pour épreuve couple)",
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
    description: "Classe d'âge du couple (sinon calculée si birthDate connus)",
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
      "Niveau du couple/solo dans la discipline de l'épreuve. Absent : niveau du profil du membre pour cette discipline. Ignoré pour les 10 danses.",
    required: false,
    enum: ["International", "Avancé", "Intermédiaire", "Débutant"],
  })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  registrantLevel?: string;
}
