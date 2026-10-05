import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateCheckoutDto {
  @ApiProperty({ example: "comp-uuid" })
  @IsString()
  @IsNotEmpty()
  competitionId!: string;

  @ApiProperty({ example: "item-uuid" })
  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @ApiPropertyOptional({ example: "Rang A, Place 5" })
  @IsString()
  @IsOptional()
  seatLabel?: string;

  @ApiProperty({ example: 10.5 })
  @IsNumber()
  amount!: number;
}
