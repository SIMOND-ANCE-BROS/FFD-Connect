import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Motif d'un signalement de problème sur une piste. Choisi par l'utilisateur
 * qui repère une métadonnée incorrecte ou un souci sur la musique.
 */
export enum ReportTrackReason {
  TITLE = "TITLE",
  ARTIST = "ARTIST",
  DANCE = "DANCE",
  MPM = "MPM",
  PASO_CLASH = "PASO_CLASH",
  OTHER = "OTHER",
}

/**
 * DTO pour signaler un problème sur une piste. N'importe quel utilisateur
 * authentifié peut signaler ; chaque admin reçoit une notification.
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
