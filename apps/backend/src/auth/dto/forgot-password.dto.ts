import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty } from "class-validator";
import { normalizeEmailTransform } from "../email-identity";

/**
 * DTO pour la demande de réinitialisation de mot de passe
 */
export class ForgotPasswordDto {
  @ApiProperty({
    description: "Email de l'utilisateur",
    example: "user@example.com",
    type: String,
  })
  @Transform(normalizeEmailTransform)
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
