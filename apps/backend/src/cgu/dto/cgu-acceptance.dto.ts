import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { CGU_VERSION_PATTERN } from "../cgu-version";

/** CGU acceptance of the signed-in account (#894). */
export class CguAcceptanceDto {
  @ApiProperty({ example: "3", description: "Version des CGU en vigueur" })
  currentVersion!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: "3",
    description:
      "Dernière version acceptée par ce compte (null : jamais acceptées)",
  })
  acceptedVersion!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: "date-time",
    description:
      "Date de la première acceptation de acceptedVersion (null : jamais)",
  })
  acceptedAt!: string | null;

  @ApiProperty({
    description:
      "true : ce compte a accepté la version en vigueur, rien à demander",
  })
  accepted!: boolean;
}

export class AcceptCguDto {
  @ApiProperty({ example: "3", description: "Version des CGU acceptée" })
  @IsString()
  @Matches(CGU_VERSION_PATTERN)
  version!: string;
}
