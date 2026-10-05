import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, MinLength } from "class-validator";

const SOLO_TEAM_LEVELS = ["Débutant", "Intermédiaire"] as const;

export class CreateSoloTeamDto {
  @ApiProperty({ example: "Team Latine 2025" })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    enum: SOLO_TEAM_LEVELS,
    description:
      "Niveau (calculé automatiquement si absent après ajout de membres)",
  })
  @IsIn(SOLO_TEAM_LEVELS)
  level!: (typeof SOLO_TEAM_LEVELS)[number];
}
