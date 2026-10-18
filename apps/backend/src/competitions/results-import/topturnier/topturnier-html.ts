import * as iconv from "iconv-lite";

/**
 * Text helpers for the HTML pages of a TopTurnier export (#786). Regex based
 * on purpose: the pages are machine-generated and small (bounded by the
 * caller), and only a handful of elements are read — no DOM, no script, no
 * network. Pure module.
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

/** Visible text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
export function htmlText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Value of an attribute in a start tag (quoted or not), raw. */
export function attributeValue(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  if (!match) return null;
  const value = match.slice(1).find((group?: string) => group !== undefined);
  return decodeEntities(value ?? "");
}

/** Text of the `<title>`, or null. */
export function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = match ? htmlText(match[1]) : "";
  return title || null;
}
