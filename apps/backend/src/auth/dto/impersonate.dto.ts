import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { trimEmailTransform } from "../email-identity";

/**
 * Démarrage d'une impersonation « se connecter en tant que » (#545).
 * Cible identifiée par UUID OU email (l'un des deux requis — vérifié côté
 * service). Réservé à l'admin (#733) ; la raison est facultative.
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
  @Transform(trimEmailTransform)
  @IsEmail()
  targetEmail?: string;

  @ApiPropertyOptional({
    description:
      "Raison de l'impersonation (facultative, journalisée). Elle est restituée à l'utilisateur ciblé dans son export RGPD (GET /users/me/export) : n'y écrire aucune donnée personnelle d'un tiers.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
