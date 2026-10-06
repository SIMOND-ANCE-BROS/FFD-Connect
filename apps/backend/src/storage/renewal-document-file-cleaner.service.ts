import { Injectable, Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { promises as fsp } from "fs";
import * as path from "path";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { getErrorMessage } from "../utils/error.utils";
import { withTimeout } from "../utils/timeout.utils";
import { BlobStorageService } from "./blob-storage.service";

/** Timeout of a single blob delete call (best-effort, ADR-0009). */
export const RENEWAL_BLOB_DELETE_TIMEOUT_MS = 8_000;

/** Why a renewal document file is being deleted (logged + Sentry tag). */
export type RenewalDocumentCleanupContext =
  | "account-deletion"
  | "document-replaced"
  | "upload-rollback"
  | "retention-purge";

/**
 * Best-effort deletion of license renewal document files (medical
 * certificate — health data, GDPR art. 9 — and license certificate).
 *
 * A reference is either:
 * - a blob name in the "uploads" container (current storage, #447): deleted
 *   behind the "azure-blob" circuit breaker + timeout (ADR-0009). A missing
 *   blob counts as success. When blob storage is not configured, nothing was
 *   ever persisted, so there is nothing to delete;
 * - a legacy multer disk path (`uploads/renewal/<file>`, before #447):
 *   deleted from local disk, confined to `<cwd>/uploads/`.
 *
 * Never throws: callers have already committed their DB change. Each failure
 * is logged as an error and reported to Sentry with only the file reference
 * and the error message (no user id, no other personal data) so the orphan
 * can be cleaned up manually (see scripts/list-orphan-renewal-blobs.ts).
 */
@Injectable()
export class RenewalDocumentFileCleaner {
  private readonly logger = new Logger(RenewalDocumentFileCleaner.name);
  private readonly uploadsRoot = path.resolve(process.cwd(), "uploads");

  constructor(
    private readonly blobStorage: BlobStorageService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /**
   * Deletes all given files in parallel; resolves once every attempt settled.
   *
   * Returns the references that are known to be gone. Callers that merely
   * cleaned up after a committed DB change can ignore it — the retention purge
   * (#62) uses it to drop only the rows whose file really went away, so a
   * failed delete is retried on the next pass instead of leaving an orphan
   * blob nothing points to any more.
   *
   * A reference whose storage is not configured counts as deleted: nothing was
   * ever persisted for it.
   */
  async deleteFiles(
    references: readonly string[],
    context: RenewalDocumentCleanupContext,
  ): Promise<ReadonlySet<string>> {
    const deleted = new Set<string>();
    if (references.length === 0) return deleted;
    const results = await Promise.allSettled(
      references.map((reference) => this.deleteOne(reference)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.reportFailure(references[index], context, result.reason);
        return;
      }
      deleted.add(references[index]);
    });
    return deleted;
  }

  private async deleteOne(reference: string): Promise<void> {
    if (/[\\/]/.test(reference)) {
      await this.deleteLegacyLocalFile(reference);
      return;
    }
    if (!this.blobStorage.isEnabled()) return;
    await this.circuitBreaker.fire("azure-blob", () =>
      withTimeout(
        this.blobStorage.deleteFile(
          reference,
          this.blobStorage.getUploadsContainer(),
        ),
        RENEWAL_BLOB_DELETE_TIMEOUT_MS,
        "blob delete (renewal document)",
      ),
    );
  }

  private async deleteLegacyLocalFile(reference: string): Promise<void> {
    const absolute = path.resolve(process.cwd(), reference);
    if (!absolute.startsWith(this.uploadsRoot + path.sep)) {
      throw new Error("legacy path outside uploads/ — not deleted");
    }
    await fsp.rm(absolute, { force: true });
  }

  private reportFailure(
    reference: string,
    context: RenewalDocumentCleanupContext,
    reason: unknown,
  ): void {
    const errorMessage = getErrorMessage(reason);
    this.logger.error(
      `Renewal document file deletion failed (${context}) for "${reference}" — manual cleanup required: ${errorMessage}`,
    );
    Sentry.captureMessage("Renewal document file deletion failed", {
      level: "error",
      tags: { rgpd: "file-deletion-failed", cleanup_context: context },
      extra: { fileReference: reference, error: errorMessage },
    });
  }
}
