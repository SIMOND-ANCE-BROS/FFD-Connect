import { getDocumentProxy } from "unpdf";

/** Circulars are 2–10 pages: anything beyond is not read. */
export const MAX_PDF_PAGES = 20;
/** Circulars hold 3–12k characters of text: stop reading beyond this. */
export const MAX_PDF_TEXT_LENGTH = 50_000;

/** `%PDF` magic bytes: FFD circulars are PDFs, posters are images. */
export function isPdf(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  );
}

interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

/**
 * Extract the text layer of a PDF (free, local — no cloud call), bounded to
 * the first MAX_PDF_PAGES pages and MAX_PDF_TEXT_LENGTH characters: the
 * document comes from a third party. pdf.js parses pages lazily (on
 * `getPage`), so pages past the cap are never parsed. Scanned PDFs have no text layer and
 * return an empty string. Line breaks follow pdf.js `hasEOL`, like unpdf's
 * own `extractText`.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  // verbosity 0 = errors only: real circulars trigger harmless font warnings
  // ("TT: undefined function") that pdf.js prints straight to stdout.
  // unpdf's serverless pdf.js build (v6) has no font `eval` path and runs no
  // document scripts.
  const pdf = await getDocumentProxy(data, { verbosity: 0 });
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    let text = "";
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items as TextItemLike[]) {
        if (item.str === undefined) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
        // Cut off as soon as the cap is reached: no further item or page is
        // read, and callers never see more than MAX_PDF_TEXT_LENGTH chars.
        if (text.length >= MAX_PDF_TEXT_LENGTH) {
          return text.slice(0, MAX_PDF_TEXT_LENGTH);
        }
      }
      text += "\n";
    }
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
