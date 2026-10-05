import * as path from "path";

/**
 * Media types served for track files (audio + artwork). The keys double as the
 * allowlist of extensions the `/uploads` blob fallback is willing to serve.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

/** Content-Type inferred from the file extension (case-insensitive). */
export function contentTypeForFilename(filename: string): string {
  return (
    MEDIA_TYPES[path.extname(filename).toLowerCase()] ?? DEFAULT_MEDIA_TYPE
  );
}

/**
 * True when `name` is a single, flat track media file name: no path separator,
 * no `..`, no leading dot, no control character, and an allowlisted media
 * extension. Anything else must never reach blob storage.
 */
export function isFlatMediaFilename(name: string): boolean {
  if (!name || name.length > 512) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return false;
  }
  if (name.startsWith(".")) return false;
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return path.extname(name).toLowerCase() in MEDIA_TYPES;
}

/**
 * RFC 6266 / RFC 5987 Content-Disposition. Node rejects non-Latin-1 header
 * values (ERR_INVALID_CHAR), so the plain `filename` gets an ASCII-only
 * fallback and the real name travels percent-encoded in `filename*`.
 */
export function buildContentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const asciiFallback =
    filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export type ByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parses a `Range` header against a resource of `size` bytes. Only a single
 * `bytes=` range is honoured; a missing, malformed or multi-range header is
 * answered with the full body (allowed by RFC 9110 §14.2).
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return { kind: "full" };

  let start: number;
  let end: number;
  if (startRaw === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(endRaw);
    if (suffix === 0 || size === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  }

  if (start >= size || start > end) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}
