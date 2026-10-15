import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

/**
 * A signed license QR is ~120 chars, a rotating entry QR (v3, #24) ~250;
 * anything far longer is not a QR we issue.
 */
export const CHECK_IN_QR_DATA_MAX_LENGTH = 512;

/**
 * DTO pour le check-in d'un participant à une compétition
 */
export class CheckInDto {
  @ApiProperty({
    description:
      "Contenu du QR de licence scanné : QR d'entrée tournant (v3, #24, signé Ed25519, valable ~90 s), QR signé lié à la licence (v2, #466 — pass Wallet), QR signé v1 (#168, accepté jusqu'à son expiration), ancien JSON non signé, ou identifiant brut",
    example:
      '{"v":3,"k":"AbCdEfGhIjK","id":"FFD-123456","lid":"3f0c…","nm":"DUPONT Jean","t":59612345,"sig":"…"}',
    maxLength: CHECK_IN_QR_DATA_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CHECK_IN_QR_DATA_MAX_LENGTH)
  qrData!: string;

  @ApiPropertyOptional({
    description:
      "Instant du scan (ISO 8601) pour un check-in scanné hors ligne puis synchronisé (#24) : le QR est vérifié à cet instant. Ni dans le futur, ni plus vieux que 48 h. Absent = maintenant.",
    example: "2026-10-16T09:12:30.000Z",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  scannedAt?: string;
}

export class CheckInUserDto {
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class CheckInRegistrationResultDto {
  @ApiProperty({ description: "Catégorie de l'épreuve" })
  event!: string;

  @ApiProperty({ enum: ["SUCCESS", "ALREADY_CHECKED_IN", "ERROR"] })
  status!: "SUCCESS" | "ALREADY_CHECKED_IN" | "ERROR";

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  bibNumber?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  partner?: string | null;
}

export class CheckInQrVerificationDto {
  @ApiProperty({
    enum: ["off", "warn", "enforce"],
    description: "Mode effectif (off si la signature est désactivée)",
  })
  mode!: "off" | "warn" | "enforce";

  @ApiProperty({
    enum: [
      "NOT_CHECKED",
      "VALID",
      "UNSIGNED",
      "INVALID_SIGNATURE",
      "EXPIRED",
      "STALE",
      "LICENSE_MISMATCH",
    ],
    description:
      "STALE : QR tournant (v3, #24) authentique mais hors de sa fenêtre de validité (capture d'écran rejouée, ou horloge décalée). LICENSE_MISMATCH : QR authentique émis avant un changement de numéro de licence (#466) — accepté en mode warn pour la licence d'origine, refusé en enforce",
  })
  status!:
    | "NOT_CHECKED"
    | "VALID"
    | "UNSIGNED"
    | "INVALID_SIGNATURE"
    | "EXPIRED"
    | "STALE"
    | "LICENSE_MISMATCH";

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Avertissement à afficher au staff (QR accepté mais non vérifié), null sinon",
    example: "QR non vérifié : ancien QR non signé",
  })
  warning!: string | null;
}

/** Réponse des deux endpoints de check-in (staff et bénévole). */
export class CheckInResponseDto {
  @ApiProperty({ type: CheckInUserDto })
  user!: CheckInUserDto;

  @ApiProperty({ type: [CheckInRegistrationResultDto] })
  registrations!: CheckInRegistrationResultDto[];

  @ApiProperty({ type: CheckInQrVerificationDto })
  qrVerification!: CheckInQrVerificationDto;
}
