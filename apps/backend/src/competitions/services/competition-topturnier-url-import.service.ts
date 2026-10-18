import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CircuitBreakerService } from "../../common/circuit-breaker/circuit-breaker.service";
import { getErrorMessage } from "../../utils/error.utils";
import { withTimeout } from "../../utils/timeout.utils";
import { TopTurnierImportReportDto } from "../dto/results-import.dto";
import {
  FetchedPage,
  TopTurnierPageTooLargeError,
  fetchTopTurnierPage,
} from "../results-import/topturnier/topturnier-http";
import type { TopTurnierPageSource } from "../results-import/topturnier/topturnier-export";
import {
  TOPTURNIER_MAX_PAGE_BYTES,
  TopTurnierFormatError,
} from "../results-import/topturnier/topturnier.parser";
import {
  TopTurnierUrlError,
  auditUrl,
  checkTopTurnierUrl,
  exportBaseUrl,
  parseAllowedHosts,
} from "../results-import/topturnier/topturnier-url";
import type { CompetitionActor } from "./competition-access.service";
import type { ImportResultsOptions } from "./competition-results-import.service";
import { CompetitionTopTurnierImportService } from "./competition-topturnier-import.service";

/** Pages fetched for one import: the competition page + 150 rankings. */
export const TOPTURNIER_URL_MAX_PAGES = 151;
/** Pause between two requests to the site (sequential, never in parallel). */
export const TOPTURNIER_URL_SPACING_MS = 500;
/** Budget of one page (socket inactivity + overall). */
export const TOPTURNIER_URL_PAGE_TIMEOUT_MS = 10_000;
/** Redirects followed per page, each one inside the allowlist. */
export const TOPTURNIER_URL_MAX_REDIRECTS = 2;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * TEMPORARY (#787) — import of the results of a competition from the public
 * URL of its TopTurnier export, until the FFD gives access to its results
 * data (#651): remove this service, its endpoint, `topturnier-http.ts`,
 * `topturnier-url.ts` and the TOPTURNIER_* variables then.
 *
 * Back-office only (STAFF / ADMIN), on demand only — never scheduled.
 * Disabled unless `TOPTURNIER_URL_IMPORT_ENABLED=true`. Only the hosts of
 * `TOPTURNIER_ALLOWED_HOSTS` are fetched, over http/https on the default
 * port, never a private / loopback / link-local address (checked at
 * connection time), redirects only inside the allowlist (2 at most), one
 * page at a time 500 ms apart, each bounded by a timeout and the `topturnier`
 * circuit breaker, pages and sizes capped. The pages then go through the
 * same reading, mapping and import pipeline as the uploaded export (#786).
 */
@Injectable()
export class CompetitionTopTurnierUrlImportService {
  private readonly logger = new Logger(
    CompetitionTopTurnierUrlImportService.name,
  );

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly topTurnierImport: CompetitionTopTurnierImportService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<string>("TOPTURNIER_URL_IMPORT_ENABLED") === "true";
  }

  allowedHosts(): string[] {
    return parseAllowedHosts(
      this.config.get<string>("TOPTURNIER_ALLOWED_HOSTS"),
    );
  }

  async importUrl(
    competitionId: string,
    rawUrl: string,
    actor: CompetitionActor,
    options: ImportResultsOptions = {},
  ): Promise<TopTurnierImportReportDto> {
    if (!this.isEnabled()) {
      throw new NotFoundException(
        "Import par adresse TopTurnier désactivé sur cet environnement",
      );
    }
    const hosts = this.allowedHosts();
    let base: URL;
    try {
      base = exportBaseUrl(checkTopTurnierUrl(rawUrl, hosts));
    } catch (error) {
      if (error instanceof TopTurnierUrlError) {
        throw new BadRequestException({ message: error.message, errors: [] });
      }
      throw error;
    }

    const source = this.pageSource(base, hosts);
    try {
      return await this.topTurnierImport.importFromSource(
        competitionId,
        source,
        { kind: "TOPTURNIER_URL", url: auditUrl(base) },
        actor,
        options,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof TopTurnierUrlError ||
        error instanceof TopTurnierFormatError
      ) {
        throw new BadRequestException({ message: error.message, errors: [] });
      }
      if (error instanceof TopTurnierPageTooLargeError) {
        throw new BadRequestException({
          message: `Page trop volumineuse sur le site (maximum ${TOPTURNIER_MAX_PAGE_BYTES} octets)`,
          errors: [],
        });
      }
      this.logger.warn(
        `TopTurnier URL import failed (${auditUrl(base)}): ${getErrorMessage(error)}`,
      );
      throw new BadGatewayException(
        "Site de l'export TopTurnier injoignable ou en erreur : réessayer plus tard, ou téléverser l'export",
      );
    }
  }

  /** Pages of the export under `base`, fetched one at a time. */
  pageSource(base: URL, hosts: readonly string[]): TopTurnierPageSource {
    let pages = 0;
    let lastRequestAt = 0;
    return {
      read: async (path: string): Promise<Buffer | null> => {
        // TopTurnier writes `.htm`: the `.html` fallbacks are not requested
        // (half the requests to the site).
        if (/\.html$/i.test(path)) return null;
        const url = new URL(path, base);
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith(base.pathname)
        ) {
          throw new TopTurnierUrlError("Page hors de l'export refusée");
        }
        pages++;
        if (pages > TOPTURNIER_URL_MAX_PAGES) {
          throw new TopTurnierFormatError(
            `Trop de pages pour l'import par adresse (${TOPTURNIER_URL_MAX_PAGES} au plus) : téléverser l'export`,
          );
        }
        const wait = lastRequestAt + TOPTURNIER_URL_SPACING_MS - Date.now();
        if (lastRequestAt > 0 && wait > 0) await this.sleep(wait);
        try {
          return await this.fetchFollowingRedirects(url, hosts);
        } finally {
          lastRequestAt = Date.now();
        }
      },
    };
  }

  private async fetchFollowingRedirects(
    start: URL,
    hosts: readonly string[],
  ): Promise<Buffer | null> {
    let url = start;
    for (let hop = 0; ; hop++) {
      const page = await this.fetchPage(url);
      if (page.status === 200) return page.body;
      if (page.status === 404 || page.status === 410) return null;
      if (REDIRECT_STATUSES.has(page.status) && page.location !== null) {
        if (hop >= TOPTURNIER_URL_MAX_REDIRECTS) {
          throw new TopTurnierUrlError("Trop de redirections");
        }
        // Every hop is checked like the submitted URL: allowlist, scheme,
        // port. The address is checked again when connecting.
        url = checkTopTurnierUrl(new URL(page.location, url).href, hosts);
        continue;
      }
      throw new Error(`HTTP ${page.status} for ${url.hostname}${url.pathname}`);
    }
  }

  /** One request, behind the breaker and the timeout. */
  async fetchPage(url: URL): Promise<FetchedPage> {
    return this.circuitBreaker.fire("topturnier", () =>
      withTimeout(
        fetchTopTurnierPage(url, {
          maxBytes: TOPTURNIER_MAX_PAGE_BYTES,
          timeoutMs: TOPTURNIER_URL_PAGE_TIMEOUT_MS,
        }),
        TOPTURNIER_URL_PAGE_TIMEOUT_MS,
        "TopTurnier page",
      ),
    );
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
