/** An ID3v2.3 tag header with an empty body (size 0, no flags). */
export const ID3_EMPTY_TAG = Buffer.from([
  0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** An MPEG-1 Layer III frame header (128 kbps, 44.1 kHz). */
export const MPEG_FRAME_HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x64]);

/**
 * Smallest buffer `isMp3` accepts the way a real file starts: an ID3 tag
 * immediately followed by an MPEG frame, then `payload` (to vary the hash).
 */
export const mp3Bytes = (payload: Buffer | string = ""): Buffer =>
  Buffer.concat([
    ID3_EMPTY_TAG,
    MPEG_FRAME_HEADER,
    typeof payload === "string" ? Buffer.from(payload) : payload,
  ]);
