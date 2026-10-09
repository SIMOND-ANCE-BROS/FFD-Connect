/**
 * TEMPORARY — deterministic deduction of a competition's épreuves from the
 * free text the FFD publishes (programme description, circular PDF text).
 *
 * FFD exposes no structured épreuves, so until the app is wired to the
 * federation this parser turns the closed FFD vocabulary (specialities, age
 * classes, levels, nature, solo/couple) into a deduplicated list of events.
 * No LLM: dictionary + regexes, line by line, with a small header context
 * (circulars are flattened tables: "LATINE STANDARD" column headers, then one
 * row per age class).
 *
 * The output is an approximation meant to be displayed as "à vérifier": when a
 * table is flattened, the column a level belongs to is lost, so a row yields
 * the union of its specialities × levels (filtered by the levels the
 * regulation allows for that age class).
 *
 * Pure module — no I/O.
 */
import { getAllowedLevelsForAgeGroup } from "../../common/age-group";

/**
 * Bump when the parsing rules change: it is part of the stored fingerprint, so
 * a new version re-processes every competition on the next sync.
 */
export const FFD_EVENTS_PARSER_VERSION = 1;

export type DeducedEventKind = "CLASSIFICATRICE" | "OPEN" | "MAJEURE";
export type DeducedEventType = "COUPLE" | "SOLO";
export type DeducedCategory = "Latin" | "Standard" | "Ten Dance";
export type DeducedLevel =
  | "Débutant"
  | "Intermédiaire"
  | "Avancé"
  | "International";

export interface DeducedEvent {
  category: DeducedCategory;
  ageGroup: string;
  eventType: DeducedEventType;
  level: DeducedLevel | null;
  eventKind: DeducedEventKind | null;
}

/** Hard cap: a runaway document must not create thousands of rows. */
export const MAX_DEDUCED_EVENTS = 400;

/** Words of prose (not vocabulary, not filler) above which a line is ignored. */
const MAX_UNKNOWN_WORDS = 4;

const ALL_CATEGORIES_FALLBACK: readonly DeducedCategory[] = [
  "Latin",
  "Standard",
];

type AgeKeyword =
  | "juvenile"
  | "junior"
  | "youth"
  | "adulte"
  | "senior"
  | "jeunes"
  | "espoir";

interface AgeToken {
  keyword: AgeKeyword;
  numbers: number[];
}

interface LineInfo {
  ages: AgeToken[];
  categories: DeducedCategory[];
  levels: DeducedLevel[];
  kinds: DeducedEventKind[];
  types: DeducedEventType[];
  team: boolean;
  unknownWords: number;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  eacute: "é",
  egrave: "è",
  agrave: "à",
};

/** FFD descriptions are HTML fragments (`<br />`, `&amp;`): make them lines. */
export function htmlToPlainText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => {
      return HTML_ENTITIES[name.toLowerCase()] ?? match;
    });
}

/** Lower-case, accent-free, typographic quotes flattened. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const NUM = String.raw`(?:[1-5]|iv|v|i{1,3})`;
const NUM_SEPARATOR = String.raw`[\s,\/.\-]*(?:(?:et|a)\b)?[\s,\/.\-]*`;
const AGE_REGEX = new RegExp(
  String.raw`\b(juveniles?|juniors?|youths?|adultes?|adults?|seniors?|jeunes|jeune|espoirs?)\b((?:${NUM_SEPARATOR}\b${NUM}\b)*)`,
  "g",
);

const CATEGORY_PATTERNS: readonly [RegExp, DeducedCategory][] = [
  [/\blatin(?:e|es|s)?\b/g, "Latin"],
  [/\bstandards?\b/g, "Standard"],
  [/\b(?:10|dix) danses\b|\bten ?dances?\b/g, "Ten Dance"],
];

const LEVEL_PATTERNS: readonly [RegExp, DeducedLevel][] = [
  [/\b(?:debutants?|novices?)\b|\bdeb\b\.?/g, "Débutant"],
  [/\bintermediaires?\b|\binter\b(?!-)\.?/g, "Intermédiaire"],
  [/\bavance(?:e)?s?\b/g, "Avancé"],
  [/\binternationa(?:l|le|ux|les)\b/g, "International"],
];

const KIND_PATTERNS: readonly [RegExp, DeducedEventKind][] = [
  [/\b(?:classificat|qualificat)\w*/g, "CLASSIFICATRICE"],
  [/\bopens?\b/g, "OPEN"],
  [/\bchampionnats?\b|\bcoupe de france\b|\bcriteriums?\b/g, "MAJEURE"],
];

const TYPE_PATTERNS: readonly [RegExp, DeducedEventType][] = [
  [/\bsolos?\b/g, "SOLO"],
  [/\bcouples?\b/g, "COUPLE"],
];

