import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PassportLevel, Prisma, UserRole } from "@prisma/client";
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
import {
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "../../common/dto/sort-params";
import { withRole } from "../../auth/roles";
import {
  enumColumn,
  type FilterColumns,
  type ListFilter,
} from "../../common/list-filters/list-filters";
import {
  ListFiltersParam,
  listFilterSchema,
} from "../../common/list-filters/list-filters.dto";
import { AdminPageMetaDto } from "./admin-audit.dto";

export const LICENSE_STATUSES = ["ACTIVE", "EXPIRED"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const ACCOUNT_STATUSES = ["active", "disabled"] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUSES)[number];

/** Columns the back-office user list can be sorted on (#443). */
export const ADMIN_USERS_SORT_FIELDS = [
  "name",
  "email",
  "role",
  "club",
  "category",
  "ageGroup",
  "createdAt",
  "lastLoginAt",
] as const;
export type AdminUsersSortField = (typeof ADMIN_USERS_SORT_FIELDS)[number];

/** Columns the back-office user list can be filtered on, with operators (#557). */
export const ADMIN_USERS_FILTER_COLUMNS: FilterColumns<Prisma.UserWhereInput> =
  {
    name: {
      kind: "text",
      where: (c) => ({ OR: [{ lastName: c }, { firstName: c }] }),
    },
    email: { kind: "text", where: (c) => ({ email: c }) },
    // Main or extra role, like the `role` parameter.
    role: enumColumn(Object.values(UserRole), (role) => withRole(role)),
    status: enumColumn(ACCOUNT_STATUSES, (status) => ({
      disabledAt: status === "active" ? null : { not: null },
    })),
    club: {
      kind: "text",
      where: (c) => ({ clubName: c }),
      whereNull: { clubName: null },
    },
    category: {
      kind: "text",
      where: (c) => ({ category: c }),
      whereNull: { category: null },
    },
    ageGroup: {
      kind: "text",
      where: (c) => ({ ageGroup: c }),
      whereNull: { ageGroup: null },
    },
    licenseNumber: {
      kind: "text",
      where: (c) => ({ license: { is: { number: c } } }),
      whereNull: { license: { is: null } },
    },
    createdAt: { kind: "date", where: (c) => ({ createdAt: c }) },
    lastLoginAt: {
      kind: "date",
      where: (c) => ({ lastLoginAt: c }),
      whereNull: { lastLoginAt: null },
    },
  };
export const AdminUsersFilterDto = listFilterSchema(
  "AdminUsersFilterDto",
  Object.keys(ADMIN_USERS_FILTER_COLUMNS),
);

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

  @SortByParam(ADMIN_USERS_SORT_FIELDS)
  sortBy?: AdminUsersSortField;

  @SortOrderParam()
  sortOrder?: SortOrder;

  @ListFiltersParam(ADMIN_USERS_FILTER_COLUMNS)
  filters?: ListFilter[];
}

export class AdminUserListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ enum: UserRole, enumName: "UserRole" }) role!: UserRole;
  @ApiProperty({ enum: UserRole, enumName: "UserRole", isArray: true })
  extraRoles!: UserRole[];
  @ApiProperty({
    enum: UserRole,
    enumName: "UserRole",
    isArray: true,
    description: "Rôle principal + rôles supplémentaires",
  })
  roles!: UserRole[];
  @ApiProperty({ nullable: true, type: String }) clubId!: string | null;
  @ApiProperty({ nullable: true, type: String }) clubName!: string | null;
  @ApiProperty({ nullable: true, type: String }) category!: string | null;
  @ApiProperty({ nullable: true, type: String }) ageGroup!: string | null;
  @ApiProperty({ enum: [...LICENSE_STATUSES, null], nullable: true })
  licenseStatus!: LicenseStatus | null;
  @ApiProperty({ nullable: true, type: String }) licenseNumber!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) lastLoginAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
  @ApiProperty({
    description:
      "Compte de validation App Store / Google Play : modifiable, mais ni supprimable ni désactivable",
  })
  isStoreReview!: boolean;
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
  @ApiProperty({
    nullable: true,
    type: String,
    deprecated: true,
    description:
      "Ancien niveau unique, dérivé des niveaux par discipline (le plus élevé) — préférer les niveaux par discipline",
  })
  competitionLevel!: string | null;
  @ApiProperty({ nullable: true, type: String })
  competitionLevelLatin!: string | null;
  @ApiProperty({ nullable: true, type: String })
  competitionLevelStandard!: string | null;
  @ApiProperty({ nullable: true, type: String }) wdsfMin!: string | null;
  @ApiProperty({ nullable: true, type: Date }) wdsfExpiresOn!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) licenseValidUntil!: Date | null;
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
