import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { STATS_PERIODS, type StatsPeriod } from "../stats/stats-period";

export class AdminStatsQueryDto {
  @ApiPropertyOptional({ enum: STATS_PERIODS, default: "12w" })
  @IsOptional()
  @IsIn(STATS_PERIODS)
  period?: StatsPeriod;
}

export class RoleCountsDto {
  @ApiProperty() LICENSEE!: number;
  @ApiProperty() CLUB!: number;
  @ApiProperty() STAFF!: number;
  @ApiProperty() ADMIN!: number;
}

export class SignupBucketDto extends RoleCountsDto {
  @ApiProperty({ description: "Bucket start, YYYY-MM-DD (Europe/Paris)" })
  start!: string;
}

export class CountBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() count!: number;
}

export class RegistrationBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() PENDING!: number;
  @ApiProperty() CONFIRMED!: number;
  @ApiProperty() CANCELLED!: number;
}

export class CorrectionBucketDto {
  @ApiProperty() start!: string;
  @ApiProperty() TITLE!: number;
  @ApiProperty() ARTIST!: number;
  @ApiProperty() DANCE!: number;
  @ApiProperty() MPM!: number;
  @ApiProperty() PASO_CLASH!: number;
  @ApiProperty() OTHER!: number;
}

export class CompetitionStatusCountsDto {
  @ApiProperty() UPCOMING!: number;
  @ApiProperty() LIVE!: number;
  @ApiProperty() PAST!: number;
  @ApiProperty() CANCELLED!: number;
}

export class TrackStatusCountsDto {
  @ApiProperty() READY!: number;
  @ApiProperty() PENDING!: number;
  @ApiProperty() ERROR!: number;
}

export class StatsClubRowDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() members!: number;
  @ApiProperty() clubAccounts!: number;
  @ApiProperty() validLicences!: number;
}

export class UsersStatsDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: RoleCountsDto }) byRole!: RoleCountsDto;
  @ApiProperty() neverLoggedIn!: number;
  @ApiProperty() active7d!: number;
  @ApiProperty() active30d!: number;
  @ApiProperty() disabled!: number;
  @ApiProperty({ type: [SignupBucketDto] }) signups!: SignupBucketDto[];
}

export class LicencesStatsDto {
  @ApiProperty() valid!: number;
  @ApiProperty() expiring30d!: number;
  @ApiProperty() expiring60d!: number;
  @ApiProperty() expired!: number;
  @ApiProperty() renewalsPending!: number;
  @ApiProperty({ type: [CountBucketDto] }) created!: CountBucketDto[];
  @ApiProperty({ type: [StatsClubRowDto] }) clubs!: StatsClubRowDto[];
  @ApiProperty() clubsWithoutClubAccount!: number;
}

export class CompetitionsStatsDto {
  @ApiProperty({ type: CompetitionStatusCountsDto })
  byStatus!: CompetitionStatusCountsDto;
  @ApiProperty({ type: [RegistrationBucketDto] })
  registrations!: RegistrationBucketDto[];
  @ApiProperty() pastConfirmed!: number;
  @ApiProperty() pastCheckedIn!: number;
  @ApiProperty() pastPaid!: number;
}

export class ContentStatsDto {
  @ApiProperty({ type: TrackStatusCountsDto })
  tracksByStatus!: TrackStatusCountsDto;
  @ApiProperty() tracksBlacklisted!: number;
  @ApiProperty() tracksMasked!: number;
  @ApiProperty() correctionsPending!: number;
  @ApiProperty({ description: "Decided during the period" })
  correctionsApproved!: number;
  @ApiProperty({ description: "Decided during the period" })
  correctionsRejected!: number;
  @ApiProperty({ type: Number, nullable: true })
  medianReviewHours!: number | null;
  @ApiProperty({ type: [CorrectionBucketDto] })
  corrections!: CorrectionBucketDto[];
  @ApiProperty({ type: [CountBucketDto] }) bugReports!: CountBucketDto[];
  @ApiProperty({ type: [CountBucketDto] }) adminActions!: CountBucketDto[];
}

export class AdminStatsDto {
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ enum: STATS_PERIODS }) period!: StatsPeriod;
  @ApiProperty({ enum: ["week", "month"] }) bucket!: "week" | "month";
  @ApiProperty({ type: [String] }) buckets!: string[];
  @ApiProperty({ type: UsersStatsDto }) users!: UsersStatsDto;
  @ApiProperty({ type: LicencesStatsDto }) licences!: LicencesStatsDto;
  @ApiProperty({ type: CompetitionsStatsDto })
  competitions!: CompetitionsStatsDto;
  @ApiProperty({ type: ContentStatsDto }) content!: ContentStatsDto;
}
