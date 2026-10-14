import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { AdminPageMetaDto } from "../../admin/dto/admin-audit.dto";
import {
  SortByParam,
  SortOrderParam,
  type SortOrder,
} from "../../common/dto/sort-params";
import {
  type FilterColumns,
  type ListFilter,
} from "../../common/list-filters/list-filters";
import {
  ListFiltersParam,
  listFilterSchema,
} from "../../common/list-filters/list-filters.dto";
import {
  LICENSE_NUMBER_MAX_LENGTH,
  LICENSE_NUMBER_PATTERN,
} from "../license-number.util";

/**
 * Reason codes of a refused renewal (#266). Stored as a plain string column
 * and validated here, not as a PostgreSQL enum: adding a value later stays a
 * code change, not a migration.
 *
 * `MEDICAL_RESTRICTION` reveals health data: like every reason, it is never
 * written to the audit log nor to the logs.
 */
export const RENEWAL_REJECTION_REASONS = [
  "ILLEGIBLE",
  "INCOMPLETE",
  "CERTIFICATE_TOO_OLD",
  "NOT_A_MEDICAL_CERTIFICATE",
  "IDENTITY_MISMATCH",
  "LICENSE_MISMATCH",
  "MEDICAL_RESTRICTION",
  "OTHER",
] as const;
export type RenewalRejectionReason = (typeof RENEWAL_REJECTION_REASONS)[number];

/**
 * The one reason code that is health data (GDPR art. 9). The retention purge
 * neutralises it to {@link RENEWAL_REASON_NEUTRAL} with the certificate.
 */
export const RENEWAL_REASON_HEALTH_DATA: RenewalRejectionReason =
  "MEDICAL_RESTRICTION";
export const RENEWAL_REASON_NEUTRAL: RenewalRejectionReason = "OTHER";

export const RENEWAL_REVIEW_COMMENT_MAX_LENGTH = 500;
export const ADMIN_RENEWAL_PAGE_MAX = 50;
export const ADMIN_RENEWAL_PAGE_DEFAULT = 20;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

/** Empty or blank comment → absent. */
const trimToUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** Columns the renewal queue can be filtered on, with operators (#557). */
export const ADMIN_RENEWALS_FILTER_COLUMNS: FilterColumns<Prisma.LicenseRenewalRequestWhereInput> =
  {
    name: {
      kind: "text",
      where: (c) => ({
        user: { is: { OR: [{ lastName: c }, { firstName: c }] } },
      }),
    },
    licenseNumber: {
      kind: "text",
      where: (c) => ({ user: { is: { license: { is: { number: c } } } } }),
      whereNull: { user: { is: { license: { is: null } } } },
    },
    validUntil: {
      kind: "date",
      where: (c) => ({ user: { is: { license: { is: { validUntil: c } } } } }),
      whereNull: { user: { is: { license: { is: null } } } },
    },
    submittedAt: {
      kind: "date",
      where: (c) => ({ submittedAt: c }),
      whereNull: { submittedAt: null },
    },
    reviewedAt: {
      kind: "date",
      where: (c) => ({ reviewedAt: c }),
      whereNull: { reviewedAt: null },
    },
    // No reviewer: an automatic approval, or a since-deleted administrator.
    reviewer: {
      kind: "text",
      where: (c) => ({
        reviewedBy: { is: { OR: [{ lastName: c }, { firstName: c }] } },
      }),
      whereNull: { reviewedById: null },
    },
  };
export const AdminLicenseRenewalsFilterDto = listFilterSchema(
  "AdminLicenseRenewalsFilterDto",
  Object.keys(ADMIN_RENEWALS_FILTER_COLUMNS),
);

/** Columns the renewal queue can be sorted on (#443); `name` = the licensee. */
export const ADMIN_RENEWALS_SORT_FIELDS = [
  "name",
  "licenseNumber",
  "validUntil",
  "submittedAt",
  "reviewedAt",
] as const;
export type AdminRenewalsSortField =
  (typeof ADMIN_RENEWALS_SORT_FIELDS)[number];

export class ListAdminLicenseRenewalsQueryDto {
  @ApiPropertyOptional({
    enum: LicenseRenewalStatus,
    enumName: "LicenseRenewalStatus",
    default: LicenseRenewalStatus.PENDING,
    description: "Statut des demandes listées (par défaut : en attente)",
  })
  @IsOptional()
  @IsEnum(LicenseRenewalStatus)
  status?: LicenseRenewalStatus;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_RENEWAL_PAGE_MAX,
    default: ADMIN_RENEWAL_PAGE_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_RENEWAL_PAGE_MAX)
  take?: number;

  @SortByParam(ADMIN_RENEWALS_SORT_FIELDS)
  sortBy?: AdminRenewalsSortField;

  @SortOrderParam()
  sortOrder?: SortOrder;

  @ListFiltersParam(ADMIN_RENEWALS_FILTER_COLUMNS)
  filters?: ListFilter[];
}

