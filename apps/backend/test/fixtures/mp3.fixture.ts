/** An ID3v2.3 tag header with an empty body (size 0, no flags). */
export const ID3_EMPTY_TAG = Buffer.from([
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** An MPEG-1 Layer III frame header (128 kbps, 44.1 kHz, no padding). */
export const MPEG_FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

/** Length of a frame with that header: floor(144 × 128000 / 44100) bytes. */
export const MPEG_FRAME_BYTES = 417;

/** A frame of `length` bytes: `header`, then a zero body. */
export const mpegFrame = (
  header: Buffer = MPEG_FRAME_HEADER,
  length = MPEG_FRAME_BYTES,
): Buffer => Buffer.concat([header, Buffer.alloc(length - header.length)]);

/** Two consecutive frames: what `isMp3` needs to see to recognise audio. */
export const TWO_MPEG_FRAMES = Buffer.concat([mpegFrame(), mpegFrame()]);

/**
 * Smallest buffer `isMp3` accepts the way a real file starts: an ID3 tag
 * immediately followed by two MPEG frames, then `payload` (to vary the hash).
 */
export const mp3Bytes = (payload: Buffer | string = ""): Buffer =>
  Buffer.concat([
    ID3_EMPTY_TAG,
    TWO_MPEG_FRAMES,
    typeof payload === "string" ? Buffer.from(payload) : payload,
  ]);
