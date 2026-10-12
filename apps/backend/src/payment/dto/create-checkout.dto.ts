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

  /**
   * Ignored (#381): the amount is computed server-side from the competition
   * layout. Still accepted so that older clients sending it are not rejected
   * by the global `forbidNonWhitelisted` validation.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      "Ignoré : le montant est calculé côté serveur à partir du tarif de la place.",
    example: 1500,
  })
  @IsOptional()
  @IsNumber()
  amount?: number;
}
