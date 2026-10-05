import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class WebhookMetadataDto {
  @ApiProperty({ example: "booking-uuid" })
  @IsString()
  @IsNotEmpty()
  bookingId!: string;
}

class WebhookDataDto {
  @ApiPropertyOptional({ type: WebhookMetadataDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookMetadataDto)
  metadata?: WebhookMetadataDto;
}

export class WebhookPayloadDto {
  @ApiProperty({ example: "Order" })
  @IsString()
  @IsNotEmpty()
  eventType!: string;

  @ApiProperty({ type: WebhookDataDto })
  @IsObject()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data!: WebhookDataDto;
}
