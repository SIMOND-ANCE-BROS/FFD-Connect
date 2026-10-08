import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
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
}
