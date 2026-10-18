import { attributeValue, htmlText, pageTitle } from "./topturnier-html";

/**
 * Parser of a TopTurnier HTML export (#786): the results of a competition as
 * published by the TopTurnier pour Windows / TopTurnier Digital software.
 *
 * Layout of an export:
 *   index.htm                 competition page, one link per event:
 *                             `<a href="3-nat_adultsavancelat/index.htm">`
 *                             labelled « Nat, Adults Avancé Latin »
 *   3-nat_adultsavancelat/    one folder per event:
 *     index.htm               frameset → menu.htm (not read)
 *     menu.htm                links to deck.htm, starter.htm, erg.htm…
 *     erg.htm                 final ranking: rank, bib, couple, club
 *                             (absent while the event is not over)
 *
 * Pure functions, no I/O: the caller hands the pages over (uploaded archive,
 * #786, or fetched, #787) and the limits below bound what is read. Nothing is
 * guessed: an unreadable row is reported with its position.
 */

/** Max events read from one competition page. */
export const TOPTURNIER_MAX_EVENTS = 300;
/** Max ranking rows of one event. */
export const TOPTURNIER_MAX_ROWS_PER_EVENT = 500;
/** Max size of one page. */
export const TOPTURNIER_MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Max size of all the pages read for one import. */
export const TOPTURNIER_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const MAX_LABEL_LENGTH = 200;
const MAX_SHORT_LENGTH = 80;

export class TopTurnierFormatError extends Error {}

/** One event link of the competition page. */
export interface TopTurnierEventLink {
  /** Folder of the event, relative to the competition page (« 3-nat_adultsavancelat »). */
  folder: string;
  /** Label as published (« Nat, Adults Avancé Latin »). */
  label: string;
}

export interface TopTurnierIndex {
  title: string | null;
  events: TopTurnierEventLink[];
}

/** One row of a final ranking. */
export interface TopTurnierRankingRow {
  /** 1-based position of the row in the ranking (for messages). */
  position: number;
  /** Rank, lower bound of a tie (« 1.-2. » → 1). */
  ranking: number;
  /** Upper bound of a tie (« 1.-2. » → 2), same as `ranking` otherwise. */
  rankingTo: number;
  bib: string | null;
  /** « Prénom Nom / Prénom Nom », or one name for a solo. */
  participant: string;
  club: string | null;
}

export interface TopTurnierRankingError {
  position: number;
  message: string;
}

export interface TopTurnierRanking {
  rows: TopTurnierRankingRow[];
  errors: TopTurnierRankingError[];
}

/**
 * Event folder of a link `N-slug/index.htm` (or `N-slug/`), or null for any
 * other link (stylesheet, external site, parent folder…). The folder is one
 * path segment of safe characters only.
 */
export function eventFolderOf(href: string): string | null {
  const match =
    /^(?:\.\/)?([A-Za-z0-9][A-Za-z0-9_.-]{0,120})\/(?:index\.html?)?$/i.exec(
      href.trim(),
    );
  if (!match) return null;
  const folder = match[1];
  if (folder.includes("..")) return null;
  return folder;
}

/** Events listed by the competition page (`index.htm`), in page order. */
export function parseTopTurnierIndex(html: string): TopTurnierIndex {
  const events: TopTurnierEventLink[] = [];
  const seen = new Set<string>();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);
  for (const anchor of anchors) {
    const href = attributeValue(`<a ${anchor[1]}>`, "href");
    const folder = href === null ? null : eventFolderOf(href);
    if (!folder || seen.has(folder)) continue;
    const label = htmlText(anchor[2]);
    if (!label) continue;
    seen.add(folder);
    if (events.length >= TOPTURNIER_MAX_EVENTS) {
      throw new TopTurnierFormatError(
        `Trop d'épreuves dans l'export (maximum ${TOPTURNIER_MAX_EVENTS})`,
      );
    }
    events.push({ folder, label: label.slice(0, MAX_LABEL_LENGTH) });
  }
  return { title: pageTitle(html), events };
}

