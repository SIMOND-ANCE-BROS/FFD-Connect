import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma, TrackStatus } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import { AdminAuditService } from "../admin/admin-audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { getErrorMessage } from "../utils/error.utils";
import { idOnlySelect, trackDuplicateSelect } from "../utils/prisma-selects";
import { withTimeout } from "../utils/timeout.utils";
import { AdminTracksQueryService } from "./admin-tracks.query-service";
import { BpmService } from "./bpm.service";
import { AdminTrackDto } from "./dto/admin-track.dto";
import {
  CheckTrackItemDto,
  CheckTracksResultDto,
  ImportTrackDto,
} from "./dto/track-import.dto";
import {
  ArtworkExtension,
  artworkExtension,
  isMp3,
} from "./track-file-signature.util";
import { TrackFilesService } from "./track-files.service";
import { TracksService } from "./tracks.service";

export const TRACK_IMPORT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
export const TRACK_IMPORT_MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
export const TRACK_IMPORT_JOB_ID = "admin-import";
export const TRACK_TEMPO_ANALYSIS_TIMEOUT_MS = 60_000;
/**
 * Backstop past BpmService's own kill: the kill fires first and the queue
 * slot is only released once ffmpeg is really stopped.
 */
export const TRACK_TEMPO_ANALYSIS_OUTER_TIMEOUT_MS =
  TRACK_TEMPO_ANALYSIS_TIMEOUT_MS + 15_000;
/** Analyses allowed to wait behind the running one before a 503. */
export const TRACK_TEMPO_ANALYSIS_MAX_WAITING = 4;
export const TRACK_TEMPO_ANALYSIS_SATURATED_MESSAGE =
  "Analyse du tempo saturée, réessayez dans un instant.";
export const TRACK_DUPLICATE_MESSAGE =
  "Cette musique est déjà dans la bibliothèque.";

/**
 * Route-scoped body limit of POST /admin/tracks, enforced by multer while it
 * reads the request (413 beyond 20 MB per file): no global body-parser limit
 * changes. `fileSize` applies to each file; the 2 MB artwork cap is checked
 * by the service.
 */
export const TRACK_IMPORT_MULTIPART_LIMITS = {
  fileSize: TRACK_IMPORT_MAX_AUDIO_BYTES,
  files: 2,
  fields: 10,
  fieldSize: 1024,
  parts: 12,
};

/** An uploaded part, as multer's memory storage hands it over. */
export interface UploadedTrackFile {
  buffer: Buffer;
  size: number;
}

interface Tempo {
  rawBpm: number;
  bpm: number;
  status: TrackStatus;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002";

/** Back-office import of track files: duplicate check and one-file import. */
@Injectable()
export class TrackImportService {
  private readonly logger = new Logger(TrackImportService.name);
  /** Tail of the tempo-analysis queue (see `analyze`). */
  private analysisQueue: Promise<void> = Promise.resolve();
  /** Analyses running or queued (each holds its upload in memory). */
  private analysesInFlight = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracks: TracksService,
    private readonly bpm: BpmService,
    private readonly files: TrackFilesService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminTracksQueryService,
  ) {}

