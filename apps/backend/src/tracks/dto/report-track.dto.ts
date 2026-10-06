import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrackCorrectionReason } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Motif d'un signalement de problème sur une piste. Choisi par l'utilisateur
 * qui repère une métadonnée incorrecte ou un souci sur la musique.
 *
 * Alias de l'enum Prisma `TrackCorrectionReason` : un signalement est stocké
 * comme une proposition de correction sans valeur proposée. Mêmes valeurs que
 * l'enum historique, le contrat de POST /tracks/:id/report est inchangé.
 */
export const ReportTrackReason = TrackCorrectionReason;
export type ReportTrackReason = TrackCorrectionReason;

/**
 * DTO pour signaler un problème sur une piste (route historique, conservée
 * pour les versions de l'application déjà installées). N'importe quel
 * utilisateur authentifié peut signaler ; le signalement entre dans la file
 * des propositions de correction et chaque admin reçoit une notification.
 */
export class ReportTrackDto {
  @ApiProperty({
    enum: ReportTrackReason,
    description: "Motif du signalement",
  })
  @IsEnum(ReportTrackReason)
  reason!: ReportTrackReason;

  @ApiPropertyOptional({
    description: "Précisions libres sur le problème (facultatif)",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
