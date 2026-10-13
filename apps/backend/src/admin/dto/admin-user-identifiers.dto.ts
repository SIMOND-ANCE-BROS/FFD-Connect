import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsAscii,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";
import {
  LICENSE_NUMBER_MAX_LENGTH,
  LICENSE_NUMBER_PATTERN,
} from "../../licenses/license-number.util";
import {
  normalizeEmailTransform,
  STORED_EMAIL_ASCII_MESSAGE,
  STORED_EMAIL_OPTIONS,
} from "../../auth/email-identity";
import { AdminUserDetailDto } from "./admin-users.dto";

/** RFC 5321 upper bound of a mailbox. */
export const EMAIL_MAX_LENGTH = 254;

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
/** Absent = unchanged; `null` is validated (and refused): neither can be cleared. */
const present = (_: object, v: unknown) => v !== undefined;

/**
 * Login email and licence number of an account, changed by an administrator
 * (#448). Each key is optional, absent = unchanged; neither can be cleared.
 */
export class UpdateAdminUserIdentifiersDto {
  @ApiPropertyOptional({
    description:
      "Nouvel email de connexion (normalisé en minuscules, sans espaces). Ferme les sessions du compte et prévient l'ancienne adresse.",
    maxLength: EMAIL_MAX_LENGTH,
  })
  @ValidateIf(present)
  @Transform(normalizeEmailTransform)
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  @IsEmail(STORED_EMAIL_OPTIONS, { message: "Adresse email invalide" })
  @IsAscii({ message: STORED_EMAIL_ASCII_MESSAGE })
  email?: string;

  @ApiPropertyOptional({
    description:
      "Nouveau numéro de la licence rattachée au compte (le compte doit déjà avoir une licence).",
    maxLength: LICENSE_NUMBER_MAX_LENGTH,
    example: "FFD-123456",
  })
  @ValidateIf(present)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(LICENSE_NUMBER_MAX_LENGTH)
  @Matches(LICENSE_NUMBER_PATTERN, {
    message: "Le numéro de licence contient des caractères non autorisés",
  })
  licenseNumber?: string;
}

export class AdminUserIdentifiersUpdatedDto {
  @ApiProperty({ type: AdminUserDetailDto }) user!: AdminUserDetailDto;

  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      "Email changé : true si l'ancienne adresse a été prévenue, false si l'envoi a échoué. null si l'email n'a pas changé.",
  })
  previousEmailNotified!: boolean | null;
}
