import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventsSource, Prisma } from "@prisma/client";
import { CircuitBreakerService } from "../../common/circuit-breaker/circuit-breaker.service";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage } from "../../utils/error.utils";
import { competitionEventsDeductionSelect } from "../../utils/prisma-selects";
import { withTimeout } from "../../utils/timeout.utils";
import {
  type DeducedEvent,
  FFD_EVENTS_PARSER_VERSION,
  mergeDeducedEvents,
  parseFfdEvents,
} from "../events-deduction/ffd-events-parser";
import { extractPdfText, isPdf } from "../events-deduction/pdf-text.util";

/** Downloads an FFD document (anti-bot aware) as raw bytes. */
export type FfdDocumentDownloader = (url: string) => Promise<Buffer>;

type DeductionCandidate = Prisma.CompetitionGetPayload<{
  select: typeof competitionEventsDeductionSelect;
}>;

const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Sources whose events were written by the sync itself (safe to replace). */
const SYNC_OWNED_SOURCES: readonly EventsSource[] = [
  EventsSource.GENERIC,
  EventsSource.DESCRIPTION,
  EventsSource.CIRCULAR,
];

/**
 * Shape of the generic events seeded by the sync before `eventsSource`
 * existed (Standard/Latin × Adult/Senior, couple, no level/kind).
 */
function isLegacyGenericEvent(event: DeductionCandidate["events"][number]) {
  return (
    event.eventType === "COUPLE" &&
    event.level === null &&
    event.eventKind === null &&
    (event.category === "Standard" || event.category === "Latin") &&
    (event.ageGroup === "Adult" || event.ageGroup === "Senior")
  );
}

/**
 * TEMPORARY (until the app is connected to the FFD) — replaces the generic
 * épreuves of a synced competition by the ones deduced from its documents:
 * the free-text programme (`eventsDescription`) and the circular PDF.
 *
 * Runs only inside the FFD sync job, once per document set: a fingerprint of
 * (parser version, description, circular URL) is stored so unchanged
 * competitions are skipped without any download. Never runs on a user
 * request (scale-to-zero: no wake, no cost).
 *
 * Events are only replaced while nobody depends on them (no registration,
 * result or schedule item) and when they were written by the sync. Every
 * failure degrades silently: logged, generic events kept.
 */
