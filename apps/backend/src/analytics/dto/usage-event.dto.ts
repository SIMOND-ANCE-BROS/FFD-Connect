import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import {
  USAGE_EVENT_NAMES,
  USAGE_MAX_BATCH,
  USAGE_MAX_DURATION_SEC,
  USAGE_PLATFORMS,
  USAGE_SPACES,
  type UsageEventName,
  type UsagePlatform,
  type UsageSpace,
} from "../usage.constants";

export class UsageEventDto {
  @ApiProperty({ description: "Random install ID (UUID v4), renewed monthly" })
  @IsUUID("4")
  installId!: string;

  @ApiProperty({ enum: USAGE_EVENT_NAMES })
  @IsIn(USAGE_EVENT_NAMES)
  name!: UsageEventName;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_]+$/)
  screen?: string;

  @ApiProperty({ description: "ISO date, truncated to the minute by the app" })
  @IsISO8601({ strict: true })
  occurredAt!: string;

  @ApiProperty({ enum: USAGE_PLATFORMS })
  @IsIn(USAGE_PLATFORMS)
  platform!: UsagePlatform;

  @ApiProperty({ maxLength: 20 })
  @MaxLength(20)
  @Matches(/^[0-9A-Za-z.-]+$/)
  appVersion!: string;

  @ApiProperty({ enum: USAGE_SPACES })
  @IsIn(USAGE_SPACES)
  space!: UsageSpace;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  competitionId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: USAGE_MAX_DURATION_SEC })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(USAGE_MAX_DURATION_SEC)
  durationSec?: number;
}

export class UsageBatchDto {
  @ApiProperty({
    type: [UsageEventDto],
    minItems: 1,
    maxItems: USAGE_MAX_BATCH,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(USAGE_MAX_BATCH)
  @ValidateNested({ each: true })
  @Type(() => UsageEventDto)
  events!: UsageEventDto[];
}
