import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import { licenseRenewalApprovalTargetSelect } from "../utils/prisma-selects";
import { renewedLicenseValidUntil } from "./license-season";
import { pickRenewalOcrData } from "./renewal-ocr-data.util";

export interface RenewalApprovalOptions {
  /** Administrator deciding, or null for the automatic approval at submission. */
  reviewerId: string | null;
  /**
   * Licence number confirmed by the administrator (#262). Takes precedence
   * over the OCR reading and replaces the number of an existing licence.
   */
  licenseNumber?: string;
  /** Decision time: the granted season is computed from it (#259). */
  now: Date;
}

export interface RenewalApprovalResult {
  /** End of validity granted by this approval. */
  validUntil: Date;
  /** Number of the licence after approval. */
  licenseNumber: string;
}

/** 409 of a decision that lost the race, or of an already decided request. */
export function renewalAlreadyDecided(): ConflictException {
  return new ConflictException(
    "Cette demande de renouvellement a déjà été traitée.",
  );
}

/**
 * Approves a PENDING renewal request and renews the licence. Must run inside
 * the caller's interactive `$transaction` (the caller adds its audit row to
 * the same transaction).
 *
 * 1. Conditional claim `updateMany … status: PENDING` FIRST (#261): of two
 *    concurrent decisions, only one updates a row; the other gets 0 rows, a
 *    409, and its transaction rolls back before touching the licence.
 * 2. Licence upsert, validity from the decision time (#259) and never shorter
 *    than the current one (#250).
 *
 * The licence number is never invented (#262): administrator's number, else
 * the OCR reading, else the existing licence's; none of them → 400.
 */
export async function approvePendingRenewal(
  tx: Prisma.TransactionClient,
  requestId: string,
  options: RenewalApprovalOptions,
): Promise<RenewalApprovalResult> {
  const request = await tx.licenseRenewalRequest.findUnique({
    where: { id: requestId },
    select: licenseRenewalApprovalTargetSelect,
  });
  if (!request)
    throw new NotFoundException("Demande de renouvellement non trouvée");
  if (request.status !== LicenseRenewalStatus.PENDING)
    throw renewalAlreadyDecided();

  const licenseCertificate = request.documents.find(
    (d) => d.type === LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
  );
  const ocrNumber = licenseCertificate
    ? nonEmpty(
        pickRenewalOcrData(licenseCertificate.type, licenseCertificate.ocrData)
          ?.licenseNumber,
      )
    : null;
  const existing = request.user.license;
  const licenseNumber =
    nonEmpty(options.licenseNumber) ?? ocrNumber ?? nonEmpty(existing?.number);
  if (!licenseNumber) {
    throw new BadRequestException(
      "Aucun numéro de licence connu pour cette demande : saisissez le numéro de licence confirmé.",
    );
  }

  const { count } = await tx.licenseRenewalRequest.updateMany({
    where: { id: requestId, status: LicenseRenewalStatus.PENDING },
    data: {
      status: LicenseRenewalStatus.APPROVED,
      reviewedById: options.reviewerId,
      reviewedAt: options.now,
    },
  });
  if (count === 0) throw renewalAlreadyDecided();

  const validUntil = renewedLicenseValidUntil(
    existing?.validUntil,
    options.now,
  );
  const confirmedNumber = nonEmpty(options.licenseNumber);
  try {
    await tx.license.upsert({
      where: { userId: request.userId },
      update: {
        validUntil,
        ...(confirmedNumber && { number: confirmedNumber }),
      },
      create: {
        userId: request.userId,
        number: licenseNumber,
        validUntil,
        category: request.user.category ?? "Standard",
        clubName: request.user.clubName ?? "Club",
      },
      select: { id: true },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ConflictException(
        "Ce numéro de licence est déjà attribué à un autre compte.",
      );
    }
    throw error;
  }

  return {
    validUntil,
    licenseNumber: confirmedNumber ?? existing?.number ?? licenseNumber,
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}