const TEAM_REGEX = /\bteams?\b/g;

/** Lines carrying these markers are rules/prices/contacts, never épreuves. */
const NOISE_MARKERS =
  /€|\bdossards?\b|\btarifs?\b|https?:|www\.|@|\blicences?\b|\bjuges?\b|\binscri\w*|\bhoraires?\b|\bbillet\w*|\bscrutat\w*|\bchairperson\b|\bdirecteur\b/;

/** Words that may surround vocabulary in an épreuves line without being prose. */
const FILLER_WORDS = new Set([
  "et",
  "ou",
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "en",
  "au",
  "aux",
  "avec",
  "sur",
  "epreuve",
  "epreuves",
  "epreuvres",
  "competition",
  "competitions",
  "nationale",
  "nationales",
  "national",
  "danse",
  "danses",
  "dance",
  "sportive",
  "niveau",
  "niveaux",
  "classe",
  "classes",
  "age",
  "piste",
  "pistes",
  "unique",
  "toutes",
  "tous",
  "categorie",
  "categories",
  "programmees",
  "programme",
  "confondus",
  "sauf",
  "finale",
  "pour",
  "regional",
  "regionale",
  "france",
  "selectif",
  "points",
  "ouvert",
  "ouverts",
]);

// ---------------------------------------------------------------------------
// Line analysis
// ---------------------------------------------------------------------------

function collect<T>(
  line: string,
  patterns: readonly [RegExp, T][],
): { values: T[]; rest: string } {
  const values: T[] = [];
  let rest = line;
  for (const [regex, value] of patterns) {
    regex.lastIndex = 0;
    if (regex.test(rest)) {
      values.push(value);
      regex.lastIndex = 0;
      rest = rest.replace(regex, " ");
    }
  }
  return { values, rest };
}

function romanOrArabic(token: string): number {
  const roman: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
  };
  return roman[token] ?? Number(token);
}

