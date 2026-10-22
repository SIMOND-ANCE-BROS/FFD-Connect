import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CompetitionStatus, Prisma } from "@prisma/client";
import {
  addIsoDays,
  parisDateOf,
  parisMidnightOf,
} from "../../admin/stats/stats-period";
import { PrismaService } from "../../prisma/prisma.service";
import { getErrorMessage } from "../../utils/error.utils";
import { competitionTopTurnierIndexMatchSelect } from "../../utils/prisma-selects";
import {
  TopTurnierCompetitionItemDto,
  TopTurnierCompetitionsDto,
} from "../dto/topturnier-index.dto";
import {
  CHAIRPERSON_INDEX_PATH,
  type ChairpersonEntry,
  parseChairpersonIndex,
} from "../results-import/topturnier/chairperson-index";
import {
  type MatchableCompetition,
  matchChairpersonEntry,
} from "../results-import/topturnier/chairperson-match";
import { decodePage } from "../results-import/topturnier/topturnier-html";
import {
  auditUrl,
  checkTopTurnierUrl,
} from "../results-import/topturnier/topturnier-url";
import { CompetitionTopTurnierUrlImportService } from "./competition-topturnier-url-import.service";

/**
 * Site whose list of recent competitions is read: the only TopTurnier site
 * known to publish one (`/resultats/index.php?annee=YYYY`). Read only while
 * it is in TOPTURNIER_ALLOWED_HOSTS.
 */
export const CHAIRPERSON_INDEX_HOST = "chairperson.ddsbagnols.com";

/** Competitions of the app read to match one list, at most. */
export const TOPTURNIER_INDEX_MAX_CANDIDATES = 1000;

/**
 * TEMPORARY (#801, with #787) — the list of recent competitions of the
 * TopTurnier site, matched to the competitions of the app, so the staff no
 * longer looks up export addresses by hand. Remove with #787 once the FFD
 * gives access to its results data (#651).
 *
 * ON DEMAND ONLY: one call = one click of a staff member, at most 2 pages
 * (current and previous year), never scheduled, prefetched or cached. Same
 * flag, allowlist and network protections as the URL import (pages fetched
 * by its client: https, address check at connection time, redirects inside
 * the allowlist, spacing, breaker, timeout, size cap), under the same
 * per-site lock (409 while an import from the site runs). Read only: the
 * import itself stays `POST /competitions/:id/results/import/topturnier-url`.
 */
@Injectable()
export class CompetitionTopTurnierIndexQueryService {
  private readonly logger = new Logger(
    CompetitionTopTurnierIndexQueryService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly urlImport: CompetitionTopTurnierUrlImportService,
  ) {}

  /** True when the list may be read (flag on, site allowlisted). No request. */
  isAvailable(): boolean {
    return (
      this.urlImport.isEnabled() &&
      this.urlImport.allowedHosts().includes(CHAIRPERSON_INDEX_HOST)
    );
  }

  async list(
    year: number | undefined,
    now: Date = new Date(),
  ): Promise<TopTurnierCompetitionsDto> {
    if (!this.isAvailable()) {
      throw new NotFoundException(
        "Liste des compétitions récentes désactivée sur cet environnement",
      );
    }
    const currentYear = Number(parisDateOf(now).slice(0, 4));
    if (
      year !== undefined &&
      year !== currentYear &&
      year !== currentYear - 1
    ) {
      throw new BadRequestException(
        `Année lisible : ${currentYear} ou ${currentYear - 1}`,
      );
    }
    const years = year === undefined ? [currentYear, currentYear - 1] : [year];
    const { entries, truncated } = await this.readIndex(years);
    const items = await this.matchEntries(entries);
    return { years, items, truncated };
  }

