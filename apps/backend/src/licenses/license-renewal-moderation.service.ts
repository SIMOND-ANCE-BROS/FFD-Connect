import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import { AdminAuditService } from "../admin/admin-audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { licenseRenewalStatusSelect } from "../utils/prisma-selects";
import {
  AdminLicenseRenewalDetailDto,
  ApproveLicenseRenewalDto,
  RejectLicenseRenewalDto,
  RENEWAL_REASON_HEALTH_DATA,
} from "./dto/admin-license-renewal.dto";
import {
  approvePendingRenewal,
  renewalAlreadyDecided,
} from "./license-renewal-approval";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";

/** A refused medical certificate is purged at most this long after the decision (#19). */
export const REJECTED_CERTIFICATE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Human moderation of licence renewals (#266, ADR-0021): writes only.
 *
 * Each decision is ONE interactive transaction: conditional claim
 * `updateMany … status: PENDING` (0 row → 409, #261), then its effect, then
 * the audit row. A 409 or any failure leaves no trace, licence included.
 *
 * The audit row carries the status and, for an approval, the granted validity
 * — never the reason code (`MEDICAL_RESTRICTION` is health data), never the
 * comment, never anything read on a document.
 */
@Injectable()
export class LicenseRenewalModerationService {
  private readonly logger = new Logger(LicenseRenewalModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: LicenseRenewalModerationQueryService,
  ) {}

  async approve(
    adminId: string,
    requestId: string,
    dto: ApproveLicenseRenewalDto,
  ): Promise<AdminLicenseRenewalDetailDto> {
    await this.assertPending(requestId);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const result = await approvePendingRenewal(tx, requestId, {
        reviewerId: adminId,
        licenseNumber: dto.licenseNumber,
        now,
      });
      await this.audit.record(tx, {
        actorId: adminId,
        action: "LICENSE_RENEWAL_APPROVE",
        targetType: "LICENSE_RENEWAL",
        targetId: requestId,
        before: { status: LicenseRenewalStatus.PENDING },
        after: {
          status: LicenseRenewalStatus.APPROVED,
          validUntil: result.validUntil.toISOString(),
        },
      });
    });
    this.logger.log(`Licence renewal ${requestId} approved by ${adminId}`);
    return this.query.detailAfterDecision(requestId);
  }

  async reject(
    adminId: string,
    requestId: string,
    dto: RejectLicenseRenewalDto,
  ): Promise<AdminLicenseRenewalDetailDto> {
    await this.assertPending(requestId);
    const now = new Date();
    const purgeDeadline = new Date(
      now.getTime() + REJECTED_CERTIFICATE_RETENTION_DAYS * DAY_MS,
    );
    const comment =
      dto.comment === undefined || dto.comment === "" ? null : dto.comment;
    await this.prisma.$transaction(async (tx) => {
      // The comment and MEDICAL_RESTRICTION may describe health data: they
      // are erased by the retention purge WITH the medical certificate. With
      // no certificate row left, nothing would ever erase them: refused.
      if (comment !== null || dto.reason === RENEWAL_REASON_HEALTH_DATA) {
        const certificates = await tx.licenseRenewalDocument.count({
          where: {
            requestId,
            type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          },
        });
        if (certificates === 0) {
          throw new BadRequestException(
            "Le certificat médical de cette demande n'est plus conservé : refusez sans commentaire, avec un motif autre que « restriction médicale ».",
          );
        }
      }
      const { count } = await tx.licenseRenewalRequest.updateMany({
        where: { id: requestId, status: LicenseRenewalStatus.PENDING },
        data: {
          status: LicenseRenewalStatus.REJECTED,
          reviewedById: adminId,
          reviewedAt: now,
          rejectionReason: dto.reason,
          reviewComment: comment,
        },
      });
      if (count === 0) throw renewalAlreadyDecided();
      // purgeDueAt = min(existing, decision + 30 days): only brought forward,
      // never postponed. The retention purge (#62) then removes the file, the
      // OCR data, and the review comment.
      await tx.licenseRenewalDocument.updateMany({
        where: {
          requestId,
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          OR: [{ purgeDueAt: null }, { purgeDueAt: { gt: purgeDeadline } }],
        },
        data: { purgeDueAt: purgeDeadline },
      });
      await this.audit.record(tx, {
        actorId: adminId,
        action: "LICENSE_RENEWAL_REJECT",
        targetType: "LICENSE_RENEWAL",
        targetId: requestId,
        before: { status: LicenseRenewalStatus.PENDING },
        after: { status: LicenseRenewalStatus.REJECTED },
      });
    });
    this.logger.log(`Licence renewal ${requestId} rejected by ${adminId}`);
    return this.query.detailAfterDecision(requestId);
  }

  /** 404 for an unknown request, 409 for one no longer PENDING. */
  private async assertPending(requestId: string): Promise<void> {
    const request = await this.prisma.licenseRenewalRequest.findUnique({
      where: { id: requestId },
      select: licenseRenewalStatusSelect,
    });
    if (!request)
      throw new NotFoundException("Demande de renouvellement non trouvée");
    if (request.status !== LicenseRenewalStatus.PENDING)
      throw renewalAlreadyDecided();
  }
}
