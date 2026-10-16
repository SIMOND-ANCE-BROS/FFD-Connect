import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { DELETED_USER_ID } from "../../users/account-deletion.core";
import { DELETED_PARTNER_LABEL } from "../../users/partner-name-scrub.utils";
import {
  idOnlySelect,
  licenseNumberUserSelect,
  registrationBibUserSelect,
  resultImportExistingSelect,
} from "../../utils/prisma-selects";
import { ImportResultsReportDto } from "../dto/results-import.dto";
import {
  MAX_RESULT_IMPORT_ROWS,
  ParsedResultRow,
  ResultParseError,
  parseResultsCsv,
} from "../results-import/results-csv.parser";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";

/**
 * `Result.userId` of an imported couple no account could be linked to.
 * Not UUID-shaped on purpose: the orphaned-results sweep
 * (`anonymizeOrphanedResults`) only touches UUID-shaped ids, so a third
 * party's published ranking is never stripped as an "orphan". Re-running the
 * import links the row once one of the couple has an account.
 */
export const UNLINKED_RESULT_USER_ID = "unlinked-import";

/** Keys of `details` that name the couple (kept when already scrubbed). */
const IDENTIFYING_DETAIL_KEYS = ["participant", "bib", "club"] as const;

type ExistingResult = Prisma.ResultGetPayload<{
  select: typeof resultImportExistingSelect;
}>;

/**
 * Fingerprint of a couple in an (event, round): its bib when the file gives
 * one, its normalised label otherwise. Hashed (SHA-256, salted by the event
 * and round) so the column never holds a name in clear and survives an
 * account deletion without re-identifying anyone.
 */
export function resultImportKey(row: ParsedResultRow): string {
  const identity = row.bib
    ? `bib:${row.bib.toLowerCase()}`
    : `label:${row.participant
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")}`;
  return crypto
    .createHash("sha256")
    .update(`v1|${row.eventId}|${row.round}|${identity}`)
    .digest("hex");
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Flat equality of two `details` objects (jsonb does not keep key order). */
function sameDetails(
  current: Prisma.JsonValue,
  next: Record<string, string | number>,
): boolean {
  if (!isJsonObject(current)) return false;
  const keys = Object.keys(current);
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => current[key] === next[key])
  );
}

function buildDetails(row: ParsedResultRow): Record<string, string | number> {
  const details: Record<string, string | number> = {
    participant: row.participant,
  };
  // The bib is stored as a string, like the account-deletion scrub expects.
  if (row.bib) details.bib = row.bib;
  if (row.club) details.club = row.club;
  if (row.status) details.status = row.status;
  if (row.totalParticipants !== null) {
    details.totalParticipants = row.totalParticipants;
  }
  return details;
}

/**
 * A label already rewritten by a partner's account deletion (#395) keeps its
 * scrubbed identifying keys: a re-import must not bring the name back.
 */
function preserveScrubbedIdentity(
  current: Prisma.JsonValue,
  next: Record<string, string | number>,
): Record<string, string | number> {
  if (!isJsonObject(current)) return next;
  const label = current.participant;
  if (typeof label !== "string" || !label.includes(DELETED_PARTNER_LABEL)) {
    return next;
  }
  const kept = { ...next };
  for (const key of IDENTIFYING_DETAIL_KEYS) {
    const value = current[key];
    if (typeof value === "string" || typeof value === "number") {
      kept[key] = value;
    } else {
      delete kept[key];
    }
  }
  return kept;
}

/**
 * Import of a competition's published results (#652): writes `Result` rows,
 * one per couple, event and round, then lets the existing readers (palmarès,
 * results screen) and the « Résultats disponibles » notification work.
 *
 * - Idempotent: a row is found again by `(eventId, round, importKey)`;
 *   re-running the same file changes nothing, a corrected file updates.
 * - All or nothing: any invalid line, unknown event or duplicate couple
 *   rejects the file (400 with the lines), nothing is written.
 * - Linking: the first licence number of the couple that belongs to an
 *   account, else the in-app registration with the same bib in the event.
 *   Unlinked couples are still published (official ranking).
 * - RGPD: a row anonymised by an account deletion (#382) is never rewritten,
 *   and a label scrubbed for a deleted partner (#395) keeps its scrub.
 *   Rows absent from a re-import are left as they are (no deletion).
 */
@Injectable()
export class CompetitionResultsImportService {
  private readonly logger = new Logger(CompetitionResultsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CompetitionCacheService,
    private readonly eventNotificationService: CompetitionEventNotificationService,
  ) {}

