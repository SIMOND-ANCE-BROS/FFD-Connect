import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import { AdminPageMetaDto } from "../../admin/dto/admin-audit.dto";

/** What was done with the health data (#63). */
export const HEALTH_DATA_ACCESS_ACTIONS = [
  "READ",
  "DOWNLOAD",
  "EXPORT",
  "DELETE",
] as const;
export type HealthDataAccessAction =
  (typeof HEALTH_DATA_ACCESS_ACTIONS)[number];

/**
 * In which capacity the actor accessed the data:
 * - ADMIN: moderation from the back-office (or an admin deleting the account);
 * - OWNER: the data subject (export, account deletion);
 * - IMPERSONATOR: an admin / staff member using "log in as" — the authorising
 *   role is in ImpersonationLog;
 * - SYSTEM: automatic processing (retention purge), no actor.
 */
export const HEALTH_DATA_ACTOR_ROLES = [
  "ADMIN",
  "OWNER",
  "IMPERSONATOR",
  "SYSTEM",
] as const;
export type HealthDataActorRole = (typeof HEALTH_DATA_ACTOR_ROLES)[number];

/**
 * LICENSE_RENEWAL_REQUEST: a renewal request seen as a whole (moderation
 * detail: OCR hints, decision). MEDICAL_CERTIFICATE: one medical certificate
 * document (its id). A licence certificate is not health data: not logged.
 */
export const HEALTH_DATA_RESOURCE_TYPES = [
  "LICENSE_RENEWAL_REQUEST",
  "MEDICAL_CERTIFICATE",
] as const;
export type HealthDataResourceType =
  (typeof HEALTH_DATA_RESOURCE_TYPES)[number];

/**
 * Where an access comes from: route templates (no id, no query string) and
 * background jobs. Constants rather than `req.route`, so that a service called
 * from several places names the right entry point and tests can assert it.
 */
export const HEALTH_DATA_ACCESS_ROUTES = {
  adminRenewalDetail: "GET /admin/license-renewals/:id",
  adminRenewalDocumentFile:
    "GET /admin/license-renewals/:id/documents/:docId/file",
  selfExport: "GET /users/me/export",
  selfAccountDeletion: "DELETE /users/me",
  adminAccountDeletion: "DELETE /admin/users/:id",
  retentionPurge: "job:health-data-retention",
} as const;

/** One access to write. Never any health content, name or e-mail. */
export interface HealthDataAccessEntry {
  subjectUserId: string;
  /** null only for SYSTEM. */
  actorUserId: string | null;
  actorRole: HealthDataActorRole;
  action: HealthDataAccessAction;
  resourceType: HealthDataResourceType;
  resourceId: string;
  route: string;
}

/** Who accesses, and through which entry point (resource-independent part). */
export type HealthDataAccessActor = Pick<
  HealthDataAccessEntry,
  "actorUserId" | "actorRole" | "route"
>;

export class ListHealthDataAccessLogQueryDto extends PaginationParamsDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Personne dont les données de santé sont concernées",
  })
  @IsOptional()
  @IsUUID()
  subjectUserId?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Auteur de l'accès" })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ enum: HEALTH_DATA_ACCESS_ACTIONS })
  @IsOptional()
  @IsIn(HEALTH_DATA_ACCESS_ACTIONS)
  action?: HealthDataAccessAction;
}

export class HealthDataAccessLogEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "uuid" }) subjectUserId!: string;
  @ApiProperty({ nullable: true, type: String }) actorUserId!: string | null;
  @ApiProperty({ enum: HEALTH_DATA_ACTOR_ROLES })
  actorRole!: HealthDataActorRole;
  @ApiProperty({ enum: HEALTH_DATA_ACCESS_ACTIONS })
  action!: HealthDataAccessAction;
  @ApiProperty({ enum: HEALTH_DATA_RESOURCE_TYPES })
  resourceType!: HealthDataResourceType;
  @ApiProperty() resourceId!: string;
  @ApiProperty() route!: string;
  @ApiProperty() createdAt!: Date;
}

export class HealthDataAccessLogPageDto {
  @ApiProperty({ type: [HealthDataAccessLogEntryDto] })
  data!: HealthDataAccessLogEntryDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}
