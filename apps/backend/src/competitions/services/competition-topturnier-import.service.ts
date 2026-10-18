import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { disciplineLabel } from "../../common/competition-level/competition-level.util";
import { PrismaService } from "../../prisma/prisma.service";
import {
  eventTopTurnierMatchSelect,
  idOnlySelect,
} from "../../utils/prisma-selects";
import {
  TopTurnierEventMappingDto,
  TopTurnierImportReportDto,
} from "../dto/results-import.dto";
import { MAX_RESULT_IMPORT_ROWS } from "../results-import/results-csv.parser";
import {
  SafeZipError,
  SafeZipLimits,
  readSafeZip,
} from "../results-import/topturnier/safe-zip";
import {
  TopTurnierImportPlan,
  TopTurnierPageSource,
  archivePageSource,
  planTopTurnierImport,
  readTopTurnierExport,
} from "../results-import/topturnier/topturnier-export";
import {
  TOPTURNIER_MAX_EVENTS,
  TOPTURNIER_MAX_PAGE_BYTES,
  TOPTURNIER_MAX_TOTAL_BYTES,
  TopTurnierFormatError,
} from "../results-import/topturnier/topturnier.parser";
import type { TopTurnierMatchableEvent } from "../results-import/topturnier/topturnier-event-label";
import type { CompetitionActor } from "./competition-access.service";
import {
  CompetitionResultsImportService,
  ImportResultsOptions,
} from "./competition-results-import.service";

/** Max size of the uploaded archive (compressed). */
export const TOPTURNIER_MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

/** Upper bound of the events of one competition read to map the export. */
const MAX_COMPETITION_EVENTS = 500;

/**
 * Archive limits: the export holds ~8 files per event (pages, image,
 * stylesheet); only the `.htm` pages are extracted.
 */
const ARCHIVE_LIMITS: SafeZipLimits = {
  maxEntries: TOPTURNIER_MAX_EVENTS * 15 + 50,
  maxFileBytes: TOPTURNIER_MAX_PAGE_BYTES,
  maxTotalBytes: TOPTURNIER_MAX_TOTAL_BYTES,
  maxRatio: 200,
  keep: (path) => /\.html?$/i.test(path),
};

/** Where the export came from, written to the audit trail. */
export type TopTurnierSource =
  | { kind: "TOPTURNIER_UPLOAD" }
  /** #787 (temporary): host + path of the public export, never the query. */
  | { kind: "TOPTURNIER_URL"; url: string };

function eventName(event: TopTurnierMatchableEvent): string {
  const ages =
    event.ageGroups.length > 0 ? event.ageGroups.join(" / ") : event.ageGroup;
  return [disciplineLabel(event.category), ages, event.level]
    .filter((part) => part && part.trim() !== "")
    .join(" ");
}

function mappingOf(
  plan: TopTurnierImportPlan,
  events: readonly TopTurnierMatchableEvent[],
): TopTurnierEventMappingDto[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  return plan.events.map((event) => {
    const target = event.eventId ? byId.get(event.eventId) : undefined;
    return {
      ...event,
      eventName: target ? eventName(target) : null,
    };
  });
}

/**
 * Import of the results of a competition from its TopTurnier export (#786):
 * reads the export, maps its events onto the competition's programme, then
 * hands the rows of the matched events to the results import pipeline
 * (`CompetitionResultsImportService.importRows`: same validation, RGPD rules,
 * dry run, audit and notification rule as the CSV import). The caller checks
 * the access first (`assertCanManageResults`).
 */
@Injectable()
export class CompetitionTopTurnierImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultsImport: CompetitionResultsImportService,
  ) {}

  /** The export uploaded as a zip archive. */
  async importArchive(
    competitionId: string,
    archive: Buffer,
    actor: CompetitionActor,
    options: ImportResultsOptions = {},
  ): Promise<TopTurnierImportReportDto> {
    let files: Map<string, Buffer>;
    try {
      files = readSafeZip(archive, ARCHIVE_LIMITS);
    } catch (error) {
      if (error instanceof SafeZipError) {
        throw new BadRequestException({ message: error.message, errors: [] });
      }
      throw error;
    }
    let source: TopTurnierPageSource;
    try {
      source = archivePageSource(files);
    } catch (error) {
      if (error instanceof TopTurnierFormatError) {
        throw new BadRequestException({ message: error.message, errors: [] });
      }
      throw error;
    }
    return this.importFromSource(
      competitionId,
      source,
      { kind: "TOPTURNIER_UPLOAD" },
      actor,
      options,
    );
  }

  /** Any page source: the archive (#786) or the public site (#787). */
  async importFromSource(
    competitionId: string,
    source: TopTurnierPageSource,
    origin: TopTurnierSource,
    actor: CompetitionActor,
    options: ImportResultsOptions = {},
  ): Promise<TopTurnierImportReportDto> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: idOnlySelect,
    });
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }

    let data;
    try {
      data = await readTopTurnierExport(source);
    } catch (error) {
      if (error instanceof TopTurnierFormatError) {
        throw new BadRequestException({ message: error.message, errors: [] });
      }
      throw error;
    }
    const events = await this.prisma.event.findMany({
      where: { competitionId },
      select: eventTopTurnierMatchSelect,
      orderBy: { id: "asc" },
      take: MAX_COMPETITION_EVENTS,
    });
    const plan = planTopTurnierImport(data, events);
    const mapping = mappingOf(plan, events);

    if (plan.rows.length === 0 && plan.errors.length === 0) {
      throw new BadRequestException({
        message:
          "Aucune épreuve de l'export n'a de classement à importer pour le programme de cette compétition : rien n'a été importé",
        errors: [],
        events: mapping,
      });
    }
    if (plan.rows.length > MAX_RESULT_IMPORT_ROWS) {
      throw new BadRequestException({
        message: `Trop de lignes de classement (${plan.rows.length}, maximum ${MAX_RESULT_IMPORT_ROWS}) : envoyer l'export en plusieurs archives (une partie des dossiers d'épreuve à chaque fois)`,
        errors: [],
        events: mapping,
      });
    }

    const matched = mapping.filter((e) => e.status === "MATCHED").length;
    const report = await this.resultsImport.importRows(
      competitionId,
      () => ({ rows: plan.rows, errors: plan.errors }),
      actor,
      {
        dryRun: options.dryRun,
        auditDetails: {
          source: origin.kind,
          ...(origin.kind === "TOPTURNIER_URL" ? { url: origin.url } : {}),
          matchedEvents: matched,
          skippedEvents: mapping.length - matched,
        },
        lineLabel: (line) => plan.lineLabels.get(line),
        errorExtras: { events: mapping },
      },
    );
    return { ...report, events: mapping };
  }
}
