import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean } from "class-validator";

export class ValidatePartnershipDto {
  @ApiProperty({ description: "true = accepter le couple, false = refuser" })
  @IsBoolean()
  accepted!: boolean;
}
