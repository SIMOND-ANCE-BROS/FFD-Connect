import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { Prisma } from "@prisma/client";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import {
  enumColumn,
  type FilterColumns,
  type ListFilter,
} from "../../common/list-filters/list-filters";
import {
  ListFiltersParam,
  listFilterSchema,
} from "../../common/list-filters/list-filters.dto";
import {
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "../../common/dto/sort-params";

export const AUDIT_ACTIONS = [
  "USER_UPDATE",
  // Lot 1 rows only; accounts created since lot 1b are logged as USER_CREATE.
  "CLUB_ACCOUNT_CREATE",
  "INVITATION_RESEND",
  "USER_CREATE",
  "USER_DISABLE",
  "USER_ENABLE",
  "USER_DELETE",
  // Login email and / or licence number changed by an administrator (#448).
  "USER_IDENTIFIERS_UPDATE",
  "CLUB_CREATE",
  "CLUB_UPDATE",
  "CLUB_DISABLE",
  "CLUB_ENABLE",
  "CLUB_DELETE",
  // Moderation decisions (lot 2), taken from the back-office or the mobile app.
  "TRACK_CORRECTION_APPROVE",
  "TRACK_CORRECTION_REJECT",
  // Track library (lot 3): back-office import, and edits / deletions from the
  // back-office or the mobile app.
  "TRACK_CREATE",
  "TRACK_UPDATE",
  "TRACK_DELETE",
  // Licence renewal moderation (#266). Views are logged too: the request and
  // its documents are health data (#63). Never any health data in before/after.
  "LICENSE_RENEWAL_VIEW",
  "LICENSE_RENEWAL_DOCUMENT_VIEW",
  "LICENSE_RENEWAL_APPROVE",
  "LICENSE_RENEWAL_REJECT",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = [
  "USER",
  "CLUB",
  "TRACK_CORRECTION",
  "TRACK",
  "LICENSE_RENEWAL",
] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

/** The journal sorts on its date only (#443): action codes have no useful order. */
export const AUDIT_SORT_FIELDS = ["createdAt"] as const;
export type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number];

/** Columns the audit journal can be filtered on, with operators (#557). */
export const AUDIT_FILTER_COLUMNS: FilterColumns<Prisma.AdminAuditLogWhereInput> =
  {
    createdAt: { kind: "date", where: (c) => ({ createdAt: c }) },
    actor: {
      kind: "text",
      where: (c) => ({
        actor: { is: { OR: [{ lastName: c }, { firstName: c }] } },
      }),
      // A deleted administrator's rows keep no actor.
      whereNull: { actorId: null },
    },
    action: enumColumn(AUDIT_ACTIONS, (action) => ({ action })),
    targetType: enumColumn(AUDIT_TARGET_TYPES, (targetType) => ({
      targetType,
    })),
  };
export const AuditLogFilterDto = listFilterSchema(
  "AuditLogFilterDto",
  Object.keys(AUDIT_FILTER_COLUMNS),
);

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export class ListAuditLogQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ enum: AUDIT_TARGET_TYPES })
  @IsOptional()
  @IsIn(AUDIT_TARGET_TYPES)
  targetType?: AuditTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ enum: AUDIT_ACTIONS })
  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;

  @SortByParam(AUDIT_SORT_FIELDS)
  sortBy?: AuditSortField;

  @SortOrderParam()
  sortOrder?: SortOrder;

  @ListFiltersParam(AUDIT_FILTER_COLUMNS)
  filters?: ListFilter[];
}

export class AuditLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AUDIT_ACTIONS }) action!: AuditAction;
  @ApiProperty({ enum: AUDIT_TARGET_TYPES }) targetType!: AuditTargetType;
  @ApiProperty() targetId!: string;
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    nullable: true,
  })
  before!: Record<string, unknown> | null;
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    nullable: true,
  })
  after!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: String }) actorId!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class AdminPageMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() skip!: number;
  @ApiProperty() take!: number;
  @ApiProperty() hasMore!: boolean;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogEntryDto] }) data!: AuditLogEntryDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