  /** Which items already exist (same source or same audio file), in request order. */
  async check(
    items: readonly CheckTrackItemDto[],
  ): Promise<CheckTracksResultDto> {
    const hashes = [...new Set(items.map((item) => item.sha256))];
    const keys = [
      ...new Set(
        items.flatMap((item) => (item.sourceKey ? [item.sourceKey] : [])),
      ),
    ];
    const rows = await this.prisma.track.findMany({
      where: {
        OR: [
          { contentHash: { in: hashes } },
          ...(keys.length > 0 ? [{ sourceKey: { in: keys } }] : []),
        ],
      },
      select: trackDuplicateSelect,
      // Both columns are unique: at most one row per hash and one per key.
      take: hashes.length + keys.length,
    });
    const byHash = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const row of rows) {
      if (row.contentHash) byHash.set(row.contentHash, row.id);
      if (row.sourceKey) byKey.set(row.sourceKey, row.id);
    }
    return {
      items: items.map((item) => {
        const trackId =
          byHash.get(item.sha256) ??
          (item.sourceKey ? byKey.get(item.sourceKey) : undefined);
        return trackId ? { exists: true, trackId } : { exists: false };
      }),
    };
  }

  /**
   * One track of the back-office import. The files are checked by content
   * (never by name or declared type), stored under server-generated names
   * before the row is written, and deleted again if the row cannot be.
   */
  async importTrack(
    actorId: string,
    dto: ImportTrackDto,
    audio: UploadedTrackFile | undefined,
    artwork: UploadedTrackFile | undefined,
  ): Promise<AdminTrackDto> {
    if (!audio) throw new BadRequestException("Fichier audio requis.");
    if (audio.size > TRACK_IMPORT_MAX_AUDIO_BYTES) {
      throw new PayloadTooLargeException("Le fichier audio dépasse 20 Mo.");
    }
    if (!isMp3(audio.buffer)) {
      throw new BadRequestException("Le fichier audio n'est pas un MP3.");
    }
    const artworkExt = artwork
      ? TrackImportService.checkArtwork(artwork)
      : null;
    const contentHash = createHash("sha256").update(audio.buffer).digest("hex");
    if (contentHash !== dto.sha256) {
      throw new BadRequestException(
        "L'empreinte SHA-256 ne correspond pas au fichier reçu.",
      );
    }
    const existing = await this.findDuplicate(dto.sourceKey, contentHash);
    if (existing) throw TrackImportService.duplicate(existing);

    const tempo = await this.tempo(audio.buffer, dto);
    const filename = `${randomUUID()}.mp3`;
    const artworkName = artworkExt ? `${randomUUID()}.${artworkExt}` : null;
    const stored: string[] = [];
    let trackId: string;
    try {
      await this.files.save(filename, audio.buffer);
      stored.push(filename);
      if (artwork && artworkName) {
        await this.files.save(artworkName, artwork.buffer);
        stored.push(artworkName);
      }
      trackId = await this.prisma.$transaction(async (tx) => {
        const created = await tx.track.create({
          data: {
            title: dto.title,
            artist: dto.artist,
            style: dto.style ?? null,
            filename,
            artwork: artworkName,
            bpm: tempo.bpm,
            rawBpm: tempo.rawBpm,
            status: tempo.status,
            sourceKey: dto.sourceKey ?? null,
            contentHash,
            jobId: TRACK_IMPORT_JOB_ID,
            submittedById: actorId,
          },
          select: idOnlySelect,
        });
        await this.audit.record(tx, {
          actorId,
          action: "TRACK_CREATE",
          targetType: "TRACK",
          targetId: created.id,
          after: {
            title: dto.title,
            artist: dto.artist,
            style: dto.style ?? null,
            bpm: tempo.bpm,
            sourceKey: dto.sourceKey ?? null,
            status: tempo.status,
          },
        });
        return created.id;
      });
    } catch (error) {
      await this.files.remove(stored);
      if (isUniqueViolation(error)) {
        // Another import of the same file or source won the race.
        throw TrackImportService.duplicate(
          await this.findDuplicate(dto.sourceKey, contentHash),
        );
      }
      throw error;
    }
    this.logger.log(
      `Track ${trackId} imported by ${actorId} (${tempo.status})`,
    );
    return this.query.detail(trackId);
  }

  private static checkArtwork(artwork: UploadedTrackFile): ArtworkExtension {
    if (artwork.size > TRACK_IMPORT_MAX_ARTWORK_BYTES) {
      throw new PayloadTooLargeException("La pochette dépasse 2 Mo.");
    }
    const ext = artworkExtension(artwork.buffer);
    if (!ext) {
      throw new BadRequestException(
        "La pochette doit être une image JPEG ou PNG.",
      );
    }
    return ext;
  }

  private static duplicate(existingTrackId: string | null): ConflictException {
    return new ConflictException({
      message: TRACK_DUPLICATE_MESSAGE,
      ...(existingTrackId && { existingTrackId }),
    });
  }

  private async findDuplicate(
    sourceKey: string | undefined,
    contentHash: string,
  ): Promise<string | null> {
    const row = await this.prisma.track.findFirst({
      where: { OR: [{ contentHash }, ...(sourceKey ? [{ sourceKey }] : [])] },
      select: idOnlySelect,
    });
    return row?.id ?? null;
  }

  /**
   * Tempo of the new track. The raw BPM comes from the import (track-prep
   * manifest) or from BpmService; the MPM is the admin's, else the raw tempo
   * converted for the dance (same rule as PATCH /tracks/:id), else the rounded
   * raw tempo. No tempo at all (analysis failed, no MPM given): the track is
   * created in ERROR, out of the library, until an admin sets its MPM.
   */
  private async tempo(audio: Buffer, dto: ImportTrackDto): Promise<Tempo> {
    const rawBpm = dto.rawBpm ?? (await this.analyze(audio));
    if (rawBpm > 0) {
      const bpm =
        this.tracks.bpmForPatch(rawBpm, { bpm: dto.mpm, style: dto.style }) ??
        Math.round(rawBpm);
      return { rawBpm, bpm, status: TrackStatus.READY };
    }
    if (dto.mpm !== undefined) {
      return { rawBpm: 0, bpm: dto.mpm, status: TrackStatus.READY };
    }
    return { rawBpm: 0, bpm: 0, status: TrackStatus.ERROR };
  }

  /**
   * Raw BPM detected by ffmpeg + music-tempo on a temp copy, or 0 when it
   * fails. One analysis at a time per replica: a bulk import sends several
   * files at once, and parallel ffmpeg + music-tempo passes would starve a
   * small replica into timeouts. The wait in the queue does not count
   * against the timeout. With TRACK_TEMPO_ANALYSIS_MAX_WAITING analyses
   * already waiting, a new one is refused (503, retryable by the SPA): each
   * waiting import keeps its upload in memory.
   */
  private analyze(audio: Buffer): Promise<number> {
    return this.oneAnalysisAtATime(async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "track-import-"));
      const file = path.join(dir, "audio.mp3");
      try {
        await fsp.writeFile(file, audio);
        // BpmService kills ffmpeg at the timeout; withTimeout, 15 s later,
        // stays as the backstop for the decoding that follows the conversion
        // (equal timeouts could release the queue slot before the kill).
        const bpm = await withTimeout(
          this.bpm.analyzeBpm(file, {
            timeoutMs: TRACK_TEMPO_ANALYSIS_TIMEOUT_MS,
          }),
          TRACK_TEMPO_ANALYSIS_OUTER_TIMEOUT_MS,
          "tempo analysis",
        );
        return Number.isFinite(bpm) && bpm > 0 ? bpm : 0;
      } catch (error) {
        this.logger.warn(`Tempo analysis failed: ${getErrorMessage(error)}`);
        return 0;
      } finally {
        await fsp.rm(dir, { recursive: true, force: true });
      }
    });
  }

  /** Promise-chain semaphore of size 1: `task` starts once the previous one settled. */
  private oneAnalysisAtATime<T>(task: () => Promise<T>): Promise<T> {
    // In flight = the running analysis + the waiting ones.
    if (this.analysesInFlight >= 1 + TRACK_TEMPO_ANALYSIS_MAX_WAITING) {
      throw new ServiceUnavailableException(
        TRACK_TEMPO_ANALYSIS_SATURATED_MESSAGE,
      );
    }
    this.analysesInFlight += 1;
    const run = this.analysisQueue.then(task).finally(() => {
      this.analysesInFlight -= 1;
    });
    this.analysisQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
