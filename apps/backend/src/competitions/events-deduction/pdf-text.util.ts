import { extractText, getDocumentProxy } from "unpdf";

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

/**
 * Extract the text layer of a PDF (free, local — no cloud call). Scanned PDFs
 * have no text layer and return an empty string.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  // Text extraction only: unpdf's serverless pdf.js build (v6) has no font
  // `eval` path and runs no document scripts.
  // verbosity 0 = errors only: real circulars trigger harmless font warnings
  // ("TT: undefined function") that pdf.js prints straight to stdout.
  const pdf = await getDocumentProxy(data, { verbosity: 0 });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
