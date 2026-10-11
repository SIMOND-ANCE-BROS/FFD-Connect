import { readBytes } from './files';

/**
 * Minimal ID3v2.3 / v2.4 reader for the import page: title (TIT2), artist
 * (TPE1), genre (TCON, the dance in track-prep files) and the front cover
 * (APIC). In-house rather than a tag library: five frames, no dependency.
 * Anything it cannot read is simply absent; the file name takes over.
 */
export interface Id3Picture {
  mime: string;
  /** ID3 picture type: 3 = front cover. */
  type: number;
  data: Uint8Array<ArrayBuffer>;
}

export interface Id3Tags {
  title?: string;
  artist?: string;
  genre?: string;
  picture?: Id3Picture;
}

/** Bigger tags are not read: a cover is at most a few hundred KB. */
export const ID3_MAX_TAG_BYTES = 4 * 1024 * 1024;

const FRONT_COVER = 3;

const syncsafe = (b: Uint8Array, at: number): number =>
  ((b[at] & 0x7f) << 21) |
  ((b[at + 1] & 0x7f) << 14) |
  ((b[at + 2] & 0x7f) << 7) |
  (b[at + 3] & 0x7f);

const uint32 = (b: Uint8Array, at: number): number =>
  b[at] * 0x1000000 + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function utf16(bytes: Uint8Array, bigEndian: boolean): string {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(
      bigEndian ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8),
    );
  }
  return text;
}

/** Text of a frame body; v2.4 may hold several NUL-separated values: the first is kept. */
function decodeText(encoding: number, bytes: Uint8Array): string {
  let text: string;
  if (encoding === 0) {
    text = latin1(bytes);
  } else if (encoding === 1) {
    const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
    const bom = bigEndian || (bytes[0] === 0xff && bytes[1] === 0xfe);
    text = utf16(bom ? bytes.subarray(2) : bytes, bigEndian);
  } else if (encoding === 2) {
    text = utf16(bytes, true);
  } else {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return text.split('\u0000')[0].trim();
}

/** Undoes unsynchronisation: every 0xFF 0x00 becomes 0xFF. */
function resync(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 1) {
    out.push(data[i]);
    if (data[i] === 0xff && data[i + 1] === 0x00) i += 1;
  }
  return Uint8Array.from(out);
}

/** APIC: encoding, MIME (Latin-1, NUL), picture type, description (NUL), data. */
function readPicture(body: Uint8Array<ArrayBuffer>): Id3Picture | null {
  const encoding = body[0];
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 0) return null;
  let mime = latin1(body.subarray(1, mimeEnd)).toLowerCase();
  if (mime === 'jpg') mime = 'image/jpeg';
  if (mime === 'png') mime = 'image/png';
  const type = body[mimeEnd + 1];
  let at = mimeEnd + 2;
  if (encoding === 1 || encoding === 2) {
    while (at + 1 < body.length && !(body[at] === 0 && body[at + 1] === 0)) at += 2;
    at += 2;
  } else {
    while (at < body.length && body[at] !== 0) at += 1;
    at += 1;
  }
  return at < body.length ? { mime, type, data: body.slice(at) } : null;
}

function readFrame(id: string, body: Uint8Array<ArrayBuffer>, tags: Id3Tags): void {
  if (body.length < 2) return;
  const text = () => decodeText(body[0], body.subarray(1)) || undefined;
  if (id === 'TIT2') tags.title ??= text();
  else if (id === 'TPE1') tags.artist ??= text();
  else if (id === 'TCON') tags.genre ??= text()?.replace(/^\(\d+\)\s*/, '') || undefined;
  else if (id === 'APIC') {
    const picture = readPicture(body);
    if (
      picture &&
      (!tags.picture || (picture.type === FRONT_COVER && tags.picture.type !== FRONT_COVER))
    ) {
      tags.picture = picture;
    }
  }
}

const frameIdAt = (tag: Uint8Array, at: number): string =>
  String.fromCharCode(tag[at], tag[at + 1], tag[at + 2], tag[at + 3]);

const FRAME_ID = /^[A-Z0-9]{4}$/;

/** End of the tag, padding, or the start of another frame. */
const isBoundary = (tag: Uint8Array, at: number): boolean =>
  at === tag.length ||
  (at < tag.length && tag[at] === 0) ||
  (at + 4 <= tag.length && FRAME_ID.test(frameIdAt(tag, at)));

/**
 * Size of the frame at `at`. Some taggers write v2.4 sizes as plain integers:
 * the plain size wins when the syncsafe one is invalid (a byte over 0x7F) or
 * lands off a frame boundary while the plain one lands on it.
 */
function frameSize(tag: Uint8Array, at: number, major: number): number {
  const plain = uint32(tag, at + 4);
  if (major !== 4) return plain;
  const safe = syncsafe(tag, at + 4);
  if (safe === plain) return safe;
  const invalid = (tag[at + 4] | tag[at + 5] | tag[at + 6] | tag[at + 7]) & 0x80;
  if (invalid || (!isBoundary(tag, at + 10 + safe) && isBoundary(tag, at + 10 + plain))) {
    return plain;
  }
  return safe;
}

async function parseTag(file: Blob): Promise<Id3Tags | null> {
  const header = await readBytes(file.slice(0, 10));
  if (header.length < 10 || header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) {
    return null;
  }
  const major = header[3];
  if (major !== 3 && major !== 4) return null;
  const flags = header[5];
  const size = syncsafe(header, 6);
  if (size > ID3_MAX_TAG_BYTES) return null;
  let tag = await readBytes(file.slice(10, 10 + size));
  // v2.3 unsynchronises the whole tag; v2.4 flags it frame by frame.
  if (major === 3 && flags & 0x80) tag = resync(tag);
  let at = 0;
  if (flags & 0x40) at = major === 4 ? syncsafe(tag, 0) : uint32(tag, 0) + 4;
  const tags: Id3Tags = {};
  while (at + 10 <= tag.length) {
    const id = frameIdAt(tag, at);
    if (!FRAME_ID.test(id)) break; // padding
    const formatFlags = tag[at + 9];
    const start = at + 10;
    const end = start + frameSize(tag, at, major);
    if (end > tag.length) break;
    at = end;
    if (end === start) continue; // empty frame
    let body = tag.subarray(start, end);
    if (major === 4) {
      if (formatFlags & 0x0c) continue; // compressed or encrypted
      if (formatFlags & 0x40) body = body.subarray(1); // group id
      if (formatFlags & 0x01) body = body.subarray(4); // data length indicator
      if (formatFlags & 0x02) body = resync(body);
    } else {
      if (formatFlags & 0xc0) continue; // compressed or encrypted
      if (formatFlags & 0x20) body = body.subarray(1); // group id
    }
    readFrame(id, body, tags);
  }
  return tags;
}

/**
 * Tags of an MP3, or null when it has no readable ID3v2.3 / v2.4 tag. Never
 * rejects: the tags only pre-fill the table, an unreadable one never blocks a file.
 */
export async function readId3(file: Blob): Promise<Id3Tags | null> {
  try {
    return await parseTag(file);
  } catch {
    return null;
  }
}