  /** Entries of the list pages of `years`, most recent first, deduplicated. */
  private async readIndex(
    years: readonly number[],
  ): Promise<{ entries: ChairpersonEntry[]; truncated: boolean }> {
    const hosts = this.urlImport.allowedHosts();
    const indexUrl = (y: number) =>
      checkTopTurnierUrl(
        `https://${CHAIRPERSON_INDEX_HOST}${CHAIRPERSON_INDEX_PATH}?annee=${y}`,
        hosts,
      );
    const where = auditUrl(indexUrl(years[0]));
    try {
      const pages = await this.urlImport.withSiteLock(
        CHAIRPERSON_INDEX_HOST,
        async () => {
          const read: { entries: ChairpersonEntry[]; truncated: boolean }[] =
            [];
          // One page at a time (the client spaces them anyway).
          for (const y of years) {
            const url = indexUrl(y);
            const body = await this.urlImport.fetchSitePage(url, hosts);
            read.push(
              body === null
                ? { entries: [], truncated: false }
                : parseChairpersonIndex(decodePage(body), url),
            );
          }
          return read;
        },
      );
      this.logger.log(
        `TopTurnier list read on demand (${where}): ${pages.length} page(s)`,
      );
      const seen = new Set<string>();
      const entries = pages
        .flatMap((page) => page.entries)
        .filter((entry) => {
          if (seen.has(entry.exportUrl)) return false;
          seen.add(entry.exportUrl);
          // Re-checked like a submitted address: the import will refuse
          // anything else anyway.
          try {
            checkTopTurnierUrl(entry.exportUrl, hosts);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { entries, truncated: pages.some((page) => page.truncated) };
    } catch (error) {
      // 409 (site busy), 503 (open breaker): as they are.
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `TopTurnier list read failed (${where}): ${getErrorMessage(error)}`,
      );
      throw new BadGatewayException(
        "Liste des compétitions du site injoignable ou en erreur : réessayer plus tard, ou saisir l'adresse de l'export sur la fiche de la compétition",
      );
    }
  }

  private async matchEntries(
    entries: readonly ChairpersonEntry[],
  ): Promise<TopTurnierCompetitionItemDto[]> {
    const competitions = await this.candidates(entries);
    const byId = new Map(competitions.map((c) => [c.competition.id, c]));
    return entries.map((entry) => {
      const match = matchChairpersonEntry(
        entry,
        competitions.map((c) => c.competition),
      );
      const matched =
        match.competitionId === null
          ? undefined
          : byId.get(match.competitionId);
      return {
        date: entry.date,
        title: entry.title,
        category: entry.category,
        exportUrl: entry.exportUrl,
        match,
        resultsAlreadyImported: matched?.hasResults ?? false,
      };
    });
  }

  /**
   * Competitions of the app taking place on one of the days of the entries
   * (Paris days, first to last day), cancelled ones excepted. One bounded
   * query.
   */
  private async candidates(
    entries: readonly ChairpersonEntry[],
  ): Promise<{ competition: MatchableCompetition; hasResults: boolean }[]> {
    const days = [
      ...new Set(
        entries
          .map((entry) => entry.date)
          .filter((day): day is string => day !== null),
      ),
    ];
    if (days.length === 0) return [];
    const onDay = days.map((day): Prisma.CompetitionWhereInput => {
      const start = parisMidnightOf(day);
      const end = parisMidnightOf(addIsoDays(day, 1));
      return {
        date: { lt: end },
        OR: [
          { endDate: { gte: start } },
          { endDate: null, date: { gte: start } },
        ],
      };
    });
    const rows = await this.prisma.competition.findMany({
      where: { status: { not: CompetitionStatus.CANCELLED }, OR: onDay },
      select: competitionTopTurnierIndexMatchSelect,
      orderBy: { date: "desc" },
      take: TOPTURNIER_INDEX_MAX_CANDIDATES,
    });
    if (rows.length === TOPTURNIER_INDEX_MAX_CANDIDATES) {
      this.logger.warn(
        `TopTurnier list matching capped at ${TOPTURNIER_INDEX_MAX_CANDIDATES} competitions`,
      );
    }
    return rows.map((row) => ({
      competition: {
        id: row.id,
        title: row.title,
        firstDay: parisDateOf(row.date),
        lastDay: parisDateOf(row.endDate ?? row.date),
        city: row.city,
        location: row.location,
      },
      hasResults: row.events.length > 0,
    }));
  }
}
