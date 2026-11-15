import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PassportLevel, UserRole } from "@prisma/client";
import { AdminPageMetaDto } from "../../admin/dto/admin-audit.dto";

/** License of a club member (number + end of validity). */
export class ClubMemberLicenseDto {
  @ApiProperty({ example: "123456" })
  number!: string;

  @ApiProperty({ type: String, format: "date-time" })
  validUntil!: Date;
}

/** WDSF license linked to a club member (null when none is linked). */
export class ClubMemberWdsfDto {
  @ApiProperty({ description: "Numéro MIN WDSF", example: "10117265" })
  min!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  nationality?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  licenseType?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  ageGroup?: string | null;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  expiresOn?: string | null;

  @ApiProperty({ type: String, nullable: true })
  federation!: string | null;
}

/** One dancer of the club (`UsersService.findClubMembers`). */
export class ClubMemberDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: UserRole, enumName: "UserRole" })
  role!: UserRole;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Discipline(s) : Latin, Standard, Ten Dance",
  })
  category!: string | null;

  @ApiProperty({ type: String, nullable: true })
  ageGroup!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Déprécié : niveau unique dérivé des niveaux par discipline",
  })
  competitionLevel!: string | null;

  @ApiProperty({ type: String, nullable: true })
  competitionLevelLatin!: string | null;

  @ApiProperty({ type: String, nullable: true })
  competitionLevelStandard!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clubName!: string | null;

  @ApiProperty({
    enum: PassportLevel,
    enumName: "PassportLevel",
    nullable: true,
  })
  passportLevelLatin!: PassportLevel | null;

  @ApiProperty({
    enum: PassportLevel,
    enumName: "PassportLevel",
    nullable: true,
  })
  passportLevelStandard!: PassportLevel | null;

  @ApiProperty({ type: ClubMemberLicenseDto, nullable: true })
  license!: ClubMemberLicenseDto | null;

  @ApiPropertyOptional({
    description:
      "Partenaire le plus fréquent sur les inscriptions en cours (PENDING, CONFIRMED)",
  })
  partnerName?: string;

  @ApiProperty({ type: ClubMemberWdsfDto, nullable: true })
  wdsf!: ClubMemberWdsfDto | null;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

/** `GET /users/members` (cf. createPaginatedResponse). */
export class ClubMembersPageDto {
  @ApiProperty({ type: [ClubMemberDto] })
  data!: ClubMemberDto[];

  @ApiProperty({ type: AdminPageMetaDto })
  meta!: AdminPageMetaDto;
}
