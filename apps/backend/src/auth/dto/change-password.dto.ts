import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MinLength } from "class-validator";

/**
 * DTO pour le changement de mot de passe (utilisateur authentifié)
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: "Mot de passe actuel",
    example: "CurrentPassword123!",
  })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({
    description: "Nouveau mot de passe",
    example: "NewSecurePassword123!",
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;
}
