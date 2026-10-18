import type { ParsedResultRow } from "../results-csv.parser";
import { decodePage } from "./topturnier-html";
import {
  TOPTURNIER_MAX_PAGE_BYTES,
  TOPTURNIER_MAX_TOTAL_BYTES,
  TopTurnierFormatError,
  TopTurnierRanking,
  parseTopTurnierIndex,
  parseTopTurnierRanking,
} from "./topturnier.parser";
import {
  TopTurnierMatchableEvent,
  matchTopTurnierEvent,
  parseTopTurnierLabel,
} from "./topturnier-event-label";

/**
 * Reading of a whole TopTurnier export (#786) from a page source — the
 * uploaded archive, or (#787, temporary) the public site — then its mapping
 * onto the competition's events, as rows of the existing results import.
 */

/** Where the pages come from. `read` returns null for a missing page. */
export interface TopTurnierPageSource {
  read(path: string): Promise<Buffer | null>;
}

export interface TopTurnierExportEvent {
  folder: string;
  label: string;
  /** null: the event has no ranking page (yet). */
  ranking: TopTurnierRanking | null;
}

export interface TopTurnierExport {
  title: string | null;
  events: TopTurnierExportEvent[];
}

/** Round label of the rows of a final ranking (`erg.htm`). */
export const TOPTURNIER_ROUND_LABEL = "Classement final";

const RANKING_PAGES = ["erg.htm", "erg.html"];

/** Reads the competition page then each event's ranking, within the size limits. */
export async function readTopTurnierExport(
  source: TopTurnierPageSource,
): Promise<TopTurnierExport> {
  let total = 0;
  const read = async (path: string): Promise<string | null> => {
    const bytes = await source.read(path);
    if (bytes === null) return null;
    if (bytes.length > TOPTURNIER_MAX_PAGE_BYTES) {
      throw new TopTurnierFormatError(
        `Page trop volumineuse dans l'export : ${path} (maximum ${TOPTURNIER_MAX_PAGE_BYTES} octets)`,
      );
    }
    total += bytes.length;
    if (total > TOPTURNIER_MAX_TOTAL_BYTES) {
      throw new TopTurnierFormatError(
        `Export trop volumineux (maximum ${TOPTURNIER_MAX_TOTAL_BYTES} octets)`,
      );
    }
    return decodePage(bytes);
  };

  const indexHtml = (await read("index.htm")) ?? (await read("index.html"));
  if (indexHtml === null) {
    throw new TopTurnierFormatError(
      "Page de la compétition (index.htm) introuvable dans l'export",
    );
  }
  const index = parseTopTurnierIndex(indexHtml);
  if (index.events.length === 0) {
    throw new TopTurnierFormatError(
      "Aucune épreuve trouvée dans la page de la compétition (index.htm)",
    );
  }

  const events: TopTurnierExportEvent[] = [];
  for (const link of index.events) {
    let html: string | null = null;
    for (const page of RANKING_PAGES) {
      html = await read(`${link.folder}/${page}`);
      if (html !== null) break;
    }
    events.push({
      ...link,
      ranking: html === null ? null : parseTopTurnierRanking(html),
    });
  }
  return { title: index.title, events };
}

export type TopTurnierEventStatus =
  | "MATCHED"
  | "UNMATCHED"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "NO_RESULTS"
  | "INVALID";

/** How one TopTurnier event was mapped (shown in the preview). */
export interface TopTurnierEventPlan {
  folder: string;
  label: string;
  status: TopTurnierEventStatus;
  eventId: string | null;
  /** false: matched on part of its classes (combined TopTurnier event). */
  exact: boolean | null;
  rows: number;
  message: string | null;
}

export interface TopTurnierImportPlan {
  events: TopTurnierEventPlan[];
  /** Rows of the MATCHED events, with synthetic line numbers. */
  rows: ParsedResultRow[];
  /** Line number → « label », position: for error messages. */
  lineLabels: Map<number, string>;
  /** Unreadable rows of MATCHED events: the import is refused. */
  errors: { line: number; message: string }[];
}

/**
 * Maps the export onto the competition's events and builds the import rows.
 * Only MATCHED events are imported; every other one is reported with why.
 * Two TopTurnier events landing on the same event are both refused
 * (CONFLICT): their rankings would overwrite each other.
 */
