import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { extname } from "path";
import { Readable } from "stream";
import { AdminAuditService } from "../admin/admin-audit.service";
import type { AuditAction } from "../admin/dto/admin-audit.dto";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { listOrderBy, type SortOrder } from "../common/dto/sort-params";
import { listFiltersWhere } from "../common/list-filters/list-filters";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { HEALTH_DATA_ACCESS_ROUTES } from "../health-data-access/dto/health-data-access-log.dto";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { getErrorMessage } from "../utils/error.utils";
import {
  auditTargetIdSelect,
  licenseRenewalAdminDetailSelect,
  licenseRenewalAdminListSelect,
  licenseRenewalDocumentFileTargetSelect,
  licenseRenewalHistorySelect,
} from "../utils/prisma-selects";
import { withTimeout } from "../utils/timeout.utils";
import {
  ADMIN_RENEWAL_PAGE_DEFAULT,
  AdminLicenseRenewalDetailDto,
  AdminLicenseRenewalsPageDto,
  type AdminRenewalsSortField,
  ADMIN_RENEWALS_FILTER_COLUMNS,
  ListAdminLicenseRenewalsQueryDto,
  RenewalRejectionReason,
} from "./dto/admin-license-renewal.dto";
import { renewedLicenseValidUntil } from "./license-season";
import { pickRenewalOcrData } from "./renewal-ocr-data.util";

type RenewalOrder = Prisma.LicenseRenewalRequestOrderByWithRelationInput;
const RENEWAL_ORDERS: Record<
  AdminRenewalsSortField,
  (o: SortOrder) => RenewalOrder[]
> = {
  name: (o) => [
    { user: { lastName: o } },
    { user: { firstName: o } },
    { id: o },
  ],
  licenseNumber: (o) => [{ user: { license: { number: o } } }, { id: o }],
  validUntil: (o) => [{ user: { license: { validUntil: o } } }, { id: o }],
  submittedAt: (o) => [{ submittedAt: { sort: o, nulls: "last" } }, { id: o }],
  reviewedAt: (o) => [{ reviewedAt: { sort: o, nulls: "last" } }, { id: o }],
};
/** Queue order: oldest submission first. */
const DEFAULT_RENEWAL_ORDER: RenewalOrder[] = [
  { submittedAt: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
];

/** Other requests of the same user shown in the detail. */
const HISTORY_TAKE = 20;
/** Opening a document stream from Blob Storage (ADR-0009). */
export const RENEWAL_DOCUMENT_DOWNLOAD_TIMEOUT_MS = 10_000;

/** Content types a renewal document may be served with (upload allowlist). */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

type ListRow = Prisma.LicenseRenewalRequestGetPayload<{
  select: typeof licenseRenewalAdminListSelect;
}>;
type DetailRow = Prisma.LicenseRenewalRequestGetPayload<{
  select: typeof licenseRenewalAdminDetailSelect;
}>;

export interface RenewalDocumentFile {
  stream: Readable;
  contentType: string;
}

/** Audit actions written by an administrator's decision (#266). */
const RENEWAL_DECISION_ACTIONS: readonly AuditAction[] = [
  "LICENSE_RENEWAL_APPROVE",
  "LICENSE_RENEWAL_REJECT",
];

/**
 * An approval without reviewer is either an automatic approval from before
 * #271 or the decision of an administrator deleted since (`SetNull`). Only
 * the second one has a decision audit row (#524); a refusal was never
 * automatic.
 */
function mayBeAutomatic(row: ListRow | DetailRow): boolean {
  return row.status === LicenseRenewalStatus.APPROVED && !row.reviewedBy;
}

function toBase(row: ListRow | DetailRow, automaticIds: ReadonlySet<string>) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    user: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      license: row.user.license,
    },
    reviewedBy: row.reviewedBy,
    decidedAutomatically: automaticIds.has(row.id),
  };
}

/**
 * Human moderation of licence renewals (#266, ADR-0021): reads.
 *
 * Reading a request or one of its documents is an access to health data: each
 * one writes, in one transaction and BEFORE the data is returned, an audit row
 * (`LICENSE_RENEWAL_VIEW`, `LICENSE_RENEWAL_DOCUMENT_VIEW`, shown in the
 * back-office journal) and a health-data access row (`HealthDataAccessLog`,
 * #63: subject, retention of its own) — if the trace cannot be written,
 * nothing is shown. The list does not need it: it shows no document content
 * and no OCR reading.
 */
