import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty } from "class-validator";

/**
 * DTO pour la demande de réinitialisation de mot de passe
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: "Email de l'utilisateur",
    example: "user@example.com",
    type: String,
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
