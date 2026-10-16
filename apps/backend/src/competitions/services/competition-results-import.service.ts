import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { AdminAuditService } from "../../admin/admin-audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  DELETED_USER_ID,
  anonymizeResultDetails,
} from "../../users/account-deletion.core";
import { DELETED_PARTNER_LABEL } from "../../users/partner-name-scrub.utils";
import {
  erasedResultIdentitySelect,
  idOnlySelect,
  licenseNumberSelect,
  licenseNumberUserSelect,
  registrationBibUserSelect,
  resultImportExistingSelect,
  resultTombstoneSelect,
} from "../../utils/prisma-selects";
import {
  erasedLicenceFingerprint,
  resultsPseudonym,
  resultsPseudonymisationKey,
} from "../../utils/results-pseudonym";
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

type ResultDetails = Record<string, string | number>;

/** Accents and case dropped, spaces collapsed: « 1/2  Finale » = « 1/2 finale ». */
export function normalizeResultText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint of a couple in an (event, round): its bib when the file gives
 * one, its label otherwise, the round normalised. Keyed HMAC (server key), so
 * the column never holds a name, cannot be recomputed from a published
 * ranking without the key, and survives an account deletion.
 */
export function resultImportKey(key: string, row: ParsedResultRow): string {
  const identity = row.bib
    ? `bib:${normalizeResultText(row.bib)}`
    : `label:${normalizeResultText(row.participant)}`;
  return resultsPseudonym(
    key,
    `result:v2|${row.eventId}|${normalizeResultText(row.round)}|${identity}`,
  );
}

function tombstoneKey(eventId: string, round: string, ranking: number): string {
  return `${eventId}|${normalizeResultText(round)}|${ranking}`;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Flat equality of two `details` objects (jsonb does not keep key order). */
function sameDetails(current: Prisma.JsonValue, next: ResultDetails): boolean {
  if (!isJsonObject(current)) return false;
  const keys = Object.keys(current);
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) => current[key] === next[key])
  );
}

function buildDetails(row: ParsedResultRow): ResultDetails {
  const details: ResultDetails = { participant: row.participant };
  // The bib is stored as a string, like the account-deletion scrub expects.
  if (row.bib) details.bib = row.bib;
  if (row.club) details.club = row.club;
  if (row.status) details.status = row.status;
  if (row.totalParticipants !== null) {
    details.totalParticipants = row.totalParticipants;
  }
  return details;
}

/** Only the non-identifying keys, like an account deletion leaves them. */
function anonymisedDetails(details: ResultDetails): ResultDetails {
  const kept: ResultDetails = {};
  for (const [key, value] of Object.entries(anonymizeResultDetails(details))) {
    if (typeof value === "string" || typeof value === "number") {
      kept[key] = value;
    }
  }
  return kept;
}

/**
 * A label already rewritten by a partner's account deletion (#395) keeps its
 * scrubbed identifying keys: a re-import must not bring the name back.
 */
function hasScrubbedLabel(details: Prisma.JsonValue | undefined): boolean {
  if (details === undefined || !isJsonObject(details)) return false;
  const label = details.participant;
  return typeof label === "string" && label.includes(DELETED_PARTNER_LABEL);
}

