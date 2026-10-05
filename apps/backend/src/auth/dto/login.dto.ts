import { ApiProperty } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * DTO pour l'authentification d'un utilisateur
 */
export class LoginDto {
  @ApiProperty({
    description: "Nom d'utilisateur ou email",
    example: "user@example.com",
    type: "string",
  })
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
