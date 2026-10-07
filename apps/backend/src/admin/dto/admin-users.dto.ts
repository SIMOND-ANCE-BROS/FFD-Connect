import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PassportLevel, UserRole } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import { AdminPageMetaDto } from "./admin-audit.dto";

export const LICENSE_STATUSES = ["ACTIVE", "EXPIRED"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const ACCOUNT_STATUSES = ["active", "disabled"] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUSES)[number];

export class ListAdminUsersQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: "Nom, prénom ou email" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  search?: string;

  @ApiPropertyOptional({ enum: UserRole, enumName: "UserRole" })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;

  @ApiPropertyOptional({ description: "Inclus, AAAA-MM-JJ" })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: "Inclus, AAAA-MM-JJ" })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}

export class AdminUserListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: UserRole, enumName: "UserRole" }) role!: UserRole;
  @ApiProperty({ nullable: true, type: String }) clubId!: string | null;
  @ApiProperty({ nullable: true, type: String }) clubName!: string | null;
  @ApiProperty({ nullable: true, type: String }) category!: string | null;
  @ApiProperty({ nullable: true, type: String }) ageGroup!: string | null;
  @ApiProperty({ enum: [...LICENSE_STATUSES, null], nullable: true })
  licenseStatus!: LicenseStatus | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
}

export class AdminUserDetailDto extends AdminUserListItemDto {
  @ApiProperty({ nullable: true, type: Date }) birthDate!: Date | null;
  @ApiProperty({ nullable: true, type: Number }) nationalRanking!:
    | number
    | null;
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
  @ApiProperty({ nullable: true, type: String }) competitionLevel!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) wdsfMin!: string | null;
  @ApiProperty({ nullable: true, type: Date }) wdsfExpiresOn!: Date | null;
  @ApiProperty({ nullable: true, type: String }) licenseNumber!: string | null;
  @ApiProperty({ nullable: true, type: Date }) licenseValidUntil!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) lastLoginAt!: Date | null;
  @ApiProperty({
    nullable: true,
    type: Date,
    description: "Désactivation du club rattaché (bloque un compte CLUB)",
  })
  clubDisabledAt!: Date | null;
  @ApiProperty({
    description:
      "Compte créé depuis le back-office (seul cas où l'invitation peut être renvoyée)",
  })
  createdByAdmin!: boolean;
  @ApiProperty() updatedAt!: Date;
}

export class AdminUsersPageDto {
  @ApiProperty({ type: [AdminUserListItemDto] }) data!: AdminUserListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
