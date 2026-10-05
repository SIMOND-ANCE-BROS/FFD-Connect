import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

export class AddSoloTeamMemberDto {
  @ApiProperty({ description: "ID du licencié (membre du club)" })
  @IsUUID()
  userId!: string;
}