export class ApproveLicenseRenewalDto {
  @ApiPropertyOptional({
    description:
      "Numéro de licence confirmé par l'administrateur. Prioritaire sur la lecture OCR ; remplace le numéro d'une licence existante. Obligatoire si aucun numéro n'est connu.",
    maxLength: LICENSE_NUMBER_MAX_LENGTH,
    example: "FFD-123456",
  })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MinLength(1)
  @MaxLength(LICENSE_NUMBER_MAX_LENGTH)
  @Matches(LICENSE_NUMBER_PATTERN, {
    message: "licenseNumber contient des caractères non autorisés",
  })
  licenseNumber?: string;
}

export class RejectLicenseRenewalDto {
  @ApiProperty({ enum: RENEWAL_REJECTION_REASONS })
  @IsIn(RENEWAL_REJECTION_REASONS)
  reason!: RenewalRejectionReason;

  @ApiPropertyOptional({
    maxLength: RENEWAL_REVIEW_COMMENT_MAX_LENGTH,
    description:
      "Commentaire adressé au licencié. Effacé avec le certificat par la purge de rétention.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(RENEWAL_REVIEW_COMMENT_MAX_LENGTH)
  comment?: string;
}

export class AdminRenewalPersonDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
}

export class AdminRenewalLicenseDto {
  @ApiProperty() number!: string;
  @ApiProperty() validUntil!: Date;
}

export class AdminRenewalUserDto extends AdminRenewalPersonDto {
  @ApiProperty({ type: AdminRenewalLicenseDto, nullable: true })
  license!: AdminRenewalLicenseDto | null;
}

/** OCR reading of a document: hints only, never a decision (#19). */
export class AdminRenewalOcrHintsDto {
  @ApiPropertyOptional() isApte?: boolean;
  @ApiPropertyOptional() date?: string;
  @ApiPropertyOptional() doctorName?: string;
  @ApiPropertyOptional() licenseNumber?: string;
  @ApiPropertyOptional() expiryDate?: string;
}

export class AdminRenewalDocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: LicenseRenewalDocumentType,
    enumName: "LicenseRenewalDocumentType",
  })
  type!: LicenseRenewalDocumentType;
  @ApiProperty() createdAt!: Date;
}

export class AdminRenewalDocumentDetailDto extends AdminRenewalDocumentDto {
  @ApiProperty({
    type: AdminRenewalOcrHintsDto,
    nullable: true,
    description:
      "Indices lus par l'OCR, seulement tant que la demande est en attente (null ensuite).",
  })
  ocr!: AdminRenewalOcrHintsDto | null;
}

class AdminLicenseRenewalBaseDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: LicenseRenewalStatus,
    enumName: "LicenseRenewalStatus",
  })
  status!: LicenseRenewalStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) submittedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) reviewedAt!: Date | null;
  @ApiProperty({ type: AdminRenewalUserDto }) user!: AdminRenewalUserDto;
  @ApiProperty({
    type: AdminRenewalPersonDto,
    nullable: true,
    description:
      "Administrateur qui a tranché ; null tant que la demande n'est pas tranchée, pour une demande auto-approuvée avant #271 (voir decidedAutomatically), ou si son compte a été supprimé depuis",
  })
  reviewedBy!: AdminRenewalPersonDto | null;
  @ApiProperty({
    description:
      "Vrai seulement pour une demande approuvée automatiquement avant #271 (approuvée, sans relecteur ni décision dans le journal d'audit). Une décision sans relecteur mais tracée vient d'un administrateur supprimé depuis ; un refus n'est jamais automatique.",
  })
  decidedAutomatically!: boolean;
}

export class AdminLicenseRenewalListItemDto extends AdminLicenseRenewalBaseDto {
  @ApiProperty({ type: [AdminRenewalDocumentDto] })
  documents!: AdminRenewalDocumentDto[];
}

export class AdminLicenseRenewalsPageDto {
  @ApiProperty({ type: [AdminLicenseRenewalListItemDto] })
  data!: AdminLicenseRenewalListItemDto[];
  @ApiProperty({ type: AdminPageMetaDto }) meta!: AdminPageMetaDto;
}

export class AdminRenewalHistoryItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: LicenseRenewalStatus,
    enumName: "LicenseRenewalStatus",
  })
  status!: LicenseRenewalStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) submittedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Date }) reviewedAt!: Date | null;
}

export class AdminLicenseRenewalDetailDto extends AdminLicenseRenewalBaseDto {
  /**
   * Only in the (audited) detail, never in the queue: `MEDICAL_RESTRICTION`
   * is health data. Neutralised to `OTHER` by the retention purge.
   */
  @ApiProperty({
    nullable: true,
    enum: RENEWAL_REJECTION_REASONS,
  })
  rejectionReason!: RenewalRejectionReason | null;
  @ApiProperty({ nullable: true, type: String }) reviewComment!: string | null;
  @ApiProperty({ type: [AdminRenewalDocumentDetailDto] })
  documents!: AdminRenewalDocumentDetailDto[];
  @ApiProperty({
    nullable: true,
    type: Date,
    description:
      "Fin de validité qu'accorderait une approbation maintenant (null hors attente)",
  })
  renewsUntil!: Date | null;
  @ApiProperty({
    type: [AdminRenewalHistoryItemDto],
    description:
      "Autres demandes du même utilisateur (statuts et dates uniquement), plus récentes d'abord",
  })
  history!: AdminRenewalHistoryItemDto[];
}