@Injectable()
export class LicenseRenewalModerationQueryService {
  private readonly logger = new Logger(
    LicenseRenewalModerationQueryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly healthAccess: HealthDataAccessLogService,
    private readonly blobStorage: BlobStorageService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /** Queue, oldest submission first; PENDING unless another status is asked. */
  async list(
    query: ListAdminLicenseRenewalsQueryDto,
  ): Promise<AdminLicenseRenewalsPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? ADMIN_RENEWAL_PAGE_DEFAULT;
    const where: Prisma.LicenseRenewalRequestWhereInput = {
      status: query.status ?? LicenseRenewalStatus.PENDING,
      ...(query.filters?.length && {
        AND: listFiltersWhere(ADMIN_RENEWALS_FILTER_COLUMNS, query.filters),
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.licenseRenewalRequest.count({ where }),
      this.prisma.licenseRenewalRequest.findMany({
        where,
        orderBy: listOrderBy(
          query.sortBy,
          query.sortOrder,
          RENEWAL_ORDERS,
          DEFAULT_RENEWAL_ORDER,
        ),
        skip,
        take,
        select: licenseRenewalAdminListSelect,
      }),
    ]);
    const automaticIds = await this.automaticallyDecided(rows);
    return createPaginatedResponse(
      rows.map((row) => ({
        ...toBase(row, automaticIds),
        documents: row.documents,
      })),
      total,
      skip,
      take,
    );
  }

  /** Detail of a request; the access is audited. */
  async detail(
    adminId: string,
    requestId: string,
  ): Promise<AdminLicenseRenewalDetailDto> {
    const row = await this.findDetailRow(requestId);
    await this.prisma.$transaction([
      this.audit.recordOp({
        actorId: adminId,
        action: "LICENSE_RENEWAL_VIEW",
        targetType: "LICENSE_RENEWAL",
        targetId: requestId,
      }),
      this.healthAccess.recordOp([
        {
          subjectUserId: row.userId,
          actorUserId: adminId,
          actorRole: "ADMIN",
          action: "READ",
          resourceType: "LICENSE_RENEWAL_REQUEST",
          resourceId: requestId,
          route: HEALTH_DATA_ACCESS_ROUTES.adminRenewalDetail,
        },
      ]),
    ]);
    return this.toDetail(row);
  }

  /** Detail returned by a decision (already audited as the decision). */
  async detailAfterDecision(
    requestId: string,
  ): Promise<AdminLicenseRenewalDetailDto> {
    return this.toDetail(await this.findDetailRow(requestId));
  }

  /**
   * Opens a document's file for the administrator, only while the request is
   * PENDING (410 afterwards: once decided, only the decision remains, #19).
   * The access is audited before the file is read.
   */
  async openDocument(
    adminId: string,
    requestId: string,
    documentId: string,
  ): Promise<RenewalDocumentFile> {
    const document = await this.prisma.licenseRenewalDocument.findFirst({
      where: { id: documentId, requestId },
      select: licenseRenewalDocumentFileTargetSelect,
    });
    if (!document) throw new NotFoundException("Document non trouvé");
    if (document.request.status !== LicenseRenewalStatus.PENDING) {
      throw new GoneException(
        "La demande a été traitée : ses documents ne sont plus consultables.",
      );
    }
    // Legacy multer disk paths (before blob storage) are gone with the old
    // VM; without blob storage nothing was ever persisted.
    if (/[\\/]/.test(document.filePath) || !this.blobStorage.isEnabled()) {
      throw new NotFoundException("Fichier indisponible");
    }

    const traces: Prisma.PrismaPromise<unknown>[] = [
      this.audit.recordOp({
        actorId: adminId,
        action: "LICENSE_RENEWAL_DOCUMENT_VIEW",
        targetType: "LICENSE_RENEWAL",
        targetId: requestId,
        // Which document was opened, never what it says.
        after: { documentId, documentType: document.type },
      }),
    ];
    // A licence certificate is not health data: audit row only.
    if (document.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE) {
      traces.push(
        this.healthAccess.recordOp([
          {
            subjectUserId: document.request.userId,
            actorUserId: adminId,
            actorRole: "ADMIN",
            action: "DOWNLOAD",
            resourceType: "MEDICAL_CERTIFICATE",
            resourceId: documentId,
            route: HEALTH_DATA_ACCESS_ROUTES.adminRenewalDocumentFile,
          },
        ]),
      );
    }
    await this.prisma.$transaction(traces);

    let stream: Readable | null;
    try {
      stream = await this.circuitBreaker.fire("azure-blob", () =>
        this.downloadWithTimeout(document.filePath),
      );
    } catch (error) {
      // Opaque reference only: no user id, no document content.
      this.logger.warn(
        `Renewal document download failed for "${document.filePath}": ${getErrorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        "Stockage des documents momentanément indisponible, réessayez dans un instant.",
      );
    }
    if (!stream) throw new NotFoundException("Fichier indisponible");
    return {
      stream,
      contentType:
        CONTENT_TYPES[extname(document.filePath).toLowerCase()] ??
        "application/octet-stream",
    };
  }

  /**
   * Download behind the shared `azure-blob` breaker:
   * - a missing blob resolves to null INSIDE the breaker, so a few missing
   *   files cannot open it for every blob read (music streaming included);
   * - if the timeout fires first, the stream that arrives later is destroyed
   *   instead of leaking an open connection to the storage.
   */
  private async downloadWithTimeout(
    blobName: string,
  ): Promise<Readable | null> {
    const download = this.blobStorage
      .downloadStream(blobName, this.blobStorage.getUploadsContainer())
      .catch((error: unknown) => {
        if (isNotFound(error)) return null;
        throw error;
      });
    try {
      return await withTimeout(
        download,
        RENEWAL_DOCUMENT_DOWNLOAD_TIMEOUT_MS,
        "blob download (renewal document)",
      );
    } catch (error) {
      void download.then(
        (late) => late?.destroy(),
        () => undefined,
      );
      throw error;
    }
  }

  /**
   * Ids of the rows approved automatically: approved, no reviewer, and no
   * decision audit row (see {@link mayBeAutomatic}). One bounded query, only
   * for the ambiguous rows of the page.
   */
  private async automaticallyDecided(
    rows: readonly (ListRow | DetailRow)[],
  ): Promise<Set<string>> {
    const candidates = rows.filter(mayBeAutomatic).map((row) => row.id);
    if (candidates.length === 0) return new Set();
    const decidedByAdmin = await this.prisma.adminAuditLog.findMany({
      where: {
        targetType: "LICENSE_RENEWAL",
        targetId: { in: candidates },
        action: { in: [...RENEWAL_DECISION_ACTIONS] },
      },
      select: auditTargetIdSelect,
      distinct: ["targetId"],
      take: candidates.length,
    });
    const byAdmin = new Set(decidedByAdmin.map((entry) => entry.targetId));
    return new Set(candidates.filter((id) => !byAdmin.has(id)));
  }

  private async findDetailRow(requestId: string): Promise<DetailRow> {
    const row = await this.prisma.licenseRenewalRequest.findUnique({
      where: { id: requestId },
      select: licenseRenewalAdminDetailSelect,
    });
    if (!row)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    return row;
  }

  private async toDetail(
    row: DetailRow,
  ): Promise<AdminLicenseRenewalDetailDto> {
    const [history, automaticIds] = await Promise.all([
      this.prisma.licenseRenewalRequest.findMany({
        where: { userId: row.userId, id: { not: row.id } },
        orderBy: { createdAt: "desc" },
        take: HISTORY_TAKE,
        select: licenseRenewalHistorySelect,
      }),
      this.automaticallyDecided([row]),
    ]);
    const pending = row.status === LicenseRenewalStatus.PENDING;
    return {
      ...toBase(row, automaticIds),
      rejectionReason: row.rejectionReason as RenewalRejectionReason | null,
      reviewComment: row.reviewComment,
      documents: row.documents.map((document) => ({
        id: document.id,
        type: document.type,
        createdAt: document.createdAt,
        // OCR hints (#19) only while a decision is still to be taken.
        ocr: pending
          ? pickRenewalOcrData(document.type, document.ocrData)
          : null,
      })),
      renewsUntil: pending
        ? renewedLicenseValidUntil(row.user.license?.validUntil)
        : null,
      history,
    };
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}
