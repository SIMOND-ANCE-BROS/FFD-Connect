/**
 * Parser of a competition results file (#652).
 *
 * No federal source publishes structured results (api.ffdanse.fr exposes the
 * programme only), so results reach the app as a CSV export of the ranking
 * the organiser publishes, one line per couple and per round. Pure function:
 * no I/O, every error is reported with its line number and nothing is
 * guessed — the caller rejects the whole file when any line is invalid.
 *
 * Columns (header row required, order free, case and accents ignored,
 * `;` or `,` separator, fields may be double-quoted):
 *   - epreuve      event id (as listed by `GET /competitions/:id/program`)
 *   - tour         round label, e.g. « Finale », « 1/2 finale »
 *   - classement   rank in the round, integer ≥ 1
 *   - couple       couple label as published, e.g. « Martin / Durand »
 *   - dossard      bib (optional)
 *   - club         club (optional)
 *   - licences     licence numbers of the couple, separated by `|`, `/` or
 *                  spaces (optional) — used to link the result to accounts
 *   - statut       e.g. QUALIFIED / ELIMINATED (optional)
 *   - participants number of couples in the round (optional)
 */

export const MAX_RESULT_IMPORT_ROWS = 2000;

const MAX_LABEL_LENGTH = 200;
const MAX_SHORT_FIELD_LENGTH = 80;
const MAX_LICENCES_PER_ROW = 4;

/** One valid line of the file. */
export interface ParsedResultRow {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  eventId: string;
  round: string;
  ranking: number;
  participant: string;
  bib: string | null;
  club: string | null;
  licenceNumbers: string[];
  status: string | null;
  totalParticipants: number | null;
}

export interface ResultParseError {
  line: number;
  message: string;
}

export interface ResultsCsvParseOutput {
  rows: ParsedResultRow[];
  errors: ResultParseError[];
}

type Column =
  | "eventId"
  | "round"
  | "ranking"
  | "participant"
  | "bib"
  | "club"
  | "licences"
  | "status"
  | "totalParticipants";

const HEADER_ALIASES: Partial<Record<string, Column>> = {
  epreuve: "eventId",
  epreuveid: "eventId",
  eventid: "eventId",
  event: "eventId",
  tour: "round",
  round: "round",
  classement: "ranking",
  rang: "ranking",
  place: "ranking",
  ranking: "ranking",
  couple: "participant",
  participant: "participant",
  nom: "participant",
  dossard: "bib",
  bib: "bib",
  club: "club",
  licences: "licences",
  licence: "licences",
  licenses: "licences",
  license: "licences",
  statut: "status",
  status: "status",
  participants: "totalParticipants",
  total: "totalParticipants",
  totalparticipants: "totalParticipants",
};

const REQUIRED_COLUMNS: readonly Column[] = [
  "eventId",
  "round",
  "ranking",
  "participant",
];

/** Lower-case, accents and non-alphanumerics removed: « Épreuve_ID » → epreuveid. */
function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The separator is the one of `;` / `,` found most in the header line. */
function detectSeparator(headerLine: string): ";" | "," {
  const semicolons = headerLine.split(";").length;
  const commas = headerLine.split(",").length;
  return semicolons >= commas ? ";" : ",";
}

/**
 * Splits the text into records of fields (RFC 4180 quoting: `""` inside a
 * quoted field is a quote; a quoted field may span lines). Each record keeps
 * the line it starts on.
 */
function splitRecords(
  text: string,
  separator: string,
): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    fields.push(field);
    if (fields.some((f) => f.trim() !== "")) {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    field = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === separator) {
      fields.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }
  endRecord();
  return records;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  // An empty cell is "no value" too, so not `??`.
  if (!trimmed) return null;
  return trimmed;
}

/** Strict positive integer (« 1 », « 12 »); null for anything else. */
function parsePositiveInt(value: string): number | null {
  if (!/^\d{1,6}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 ? parsed : null;
}

export function parseResultsCsv(text: string): ResultsCsvParseOutput {
  const content = text.replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const records = splitRecords(content, detectSeparator(firstLine));
  const errors: ResultParseError[] = [];

  const header = records.shift();
  if (!header) {
    return { rows: [], errors: [{ line: 1, message: "Fichier vide" }] };
  }
  const columnIndex = new Map<Column, number>();
  header.fields.forEach((name, index) => {
    const column = HEADER_ALIASES[normalizeHeader(name)];
    if (column && !columnIndex.has(column)) columnIndex.set(column, index);
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !columnIndex.has(c));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: header.line,
          message: `Colonnes obligatoires absentes : ${missing.join(", ")}`,
        },
      ],
    };
  }
  if (records.length === 0) {
    return {
      rows: [],
      errors: [{ line: header.line, message: "Aucune ligne de résultat" }],
    };
  }
  if (records.length > MAX_RESULT_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [
        {
          line: header.line,
          message: `Trop de lignes (${records.length}, maximum ${MAX_RESULT_IMPORT_ROWS})`,
        },
      ],
    };
  }

  const rows: ParsedResultRow[] = [];
  for (const record of records) {
    const get = (column: Column): string => {
      const index = columnIndex.get(column);
      return index === undefined ? "" : (record.fields[index] ?? "").trim();
    };
    const lineErrors: string[] = [];

    const eventId = get("eventId");
    if (!eventId) lineErrors.push("épreuve manquante");
    const round = get("round");
    if (!round) lineErrors.push("tour manquant");
    if (round.length > MAX_SHORT_FIELD_LENGTH)
      lineErrors.push("tour trop long");
    const ranking = parsePositiveInt(get("ranking"));
    if (ranking === null) {
      lineErrors.push("classement invalide (entier ≥ 1 attendu)");
    }
    const participant = get("participant").replace(/\s+/g, " ");
    if (!participant) lineErrors.push("couple manquant");
    if (participant.length > MAX_LABEL_LENGTH) {
      lineErrors.push("libellé du couple trop long");
    }
    const bib = optional(get("bib"));
    if (bib && bib.length > MAX_SHORT_FIELD_LENGTH) {
      lineErrors.push("dossard trop long");
    }
    const club = optional(get("club"));
    if (club && club.length > MAX_LABEL_LENGTH) {
      lineErrors.push("club trop long");
    }
    const status = optional(get("status"));
    if (status && status.length > MAX_SHORT_FIELD_LENGTH) {
      lineErrors.push("statut trop long");
    }
    const totalRaw = get("totalParticipants");
    const totalParticipants = totalRaw ? parsePositiveInt(totalRaw) : null;
    if (totalRaw && totalParticipants === null) {
      lineErrors.push("nombre de participants invalide");
    }
    const licenceNumbers = [
      ...new Set(
        get("licences")
          .split(/[|/\s]+/)
          .map((n) => n.trim())
          .filter((n) => n !== ""),
      ),
    ];
    if (
      licenceNumbers.length > MAX_LICENCES_PER_ROW ||
      licenceNumbers.some((n) => n.length > MAX_SHORT_FIELD_LENGTH)
    ) {
      lineErrors.push("numéros de licence invalides");
    }

    if (lineErrors.length > 0 || ranking === null) {
      errors.push({ line: record.line, message: lineErrors.join(", ") });
      continue;
    }
    rows.push({
      line: record.line,
      eventId,
      round,
      ranking,
      participant,
      bib,
      club,
      licenceNumbers,
      status,
      totalParticipants,
    });
  }

  return { rows, errors };
}
