import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TrackCorrectionReason } from "@prisma/client";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Motif d'un signalement de problème sur une piste. Choisi par l'utilisateur
 * qui repère une métadonnée incorrecte ou un souci sur la musique.
 *
 * Alias de l'enum Prisma `TrackCorrectionReason` : un signalement est stocké
 * comme une proposition de correction sans valeur proposée.
 */
export const ReportTrackReason = TrackCorrectionReason;
export type ReportTrackReason = TrackCorrectionReason;

/**
 * Motifs acceptés par la route historique : ceux de l'enum d'origine, le
 * contrat de POST /tracks/:id/report est inchangé. Un motif ajouté depuis
 * (`DELETE`, #446) n'existe que sur POST /track-corrections, qui en porte les
 * règles (message obligatoire, une seule demande en attente).
 */
export const LEGACY_REPORT_REASONS: readonly TrackCorrectionReason[] = [
  TrackCorrectionReason.TITLE,
  TrackCorrectionReason.ARTIST,
  TrackCorrectionReason.DANCE,
  TrackCorrectionReason.MPM,
  TrackCorrectionReason.PASO_CLASH,
  TrackCorrectionReason.OTHER,
];

/**
 * DTO pour signaler un problème sur une piste (route historique, conservée
 * pour les versions de l'application déjà installées). N'importe quel
 * utilisateur authentifié peut signaler ; le signalement entre dans la file
 * des propositions de correction et chaque admin reçoit une notification.
 */
export class ReportTrackDto {
  @ApiProperty({
    enum: LEGACY_REPORT_REASONS,
    description: "Motif du signalement",
  })
  @IsIn(LEGACY_REPORT_REASONS)
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
