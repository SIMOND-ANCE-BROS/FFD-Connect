import { TextCollector, attributeValue, htmlTokens } from "./topturnier-html";

/**
 * TEMPORARY (#801, with #787) — reading of the public list of recent
 * competitions of the TopTurnier site (`/resultats/index.php?annee=YYYY`),
 * until the FFD gives access to its results data (#651). Remove this module
 * with `topturnier-url.ts` then.
 *
 * The page is untrusted: it is read by the same linear tokenizer as the
 * export pages (`htmlTokens`), regexes only ever run on small bounded pieces
 * (a tag, a collected text capped at a few hundred characters, a path). Pure
 * module: no network, no database.
 *
 * Observed structure (2026-10-20), one block per competition:
 *
 *   <div class='resultatsEvent'>
 *     <div class='date'><p>17 <span>oct</span> <span>26</span></p></div>
 *     <div class='detail'>
 *       <h4>Ep. à Points, Opens</h4>
 *       <a href='20261017_exempleville/index.htm'>Exempleville, Trophée</a>
 *     </div>
 *   </div>
 */

/** Path of the list on the site; exports live in folders next to it. */
export const CHAIRPERSON_INDEX_PATH = "/resultats/index.php";

/** Entries read from one page at most (a year lists a few dozen). */
export const MAX_CHAIRPERSON_ENTRIES = 300;
/** Max characters kept of a title / a category. */
export const MAX_CHAIRPERSON_TITLE = 200;
export const MAX_CHAIRPERSON_CATEGORY = 100;
/** Max characters of a date text (« 17 oct 26 »). */
const MAX_DATE_TEXT = 64;

export interface ChairpersonEntry {
  /** `YYYY-MM-DD`, null when neither the block nor the folder name gives a valid day. */
  date: string | null;
  title: string;
  category: string | null;
  /** Folder of the export under `/resultats/` (`20261017_exempleville`). */
  folder: string;
  /** Absolute https URL of the export's competition page, query and fragment dropped. */
  exportUrl: string;
}

export interface ChairpersonIndex {
  entries: ChairpersonEntry[];
  /** True when the page listed more than MAX_CHAIRPERSON_ENTRIES entries. */
  truncated: boolean;
}