/** Rank cell: « 1. », « 1 », « 1.-2. », « 7.-12. ». */
export function parseRankCell(
  cell: string,
): { from: number; to: number } | null {
  const match = /^(\d{1,4})\.?(?:\s*-\s*(\d{1,4})\.?)?$/.exec(cell.trim());
  if (!match) return null;
  const from = Number(match[1]);
  const toRaw = match.at(2);
  const to = toRaw === undefined ? from : Number(toRaw);
  if (from < 1 || to < from) return null;
  return { from, to };
}

type RankingColumn = "rank" | "bib" | "participant" | "club";

/** Header labels seen in French, English and German exports. */
const HEADER_COLUMNS: [RegExp, RankingColumn][] = [
  [/^(rank|rang|place|platz|pl|classement)\.?$/, "rank"],
  [/^(no|nr|n°|num|startnr|startnummer|dossard|bib)\.?$/, "bib"],
  [
    /^(participant|participants|paar|couple|couples|name|nom|teilnehmer|solo)$/,
    "participant",
  ],
  [/^(country|club|verein|land|pays|nation|ecole|ecole club)$/, "club"],
];

function headerColumn(cell: string): RankingColumn | null {
  const key = cell.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  for (const [pattern, column] of HEADER_COLUMNS) {
    if (pattern.test(key)) return column;
  }
  return null;
}

/** Cells of every `<tr>` of the page, as visible text. */
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const tr of html.matchAll(
    /<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table\s*>)/gi,
  )) {
    const cells = [
      ...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr\s*>|$)/gi),
    ].map((cell) => htmlText(cell[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

const POSITIONAL: Record<RankingColumn, number> = {
  rank: 0,
  bib: 1,
  participant: 2,
  club: 3,
};

/**
 * Final ranking of an event (`erg.htm`). Every row whose first cell is a rank
 * is a result; the header row (« Rank | No. | Participant | Country »,
 * « Platz | Nr. | Paar | Verein »…) gives the columns, positional otherwise.
 * A ranking split in several tables (final, then the couples out in the
 * earlier rounds) is read as one: a couple listed twice is reported.
 */
export function parseTopTurnierRanking(html: string): TopTurnierRanking {
  let columns: Record<RankingColumn, number> = { ...POSITIONAL };
  const rows: TopTurnierRankingRow[] = [];
  const errors: TopTurnierRankingError[] = [];
  let position = 0;

  for (const cells of tableRows(html)) {
    const mapped = cells.map(headerColumn);
    if (mapped.includes("rank") && mapped.includes("participant")) {
      const next: Partial<Record<RankingColumn, number>> = {};
      mapped.forEach((column, index) => {
        if (column && next[column] === undefined) next[column] = index;
      });
      columns = { ...POSITIONAL, ...next };
      if (next.bib === undefined) columns.bib = -1;
      if (next.club === undefined) columns.club = -1;
      continue;
    }
    const rank = parseRankCell(cells[columns.rank] ?? "");
    if (!rank) continue; // Title row (« Final »), spacer…

    position++;
    if (position > TOPTURNIER_MAX_ROWS_PER_EVENT) {
      throw new TopTurnierFormatError(
        `Trop de lignes dans un classement (maximum ${TOPTURNIER_MAX_ROWS_PER_EVENT})`,
      );
    }
    const cell = (column: RankingColumn): string =>
      columns[column] < 0 ? "" : (cells[columns[column]] ?? "").trim();
    const participant = cell("participant").replace(/\s*\/\s*/g, " / ");
    const bib = cell("bib") || null;
    const club = cell("club") || null;
    const problems: string[] = [];
    if (!participant) problems.push("couple manquant");
    if (participant.length > MAX_LABEL_LENGTH) {
      problems.push("libellé du couple trop long");
    }
    if (
      bib &&
      (bib.length > MAX_SHORT_LENGTH || !/^[A-Za-z0-9 ._-]+$/.test(bib))
    ) {
      problems.push("dossard invalide");
    }
    if (club && club.length > MAX_LABEL_LENGTH) problems.push("club trop long");
    if (problems.length > 0) {
      errors.push({ position, message: problems.join(", ") });
      continue;
    }
    rows.push({
      position,
      ranking: rank.from,
      rankingTo: rank.to,
      bib,
      participant,
      club,
    });
  }
  if (rows.length === 0 && errors.length === 0) {
    errors.push({ position: 0, message: "aucune ligne de classement" });
  }
  return { rows, errors };
}
