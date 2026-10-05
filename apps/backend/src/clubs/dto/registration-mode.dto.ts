import { ApiProperty } from "@nestjs/swagger";
import { ClubRegistrationMode } from "@prisma/client";
import { IsEnum } from "class-validator";

export class SetRegistrationModeDto {
  @ApiProperty({
    enum: ClubRegistrationMode,
    description:
      "CLUB_AND_MEMBERS_PENDING = licenciés peuvent s'inscrire, validation par le club ; " +
      "CLUB_ONLY = seul le club inscrit les licenciés ; " +
      "MEMBERS_AUTO_CONFIRM = inscriptions licenciés validées automatiquement.",
  })
  @IsEnum(ClubRegistrationMode)
  registrationMode!: ClubRegistrationMode;
}
