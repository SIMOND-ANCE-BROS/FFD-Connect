/**
 * Track uploads are recognised by their first bytes, never by the client's
 * file name or declared type.
 */

/** MP3: an ID3v2 tag, or an MPEG audio frame header (Layer I–III). */
export function isMp3(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  // "ID3"
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33)
    return true;
  if (buffer.length < 4) return false;
  const sync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  const version = (buffer[1] >> 3) & 0x03; // 01 = reserved
  const layer = (buffer[1] >> 1) & 0x03; // 00 = reserved (ADTS AAC uses it)
  const bitrate = (buffer[2] >> 4) & 0x0f; // 1111 = forbidden
  return sync && version !== 0x01 && layer !== 0x00 && bitrate !== 0x0f;
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
