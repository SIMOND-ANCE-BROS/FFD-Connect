/**
 * Track uploads are recognised by their first bytes, never by the client's
 * file name or declared type.
 */

const ID3_HEADER_BYTES = 10;
const ID3_FOOTER_FLAG = 0x10;
/** Stacked ID3v2 tags walked before looking for audio. */
const ID3_MAX_STACKED_TAGS = 4;
const MPEG_FRAME_HEADER_BYTES = 4;
/** How far past the tags (or the start of the file) the first frame may sit. */
export const MP3_FRAME_SCAN_BYTES = 8 * 1024;

/** Bitrates in kbps, indexed by the header's 4-bit field (0 = free format). */
const BITRATES_MPEG1 = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
} as const;
/** MPEG-2 and MPEG-2.5 share their bitrate tables; Layers II and III too. */
const BITRATES_MPEG2 = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;

/** Sample rates in Hz by version bits (00 = 2.5, 10 = 2, 11 = 1). */
const SAMPLE_RATES: Record<number, readonly [number, number, number]> = {
  0b00: [11025, 12000, 8000],
  0b10: [22050, 24000, 16000],
  0b11: [44100, 48000, 32000],
};

/**
 * Length in bytes (padding included) of the MPEG audio frame whose header
 * starts at `offset`, or null when no valid header is there (no sync,
 * reserved version / layer / sample rate, free-format or forbidden bitrate,
 * header past the end of the buffer).
 */
export function mpegFrameLength(buffer: Buffer, offset: number): number | null {
  if (offset < 0 || offset + MPEG_FRAME_HEADER_BYTES > buffer.length) {
    return null;
  }
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  if (buffer[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0x03; // 01 = reserved
  const layerBits = (b1 >> 1) & 0x03; // 00 = reserved (ADTS AAC uses it)
  const bitrateIndex = (b2 >> 4) & 0x0f; // 0 = free format, 1111 = forbidden
  const sampleRateIndex = (b2 >> 2) & 0x03; // 11 = reserved
  const padding = (b2 >> 1) & 0x01;
  if (versionBits === 0b01 || layerBits === 0b00) return null;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 3) {
    return null;
  }
  const layer = (4 - layerBits) as 1 | 2 | 3; // 11 = I, 10 = II, 01 = III
  const mpeg1 = versionBits === 0b11;
  const bitrate =
    (mpeg1 ? BITRATES_MPEG1 : BITRATES_MPEG2)[layer][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[versionBits][sampleRateIndex];
  if (layer === 1) {
    return (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  }
  // Layer III of MPEG-2 / 2.5 carries half as many samples per frame.
  const coefficient = layer === 3 && !mpeg1 ? 72 : 144;
  return Math.floor((coefficient * bitrate) / sampleRate) + padding;
}

/**
 * Audio starts at `offset` when two consecutive valid frame headers are
 * there: one 4-byte match alone happens by chance in random data. The second
 * frame has the same version, layer and sample rate.
 */
function startsAudio(buffer: Buffer, offset: number): boolean {
  const length = mpegFrameLength(buffer, offset);
  if (length === null) return false;
  const next = offset + length;
  return (
    mpegFrameLength(buffer, next) !== null &&
    (buffer[next + 1] & 0xfe) === (buffer[offset + 1] & 0xfe) &&
    (buffer[next + 2] & 0x0c) === (buffer[offset + 2] & 0x0c)
  );
}

const isId3At = (buffer: Buffer, offset: number): boolean =>
  offset + 3 <= buffer.length &&
  buffer[offset] === 0x49 && // "I"
  buffer[offset + 1] === 0x44 && // "D"
  buffer[offset + 2] === 0x33; // "3"

/**
 * End of the ID3v2 tag at `offset` ("ID3", version, revision, flags, 4-byte
 * synchsafe size, then a 10-byte footer when a v2.4 tag says so), or null
 * when its header is malformed.
 */
function id3TagEnd(buffer: Buffer, offset: number): number | null {
  if (offset + ID3_HEADER_BYTES > buffer.length) return null;
  const version = buffer[offset + 3];
  // Version and revision are never 0xFF.
  if (version === 0xff || buffer[offset + 4] === 0xff) return null;
  let size = 0;
  for (let i = 6; i < ID3_HEADER_BYTES; i++) {
    const byte = buffer[offset + i];
    if (byte >= 0x80) return null; // not synchsafe
    size = (size << 7) | byte;
  }
  // The footer exists from ID3v2.4 on; the bit means nothing before.
  const footer =
    version === 4 && buffer[offset + 5] & ID3_FOOTER_FLAG
      ? ID3_HEADER_BYTES
      : 0;
  return offset + ID3_HEADER_BYTES + size + footer;
}

/**
 * MP3: two consecutive MPEG audio frames (Layer I–III) found within
 * MP3_FRAME_SCAN_BYTES after the ID3v2 tags (up to 4 stacked tags, each
 * header validated) or after the start of the file. Padding, junk or a stray
 * sync before the first real frame is tolerated, as players and ffmpeg do;
 * an "ID3" prefix alone is not enough. Every read is bounded by the buffer.
 */
export function isMp3(buffer: Buffer): boolean {
  let start = 0;
  for (
    let tags = 0;
    tags < ID3_MAX_STACKED_TAGS && isId3At(buffer, start);
    tags++
  ) {
    const end = id3TagEnd(buffer, start);
    if (end === null) return false;
    start = end;
  }
  const last = Math.min(
    start + MP3_FRAME_SCAN_BYTES,
    buffer.length - MPEG_FRAME_HEADER_BYTES,
  );
  for (let offset = start; offset <= last; offset++) {
    if (buffer[offset] === 0xff && startsAudio(buffer, offset)) return true;
  }
  return false;
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
