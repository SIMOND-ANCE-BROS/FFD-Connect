import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

/**
 * DTO pour la réinitialisation de mot de passe avec un token
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: "Token de réinitialisation reçu par email",
    example: "a1b2c3d4e5f6...",
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({
    description: "Nouveau mot de passe",
    example: "NewSecurePassword123!",
    minLength: 8,
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
