import { ApiProperty } from "@nestjs/swagger";
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import type { ID } from "@ffd-connect/shared";

export class CreateReportDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: ID;

  @ApiProperty({
    enum: ["BUG", "FEATURE"],
    description: "Type de rapport",
  })
  @IsEnum(["BUG", "FEATURE"])
  @IsNotEmpty()
  type!: "BUG" | "FEATURE";

  @ApiProperty({
    description: "Titre du rapport",
    example: "Bug dans la connexion",
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200, { message: "Le titre ne peut pas dépasser 200 caractères" })
  title!: string;

  @ApiProperty({
    description: "Description du rapport",
    example: "Le bouton de connexion ne fonctionne pas",
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000, {
    message: "La description ne peut pas dépasser 5000 caractères",
  })
  description!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  module?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  logs?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  steps?: string;

  @ApiProperty({
    enum: ["LOW", "MEDIUM", "HIGH"],
    required: false,
  })
  @IsOptional()
  @IsEnum(["LOW", "MEDIUM", "HIGH"])
  severity?: "LOW" | "MEDIUM" | "HIGH";

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  stackTrace?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  deviceInfo?: string;
}
