import { ApiProperty } from "@nestjs/swagger";
import { ClubRegistrationMode } from "@prisma/client";
import { IsEnum } from "class-validator";

const REGISTRATION_MODE_DESCRIPTION =
  "CLUB_AND_MEMBERS_PENDING = licenciés peuvent s'inscrire, validation par le club ; " +
  "CLUB_ONLY = seul le club inscrit les licenciés ; " +
  "MEMBERS_AUTO_CONFIRM = inscriptions licenciés validées automatiquement.";

export class SetRegistrationModeDto {
  @ApiProperty({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
    description: REGISTRATION_MODE_DESCRIPTION,
  })
  @IsEnum(ClubRegistrationMode)
  registrationMode!: ClubRegistrationMode;
}

/** `GET /clubs/me/registration-mode` (#665): the club setting on its own. */
export class ClubRegistrationModeDto {
  @ApiProperty({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
    nullable: true,
    description:
      `${REGISTRATION_MODE_DESCRIPTION} ` +
      "null quand l'utilisateur n'a pas de club (ou qu'un ancien compte sans club rattaché désigne plusieurs clubs ou aucun).",
  })
  registrationMode!: ClubRegistrationMode | null;
}

/** `PATCH /clubs/me/registration-mode` response. */
export class ClubRegistrationModeUpdatedDto {
  @ApiProperty() clubName!: string;

  @ApiProperty({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
  })
  registrationMode!: ClubRegistrationMode;
}
