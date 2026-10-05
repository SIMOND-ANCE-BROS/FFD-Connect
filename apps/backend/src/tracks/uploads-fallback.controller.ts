import {
  Controller,
  Get,
  Logger,
  Next,
  Param,
  Req,
  RequestMethod,
  Res,
} from "@nestjs/common";
import type { RouteInfo } from "@nestjs/common/interfaces";
import { ApiExcludeController } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { NextFunction, Request, Response } from "express";
import { promises as fsp } from "fs";
import * as path from "path";
import { pipeline, Readable } from "stream";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import {
  BlobFileProperties,
  BlobStorageService,
} from "../storage/blob-storage.service";
import { getErrorMessage } from "../utils/error.utils";
import { withTimeout } from "../utils/timeout.utils";
import {
  contentTypeForFilename,
  isFlatMediaFilename,
  parseByteRange,
} from "./media-response.util";

/**
 * `/uploads` is served at the root (no `api/v1` prefix): this route must be
 * excluded from the global prefix wherever it is set (main.ts, test app).
 */
export const UPLOADS_FALLBACK_PREFIX_EXCLUDE: RouteInfo = {
  path: "uploads/:filename",
  method: RequestMethod.GET,
};

const BLOB_CALL_TIMEOUT_MS = 8_000;
// Track files are written once by tools/track-prep and keep their name; a day
// of client caching saves wake-ups and blob reads without pinning a bad file.
const CACHE_CONTROL = "public, max-age=86400";

/**
 * `/uploads/<file>` blob fallback.
 *
 * The client builds audio and artwork URLs as `/uploads/<file>`, historically
 * served by ServeStaticModule from the container's local disk — which is empty
 * on every new Container Apps revision. Real tracks only live in the blob
 * `tracks` container, so this route streams them from there when the file is
 * not on disk.
 *
 * Nest routes are registered before ServeStaticModule's handlers, so this
 * route runs first and hands over (`next()`) to ServeStatic in every case it
 * does not own: blob disabled, non-flat or non-media name, file present on
 * disk, blob miss or blob error. Only single-segment names match, so
 * sub-folders of `uploads/` are untouched, and the `uploads` blob container
 * (licence/medical documents) is never read.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller("uploads")
export class UploadsFallbackController {
  private readonly logger = new Logger(UploadsFallbackController.name);
  private readonly uploadsRoot = path.join(process.cwd(), "uploads");

  constructor(
    private readonly blobStorage: BlobStorageService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  @Get(":filename")
  async serve(
    @Param("filename") filename: string,
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    if (!this.fallbackEnabled() || !isFlatMediaFilename(filename)) {
      return next();
    }
    if (await this.existsOnDisk(filename)) {
      return next();
    }

    let props: BlobFileProperties | null;
    try {
      props = await this.callBlob("getProperties", () =>
        this.blobStorage.getProperties(filename),
      );
    } catch (error) {
      this.logger.warn(
        `Blob lookup failed for /uploads fallback: ${getErrorMessage(error)}`,
      );
      return next();
    }
    if (!props) {
      return next();
    }

    const etag = props.etag;
    if (etag && req.headers["if-none-match"] === etag) {
      this.setCommonHeaders(res, filename, props);
      res.status(304).end();
      return;
    }

    const ifRange = req.headers["if-range"];
    const rangeHeader =
      ifRange && ifRange !== etag ? undefined : req.headers.range;
    const range = parseByteRange(rangeHeader, props.size);

    if (range.kind === "unsatisfiable") {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Range", `bytes */${props.size}`);
      res.status(416).end();
      return;
    }

    const start = range.kind === "partial" ? range.start : 0;
    const end = range.kind === "partial" ? range.end : props.size - 1;
    const length = props.size === 0 ? 0 : end - start + 1;
    const status = range.kind === "partial" ? 206 : 200;

    if (req.method === "HEAD" || length === 0) {
      this.writeHead(res, status, filename, props, length, start, end);
      res.end();
      return;
    }

    let body: Readable;
    try {
      body = await this.callBlob("download", () =>
        this.blobStorage.downloadRange(filename, start, length),
      );
    } catch (error) {
      this.logger.warn(
        `Blob download failed for /uploads fallback: ${getErrorMessage(error)}`,
      );
      return next();
    }

    this.writeHead(res, status, filename, props, length, start, end);
    pipeline(body, res, (error) => {
      if (error) {
        this.logger.warn(
          `Blob stream aborted for /uploads fallback: ${getErrorMessage(error)}`,
        );
      }
    });
  }

  /** Disabled without blob, or if the track container is the documents one. */
  private fallbackEnabled(): boolean {
    return (
      this.blobStorage.isEnabled() &&
      this.blobStorage.getDefaultContainer() !==
        this.blobStorage.getUploadsContainer()
    );
  }

  private async existsOnDisk(filename: string): Promise<boolean> {
    try {
      const stat = await fsp.stat(path.join(this.uploadsRoot, filename));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private callBlob<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return this.circuitBreaker.fire("azure-blob", () =>
      withTimeout(fn(), BLOB_CALL_TIMEOUT_MS, `blob ${label}`),
    );
  }

  private setCommonHeaders(
    res: Response,
    filename: string,
    props: BlobFileProperties,
  ): void {
    // No Content-Disposition: inline media, and the name may be non-ASCII.
    res.setHeader("Content-Type", contentTypeForFilename(filename));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", CACHE_CONTROL);
    if (props.etag) res.setHeader("ETag", props.etag);
    if (props.lastModified) {
      res.setHeader("Last-Modified", props.lastModified.toUTCString());
    }
  }

  private writeHead(
    res: Response,
    status: number,
    filename: string,
    props: BlobFileProperties,
    length: number,
    start: number,
    end: number,
  ): void {
    this.setCommonHeaders(res, filename, props);
    res.setHeader("Content-Length", String(length));
    if (status === 206) {
      res.setHeader("Content-Range", `bytes ${start}-${end}/${props.size}`);
    }
    res.status(status);
  }
}
