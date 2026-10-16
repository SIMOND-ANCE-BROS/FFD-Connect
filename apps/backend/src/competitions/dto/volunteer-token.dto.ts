import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString, MaxLength } from "class-validator";
import { CHECK_IN_QR_DATA_MAX_LENGTH } from "./checkin.dto";

export class GenerateVolunteerTokenDto {
  @ApiProperty({
    description: "Nom du bénévole (optionnel)",
    example: "Jean Dupont",
    required: false,
  })
  @IsString()
  @IsOptional()
  name?: string;
}

export class VolunteerTokenResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  id!: string;

  @ApiProperty({ example: "abc123xyz..." })
  token!: string;

  @ApiProperty({ example: "comp-123" })
  competitionId!: string;

  @ApiProperty({ example: "2026-02-24T12:00:00.000Z" })
  expiresAt!: Date;

  @ApiProperty({ example: "Bénévole" })
  name!: string;

  @ApiProperty({
    example:
      "https://ffd-connect.fr/volunteer/checkin?token=abc123xyz&id=comp-123",
    description: "Lien d'accès direct pour le bénévole",
  })
  accessUrl!: string;
}

export class VolunteerCheckInDto {
  @ApiProperty({ description: "Jeton d'accès bénévole" })
  @IsString()
  token!: string;

  @ApiProperty({ description: "ID de la compétition" })
  @IsString()
  competitionId!: string;

  @ApiProperty({
    description: "Données du QR code du participant",
    maxLength: CHECK_IN_QR_DATA_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(CHECK_IN_QR_DATA_MAX_LENGTH)
  qrData!: string;

  @ApiPropertyOptional({
    description:
      "Instant du scan (ISO 8601) pour un check-in scanné hors ligne puis synchronisé (#24). QR tournant (v3) uniquement, valide à cet instant quel que soit le mode ; ni dans le futur, ni plus vieux que 12 h, et dans les jours de la compétition (Europe/Paris). Gardé à part (`checkInClaimedScanAt`) : l'heure du check-in reste celle du serveur. Absent = maintenant.",
    example: "2026-10-16T09:12:30.000Z",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  scannedAt?: string;
}
