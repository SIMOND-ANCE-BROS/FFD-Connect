/** Builds ID3v2 tags byte by byte, for the ID3 reader and import page tests. */
const latin1 = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

const syncsafe = (size: number): number[] => [
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
];

const uint32 = (size: number): number[] => [
  (size >>> 24) & 0xff,
  (size >> 16) & 0xff,
  (size >> 8) & 0xff,
  size & 0xff,
];

export function id3Frame(id: string, body: number[], version: 3 | 4 = 3): number[] {
  return [
    ...latin1(id),
    ...(version === 4 ? syncsafe(body.length) : uint32(body.length)),
    0,
    0,
    ...body,
  ];
}

/** ISO-8859-1 text frame (encoding 0). */
export const textFrame = (id: string, value: string, version: 3 | 4 = 3): number[] =>
  id3Frame(id, [0, ...latin1(value)], version);

/** UTF-16 text frame with a little-endian BOM (encoding 1), what ffmpeg writes for accents. */
export function utf16Frame(id: string, value: string): number[] {
  const body = [1, 0xff, 0xfe];
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    body.push(unit & 0xff, unit >> 8);
  }
  return id3Frame(id, body);
}

/** UTF-8 text frame (encoding 3, ID3v2.4 only). */
export const utf8Frame = (id: string, value: string): number[] =>
  id3Frame(id, [3, ...new TextEncoder().encode(value)], 4);

export const pictureFrame = (
  mime: string,
  data: number[],
  type = 3,
  version: 3 | 4 = 3,
): number[] =>
  id3Frame('APIC', [0, ...latin1(mime), 0, type, ...latin1('cover'), 0, ...data], version);

/** An MP3: an ID3v2 tag (16 bytes of padding) then one MPEG frame header. */
export function mp3Bytes(
  frames: number[][],
  version: 3 | 4 = 3,
  salt = '',
): Uint8Array<ArrayBuffer> {
  const body = [...frames.flat(), ...new Array<number>(16).fill(0)];
  return Uint8Array.from([
    0x49,
    0x44,
    0x33,
    version,
    0,
    0,
    ...syncsafe(body.length),
    ...body,
    0xff,
    0xfb,
    0x90,
    0x64,
    ...latin1(salt),
  ]);
}

export const mp3File = (name: string, bytes: Uint8Array<ArrayBuffer>): File =>
  new File([bytes], name, { type: 'audio/mpeg' });

export const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
