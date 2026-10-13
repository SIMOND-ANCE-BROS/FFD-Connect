import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { normalizeEmailTransform } from "../email-identity";

/**
 * DTO pour l'authentification d'un utilisateur
 */
export class LoginDto {
  @ApiProperty({
    description: "Nom d'utilisateur ou email",
    example: "user@example.com",
    type: "string",
  })
  @Transform(normalizeEmailTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[a-zA-Z0-9._%+-@]+$/, {
    message: "username must contain only letters, numbers, and . _ % + - @",
  })
  username!: string;

  @ApiProperty({
    description: "Mot de passe de l'utilisateur",
    example: "password123",
    minLength: 6,
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