export function planTopTurnierImport(
  data: TopTurnierExport,
  competitionEvents: readonly TopTurnierMatchableEvent[],
): TopTurnierImportPlan {
  const plans: TopTurnierEventPlan[] = data.events.map((event) => {
    const base = {
      folder: event.folder,
      label: event.label,
      eventId: null,
      exact: null,
      rows: event.ranking?.rows.length ?? 0,
      message: null,
    };
    const parsed = parseTopTurnierLabel(event.label);
    if (!parsed.ok) {
      return { ...base, status: "UNMATCHED", message: parsed.reason };
    }
    const match = matchTopTurnierEvent(parsed.descriptor, competitionEvents);
    if (match.kind === "unknown") {
      return { ...base, status: "UNMATCHED", message: match.reason };
    }
    if (match.kind === "ambiguous") {
      return {
        ...base,
        status: "AMBIGUOUS",
        message: `${match.count} épreuves du programme correspondent`,
      };
    }
    const matched = { ...base, eventId: match.eventId, exact: match.exact };
    if (!event.ranking) {
      return {
        ...matched,
        status: "NO_RESULTS",
        message: "pas de classement final (erg.htm) dans l'export",
      };
    }
    if (event.ranking.errors.length > 0) {
      return {
        ...matched,
        status: "INVALID",
        message: event.ranking.errors
          .slice(0, 5)
          .map((e) =>
            e.position > 0 ? `ligne ${e.position} : ${e.message}` : e.message,
          )
          .join(" ; "),
      };
    }
    return { ...matched, status: "MATCHED" };
  });

  const byEvent = new Map<string, TopTurnierEventPlan[]>();
  for (const plan of plans) {
    if (plan.status !== "MATCHED" || !plan.eventId) continue;
    byEvent.set(plan.eventId, [...(byEvent.get(plan.eventId) ?? []), plan]);
  }
  for (const group of byEvent.values()) {
    if (group.length < 2) continue;
    for (const plan of group) {
      plan.status = "CONFLICT";
      plan.message = `même épreuve du programme que ${group
        .filter((other) => other !== plan)
        .map((other) => `« ${other.label} »`)
        .join(", ")}`;
    }
  }

  const rows: ParsedResultRow[] = [];
  const lineLabels = new Map<number, string>();
  const errors: { line: number; message: string }[] = [];
  let line = 0;
  data.events.forEach((event, index) => {
    const plan = plans[index];
    if (plan.status === "INVALID" && event.ranking) {
      for (const error of event.ranking.errors) {
        line++;
        lineLabels.set(line, `« ${event.label} », ligne ${error.position}`);
        errors.push({ line, message: error.message });
      }
      return;
    }
    if (plan.status !== "MATCHED" || !plan.eventId || !event.ranking) return;
    for (const row of event.ranking.rows) {
      line++;
      lineLabels.set(line, `« ${event.label} », ligne ${row.position}`);
      rows.push({
        line,
        eventId: plan.eventId,
        round: TOPTURNIER_ROUND_LABEL,
        ranking: row.ranking,
        participant: row.participant,
        bib: row.bib,
        club: row.club,
        licenceNumbers: [],
        status: null,
        totalParticipants: event.ranking.rows.length,
      });
    }
  });
  return { events: plans, rows, lineLabels, errors };
}

/**
 * Page source over the files of an uploaded archive. The export may sit at
 * the root of the archive or in one folder (« 20261017Lardy/index.htm »):
 * its competition page is the shallowest `index.htm`. Paths are compared
 * case-insensitively (exports made on Windows).
 */
export function archivePageSource(
  files: ReadonlyMap<string, Buffer>,
): TopTurnierPageSource {
  const byLowerPath = new Map<string, Buffer>();
  for (const [path, content] of files) {
    byLowerPath.set(path.toLowerCase(), content);
  }
  const indexes = [...byLowerPath.keys()].filter((p) =>
    /(^|\/)index\.html?$/.test(p),
  );
  const depth = (p: string) => p.split("/").length;
  const shallowest = Math.min(...indexes.map(depth));
  const roots = [
    ...new Set(
      indexes
        .filter((p) => depth(p) === shallowest)
        .map((p) => p.slice(0, p.lastIndexOf("/") + 1)),
    ),
  ];
  if (roots.length > 1) {
    throw new TopTurnierFormatError(
      "L'archive contient plusieurs exports : envoyer une compétition à la fois",
    );
  }
  const root = roots[0] ?? "";
  return {
    read: (path) =>
      Promise.resolve(byLowerPath.get(`${root}${path}`.toLowerCase()) ?? null),
  };
}
