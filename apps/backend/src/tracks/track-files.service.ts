import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { promises as fsp } from "fs";
import * as path from "path";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { getErrorMessage } from "../utils/error.utils";
import { withTimeout } from "../utils/timeout.utils";
import { isFlatMediaFilename } from "./media-response.util";

/** One upload of at most 20 MB to the blob `tracks` container. */
export const TRACK_FILE_UPLOAD_TIMEOUT_MS = 30_000;
/** Storage timeout or open breaker on upload: a 503 the SPA retries. */
export const TRACK_STORAGE_UNAVAILABLE_MESSAGE =
  "Stockage des musiques indisponible, réessayez dans un instant.";
/** One best-effort blob delete. */
export const TRACK_FILE_DELETE_TIMEOUT_MS = 8_000;

/**
 * Audio and artwork files of the track library, stored flat under their name:
 * in the blob `tracks` container (served by `/uploads/<name>`, see
 * UploadsFallbackController), or in `<cwd>/uploads/` when blob storage is not
 * configured (local dev, served by ServeStaticModule).
 *
 * Blob calls go through a circuit breaker + timeout (ADR-0009). Uploads have
 * their own breaker: a 20 MB upload must not share the 10 s budget of the
 * `/uploads` reads.
 */
@Injectable()
export class TrackFilesService {
  private readonly logger = new Logger(TrackFilesService.name);
  private readonly uploadsRoot = path.join(process.cwd(), "uploads");

  constructor(
    private readonly blobStorage: BlobStorageService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /** Stores a file under a server-generated flat name; throws on failure. */
  async save(name: string, buffer: Buffer): Promise<void> {
    if (!isFlatMediaFilename(name)) {
      throw new Error(`Refused track file name ${name}`);
    }
    if (!this.blobStorage.isEnabled()) {
      await fsp.mkdir(this.uploadsRoot, { recursive: true });
      await fsp.writeFile(path.join(this.uploadsRoot, name), buffer);
      return;
    }
    try {
      await this.circuitBreaker.fire("azure-blob-write", () =>
        withTimeout(
          this.blobStorage.uploadBuffer(buffer, name),
          TRACK_FILE_UPLOAD_TIMEOUT_MS,
          "blob upload (track)",
        ),
      );
    } catch (error) {
      if (TrackFilesService.isUnavailable(error)) {
        this.logger.warn(`Track upload unavailable: ${getErrorMessage(error)}`);
        throw new ServiceUnavailableException(
          TRACK_STORAGE_UNAVAILABLE_MESSAGE,
        );
      }
      throw error;
    }
  }

  /** Open breaker, our timeout, or the breaker's own timeout (opossum ETIMEDOUT). */
  private static isUnavailable(error: unknown): boolean {
    if (error instanceof ServiceUnavailableException) return true;
    if (!(error instanceof Error)) return false;
    return (
      error.message.startsWith("[Timeout]") ||
      (error as { code?: unknown }).code === "ETIMEDOUT"
    );
  }

  /**
   * Best-effort deletion, never throws: the caller already committed (or
   * rolled back) its row. Each failure is logged with the file name, so the
   * orphan can be removed by hand.
   */
  async remove(names: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      names.map((name) => this.removeOne(name)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.logger.warn(
          `Track file deletion failed for "${names[index]}" — manual cleanup required: ${getErrorMessage(result.reason)}`,
        );
      }
    });
  }

  private async removeOne(name: string): Promise<void> {
    const safeName = path.basename(name);
    if (!this.blobStorage.isEnabled()) {
      await fsp.rm(path.join(this.uploadsRoot, safeName), { force: true });
      return;
    }
    await this.circuitBreaker.fire("azure-blob", () =>
      withTimeout(
        this.blobStorage.deleteFile(safeName),
        TRACK_FILE_DELETE_TIMEOUT_MS,
        "blob delete (track)",
      ),
    );
  }
}
