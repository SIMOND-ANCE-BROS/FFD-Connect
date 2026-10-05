import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";

/**
 * Démarrage d'une impersonation « se connecter en tant que » (#545).
 * Cible identifiée par UUID OU email (l'un des deux requis — vérifié côté
 * service). La raison est facultative pour l'admin, obligatoire pour le staff.
 */
export class ImpersonateDto {
  @ApiPropertyOptional({ description: "UUID de l'utilisateur cible" })
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @ApiPropertyOptional({
    description: "Email de l'utilisateur cible (alternative à targetUserId)",
  })
  @IsOptional()
  @IsEmail()
  targetEmail?: string;

  @ApiPropertyOptional({
    description:
      "Raison de l'impersonation (obligatoire pour le staff, journalisée).",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
