import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsAscii,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import {
  normalizeEmailTransform,
  STORED_EMAIL_ASCII_MESSAGE,
  STORED_EMAIL_OPTIONS,
} from "../email-identity";

/** Longueur max d'un numéro de licence FFD (partagée avec AuthService). */
export const LICENSE_NUMBER_MAX_LENGTH = 50;

export class RegisterDto {
  @ApiProperty({
    description: "Adresse email",
    example: "danseur@example.com",
  })
  @Transform(normalizeEmailTransform)
  @IsEmail(STORED_EMAIL_OPTIONS)
  @IsAscii({ message: STORED_EMAIL_ASCII_MESSAGE })
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    description:
      "Mot de passe (min 8 caractères, majuscule, minuscule, chiffre, spécial)",
    example: "MonMotDePasse1!",
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    description: "Numéro de licence FFD",
    example: "FFD-2025-12345",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(LICENSE_NUMBER_MAX_LENGTH)
  licenseNumber!: string;

  @ApiProperty({
    description: "Nom de famille (doit correspondre à la licence)",
    example: "Dupont",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    description: "Prénom",
    example: "Marie",
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  firstName!: string;

  @ApiPropertyOptional({
    description:
      "E-mail d'un parent ou représentant légal (#61). Utilisé seulement si la licence désigne un mineur : un lien d'accord lui est envoyé. Ignoré pour un majeur.",
    example: "parent@example.com",
  })
  @IsOptional()
  @Transform(normalizeEmailTransform)
  @IsEmail(STORED_EMAIL_OPTIONS)
  @IsAscii({ message: STORED_EMAIL_ASCII_MESSAGE })
  @MaxLength(255)
  parentEmail?: string;
}