function preserveScrubbedIdentity(
  current: Prisma.JsonValue,
  next: ResultDetails,
): ResultDetails {
  if (!isJsonObject(current) || !hasScrubbedLabel(current)) return next;
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

/** What the database tells about the couples of the file. */
interface ImportContext {
  /** Accounts recognised for each line (first = holder, second = partner). */
  members: Map<number, string[]>;
  /** Lines carrying a licence number of a deleted account. */
  erasedLines: Set<number>;
  /** Anonymised rows, by event + normalised round + rank. */
  tombstones: Set<string>;
  /** Rows already imported, by event + import key. */
  existing: Map<string, ExistingResult>;
}

/**
 * Import of a competition's published results (#652): writes `Result` rows,
 * one per couple, event and round, then lets the existing readers (palmarès,
 * results screen) and the « Résultats disponibles » notification work.
 *
 * - Idempotent: a row is found again by `(eventId, importKey)`; re-running
 *   the same file changes nothing, a corrected file updates.
 * - All or nothing: any invalid line, unknown event or duplicate couple
 *   rejects the file (400 with the lines), nothing is written.
 * - Linking: every licence number of the couple that belongs to an account
 *   (never a retired number) — holder in `userId`, second member in
 *   `partnerUserId`. Only a line without licence numbers falls back to the
 *   in-app registration holding the same bib. Unlinked couples are still
 *   published (official ranking).
 * - RGPD (right to erasure): a row anonymised by an account deletion is
 *   never rewritten nor recreated (same key, or same event + round + rank);
 *   a line carrying a deleted account's licence is written anonymised; a
 *   label scrubbed for a deleted partner keeps its scrub. Rows absent from a
 *   re-import are left as they are (no deletion).
 * - Every import is written to the admin audit trail (actor, counts).
 */
@Injectable()
export class CompetitionResultsImportService {
  private readonly logger = new Logger(CompetitionResultsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
    private readonly cacheService: CompetitionCacheService,
    private readonly eventNotificationService: CompetitionEventNotificationService,
  ) {}

  async importCsv(
    competitionId: string,
    csv: string,
    actorId: string,
  ): Promise<ImportResultsReportDto> {
    const key = resultsPseudonymisationKey(this.config);
    if (!key) {
      throw new ServiceUnavailableException(
        "Import des résultats indisponible : clé de pseudonymisation non configurée",
      );
    }
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: idOnlySelect,
    });
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }

    const { rows, errors } = parseResultsCsv(csv);
    if (errors.length === 0) {
      errors.push(...this.duplicateErrors(key, rows));
      errors.push(...(await this.unknownEventErrors(competitionId, rows)));
    }
    if (errors.length > 0) {
      throw new BadRequestException({
        message: "Fichier de résultats invalide : rien n'a été importé",
        errors: errors.sort((a, b) => a.line - b.line).slice(0, 100),
      });
    }

    const keyed = rows.map((row) => ({
      row,
      importKey: resultImportKey(key, row),
    }));
    const context = await this.loadContext(
      key,
      rows,
      keyed.map((k) => k.importKey),
    );

    const creates: Prisma.ResultCreateManyInput[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    const report: ImportResultsReportDto = {
      created: 0,
      updated: 0,
      unchanged: 0,
      relinked: 0,
      anonymisedKept: 0,
      linked: 0,
      unlinked: 0,
    };

    for (const { row, importKey } of keyed) {
      const current = context.existing.get(`${row.eventId}|${importKey}`);
      const members = context.members.get(row.line) ?? [];

      // Erased couples: never rewritten, never recreated with a name.
      if (current?.userId === DELETED_USER_ID) {
        report.anonymisedKept++;
        continue;
      }
      if (
        !current &&
        context.tombstones.has(
          tombstoneKey(row.eventId, row.round, row.ranking),
        )
      ) {
        report.anonymisedKept++;
        continue;
      }

      // A row whose label was already scrubbed when the partner deleted their
      // account (#395) keeps that scrub and its surviving holder.
      const erased =
        context.erasedLines.has(row.line) &&
        !hasScrubbedLabel(current?.details);
      let userId: string;
      let partnerUserId: string | null;
      let details = buildDetails(row);
      if (erased) {
        // The surviving member keeps the ranking in their palmarès.
        userId = DELETED_USER_ID;
        partnerUserId = members[0] ?? null;
        details = anonymisedDetails(details);
      } else if (members.length > 0) {
        userId = members[0];
        partnerUserId = members[1] ?? null;
      } else {
        // A link found earlier (or set by hand) is kept when this file has none.
        userId = current?.userId ?? UNLINKED_RESULT_USER_ID;
        partnerUserId = current?.partnerUserId ?? null;
      }

      if (erased) report.anonymisedKept++;
      else if (userId !== UNLINKED_RESULT_USER_ID) report.linked++;
      else report.unlinked++;

      if (!current) {
        report.created++;
        creates.push({
          eventId: row.eventId,
          round: row.round,
          ranking: row.ranking,
          importKey,
          userId,
          partnerUserId,
          details,
        });
        continue;
      }

      const nextDetails = erased
        ? details
        : preserveScrubbedIdentity(current.details, details);
      const relinked =
        current.userId !== userId || current.partnerUserId !== partnerUserId;
      if (
        !relinked &&
        current.ranking === row.ranking &&
        sameDetails(current.details, nextDetails)
      ) {
        report.unchanged++;
        continue;
      }
      report.updated++;
      if (relinked) report.relinked++;
      updates.push(
        // Guarded on the owner read above: a row anonymised meanwhile by an
        // account deletion is not rewritten (0 rows instead of an error).
        this.prisma.result.updateMany({
          where: { id: current.id, userId: current.userId },
          data: {
            ranking: row.ranking,
            userId,
            partnerUserId,
            details: nextDetails,
          },
        }),
      );
    }

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
      // Who imported what, counts only: the file names third parties.
      this.audit.recordOp({
        actorId,
        action: "COMPETITION_RESULTS_IMPORT",
        targetType: "COMPETITION",
        targetId: competitionId,
        after: { ...report },
      }),
    ]);
    if (creates.length > 0 || updates.length > 0) {
      await this.cacheService.invalidateResults(competitionId);
    }

    // Fires once per competition (atomic claim in the service, never throws).
    await this.eventNotificationService.notifyResultsPublished(competitionId);

    this.logger.log(
      `Results import for competition ${competitionId}: ${JSON.stringify(report)}`,
    );
    return report;
  }

  /** The same couple twice in an (event, round) is ambiguous: refused. */
  private duplicateErrors(
    key: string,
    rows: ParsedResultRow[],
  ): ResultParseError[] {
    const seen = new Map<string, number>();
    const errors: ResultParseError[] = [];
    for (const row of rows) {
      const importKey = `${row.eventId}|${resultImportKey(key, row)}`;
      const first = seen.get(importKey);
      if (first === undefined) {
        seen.set(importKey, row.line);
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

  private async loadContext(
    key: string,
    rows: ParsedResultRow[],
    importKeys: string[],
  ): Promise<ImportContext> {
    const eventIds = [...new Set(rows.map((r) => r.eventId))];
    const numbers = [...new Set(rows.flatMap((r) => r.licenceNumbers))];
    const fingerprintOf = new Map(
      numbers.map((n) => [n, erasedLicenceFingerprint(key, n)]),
    );

    const [existing, tombstones, erased, { members, liveNumbers }] =
      await Promise.all([
        this.prisma.result.findMany({
          where: { eventId: { in: eventIds }, importKey: { in: importKeys } },
          select: resultImportExistingSelect,
          take: MAX_RESULT_IMPORT_ROWS,
        }),
        this.prisma.result.findMany({
          where: { eventId: { in: eventIds }, userId: DELETED_USER_ID },
          select: resultTombstoneSelect,
          take: MAX_RESULT_IMPORT_ROWS,
        }),
        numbers.length === 0
          ? Promise.resolve([])
          : this.prisma.erasedResultIdentity.findMany({
              where: { fingerprint: { in: [...fingerprintOf.values()] } },
              select: erasedResultIdentitySelect,
              take: numbers.length,
            }),
        this.resolveMembers(rows, numbers),
      ]);

    const erasedFingerprints = new Set(erased.map((e) => e.fingerprint));
    return {
      members,
      erasedLines: new Set(
        rows
          .filter((row) =>
            row.licenceNumbers.some((n) => {
              // A licence held again by a living account (the person came
              // back): their new account decides, the erasure no longer
              // applies to it.
              if (liveNumbers.has(n)) return false;
              const fingerprint = fingerprintOf.get(n);
              return (
                fingerprint !== undefined && erasedFingerprints.has(fingerprint)
              );
            }),
          )
          .map((row) => row.line),
      ),
      tombstones: new Set(
        tombstones.map((t) => tombstoneKey(t.eventId, t.round, t.ranking)),
      ),
      existing: new Map(
        existing.map((e) => [`${e.eventId}|${e.importKey}`, e]),
      ),
    };
  }

  /**
   * Accounts of each line. By licence number (the federal identifier),
   * skipping any number retired by a number change: it may now designate
   * someone else. A line WITH licence numbers never falls back to the bib;
   * a line without any is linked to the in-app registration holding the
   * same bib in the event, when it designates one couple only.
   */
  private async resolveMembers(
    rows: ParsedResultRow[],
    numbers: string[],
  ): Promise<{ members: Map<number, string[]>; liveNumbers: Set<string> }> {
    const [licences, retired] =
      numbers.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.license.findMany({
              where: { number: { in: numbers }, userId: { not: null } },
              select: licenseNumberUserSelect,
              take: numbers.length,
            }),
            this.prisma.retiredLicenseNumber.findMany({
              where: { number: { in: numbers } },
              select: licenseNumberSelect,
              take: numbers.length,
            }),
          ]);
    const retiredNumbers = new Set(retired.map((r) => r.number));
    const userByLicence = new Map<string, string>();
    for (const licence of licences) {
      if (licence.userId && !retiredNumbers.has(licence.number)) {
        userByLicence.set(licence.number, licence.userId);
      }
    }

    const bibRows = rows.filter(
      (r) =>
        r.licenceNumbers.length === 0 &&
        r.bib !== null &&
        /^\d{1,9}$/.test(r.bib),
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
    const accountsByBib = new Map<string, string[]>();
    for (const reg of registrations) {
      const bibKey = `${reg.eventId}|${reg.bibNumber}`;
      const accounts = accountsByBib.get(bibKey) ?? [];
      for (const id of [reg.userId, reg.partnerUserId]) {
        if (id && !accounts.includes(id)) accounts.push(id);
      }
      accountsByBib.set(bibKey, accounts);
    }

    const members = new Map<number, string[]>();
    for (const row of rows) {
      if (row.licenceNumbers.length > 0) {
        const accounts = [
          ...new Set(
            row.licenceNumbers
              .map((n) => userByLicence.get(n))
              .filter((id): id is string => id !== undefined),
          ),
        ];
        if (accounts.length > 0) members.set(row.line, accounts.slice(0, 2));
        continue;
      }
      if (row.bib === null) continue;
      const accounts = accountsByBib.get(`${row.eventId}|${Number(row.bib)}`);
      // More than two accounts on one bib: not one couple, no guess.
      if (accounts && accounts.length > 0 && accounts.length <= 2) {
        members.set(row.line, accounts);
      }
    }
    return { members, liveNumbers: new Set(userByLicence.keys()) };
  }
}
