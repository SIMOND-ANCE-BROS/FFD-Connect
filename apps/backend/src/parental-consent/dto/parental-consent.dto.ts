import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  Equals,
  IsAscii,
  IsEmail,
  IsHexadecimal,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
} from "class-validator";
import {
  normalizeEmailTransform,
  STORED_EMAIL_ASCII_MESSAGE,
  STORED_EMAIL_OPTIONS,
} from "../../auth/email-identity";
import type { ParentalConsentLinkState } from "../parental-consent.query-service";
import type {
  ParentalConsentOutcome,
  ParentalConsentState,
} from "../parental-consent.policy";

/** Length of a link token: 32 random bytes, hex-encoded. */
export const PARENTAL_CONSENT_TOKEN_LENGTH = 64;

export class RequestParentalConsentDto {
  @ApiProperty({
    description: "Adresse e-mail d'un parent ou représentant légal",
    example: "parent@example.com",
  })
  @Transform(normalizeEmailTransform)
  @IsEmail(STORED_EMAIL_OPTIONS)
  @IsAscii({ message: STORED_EMAIL_ASCII_MESSAGE })
  @IsNotEmpty()
  @MaxLength(255)
  parentEmail!: string;
}

export class ParentalConsentTokenDto {
  @ApiProperty({
    description: "Jeton du lien reçu par e-mail par le représentant légal",
    example: "a1b2c3…",
  })
  @IsString()
  @IsHexadecimal()
  @Length(PARENTAL_CONSENT_TOKEN_LENGTH, PARENTAL_CONSENT_TOKEN_LENGTH)
  token!: string;
}

export class ConfirmParentalConsentDto extends ParentalConsentTokenDto {
  @ApiProperty({
    description:
      "Accord au traitement des données de l'enfant (RGPD art. 8) et aux CGU",
    example: true,
  })
  @Equals(true, { message: "L'accord au traitement des données est requis" })
  acceptDataProcessing!: boolean;

  @ApiProperty({
    description:
      "Accord explicite au traitement du certificat médical (RGPD art. 9)",
    example: true,
  })
  @Equals(true, {
    message:
      "L'accord explicite au traitement du certificat médical est requis",
  })
  acceptHealthData!: boolean;
}

export class ParentalConsentStateDto {
  @ApiProperty({
    enum: ["NOT_REQUIRED", "REQUIRED", "PENDING", "GRANTED"],
    description:
      "NOT_REQUIRED : majeur (ou âge inconnu) ; REQUIRED : mineur sans accord ; PENDING : lien envoyé ; GRANTED : accord donné",
  })
  state!: ParentalConsentState;

  @ApiPropertyOptional({
    enum: ["EXPIRED", "REVOKED"],
    nullable: true,
    type: String,
    description: "Pourquoi un mineur est revenu à REQUIRED",
  })
  lastOutcome!: ParentalConsentOutcome | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: "p***@g***.fr",
  })
  parentEmailMasked!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  requestedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  expiresAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  grantedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  revokedAt!: Date | null;
}

export class ParentalConsentLinkDto {
  @ApiProperty({ example: "Léa" })
  childFirstName!: string;

  @ApiProperty({ enum: ["PENDING", "EXPIRED", "GRANTED", "REVOKED"] })
  state!: ParentalConsentLinkState;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  grantedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String, format: "date-time" })
  revokedAt!: Date | null;
}
