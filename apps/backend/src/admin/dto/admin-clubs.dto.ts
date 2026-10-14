import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ClubRegistrationMode, Prisma, UserRole } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import {
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "../../common/dto/sort-params";
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
import { ACCOUNT_STATUSES, type AccountStatusFilter } from "./admin-users.dto";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

/** Columns the back-office club list can be sorted on (#443). */
export const ADMIN_CLUBS_SORT_FIELDS = [
  "name",
  "registrationMode",
  "createdAt",
] as const;
export type AdminClubsSortField = (typeof ADMIN_CLUBS_SORT_FIELDS)[number];

/** Columns the back-office club list can be filtered on, with operators (#557). */
export const ADMIN_CLUBS_FILTER_COLUMNS: FilterColumns<Prisma.ClubWhereInput> =
  {
    name: { kind: "text", where: (c) => ({ name: c }) },
    status: enumColumn(ACCOUNT_STATUSES, (status) => ({
      disabledAt: status === "active" ? null : { not: null },
    })),
    registrationMode: enumColumn(
      Object.values(ClubRegistrationMode),
      (mode) => ({ registrationMode: mode }),
    ),
    createdAt: { kind: "date", where: (c) => ({ createdAt: c }) },
  };
export const AdminClubsFilterDto = listFilterSchema(
  "AdminClubsFilterDto",
  Object.keys(ADMIN_CLUBS_FILTER_COLUMNS),
);

export class ListAdminClubsQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({ description: "Nom du club" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  search?: string;

  @ApiPropertyOptional({ enum: ACCOUNT_STATUSES })
  @IsOptional()
  @IsIn(ACCOUNT_STATUSES)
  status?: AccountStatusFilter;

  @SortByParam(ADMIN_CLUBS_SORT_FIELDS)
  sortBy?: AdminClubsSortField;

  @SortOrderParam()
  sortOrder?: SortOrder;

  @ListFiltersParam(ADMIN_CLUBS_FILTER_COLUMNS)
  filters?: ListFilter[];
}

export class ClubOptionsQueryDto {
  @ApiPropertyOptional({
    description: "Club à inclure même s'il est désactivé (valeur actuelle)",
  })
  @IsOptional()
  @IsUUID()
  includeId?: string;
}

export class AdminClubListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ClubRegistrationMode, enumName: "ClubRegistrationMode" })
  registrationMode!: ClubRegistrationMode;
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
  @ApiProperty({
    description:
      "Club du compte de validation App Store / Google Play : modifiable, mais ni supprimable ni désactivable",
  })
  isStoreReview!: boolean;
  @ApiProperty({ description: "Membres hors comptes Club" })
  memberCount!: number;
  @ApiProperty() clubAccountCount!: number;
  @ApiProperty({
    description: "Identifiants HelloAsso renseignés (jamais exposés)",
  })
  helloAssoConfigured!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class AdminClubsPageDto {
  @ApiProperty({ type: [AdminClubListItemDto] }) data!: AdminClubListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}

export class AdminClubMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole, enumName: "UserRole" }) role!: UserRole;
  @ApiProperty({ enum: UserRole, enumName: "UserRole", isArray: true })
  extraRoles!: UserRole[];
  @ApiProperty({ nullable: true, type: Date }) disabledAt!: Date | null;
}

export class AdminClubDetailDto extends AdminClubListItemDto {
  @ApiProperty({ description: "Compétitions dont l'organisateur porte ce nom" })
  competitionCount!: number;
  @ApiProperty() partnershipCount!: number;
  @ApiProperty() soloTeamCount!: number;
  @ApiProperty({
    type: [AdminClubMemberDto],
    description: "200 premiers membres, triés par nom",
  })
  members!: AdminClubMemberDto[];
}

/** `null` is a 400 (both columns are required); an absent key is unchanged. */
const notUndefined = (_: object, v: unknown) => v !== undefined;

export class UpdateAdminClubDto {
  @ApiPropertyOptional()
  @ValidateIf(notUndefined)
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
  })
  @ValidateIf(notUndefined)
  @IsEnum(ClubRegistrationMode)
  registrationMode?: ClubRegistrationMode;
}

export class CreateAdminClubDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({
    enum: ClubRegistrationMode,
    enumName: "ClubRegistrationMode",
    default: ClubRegistrationMode.MEMBERS_AUTO_CONFIRM,
  })
  @IsOptional()
  @IsEnum(ClubRegistrationMode)
  registrationMode?: ClubRegistrationMode;
}

/** 409 body of DELETE /admin/clubs/:id. */
export class ClubNotEmptyDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty() message!: string;
  @ApiProperty() memberCount!: number;
  @ApiProperty() clubAccountCount!: number;
  @ApiProperty() competitionCount!: number;
  @ApiProperty() partnershipCount!: number;
  @ApiProperty() soloTeamCount!: number;
}