  async importCsv(
    competitionId: string,
    csv: string,
  ): Promise<ImportResultsReportDto> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: idOnlySelect,
    });
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }

    const { rows, errors } = parseResultsCsv(csv);
    if (errors.length === 0) {
      errors.push(...this.duplicateErrors(rows));
      errors.push(...(await this.unknownEventErrors(competitionId, rows)));
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        message: "Fichier de résultats invalide : rien n'a été importé",
        errors: errors.sort((a, b) => a.line - b.line).slice(0, 100),
      });
    }

    const owners = await this.resolveOwners(rows);
    const keyed = rows.map((row) => ({ row, key: resultImportKey(row) }));
    const existing = await this.prisma.result.findMany({
      where: {
        eventId: { in: [...new Set(rows.map((r) => r.eventId))] },
        importKey: { in: keyed.map((k) => k.key) },
      },
      select: resultImportExistingSelect,
      take: MAX_RESULT_IMPORT_ROWS,
    });
    const existingByKey = new Map<string, ExistingResult>(
      existing.map((e) => [`${e.eventId}|${e.round}|${e.importKey}`, e]),
    );

    const creates: Prisma.ResultCreateManyInput[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    let unchanged = 0;
    let anonymisedKept = 0;
    let linked = 0;

    for (const { row, key } of keyed) {
      const matched = owners.get(row.line) ?? null;
      const current = existingByKey.get(`${row.eventId}|${row.round}|${key}`);
      const details = buildDetails(row);

      if (!current) {
        const userId = matched ?? UNLINKED_RESULT_USER_ID;
        if (matched) linked++;
        creates.push({
          eventId: row.eventId,
          round: row.round,
          ranking: row.ranking,
          importKey: key,
          userId,
          details,
        });
        continue;
      }
      if (current.userId === DELETED_USER_ID) {
        anonymisedKept++;
        continue;
      }
      // A link found earlier (or set by hand) is kept when this file has none.
      const userId =
        matched ??
        (current.userId !== UNLINKED_RESULT_USER_ID
          ? current.userId
          : UNLINKED_RESULT_USER_ID);
      if (userId !== UNLINKED_RESULT_USER_ID) linked++;
      const nextDetails = preserveScrubbedIdentity(current.details, details);
      if (
        current.ranking === row.ranking &&
        current.userId === userId &&
        sameDetails(current.details, nextDetails)
      ) {
        unchanged++;
        continue;
      }
      updates.push(
        // Guarded on the owner read above: a row anonymised meanwhile by an
        // account deletion is not rewritten (0 rows instead of an error).
        this.prisma.result.updateMany({
          where: { id: current.id, userId: current.userId },
          data: { ranking: row.ranking, userId, details: nextDetails },
        }),
      );
    }

    if (creates.length > 0 || updates.length > 0) {
      await this.prisma.$transaction([
        ...(creates.length > 0
          ? [
              this.prisma.result.createMany({
                data: creates,
                skipDuplicates: true,
              }),
            ]
          : []),
        ...updates,
      ]);
      await this.cacheService.invalidateResults(competitionId);
    }

    // Fires once per competition (guarded in the service, never throws).
    await this.eventNotificationService.notifyResultsPublished(competitionId);

    const report: ImportResultsReportDto = {
      created: creates.length,
      updated: updates.length,
      unchanged,
      anonymisedKept,
      linked,
      unlinked: rows.length - anonymisedKept - linked,
    };
    // Counts only: the file names third parties.
    this.logger.log(
      `Results import for competition ${competitionId}: ${JSON.stringify(report)}`,
    );
    return report;
  }

  /** The same couple twice in an (event, round) is ambiguous: refused. */
  private duplicateErrors(rows: ParsedResultRow[]): ResultParseError[] {
    const seen = new Map<string, number>();
    const errors: ResultParseError[] = [];
    for (const row of rows) {
      const key = resultImportKey(row);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, row.line);
      } else {
        errors.push({
          line: row.line,
          message: `même couple que la ligne ${first} pour cette épreuve et ce tour`,
        });
      }
    }
    return errors;
  }

  private async unknownEventErrors(
    competitionId: string,
    rows: ParsedResultRow[],
  ): Promise<ResultParseError[]> {
    const eventIds = [...new Set(rows.map((r) => r.eventId))];
    const known = await this.prisma.event.findMany({
      where: { id: { in: eventIds }, competitionId },
      select: idOnlySelect,
      take: eventIds.length,
    });
    const knownIds = new Set(known.map((e) => e.id));
    return rows
      .filter((row) => !knownIds.has(row.eventId))
      .map((row) => ({
        line: row.line,
        message: "épreuve inconnue pour cette compétition",
      }));
  }

  /**
   * Account of each line, by licence number first (the federal identifier),
   * then by the in-app registration holding the same bib in the event (only
   * when exactly one account holds it). Lines without a match are absent.
   */
  private async resolveOwners(
    rows: ParsedResultRow[],
  ): Promise<Map<number, string>> {
    const numbers = [...new Set(rows.flatMap((r) => r.licenceNumbers))];
    const licences =
      numbers.length === 0
        ? []
        : await this.prisma.license.findMany({
            where: { number: { in: numbers }, userId: { not: null } },
            select: licenseNumberUserSelect,
            take: numbers.length,
          });
    const userByLicence = new Map<string, string>();
    for (const licence of licences) {
      if (licence.userId) userByLicence.set(licence.number, licence.userId);
    }

    const bibRows = rows.filter(
      (r) =>
        r.bib !== null &&
        /^\d{1,9}$/.test(r.bib) &&
        !r.licenceNumbers.some((n) => userByLicence.has(n)),
    );
    const registrations =
      bibRows.length === 0
        ? []
        : await this.prisma.registration.findMany({
            where: {
              status: { not: "CANCELLED" },
              OR: bibRows.map((r) => ({
                eventId: r.eventId,
                bibNumber: Number(r.bib),
              })),
            },
            select: registrationBibUserSelect,
            take: MAX_RESULT_IMPORT_ROWS,
          });
    const usersByBib = new Map<string, Set<string>>();
    for (const reg of registrations) {
      const key = `${reg.eventId}|${reg.bibNumber}`;
      const users = usersByBib.get(key) ?? new Set<string>();
      users.add(reg.userId);
      usersByBib.set(key, users);
    }

    const owners = new Map<number, string>();
    for (const row of rows) {
      const byLicence = row.licenceNumbers
        .map((n) => userByLicence.get(n))
        .find((id): id is string => id !== undefined);
      if (byLicence) {
        owners.set(row.line, byLicence);
        continue;
      }
      if (row.bib === null) continue;
      const users = usersByBib.get(`${row.eventId}|${Number(row.bib)}`);
      if (users?.size === 1) owners.set(row.line, [...users][0]);
    }
    return owners;
  }
}