/** Month abbreviations seen on the site, accents and dots removed. */
const MONTHS: Readonly<Partial<Record<string, number>>> = {
  jan: 1,
  janv: 1,
  janvier: 1,
  fev: 2,
  fevr: 2,
  fevrier: 2,
  mar: 3,
  mars: 3,
  avr: 4,
  avril: 4,
  mai: 5,
  jun: 6,
  juin: 6,
  jul: 7,
  juil: 7,
  juillet: 7,
  aou: 8,
  aout: 8,
  sep: 9,
  sept: 9,
  septembre: 9,
  oct: 10,
  octobre: 10,
  nov: 11,
  novembre: 11,
  dec: 12,
  decembre: 12,
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** `YYYY-MM-DD` of a calendar day, null when it does not exist. */
function isoDay(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2099
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Day of a block's date text: « 17 oct 26 », « 3 févr. 2026 ». */
export function parseChairpersonDate(text: string): string | null {
  const parts = stripAccents(text.slice(0, MAX_DATE_TEXT))
    .toLowerCase()
    .split(" ")
    .map((part) => part.replace(/\.$/, ""))
    .filter((part) => part !== "");
  if (parts.length !== 3) return null;
  const [dayText, monthText, yearText] = parts;
  if (!/^\d{1,2}$/.test(dayText) || !/^(?:\d{2}|\d{4})$/.test(yearText)) {
    return null;
  }
  const month = MONTHS[monthText];
  if (month === undefined) return null;
  const year = Number(yearText) + (yearText.length === 2 ? 2000 : 0);
  return isoDay(year, month, Number(dayText));
}

/** Day of a folder name starting with `AAAAMMJJ` (`20261017_exempleville`). */
export function folderDate(folder: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(folder);
  if (!match) return null;
  return isoDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Folder of an export link, only `<folder>/index.htm` under `/resultats/`. */
const EXPORT_PATH =
  /^\/resultats\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/index\.html?$/;

/**
 * Absolute URL of an export link of the list, or null. Only a competition
 * page in a direct sub-folder of `/resultats/` on the list's own origin is
 * kept (never `..`, another path or another site).
 */
export function exportLink(
  href: string,
  indexUrl: URL,
): { folder: string; url: URL } | null {
  let url: URL;
  try {
    url = new URL(href.trim(), indexUrl);
  } catch {
    return null;
  }
  if (url.origin !== indexUrl.origin) return null;
  const match = EXPORT_PATH.exec(url.pathname);
  if (!match) return null;
  url.search = "";
  url.hash = "";
  return { folder: match[1], url };
}

function hasClass(raw: string, name: string): boolean {
  const value = attributeValue(raw, "class");
  return value?.split(/\s+/).includes(name) === true;
}

interface Block {
  /** Div depth of the block: it ends when its own `</div>` comes back to it. */
  depth: number;
  date: TextCollector | null;
  dateDone: boolean;
  category: TextCollector | null;
  categoryDone: boolean;
  title: TextCollector | null;
  href: string | null;
  titleDone: boolean;
}

/**
 * Entries of the list page, in page order. A block without a usable export
 * link is skipped (never guessed). One forward pass over the tokens: linear
 * in the page size whatever its content.
 */
export function parseChairpersonIndex(
  html: string,
  indexUrl: URL,
): ChairpersonIndex {
  const entries: ChairpersonEntry[] = [];
  let truncated = false;
  let depth = 0;
  let block: Block | null = null;
  let capture: TextCollector | null = null;

  const finish = (done: Block): void => {
    if (done.href === null || done.title === null) return;
    const link = exportLink(done.href, indexUrl);
    const title = done.title.text().slice(0, MAX_CHAIRPERSON_TITLE);
    if (link === null || title === "") return;
    if (entries.length >= MAX_CHAIRPERSON_ENTRIES) {
      truncated = true;
      return;
    }
    const category =
      done.category?.text().slice(0, MAX_CHAIRPERSON_CATEGORY) ?? "";
    const blockDate =
      done.date === null ? null : parseChairpersonDate(done.date.text());
    entries.push({
      date: blockDate ?? folderDate(link.folder),
      title,
      category: category === "" ? null : category,
      folder: link.folder,
      exportUrl: link.url.href,
    });
  };

  for (const token of htmlTokens(html)) {
    if (token.kind === "text") {
      capture?.add(token.text);
      continue;
    }
    if (token.name === "div") {
      if (token.closing) {
        depth = Math.max(0, depth - 1);
        if (block !== null && depth < block.depth) {
          finish(block);
          block = null;
          capture = null;
        }
      } else if (!token.raw.endsWith("/>")) {
        depth++;
        if (hasClass(token.raw, "resultatsEvent")) {
          // A block opened inside another one closes it (malformed page).
          if (block !== null) finish(block);
          block = {
            depth,
            date: null,
            dateDone: false,
            category: null,
            categoryDone: false,
            title: null,
            href: null,
            titleDone: false,
          };
          capture = null;
        }
      }
      continue;
    }
    if (block === null) continue;
    const current: Block = block;
    if (token.name === "p" && !current.dateDone) {
      if (!token.closing) {
        current.date = new TextCollector();
        capture = current.date;
      } else if (current.date !== null) {
        current.dateDone = true;
        capture = null;
      }
      continue;
    }
    if (token.name === "h4" && !current.categoryDone) {
      if (!token.closing) {
        current.category = new TextCollector();
        capture = current.category;
      } else if (current.category !== null) {
        current.categoryDone = true;
        capture = null;
      }
      continue;
    }
    if (token.name === "a" && !current.titleDone) {
      if (!token.closing) {
        const href = attributeValue(token.raw, "href");
        if (href !== null && current.title === null) {
          current.href = href;
          current.title = new TextCollector();
          capture = current.title;
        }
      } else if (current.title !== null) {
        current.titleDone = true;
        capture = null;
      }
      continue;
    }
    // Any other tag separates words (`17<span>oct</span>`).
    capture?.add(" ");
  }
  if (block !== null) finish(block);
  return { entries, truncated };
}
