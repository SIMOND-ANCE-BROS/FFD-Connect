import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/** Longueur max d'un numéro de licence FFD (partagée avec AuthService). */
export const LICENSE_NUMBER_MAX_LENGTH = 50;

export class RegisterDto {
  @ApiProperty({
    description: "Adresse email",
    example: "danseur@example.com",
  })
  @IsEmail()
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
}
