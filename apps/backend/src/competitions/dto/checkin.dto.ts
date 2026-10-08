import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

/**
 * DTO pour le check-in d'un participant à une compétition
 */
export class CheckInDto {
  @ApiProperty({
    description:
      "Contenu du QR de licence scanné : QR signé (#168), ancien JSON non signé, ou identifiant brut",
    example: '{"v":1,"id":"FFD-123456","exp":"2026-08-31","sig":"…"}',
  })
  @IsString()
  @IsNotEmpty()
  qrData!: string;
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
    enum: ["NOT_CHECKED", "VALID", "UNSIGNED", "INVALID_SIGNATURE", "EXPIRED"],
  })
  status!:
    | "NOT_CHECKED"
    | "VALID"
    | "UNSIGNED"
    | "INVALID_SIGNATURE"
    | "EXPIRED";

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
