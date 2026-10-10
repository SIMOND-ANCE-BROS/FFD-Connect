import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { USAGE_SPACES, type UsageSpace } from "../usage.constants";

export const USAGE_PERIODS = ["7d", "30d", "12m"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export class AdminUsageQueryDto {
  @ApiPropertyOptional({ enum: USAGE_PERIODS, default: "30d" })
  @IsOptional()
  @IsIn(USAGE_PERIODS)
  period?: UsagePeriod;

  @ApiPropertyOptional({
    enum: USAGE_SPACES,
    description: "Filters the screen ranking only",
  })
  @IsOptional()
  @IsIn(USAGE_SPACES)
  space?: UsageSpace;
}

export class UsagePlatformsDto {
  @ApiProperty() ios!: number;
  @ApiProperty() android!: number;
}

export class UsageScreenDto {
  @ApiProperty() screen!: string;
  @ApiProperty() views!: number;
  @ApiProperty() durationSec!: number;
}

export class UsageEventBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() login!: number;
  @ApiProperty() login_biometric!: number;
  @ApiProperty() login_guest!: number;
  @ApiProperty() register!: number;
  @ApiProperty() license_scan!: number;
  @ApiProperty() license_wallet_add!: number;
}

export class UsageVersionDto {
  @ApiProperty() appVersion!: string;
  @ApiProperty() installs!: number;
}

export class UsageCompetitionDto {
  @ApiProperty() competitionId!: string;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty() views!: number;
}

export class AdminUsageDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ enum: USAGE_PERIODS }) period!: UsagePeriod;
  @ApiProperty({ description: "YYYY-MM-DD (Paris), inclusive" }) from!: string;
  @ApiProperty({ description: "YYYY-MM-DD (Paris), inclusive" }) to!: string;
  @ApiProperty({ enum: ["day", "month"] }) bucket!: "day" | "month";
  @ApiProperty({ type: String, nullable: true }) aggregatedUntil!:
    | string
    | null;
  @ApiProperty() activeInstallsPerDay!: number;
  @ApiProperty() activeInstallsThisMonth!: number;
  @ApiProperty({ type: Number, nullable: true }) sessions!: number | null;
  @ApiProperty({ type: Number, nullable: true }) medianSessionMinutes!:
    | number
    | null;
  @ApiProperty({ type: UsagePlatformsDto }) platforms!: UsagePlatformsDto;
  @ApiProperty({
    description: "7 rows (Monday first) × 24 hours, Paris time",
    type: "array",
    items: { type: "array", items: { type: "number" } },
  })
  heatmap!: number[][];
  @ApiProperty({ type: [UsageScreenDto] }) screens!: UsageScreenDto[];
  @ApiProperty({ type: [UsageEventBucketDto] }) events!: UsageEventBucketDto[];
  @ApiProperty({ type: [UsageVersionDto] }) versions!: UsageVersionDto[];
  @ApiProperty({ type: [UsageCompetitionDto] })
  competitions!: UsageCompetitionDto[];
}
