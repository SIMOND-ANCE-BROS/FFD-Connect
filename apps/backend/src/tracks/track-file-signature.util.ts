/**
 * Track uploads are recognised by their first bytes, never by the client's
 * file name or declared type.
 */

const ID3_HEADER_BYTES = 10;
const ID3_FOOTER_FLAG = 0x10;
const MPEG_FRAME_HEADER_BYTES = 4;

/** An MPEG audio frame header (Layer I–III) starting at `offset`. */
function isMpegFrameHeader(buffer: Buffer, offset: number): boolean {
  if (offset < 0 || offset + MPEG_FRAME_HEADER_BYTES > buffer.length) {
    return false;
  }
  const b1 = buffer[offset + 1];
  const sync = buffer[offset] === 0xff && (b1 & 0xe0) === 0xe0;
  const version = (b1 >> 3) & 0x03; // 01 = reserved
  const layer = (b1 >> 1) & 0x03; // 00 = reserved (ADTS AAC uses it)
  const bitrate = (buffer[offset + 2] >> 4) & 0x0f; // 1111 = forbidden
  return sync && version !== 0x01 && layer !== 0x00 && bitrate !== 0x0f;
}

/**
 * Offset of the first audio frame after an ID3v2 tag ("ID3", version,
 * revision, flags, 4-byte synchsafe size, optional 10-byte footer), or null
 * when the header is malformed.
 */
function afterId3Tag(buffer: Buffer): number | null {
  if (buffer.length < ID3_HEADER_BYTES) return null;
  // Version and revision are never 0xFF.
  if (buffer[3] === 0xff || buffer[4] === 0xff) return null;
  let size = 0;
  for (let i = 6; i < ID3_HEADER_BYTES; i++) {
    if (buffer[i] >= 0x80) return null; // not synchsafe
    size = (size << 7) | buffer[i];
  }
  const footer = buffer[5] & ID3_FOOTER_FLAG ? ID3_HEADER_BYTES : 0;
  return ID3_HEADER_BYTES + size + footer;
}

/**
 * MP3: an MPEG audio frame header (Layer I–III), possibly behind an ID3v2
 * tag. An "ID3" prefix alone is not enough: the tag header must be valid and
 * an MPEG frame must start right after it. Every read is bounded by the
 * buffer length.
 */
export function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  // "ID3"
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const offset = afterId3Tag(buffer);
    return offset !== null && isMpegFrameHeader(buffer, offset);
  }
  return isMpegFrameHeader(buffer, 0);
}

export type ArtworkExtension = "jpg" | "png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Extension of a JPEG or PNG artwork, or null for anything else. */
export function artworkExtension(buffer: Buffer): ArtworkExtension | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    buffer.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
  ) {
    return "png";
  }
  return null;
}
