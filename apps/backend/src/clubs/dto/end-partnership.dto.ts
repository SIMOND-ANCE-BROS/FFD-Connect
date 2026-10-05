import { ApiProperty } from "@nestjs/swagger";
import { IsDateString } from "class-validator";

export class EndPartnershipDto {
  @ApiProperty({ description: "Date de fin du partenariat" })
  @IsDateString()
  endDate!: string;
}
