import { crc32, inflateRawSync } from "zlib";

/**
 * Minimal, defensive ZIP reader for the TopTurnier export upload (#786).
 *
 * Reads the archive in memory only — nothing is ever written to disk, so an
 * entry name can never escape a directory — and refuses anything an export
 * produced by TopTurnier does not need: encryption, ZIP64, multi-disk
 * archives, compression other than stored/deflate, symbolic links, absolute
 * or `..` paths. Sizes are bounded BEFORE inflating (central directory) and
 * WHILE inflating (`maxOutputLength`), so a zip bomb that lies about its
 * sizes still stops at the limit. Pure function, no dependency.
 */

export interface SafeZipLimits {
  /** Max number of entries (directories included). */
  maxEntries: number;
  /** Max uncompressed size of one file. */
  maxFileBytes: number;
  /** Max uncompressed size of all the files kept. */
  maxTotalBytes: number;
  /** Max compression ratio of one entry (zip-bomb guard). */
  maxRatio: number;
  /**
   * Files to extract; the others (images, stylesheets…) are checked for
   * their path and type only, never inflated nor counted. All by default.
   */
  keep?: (path: string) => boolean;
}

export class SafeZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const HOST_UNIX = 3;

/**
 * Normalised entry path (`/` separators, no leading `./`), or null when the
 * name is unsafe: absolute, drive letter, `..` segment, NUL or control
 * characters.
 */
export function safeEntryPath(name: string): string | null {
  if (/[\u0000-\u001f]/.test(name)) return null;
  const path = name.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return null;
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) return null;
  return segments.join("/");
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const stop = Math.max(
    0,
    buffer.length - EOCD_MIN_LENGTH - MAX_COMMENT_LENGTH,
  );
  for (let i = buffer.length - EOCD_MIN_LENGTH; i >= stop; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new SafeZipError("Archive zip illisible");
}

/**
 * Files of the archive, by normalised path (directories dropped). Throws
 * `SafeZipError` (message in French, shown to the user) on any refusal.
 */
export function readSafeZip(
  buffer: Buffer,
  limits: SafeZipLimits,
): Map<string, Buffer> {
  if (buffer.length < EOCD_MIN_LENGTH) {
    throw new SafeZipError("Archive zip illisible");
  }
  const eocd = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) {
    throw new SafeZipError("Archive zip en plusieurs parties non acceptée");
  }
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    throw new SafeZipError("Archive zip64 non acceptée");
  }
  if (entryCount > limits.maxEntries) {
    throw new SafeZipError(
      `Archive trop volumineuse (${entryCount} fichiers, maximum ${limits.maxEntries})`,
    );
  }
  if (cdOffset + cdSize > eocd) {
    throw new SafeZipError("Archive zip illisible");
  }

  const files = new Map<string, Buffer>();
  let total = 0;
  let cursor = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (
      cursor + 46 > eocd ||
      buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
    ) {
      throw new SafeZipError("Archive zip illisible");
    }
    const hostSystem = buffer.readUInt8(cursor + 5);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const rawName = buffer.toString(
      "utf8",
      cursor + 46,
      cursor + 46 + nameLength,
    );
    cursor += 46 + nameLength + extraLength + commentLength;

    if (flags & FLAG_ENCRYPTED) {
      throw new SafeZipError("Archive chiffrée non acceptée");
    }
    if (size === 0xffffffff || compressedSize === 0xffffffff) {
      throw new SafeZipError("Archive zip64 non acceptée");
    }
    const unixMode = hostSystem === HOST_UNIX ? externalAttributes >>> 16 : 0;
    const fileType = unixMode & S_IFMT;
    if (fileType === S_IFLNK) {
      throw new SafeZipError("Lien symbolique refusé dans l'archive");
    }
    if (fileType !== 0 && fileType !== S_IFREG && fileType !== S_IFDIR) {
      throw new SafeZipError("Fichier spécial refusé dans l'archive");
    }
    const path = safeEntryPath(rawName);
    if (path === null) {
      throw new SafeZipError("Chemin interdit dans l'archive");
    }
    if (rawName.endsWith("/") || fileType === S_IFDIR || path === "") {
      continue;
    }
    if (limits.keep && !limits.keep(path)) continue;
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new SafeZipError("Méthode de compression non acceptée");
    }
    if (size > limits.maxFileBytes) {
      throw new SafeZipError(
        `Fichier trop volumineux dans l'archive (maximum ${limits.maxFileBytes} octets)`,
      );
    }
    if (compressedSize > 0 && size / compressedSize > limits.maxRatio) {
      throw new SafeZipError("Taux de compression suspect : archive refusée");
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new SafeZipError(
        `Archive trop volumineuse une fois décompressée (maximum ${limits.maxTotalBytes} octets)`,
      );
    }
    if (files.has(path)) {
      throw new SafeZipError("Fichier en double dans l'archive");
    }

    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE
    ) {
      throw new SafeZipError("Archive zip illisible");
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) {
      throw new SafeZipError("Archive zip illisible");
    }
    const compressed = buffer.subarray(dataStart, dataEnd);
    let content: Buffer;
    if (method === METHOD_STORED) {
      if (compressedSize !== size) {
        throw new SafeZipError("Archive zip illisible");
      }
      content = Buffer.from(compressed);
    } else {
      try {
        // Stops at the declared size + 1: a lying header cannot inflate more.
        content = inflateRawSync(compressed, { maxOutputLength: size + 1 });
      } catch {
        throw new SafeZipError("Archive zip illisible");
      }
    }
    if (content.length !== size || crc32(content) !== expectedCrc) {
      throw new SafeZipError("Archive zip corrompue");
    }
    files.set(path, content);
  }
  return files;
}
