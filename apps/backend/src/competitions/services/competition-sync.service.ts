import { HttpService } from "@nestjs/axios";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage, getErrorStack } from "../../utils/error.utils";
import {
  FFDCompetitionItem,
  FFDResponse,
} from "../interfaces/ffd-competition.interface";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";
import { CompetitionEventsDeductionService } from "./competition-events-deduction.service";

@Injectable()
export class CompetitionSyncService {
  private readonly logger = new Logger(CompetitionSyncService.name);
  private readonly SYNC_BATCH_SIZE = 5;

  // The FFD API sits behind a JS/cookie anti-bot ("bot_mitigation_cookie"):
  // the first request returns an HTML page that redirects to
  // /redirect_<token>====/<path> and sets the cookie. Following that redirect
  // validates the cookie; subsequent requests carrying it return real JSON.
  private readonly USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  private readonly FFD_MAX_HOPS = 12;
  // Pages of competitions to pull (newest first), itemsPerPage each. Bounds the
  // sync to upcoming + recent past instead of the full ~390-item history.
  private readonly FFD_MAX_PAGES = 4;
  // Circulars are 0.2–2 MB; anything far larger is not a circular.
  private readonly FFD_MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
  private botCookie: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CompetitionCacheService,
    private readonly eventNotificationService: CompetitionEventNotificationService,
    private readonly eventsDeductionService: CompetitionEventsDeductionService,
  ) {}

  async syncFFDCompetitions() {
    try {
      this.logger.log("Syncing competitions from FFD API");
      const items = await this.fetchAllFFDCompetitions();
      this.logger.log(`Found ${items.length} competitions from FFD`);

      const syncResult = await this.processCompetitionsSync(items);

      this.logger.log(
        `Sync completed: ${syncResult.synced} synced, ${syncResult.failed} failed`,
      );

      this.validateSyncResult(syncResult, items.length);

      const result = {
        total: items.length,
        synced: syncResult.synced,
        failed: syncResult.failed,
      };

      await this.cacheService.invalidateAll();

      return result;
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const errorStack = getErrorStack(error);
      this.logger.error(`Sync failed: ${errorMessage}`, errorStack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to sync competitions: ${errorMessage}`,
      );
    }
  }

  private async processCompetitionsSync(
    items: FFDCompetitionItem[],
  ): Promise<{ synced: number; failed: number }> {
    let syncedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < items.length; i += this.SYNC_BATCH_SIZE) {
      const batch = items.slice(i, i + this.SYNC_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((item) => this.syncSingleCompetition(item["@id"])),
      );

      const syncedIds: string[] = [];
      const newCompetitionIds: string[] = [];
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled") {
          syncedCount++;
          syncedIds.push(result.value.id);
          if (result.value.isNew) {
            newCompetitionIds.push(result.value.id);
          }
        } else {
          const ffdId = batch[j]["@id"];
          this.logger.error(
            `Failed to sync competition ${ffdId}: ${getErrorMessage(result.reason)}`,
            getErrorStack(result.reason),
          );
          failedCount++;
        }
      }

      // FFD exposes no structured épreuves, so we seed generic ones per
      // competition (Standard/Latin × Adult/Senior) to power in-app
      // registration + the career/results views. The real FFD programme stays
      // available via competition.eventsDescription/programUrl.
      await this.ensureDefaultEventsBatch(syncedIds);

      // TEMPORARY: replace those generic events by the real épreuves deduced
      // from the FFD description / circular PDF (once per document, never
      // when registrations exist). Never throws.
      await this.eventsDeductionService.deduceForCompetitions(
        syncedIds,
        (url) => this.downloadFfdDocument(url),
      );

      // In-app notifications (never throw — they must not break the sync):
      //  - newly-created competitions → eligible licensees
      //  - competitions that now have published results → participants
      await this.dispatchNewCompetitionNotifications(newCompetitionIds);
      await this.dispatchResultsNotifications(syncedIds);
    }

    return { synced: syncedCount, failed: failedCount };
  }

  private async syncSingleCompetition(
    ffdId: string,
  ): Promise<{ id: string; isNew: boolean }> {
    const details = await this.fetchCompetitionDetails(ffdId);
    // Distinguish create vs update: the FFD upsert doesn't report which branch
    // ran, so we check existence by ffdId first. A missing row = new competition.
    const existing = await this.prisma.competition.findUnique({
      where: { ffdId },
      select: { id: true },
    });
    const competition = await this.upsertCompetition(ffdId, details);
    return { id: competition.id, isNew: existing === null };
  }

  /**
   * Fire the "Nouvelle compétition" notification for competitions created in
   * this sync run. Loads events so eligibility can be computed. Isolated so a
   * notification failure can never bubble up into the sync result.
   */
  private async dispatchNewCompetitionNotifications(
    competitionIds: string[],
  ): Promise<void> {
    if (competitionIds.length === 0) return;

    const competitions = await this.prisma.competition.findMany({
      where: { id: { in: competitionIds } },
      select: {
        id: true,
        title: true,
        location: true,
        date: true,
        events: {
          select: { category: true, level: true, ageGroup: true },
        },
      },
    });

    for (const competition of competitions) {
      await this.eventNotificationService.notifyNewCompetition(competition);
    }
  }

  /**
   * Fire "Résultats disponibles" for synced competitions that now have at least
   * one Result row. The notification service itself guards against re-sending,
   * so this only ever notifies once per competition (results count 0 → N).
   */
  private async dispatchResultsNotifications(
    competitionIds: string[],
  ): Promise<void> {
    if (competitionIds.length === 0) return;

    const withResults = await this.prisma.competition.findMany({
      where: {
        id: { in: competitionIds },
        events: { some: { results: { some: {} } } },
      },
      select: { id: true },
    });

    for (const { id } of withResults) {
      await this.eventNotificationService.notifyResultsPublished(id);
    }
  }

  private validateSyncResult(
    result: { synced: number; failed: number },
    total: number,
  ): void {
    if (result.failed > 0 && result.synced === 0) {
      throw new BadRequestException(
        `Failed to sync all competitions: ${result.failed} failed out of ${total}`,
      );
    }
  }

  private get itemsPerPage(): number {
    return this.configService.get<number>("ffd.itemsPerPage") ?? 50;
  }

  private buildFFDApiUrl(page: number): string {
    const baseUrl = this.configService.get<string>("ffd.apiBaseUrl") ?? "";
    const apiPath = this.configService.get<string>("ffd.apiPath") ?? "";
    const danceFamilies = encodeURIComponent(
      this.configService.get<string>("ffd.danceFamilies") ?? "",
    );
    const eventCategory = encodeURIComponent(
      this.configService.get<string>("ffd.eventCategory") ?? "",
    );

    // Newest first, and NO `displayInAgenda`/`upcomingDate` filter so PAST
    // competitions are returned too (the agenda feed only exposes upcoming).
    return `${baseUrl}${apiPath}?dance.subDanceFamilies.danceFamilies.slug%5B%5D=${danceFamilies}&type.eventCategories.title=${eventCategory}&order%5BstartAt%5D=desc&page=${page}&itemsPerPage=${this.itemsPerPage}`;
  }

  /**
   * Fetch competitions across pages (newest first), bounded by FFD_MAX_PAGES,
   * so we get upcoming + recent past without pulling the entire ~390-item
   * history every sync.
   */
  private async fetchAllFFDCompetitions(): Promise<FFDCompetitionItem[]> {
    const all: FFDCompetitionItem[] = [];
    for (let page = 1; page <= this.FFD_MAX_PAGES; page++) {
      const data = await this.ffdGet<FFDResponse>(this.buildFFDApiUrl(page));
      const members = data["hydra:member"];
      if (!Array.isArray(members)) {
        if (page === 1) {
          throw new Error(
            "FFD API returned no 'hydra:member' array (anti-bot challenge unresolved?)",
          );
        }
        break;
      }
      all.push(...members);
      if (members.length < this.itemsPerPage) break;
    }
    return all;
  }

  private async fetchCompetitionDetails(
    ffdId: string,
  ): Promise<FFDCompetitionItem> {
    this.logger.debug(`Fetching details for competition: ${ffdId}`);
    const baseUrl = this.configService.get<string>("ffd.apiBaseUrl");
    const details = await this.ffdGet<FFDCompetitionItem>(`${baseUrl}${ffdId}`);
    if (!details.title) {
      throw new Error("Invalid competition data: missing title");
    }
    return details;
  }

  /**
   * GET an FFD API resource, transparently solving the bot-mitigation
   * challenge. The FFD WAF answers an un-cookied hit with a JS redirect
   * (200 text/html, `window.location → /redirect_<token>/…`) that sets a
   * cookie; following it returns a 307 that sets the *validated* cookie and
   * redirects back to the resource. axios does not carry Set-Cookie across
   * hops, so we follow both redirect kinds manually (maxRedirects: 0),
   * reusing the latest cookie, until the API returns real JSON. The cookie is
   * cached on the instance and reused for the list + every detail request.
   */
  private async ffdGet<T>(startUrl: string): Promise<T> {
    return this.ffdRequest<T>(startUrl, "json");
  }

  /**
   * Download an FFD document (circular PDF) through the same anti-bot flow as
   * the API: a plain request only gets the HTML redirect page.
   */
  async downloadFfdDocument(url: string): Promise<Buffer> {
    return this.ffdRequest<Buffer>(url, "binary");
  }

  private async ffdRequest<T>(
    startUrl: string,
    mode: "json" | "binary",
  ): Promise<T> {
    const baseUrl = this.configService.get<string>("ffd.apiBaseUrl") ?? "";
    let target = startUrl;

    for (let hop = 0; hop < this.FFD_MAX_HOPS; hop++) {
      const headers: Record<string, string> = {
        "User-Agent": this.USER_AGENT,
        Accept: "application/ld+json,application/json;q=0.9,*/*;q=0.8",
      };
      if (this.botCookie) {
        headers.Cookie = this.botCookie;
      }

      const response = await firstValueFrom(
        this.httpService.get<T>(target, {
          headers,
          validateStatus: () => true,
          maxRedirects: 0,
          ...(mode === "binary"
            ? {
                responseType: "arraybuffer" as const,
                maxContentLength: this.FFD_MAX_DOCUMENT_BYTES,
              }
            : {}),
        }),
      );
      this.captureCookie(response.headers?.["set-cookie"]);

      const status = response.status;
      const location = response.headers?.["location"] as string | undefined;
      if (status >= 300 && status < 400 && location) {
        target = new URL(location, baseUrl).toString();
        continue;
      }

      if (mode === "binary") {
        const body = Buffer.from(response.data as unknown as ArrayBuffer);
        const jsRedirect = this.extractJsRedirect(
          body.subarray(0, 8192).toString("latin1"),
        );
        if (jsRedirect) {
          target = new URL(jsRedirect, baseUrl).toString();
          continue;
        }
        if (status >= 400) {
          throw new Error(`FFD document request failed with HTTP ${status}`);
        }
        return body as T;
      }

      const jsRedirect = this.extractJsRedirect(response.data);
      if (jsRedirect) {
        target = new URL(jsRedirect, baseUrl).toString();
        continue;
      }

      return response.data;
    }

    throw new Error(
      "FFD request exceeded max redirects (anti-bot challenge not resolved)",
    );
  }

  private extractJsRedirect(data: unknown): string | null {
    if (typeof data !== "string" || !data.includes("/redirect_")) {
      return null;
    }
    const match = /window\.location\.href='([^']+)'/.exec(data);
    return match ? match[1] : null;
  }

  private captureCookie(setCookie: unknown): void {
    if (!Array.isArray(setCookie) || setCookie.length === 0) return;
    const jar = new Map<string, string>();
    if (this.botCookie) {
      for (const part of this.botCookie.split("; ")) {
        const eq = part.indexOf("=");
        if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
      }
    }
    for (const raw of setCookie as string[]) {
      const first = raw.split(";")[0];
      const eq = first.indexOf("=");
      if (eq > 0) {
        jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
      }
    }
    this.botCookie = Array.from(jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private async upsertCompetition(ffdId: string, details: FFDCompetitionItem) {
    const competitionData = this.mapFFDCompetitionToDB(details);
    this.logger.debug(`Upserting competition: ${competitionData.title}`);

    return this.prisma.competition.upsert({
      where: { ffdId },
      update: competitionData,
      create: {
        ...competitionData,
        ffdId,
        status: "UPCOMING",
      },
    });
  }

  private mapFFDCompetitionToDB(details: FFDCompetitionItem) {
    return {
      title: details.title,
      date: new Date(details.startAt),
      endDate: details.endAt ? new Date(details.endAt) : null,
      location: details.city ?? "Lieu non spécifié",
      address: details.address1,
      zipCode: details.zipCode,
      city: details.city,
      latitude: details.latitude,
      longitude: details.longitude,
      description: details.description,
      // The only "épreuves" info FFD exposes: free-text programme + PDF.
      eventsDescription: details.danceEventDescription,
      programUrl: details.fileEvents?.path ?? null,
      type: details.type?.title,
      organizer: details.company?.name,
      registrationUrl: details.communicationLink,
      imageUrl:
        typeof details.communicationPhoto === "string"
          ? details.communicationPhoto
          : details.communicationPhoto?.path,
      circularUrl: details.fileLogisticInformation?.path,
    };
  }

  /**
   * Seed generic events (Standard/Latin × Adult/Senior) for competitions that
   * have none. FFD does not expose structured épreuves, so these are the
   * registration targets used by the licensee flow + career/results. The real
   * FFD programme remains on the competition (eventsDescription/programUrl).
   */
  private async ensureDefaultEventsBatch(competitionIds: string[]) {
    if (competitionIds.length === 0) return;

    // One row per competition (deduced programmes can hold hundreds of events).
    const competitionsWithEvents = await this.prisma.event.findMany({
      where: { competitionId: { in: competitionIds } },
      select: { competitionId: true },
      distinct: ["competitionId"],
      take: competitionIds.length,
    });

    const idsWithEvents = new Set(
      competitionsWithEvents.map((e) => e.competitionId),
    );
    const idsToSeed = competitionIds.filter((id) => !idsWithEvents.has(id));

    if (idsToSeed.length === 0) return;

    const defaultEvents = idsToSeed.flatMap((competitionId) => [
      {
        competitionId,
        category: "Standard",
        ageGroup: "Adult",
        eventType: "COUPLE" as const,
      },
      {
        competitionId,
        category: "Latin",
        ageGroup: "Adult",
        eventType: "COUPLE" as const,
      },
      {
        competitionId,
        category: "Standard",
        ageGroup: "Senior",
        eventType: "COUPLE" as const,
      },
      {
        competitionId,
        category: "Latin",
        ageGroup: "Senior",
        eventType: "COUPLE" as const,
      },
    ]);

    await this.prisma.event.createMany({ data: defaultEvents });
    await this.prisma.competition.updateMany({
      where: { id: { in: idsToSeed } },
      data: { eventsSource: "GENERIC" },
    });

    this.logger.debug(
      `Seeded default events for ${idsToSeed.length} competitions`,
    );
  }
}
