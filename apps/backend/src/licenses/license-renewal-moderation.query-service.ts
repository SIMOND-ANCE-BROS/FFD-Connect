import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { LicenseRenewalStatus, Prisma } from "@prisma/client";
import { extname } from "path";
import { Readable } from "stream";
import { AdminAuditService } from "../admin/admin-audit.service";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { getErrorMessage } from "../utils/error.utils";
import {
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
  ListAdminLicenseRenewalsQueryDto,
  RenewalRejectionReason,
} from "./dto/admin-license-renewal.dto";
import { renewedLicenseValidUntil } from "./license-season";
import { pickRenewalOcrData } from "./renewal-ocr-data.util";

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

function toBase(row: ListRow | DetailRow) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    rejectionReason: row.rejectionReason as RenewalRejectionReason | null,
    user: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      license: row.user.license,
    },
    reviewedBy: row.reviewedBy,
  };
}

/**
 * Human moderation of licence renewals (#266, ADR-0021): reads.
 *
 * Reading a request or one of its documents is an access to health data: each
 * one writes an audit row (`LICENSE_RENEWAL_VIEW`,
 * `LICENSE_RENEWAL_DOCUMENT_VIEW`, #63) BEFORE the data is returned — if the
 * trace cannot be written, nothing is shown. The list does not need it: it
 * shows no document content and no OCR reading.
 */
@Injectable()
export class LicenseRenewalModerationQueryService {
  private readonly logger = new Logger(
    LicenseRenewalModerationQueryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
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
    };
    const [total, rows] = await Promise.all([
      this.prisma.licenseRenewalRequest.count({ where }),
      this.prisma.licenseRenewalRequest.findMany({
        where,
        orderBy: [
          { submittedAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        skip,
        take,
        select: licenseRenewalAdminListSelect,
      }),
    ]);
    return createPaginatedResponse(
      rows.map((row) => ({ ...toBase(row), documents: row.documents })),
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
    await this.audit.recordOp({
      actorId: adminId,
      action: "LICENSE_RENEWAL_VIEW",
      targetType: "LICENSE_RENEWAL",
      targetId: requestId,
    });
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

    await this.audit.recordOp({
      actorId: adminId,
      action: "LICENSE_RENEWAL_DOCUMENT_VIEW",
      targetType: "LICENSE_RENEWAL",
      targetId: requestId,
      // Which document was opened, never what it says.
      after: { documentId, documentType: document.type },
    });

    let stream: Readable;
    try {
      stream = await this.circuitBreaker.fire("azure-blob", () =>
        withTimeout(
          this.blobStorage.downloadStream(
            document.filePath,
            this.blobStorage.getUploadsContainer(),
          ),
          RENEWAL_DOCUMENT_DOWNLOAD_TIMEOUT_MS,
          "blob download (renewal document)",
        ),
      );
    } catch (error) {
      if (isNotFound(error))
        throw new NotFoundException("Fichier indisponible");
      // Opaque reference only: no user id, no document content.
      this.logger.warn(
        `Renewal document download failed for "${document.filePath}": ${getErrorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        "Stockage des documents momentanément indisponible, réessayez dans un instant.",
      );
    }
    return {
      stream,
      contentType:
        CONTENT_TYPES[extname(document.filePath).toLowerCase()] ??
        "application/octet-stream",
    };
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
    const history = await this.prisma.licenseRenewalRequest.findMany({
      where: { userId: row.userId, id: { not: row.id } },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TAKE,
      select: licenseRenewalHistorySelect,
    });
    const pending = row.status === LicenseRenewalStatus.PENDING;
    return {
      ...toBase(row),
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
