// apps/backend/src/competitions/services/competition-management.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import {
  ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE,
  COMPETITION_TYPES,
  EVENT_KINDS,
  LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE,
} from "../../common/participation-rules";
import { COMPETITION_LEVELS } from "../../common/age-group";
import { EntryQrService } from "../../licenses/qr/entry-qr.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  CreateCompetitionDto,
  UpdateCompetitionDto,
} from "../dto/competition-management.dto";
import type { NewCompetitionOrganizer } from "./competition-access.service";
import { CompetitionCacheService } from "./competition-cache.service";
import { COMPETITION_BASE_SELECT } from "./competition-query.service";
import { SyncResult } from "../sync.processor";

export const ROTATING_QR_UNAVAILABLE_MESSAGE =
  "Le QR d'entrée tournant n'est pas activé sur ce serveur : il ne peut pas être rendu obligatoire.";

@Injectable()
export class CompetitionManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    @InjectQueue("ffd-sync") private readonly syncQueue: Queue,
    private readonly redisService: RedisService,
    private readonly entryQrService: EntryQrService,
  ) {}

  getRegulationConstants() {
    const allowedByType: Record<string, string[]> = {};
    for (const [type, kinds] of Object.entries(
      ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE,
    )) {
      allowedByType[type] = [...kinds];
    }
    return {
      competitionTypes: [...COMPETITION_TYPES],
      eventKinds: [...EVENT_KINDS],
      competitionLevels: [...COMPETITION_LEVELS],
      allowedEventKindsByCompetitionType: allowedByType,
      levelsForProximiteClassificatrice: [
        ...LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE,
      ],
    };
  }

  async enqueueSyncFFD(): Promise<{ jobId: string }> {
    const existing = await this.syncQueue.getJobs([
      "active",
      "waiting",
      "delayed",
    ]);
    if (existing.length > 0) {
      throw new ConflictException(
        "A sync is already in progress. Try again later.",
      );
    }
    const job = await this.syncQueue.add("sync-ffd", {});
    await this.redisService.set("ffd-sync:latest-job-id", job.id!);
    return { jobId: job.id! };
  }

  async getSyncStatus(): Promise<{
    status: string;
    jobId?: string;
    stats?: SyncResult;
    error?: string;
  }> {
    const jobId = await this.redisService.get("ffd-sync:latest-job-id");
    if (!jobId) return { status: "idle" };
    const job = await this.syncQueue.getJob(jobId);
    if (!job) return { status: "idle" };
    const state = await job.getState();
    return {
      status: state,
      jobId,
      stats:
        state === "completed" ? (job.returnvalue as SyncResult) : undefined,
      error: state === "failed" ? job.failedReason : undefined,
    };
  }

  /**
   * A deadline after the competition itself would never close registration,
   * which is indistinguishable from having none — reject it rather than store
   * a value that silently does nothing.
   */
  /**
   * Making the rotating QR mandatory (#668) while the server cannot issue
   * one (no Ed25519 key, ADR-0024) would lock every participant out: no app
   * could show anything but a static QR. Disabling it is always allowed.
   */
  private assertRotatingQrAvailable(requireRotatingQr?: boolean) {
    if (requireRotatingQr === true && !this.entryQrService.canIssue()) {
      throw new BadRequestException(ROTATING_QR_UNAVAILABLE_MESSAGE);
    }
  }

  private assertDeadlineBeforeDate(deadline: Date, competitionDate: Date) {
    if (deadline.getTime() > competitionDate.getTime()) {
      throw new BadRequestException(
        "registrationDeadline doit être antérieure ou égale à la date de la compétition.",
      );
    }
  }

  /**
   * @param organizer organizing club (label + link, #408), stamped for a
   *   competition created by a CLUB account (see
   *   CompetitionAccessService.organizerForNewCompetition).
   */
  async create(
    data: CreateCompetitionDto,
    organizer?: NewCompetitionOrganizer,
  ) {
    const { date, layout, registrationDeadline, ...rest } = data;
    const competitionDate = new Date(date);
    const deadline =
      registrationDeadline === undefined
        ? undefined
        : new Date(registrationDeadline);
    if (deadline) this.assertDeadlineBeforeDate(deadline, competitionDate);
    this.assertRotatingQrAvailable(data.requireRotatingQr);
    return this.prisma.competition.create({
      data: {
        ...rest,
        ...(organizer !== undefined && {
          organizer: organizer.organizer,
          organizerClubId: organizer.organizerClubId,
        }),
        date: competitionDate,
        ...(deadline !== undefined && { registrationDeadline: deadline }),
        ...(layout !== undefined && {
          layout: layout as Prisma.InputJsonValue,
        }),
      },
      select: COMPETITION_BASE_SELECT,
    });
  }

  async update(id: string, data: UpdateCompetitionDto) {
    const { date, layout, registrationDeadline, ...rest } = data;
    this.assertRotatingQrAvailable(data.requireRotatingQr);
    // `null` clears the deadline; `undefined` leaves it untouched.
    const deadline =
      registrationDeadline === undefined || registrationDeadline === null
        ? registrationDeadline
        : new Date(registrationDeadline);
    if (deadline) {
      // The competition date may not be in this payload — fall back to the
      // stored one so the constraint holds on a deadline-only update.
      const competitionDate = date
        ? new Date(date)
        : (
            await this.prisma.competition.findUniqueOrThrow({
              where: { id },
              select: { date: true },
            })
          ).date;
      this.assertDeadlineBeforeDate(deadline, competitionDate);
    }
    const updated = await this.prisma.competition.update({
      where: { id },
      data: {
        ...rest,
        ...(date ? { date: new Date(date) } : {}),
        ...(deadline !== undefined && { registrationDeadline: deadline }),
        ...(layout !== undefined && {
          layout: layout as Prisma.InputJsonValue,
        }),
      },
      select: COMPETITION_BASE_SELECT,
    });
    await this.cacheService.invalidateCompetition(id);
    return updated;
  }
}
