import { ApiProperty } from "@nestjs/swagger";

export class AdminReferenceDataDto {
  @ApiProperty({ type: [String] }) categories!: string[];
  @ApiProperty({ type: [String] }) ageGroups!: string[];
  @ApiProperty({ type: [String] }) competitionLevels!: string[];
  @ApiProperty({ type: [String] }) passportLevels!: string[];
  @ApiProperty({ type: [String] }) roles!: string[];
}

export class AdminClubOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