function parseNumbers(suffix: string): number[] {
  const tokens = suffix.match(new RegExp(String.raw`\b${NUM}\b`, "g")) ?? [];
  const numbers = tokens.map(romanOrArabic);
  // "1..5" / "1 a 5" (accent stripped "à") denote a range, "1 / 2" a list.
  const isRange = /\.\.|\ba\b/.test(suffix);
  if (isRange && numbers.length >= 2) {
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  return Array.from(new Set(numbers));
}

function toAgeKeyword(word: string): AgeKeyword {
  if (word.startsWith("juvenile")) return "juvenile";
  if (word.startsWith("junior")) return "junior";
  if (word.startsWith("youth")) return "youth";
  if (word.startsWith("adult")) return "adulte";
  if (word.startsWith("senior")) return "senior";
  if (word.startsWith("espoir")) return "espoir";
  return "jeunes";
}

export function analyzeLine(normalizedLine: string): LineInfo {
  const ages: AgeToken[] = [];
  AGE_REGEX.lastIndex = 0;
  let rest = normalizedLine.replace(
    AGE_REGEX,
    (_match, word: string, suffix: string) => {
      ages.push({ keyword: toAgeKeyword(word), numbers: parseNumbers(suffix) });
      return " ";
    },
  );

  const categories = collect(rest, CATEGORY_PATTERNS);
  rest = categories.rest;
  const levels = collect(rest, LEVEL_PATTERNS);
  rest = levels.rest;
  const kinds = collect(rest, KIND_PATTERNS);
  rest = kinds.rest;
  const types = collect(rest, TYPE_PATTERNS);
  rest = types.rest;
  TEAM_REGEX.lastIndex = 0;
  const team = TEAM_REGEX.test(rest);
  rest = rest.replace(TEAM_REGEX, " ");

  const unknownWords = (rest.match(/[a-z]{3,}/g) ?? []).filter(
    (word) => !FILLER_WORDS.has(word) && word !== "x",
  ).length;

  return {
    ages,
    categories: categories.values,
    levels: levels.values,
    kinds: kinds.values,
    types: types.values,
    team,
    unknownWords,
  };
}

// ---------------------------------------------------------------------------
// Age class mapping (canonical names of src/common/age-group)
// ---------------------------------------------------------------------------

const COUPLE_ROMAN = ["I", "II", "III", "IV", "V"];

function pick(numbers: number[], max: number): number[] {
  const inRange = numbers.filter((n) => n >= 1 && n <= max);
  return inRange.length > 0
    ? inRange
    : Array.from({ length: max }, (_, i) => i + 1);
}

export function mapAgeToken(
  token: AgeToken,
  eventType: DeducedEventType,
  lineHasJuvenileOrJunior: boolean,
): string[] {
  const solo = eventType === "SOLO";
  switch (token.keyword) {
    case "juvenile":
      return solo
        ? ["Solo Juvénile"]
        : pick(token.numbers, 2).map((n) => `Juvénile ${COUPLE_ROMAN[n - 1]}`);
    case "junior":
      return pick(token.numbers, 2).map((n) =>
        solo ? `Solo Junior ${n}` : `Junior ${COUPLE_ROMAN[n - 1]}`,
      );
    case "youth":
      return [solo ? "Solo Youth" : "Youth"];
    case "adulte":
      return [solo ? "Solo Adulte" : "Adulte"];
    case "senior":
      return solo
        ? ["Solo Senior"]
        : pick(token.numbers, 5).map((n) => `Senior ${COUPLE_ROMAN[n - 1]}`);
    case "jeunes":
      // "Jeunes Juvéniles" = qualifier; "Open Jeunes" alone = juvéniles + juniors.
      if (lineHasJuvenileOrJunior) return [];
      return solo
        ? ["Solo Juvénile", "Solo Junior 1", "Solo Junior 2"]
        : ["Juvénile I", "Juvénile II", "Junior I", "Junior II"];
    case "espoir":
      // "Espoir" (under 21) has no age class of its own in the app.
      return [];
  }
}

/**
 * Numbered juvenile/senior classes and "Espoir" only exist for couples: in a
 * solo context they reveal a couple table whose header was merged with the
 * solo one (flattened two-column layouts).
 */
function isCoupleOnlyToken(token: AgeToken): boolean {
  if (token.keyword === "espoir") return true;
  if (token.keyword === "senior" && token.numbers.length > 0) return true;
  return token.keyword === "juvenile" && token.numbers.length > 0;
}

function isLevelAllowed(
  eventType: DeducedEventType,
  ageGroup: string,
  level: DeducedLevel,
): boolean {
  const allowed = getAllowedLevelsForAgeGroup(eventType, ageGroup);
  return allowed.length === 0 || allowed.includes(level);
}

// ---------------------------------------------------------------------------
// Document walk
// ---------------------------------------------------------------------------

interface Context {
  kind: DeducedEventKind | null;
  types: DeducedEventType[];
  categories: DeducedCategory[];
  levels: DeducedLevel[];
}

interface Row {
  ages: AgeToken[];
  kind: DeducedEventKind | null;
  types: DeducedEventType[];
  categories: DeducedCategory[];
  lineHasJuvenileOrJunior: boolean;
}

function singleOrNull<T>(values: T[]): T | null {
  return values.length === 1 ? values[0] : null;
}

function sameSlotKey(event: DeducedEvent): string {
  return [event.eventType, event.category, event.ageGroup].join("|");
}

class EventCollector {
  private readonly byKey = new Map<string, DeducedEvent>();

  add(row: Row, levels: DeducedLevel[]): void {
    for (const type of row.types) {
      for (const token of row.ages) {
        const effectiveType: DeducedEventType =
          type === "SOLO" && row.types.length === 1 && isCoupleOnlyToken(token)
            ? "COUPLE"
            : type;
        const ageGroups = mapAgeToken(
          token,
          effectiveType,
          row.lineHasJuvenileOrJunior,
        );
        for (const ageGroup of ageGroups) {
          for (const category of row.categories) {
            this.addOne(row.kind, effectiveType, ageGroup, category, levels);
          }
        }
      }
    }
  }

  private addOne(
    kind: DeducedEventKind | null,
    eventType: DeducedEventType,
    ageGroup: string,
    category: DeducedCategory,
    levels: DeducedLevel[],
  ): void {
    // Levels define classificatrices; opens and majeures group all levels.
    const eventKind: DeducedEventKind | null =
      kind ?? (levels.length > 0 ? "CLASSIFICATRICE" : null);
    const effectiveLevels: (DeducedLevel | null)[] =
      eventKind === "OPEN" || eventKind === "MAJEURE" || levels.length === 0
        ? [null]
        : levels.filter((level) => isLevelAllowed(eventType, ageGroup, level));

    for (const level of effectiveLevels) {
      if (this.byKey.size >= MAX_DEDUCED_EVENTS) return;
      const key = [eventKind, eventType, category, ageGroup, level].join("|");
      if (!this.byKey.has(key)) {
        this.byKey.set(key, {
          category,
          ageGroup,
          eventType,
          level,
          eventKind,
        });
      }
    }
  }

  /**
   * A classificatrice row whose levels sit on the next (wrapped) line was
   * first recorded without level: drop it once a levelled twin exists.
   */
  values(): DeducedEvent[] {
    const all = Array.from(this.byKey.values());
    const levelled = new Set(
      all
        .filter((e) => e.eventKind === "CLASSIFICATRICE" && e.level !== null)
        .map(sameSlotKey),
    );
    return all.filter(
      (e) =>
        !(
          e.eventKind === "CLASSIFICATRICE" &&
          e.level === null &&
          levelled.has(sameSlotKey(e))
        ),
    );
  }
}

/**
 * Parse a plain-text (or HTML fragment) FFD document into deduplicated events.
 * Returns [] when nothing reliable is recognised (no age class anywhere).
 */
export function parseFfdEvents(text: string): DeducedEvent[] {
  const lines = htmlToPlainText(text)
    .split(/\r?\n/)
    .map((line) => normalizeForMatch(line).trim())
    .filter((line) => line.length > 0);

  const infos = lines
    .filter((line) => !NOISE_MARKERS.test(line))
    .map(analyzeLine)
    .filter((info) => info.unknownWords <= MAX_UNKNOWN_WORDS);

  const documentCategories = Array.from(
    new Set(infos.flatMap((info) => info.categories)),
  );

  const context: Context = {
    kind: null,
    types: ["COUPLE"],
    categories: [],
    levels: [],
  };
  let lastRow: Row | null = null;
  // Consecutive speciality headers ("Latines" / "Standards" on two lines)
  // are the columns of one table: accumulate them until a row is read.
  let categoryHeaderOpen = false;
  const setContextCategories = (categories: DeducedCategory[]) => {
    context.categories = categoryHeaderOpen
      ? Array.from(new Set([...context.categories, ...categories]))
      : categories;
    categoryHeaderOpen = true;
  };
  const collector = new EventCollector();

  for (const info of infos) {
    // Team events (Solo Danse Team, Show) are not individual registrations.
    if (info.team) continue;

    if (info.ages.length > 0) {
      const lineKind = singleOrNull(info.kinds);
      const kind = info.kinds.length > 0 ? lineKind : context.kind;
      if (info.kinds.length > 0) context.kind = lineKind;
      const categories =
        info.categories.length > 0
          ? info.categories
          : context.categories.length > 0
            ? context.categories
            : documentCategories.length > 0
              ? documentCategories
              : [...ALL_CATEGORIES_FALLBACK];
      const row: Row = {
        ages: info.ages,
        kind,
        types: info.types.length > 0 ? info.types : context.types,
        categories,
        lineHasJuvenileOrJunior: info.ages.some(
          (age) => age.keyword === "juvenile" || age.keyword === "junior",
        ),
      };
      collector.add(
        row,
        info.levels.length > 0
          ? info.levels
          : kind === "CLASSIFICATRICE" || kind === null
            ? context.levels
            : [],
      );
      lastRow = row;
      categoryHeaderOpen = false;
      continue;
    }

    const isHeader = info.kinds.length > 0 || info.types.length > 0;
    if (isHeader) {
      if (info.kinds.length > 0) {
        context.kind = singleOrNull(info.kinds);
        // A new nature section starts couple unless it says otherwise.
        context.types = info.types.length > 0 ? info.types : ["COUPLE"];
      } else {
        // "SOLOS" after an opens couples table starts the solo
        // classificatrices; "Couple" right after "Opens" just details them.
        const switchesType = info.types.some(
          (type) => !context.types.includes(type),
        );
        if (context.kind === "OPEN" && switchesType) context.kind = null;
        context.types = info.types;
      }
      categoryHeaderOpen = false;
      if (info.categories.length > 0) setContextCategories(info.categories);
      context.levels = info.levels;
      lastRow = null;
      continue;
    }

    if (info.categories.length > 0) {
      // A speciality header opens a new table: no more wrapped cells.
      setContextCategories(info.categories);
      lastRow = null;
    }
    if (info.levels.length > 0) {
      if (lastRow) {
        // Wrapped table cell: "Junior 1 Débutant" / "Intermédiaire Avancé".
        collector.add(lastRow, info.levels);
      } else {
        // Column header of a table: "Débutants Intermédiaire Avancé".
        context.levels = info.levels;
        lastRow = null;
      }
    }
  }

  return collector.values();
}

/**
 * Union of the circular's events (authoritative: detailed tables) and the
 * description's, keeping from the description only the age classes the
 * circular does not mention at all (per solo/couple).
 */
export function mergeDeducedEvents(
  primary: DeducedEvent[],
  secondary: DeducedEvent[],
): DeducedEvent[] {
  const covered = new Set(primary.map((e) => `${e.eventType}|${e.ageGroup}`));
  const merged = [...primary];
  for (const event of secondary) {
    if (merged.length >= MAX_DEDUCED_EVENTS) break;
    if (!covered.has(`${event.eventType}|${event.ageGroup}`)) {
      merged.push(event);
    }
  }
  return merged;
}
