import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * Suppression de compte (droit à l'oubli RGPD art. 17, exigence Apple 5.1.1(v)).
 * Le mot de passe courant est exigé pour prouver que le détenteur du compte
 * est bien à l'origine de la demande (un token volé ne suffit pas).
 */
export class DeleteAccountDto {
  @ApiProperty({
    description: "Mot de passe courant (confirmation de la suppression)",
    example: "MonMotDePasse123!",
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
