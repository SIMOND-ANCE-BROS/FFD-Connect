import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";

export const AUDIT_ACTIONS = [
  "USER_UPDATE",
  // Lot 1 rows only; accounts created since lot 1b are logged as USER_CREATE.
  "CLUB_ACCOUNT_CREATE",
  "INVITATION_RESEND",
  "USER_CREATE",
  "USER_DISABLE",
  "USER_ENABLE",
  "USER_DELETE",
  "CLUB_CREATE",
  "CLUB_UPDATE",
  "CLUB_DISABLE",
  "CLUB_ENABLE",
  "CLUB_DELETE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_TARGET_TYPES = ["USER", "CLUB"] as const;
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];

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