@Injectable()
export class CompetitionEventsDeductionService {
  private readonly logger = new Logger(CompetitionEventsDeductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  get enabled(): boolean {
    return this.configService.get<boolean>("ffd.deduceEvents") ?? true;
  }

  /** Never throws: a deduction problem must not fail the sync. */
  async deduceForCompetitions(
    competitionIds: string[],
    download: FfdDocumentDownloader,
  ): Promise<void> {
    if (!this.enabled || competitionIds.length === 0) return;

    let candidates: DeductionCandidate[];
    try {
      candidates = await this.prisma.competition.findMany({
        where: { id: { in: competitionIds } },
        select: competitionEventsDeductionSelect,
        take: competitionIds.length,
      });
    } catch (error: unknown) {
      this.logger.warn(`Events deduction skipped: ${getErrorMessage(error)}`);
      return;
    }

    for (const competition of candidates) {
      try {
        await this.deduceOne(competition, download);
      } catch (error: unknown) {
        this.logger.warn(
          `Events deduction failed for competition ${competition.id}: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  fingerprint(competition: {
    eventsDescription: string | null;
    circularUrl: string | null;
  }): string {
    return createHash("sha256")
      .update(
        [
          `v${FFD_EVENTS_PARSER_VERSION}`,
          competition.eventsDescription ?? "",
          competition.circularUrl ?? "",
        ].join("\u0000"),
      )
      .digest("hex");
  }

  isReplaceable(competition: DeductionCandidate): boolean {
    const hasDependants = competition.events.some(
      (event) =>
        event._count.registrations > 0 ||
        event._count.results > 0 ||
        event._count.scheduleItems > 0,
    );
    if (hasDependants) return false;
    if (
      competition.eventsSource !== null &&
      SYNC_OWNED_SOURCES.includes(competition.eventsSource)
    ) {
      return true;
    }
    return competition.events.every(isLegacyGenericEvent);
  }

  private async deduceOne(
    competition: DeductionCandidate,
    download: FfdDocumentDownloader,
  ): Promise<void> {
    const fingerprint = this.fingerprint(competition);
    if (competition.eventsFingerprint === fingerprint) return;

    // Checked before any download: a competition with registrations is
    // never touched, so its documents are not even fetched.
    if (!this.isReplaceable(competition)) {
      await this.saveFingerprint(competition.id, fingerprint);
      return;
    }

    const fromDescription = competition.eventsDescription
      ? parseFfdEvents(competition.eventsDescription)
      : [];
    const circular = await this.readCircular(competition.circularUrl, download);
    const fromCircular = circular.events;

    const events = mergeDeducedEvents(fromCircular, fromDescription);
    const source =
      fromCircular.length > 0
        ? EventsSource.CIRCULAR
        : fromDescription.length > 0
          ? EventsSource.DESCRIPTION
          : null;

    // A failed download is retried on the next sync: no fingerprint then.
    const nextFingerprint = circular.failed ? null : fingerprint;

    if (source === null) {
      // Nothing recognised: keep the generic events.
      if (nextFingerprint) {
        await this.saveFingerprint(competition.id, nextFingerprint);
      }
      return;
    }

    await this.replaceEvents(competition.id, events, source, nextFingerprint);
    this.logger.log(
      `Deduced ${events.length} events (${source}) for competition ${competition.id}`,
    );
  }

  private async readCircular(
    circularUrl: string | null,
    download: FfdDocumentDownloader,
  ): Promise<{ events: DeducedEvent[]; failed: boolean }> {
    if (!circularUrl || !this.isFfdDocumentUrl(circularUrl)) {
      return { events: [], failed: false };
    }

    let data: Buffer;
    try {
      data = await this.circuitBreaker.fire("ffd-documents", () =>
        withTimeout(
          download(circularUrl),
          DOWNLOAD_TIMEOUT_MS,
          "FFD circular download",
        ),
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Circular download failed (${circularUrl}): ${getErrorMessage(error)}`,
      );
      return { events: [], failed: true };
    }

    if (!isPdf(data)) return { events: [], failed: false };

    let text: string;
    try {
      text = await extractPdfText(new Uint8Array(data));
    } catch (error: unknown) {
      // A malformed PDF will not get better: no retry, description only.
      this.logger.warn(
        `Circular text extraction failed (${circularUrl}): ${getErrorMessage(error)}`,
      );
      return { events: [], failed: false };
    }
    // TODO(ocr): scanned circulars (no text layer, ~1 in 35 locally) and
    // poster images could go through OCR, but Azure Vision Read
    // (src/utils/ocr.service.ts) does not accept PDFs: it would need page
    // rasterisation or a Document Intelligence resource. Not worth it for a
    // temporary feature — those competitions keep the description/generic
    // events.
    return { events: parseFfdEvents(text), failed: false };
  }

  /**
   * Only documents hosted by the FFD API are fetched (the URL comes from the
   * FFD payload; this keeps the sync from being pointed anywhere else).
   */
  private isFfdDocumentUrl(url: string): boolean {
    const base = this.configService.get<string>("ffd.apiBaseUrl") ?? "";
    try {
      const target = new URL(url);
      return (
        target.protocol === "https:" && target.origin === new URL(base).origin
      );
    } catch {
      return false;
    }
  }

  private async saveFingerprint(
    competitionId: string,
    fingerprint: string,
  ): Promise<void> {
    await this.prisma.competition.update({
      where: { id: competitionId },
      data: { eventsFingerprint: fingerprint },
      select: { id: true },
    });
  }

  private async replaceEvents(
    competitionId: string,
    events: DeducedEvent[],
    source: EventsSource,
    fingerprint: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction; the Registration → Event foreign
      // key also makes the delete fail (and roll back) if one slipped in.
      const registrations = await tx.registration.count({
        where: { event: { competitionId } },
      });
      if (registrations > 0) return;

      await tx.event.deleteMany({ where: { competitionId } });
      await tx.event.createMany({
        data: events.map((event) => ({ ...event, competitionId })),
      });
      await tx.competition.update({
        where: { id: competitionId },
        data: {
          eventsSource: source,
          ...(fingerprint ? { eventsFingerprint: fingerprint } : {}),
        },
        select: { id: true },
      });
    });
  }
}
