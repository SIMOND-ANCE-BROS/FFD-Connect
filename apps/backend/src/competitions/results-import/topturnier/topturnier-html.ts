import * as iconv from "iconv-lite";

/**
 * Text helpers for the HTML pages of a TopTurnier export (#786). The pages
 * are untrusted (uploaded, or fetched for #787): they are read by a linear
 * tokenizer (`htmlTokens`), regexes only ever run on small bounded pieces
 * (a tag, a cell, the first 2 KB). No DOM, no script, no network. Pure
 * module.
 */

/**
 * Bytes of a page as text. TopTurnier Digital writes UTF-8; older « pour
 * Windows » exports may be windows-1252 / ISO-8859-1, announced by a
 * `<meta charset>`. A BOM wins, then the meta, then UTF-8 when the bytes are
 * valid UTF-8, windows-1252 otherwise.
 */
export function decodePage(bytes: Buffer): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  const head = bytes.subarray(0, 2048).toString("latin1");
  const declared = /charset\s*=\s*["']?\s*([a-z0-9_-]+)/i
    .exec(head)?.[1]
    ?.toLowerCase();
  if (
    declared &&
    declared !== "utf-8" &&
    declared !== "utf8" &&
    iconv.encodingExists(declared)
  ) {
    return iconv.decode(bytes, declared);
  }
  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return iconv.decode(bytes, "windows-1252");
}

const NAMED_ENTITIES: Partial<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  equiv: "≡",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  agrave: "à",
  acirc: "â",
  auml: "ä",
  ccedil: "ç",
  icirc: "î",
  iuml: "ï",
  ocirc: "ô",
  ouml: "ö",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  szlig: "ß",
  Eacute: "É",
  Egrave: "È",
  Agrave: "À",
  Ccedil: "Ç",
  Ouml: "Ö",
  Uuml: "Ü",
  Auml: "Ä",
};

function codePoint(value: number): string {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff) return "";
  // No control characters from an entity (tabs/newlines become spaces later).
  if (value < 0x20 || (value >= 0x7f && value < 0xa0)) return " ";
  return String.fromCodePoint(value);
}

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});?/gi,
    (whole, ref: string) => {
      if (ref[0] === "#") {
        const hex = ref[1] === "x" || ref[1] === "X";
        return codePoint(
          Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
      }
      return NAMED_ENTITIES[ref] ?? whole;
    },
  );
}

/**
 * One piece of a page: text (raw, entities not decoded) or a tag. Comments,
 * doctypes, `<script>` and `<style>` are dropped (a space in their place).
 */
export type HtmlToken =
  | { kind: "text"; text: string }
  | { kind: "tag"; name: string; closing: boolean; raw: string };

/** Max characters of a tag kept to read its attributes. */
const MAX_TAG_LENGTH = 4096;
/** Max characters collected for one text (cell, link label, title). */
export const MAX_COLLECTED_TEXT = 8192;

const SPACE: HtmlToken = { kind: "text", text: " " };

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57);
}

/**
 * Index just past the closing `</name ...>` of a raw-text element, or -1.
 * Case-insensitive, forward only.
 */
function rawTextEnd(html: string, from: number, name: string): number {
  let cursor = from;
  for (;;) {
    const open = html.indexOf("</", cursor);
    if (open < 0) return -1;
    const after = open + 2 + name.length;
    if (
      html.slice(open + 2, after).toLowerCase() === name &&
      !isNameChar(html.charCodeAt(after))
    ) {
      const close = html.indexOf(">", after);
      return close < 0 ? -1 : close + 1;
    }
    cursor = open + 2;
  }
}

/**
 * Tokenizer of an untrusted page, in ONE forward pass: every step only
 * searches (`indexOf`) from the current position onwards, so the cost is
 * linear in the page size whatever its content (unclosed tags or comments,
 * long attribute or space runs). No regex runs over the whole page — lazy
 * `[\s\S]*?` patterns with a missing terminator rescan the rest of the page
 * from every start position (quadratic, a CPU denial of service on 2 MB).
 * An unterminated construct ends the page, like a browser would.
 */
export function* htmlTokens(html: string): Generator<HtmlToken> {
  const length = html.length;
  let i = 0;
  while (i < length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      yield { kind: "text", text: html.slice(i) };
      return;
    }
    if (lt > i) yield { kind: "text", text: html.slice(i, lt) };
    const next = html.charCodeAt(lt + 1);
    if (next === 33 /* ! */) {
      const comment = html.startsWith("<!--", lt);
      const end = comment
        ? html.indexOf("-->", lt + 4)
        : html.indexOf(">", lt + 2);
      if (end < 0) return;
      i = end + (comment ? 3 : 1);
      yield SPACE;
      continue;
    }
    const closing = next === 47; /* / */
    const nameStart = lt + (closing ? 2 : 1);
    if (!isAsciiLetter(html.charCodeAt(nameStart))) {
      // A lone « < » (« a < b »): plain text.
      yield { kind: "text", text: "<" };
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf(">", nameStart);
    if (gt < 0) return;
    let nameEnd = nameStart;
    while (nameEnd < gt && isNameChar(html.charCodeAt(nameEnd))) nameEnd++;
    const name = html.slice(nameStart, nameEnd).toLowerCase();
    if (!closing && (name === "script" || name === "style")) {
      const end = rawTextEnd(html, gt + 1, name);
      if (end < 0) return;
      i = end;
      yield SPACE;
      continue;
    }
    yield {
      kind: "tag",
      name,
      closing,
      raw: html.slice(lt, Math.min(gt + 1, lt + MAX_TAG_LENGTH)),
    };
    i = gt + 1;
  }
}

/**
 * Text gathered from successive tokens, spaces collapsed as it comes, capped
 * at MAX_COLLECTED_TEXT characters (a longer text stays longer than any
 * accepted field, so the cap never turns an invalid value into a valid one).
 */
export class TextCollector {
  private readonly parts: string[] = [];
  private length = 0;

  add(text: string): void {
    if (this.length >= MAX_COLLECTED_TEXT) return;
    const piece = text
      .replace(/\s+/g, " ")
      .slice(0, MAX_COLLECTED_TEXT - this.length);
    this.parts.push(piece);
    this.length += piece.length;
  }

  /** Visible text: entities decoded, spaces collapsed, trimmed. */
  text(): string {
    return decodeEntities(this.parts.join("")).replace(/\s+/g, " ").trim();
  }
}

/** Visible text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function htmlText(fragment: string): string {
  const text = new TextCollector();
  for (const token of htmlTokens(fragment)) {
    text.add(token.kind === "text" ? token.text : " ");
  }
  return text.text();
}

/** Value of an attribute in a start tag (quoted or not), entities decoded. */
export function attributeValue(tag: string, name: string): string | null {
  // Bounded input: the regex never runs on more than one capped tag.
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag.slice(0, MAX_TAG_LENGTH));
  if (!match) return null;
  const value = match.slice(1).find((group?: string) => group !== undefined);
  return decodeEntities(value ?? "");
}

/** Text of the `<title>`, or null. */
export function pageTitle(html: string): string | null {
  let title: TextCollector | null = null;
  for (const token of htmlTokens(html)) {
    if (token.kind === "text") {
      title?.add(token.text);
    } else if (token.name === "title") {
      if (!token.closing) {
        title = new TextCollector();
      } else if (title) {
        return title.text() || null;
      }
    } else {
      title?.add(" ");
    }
  }
  return null;
}
