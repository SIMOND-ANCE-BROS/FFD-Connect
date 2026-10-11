import {
  ID3_EMPTY_TAG,
  MPEG_FRAME_HEADER,
  TWO_MPEG_FRAMES,
  mp3Bytes,
  mpegFrame,
} from "../../test/fixtures/mp3.fixture";
import {
  MP3_FRAME_SCAN_BYTES,
  artworkExtension,
  isMp3,
  mpegFrameLength,
} from "./track-file-signature.util";

const bytes = (...values: number[]) => Buffer.from(values);

/** ID3v2 header: "ID3", version, revision, flags, synchsafe size (4 bytes). */
const id3Header = (size: number[], flags = 0x00, version = 0x03) =>
  bytes(0x49, 0x44, 0x33, version, 0x00, flags, ...size);

/** Synchsafe encoding of a tag size (7 bits per byte). */
const synchsafe = (size: number) => [
  (size >> 21) & 0x7f,
  (size >> 14) & 0x7f,
  (size >> 7) & 0x7f,
  size & 0x7f,
];

/** A full ID3v2.3 tag whose body is `body` zero bytes. */
const id3Tag = (body: number) =>
  Buffer.concat([id3Header(synchsafe(body)), Buffer.alloc(body)]);

/** Deterministic non-audio bytes (no 0xFF, hence no frame sync). */
const junk = (length: number) =>
  Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) % 0xfe));

const twoFrames = (header: number[], length: number) =>
  Buffer.concat([
    mpegFrame(Buffer.from(header), length),
    mpegFrame(Buffer.from(header), length),
  ]);

describe("track file signatures", () => {
  describe("mpegFrameLength", () => {
    it.each([
      ["MPEG-1 Layer III 128 kbps 44.1 kHz", [0xff, 0xfb, 0x90, 0x64], 417],
      [
        "MPEG-1 Layer III 128 kbps 44.1 kHz, padded",
        [0xff, 0xfb, 0x92, 0x64],
        418,
      ],
      ["MPEG-1 Layer II 160 kbps 48 kHz", [0xff, 0xfd, 0x94, 0x00], 480],
      ["MPEG-1 Layer I 32 kbps 44.1 kHz", [0xff, 0xff, 0x10, 0x00], 32],
      ["MPEG-1 Layer I 32 kbps 44.1 kHz, padded", [0xff, 0xff, 0x12, 0x00], 36],
      ["MPEG-2 Layer III 32 kbps 16 kHz", [0xff, 0xf3, 0x48, 0xc4], 144],
      ["MPEG-2 Layer II 64 kbps 24 kHz", [0xff, 0xf5, 0x84, 0x00], 384],
      ["MPEG-2 Layer I 32 kbps 22.05 kHz", [0xff, 0xf7, 0x10, 0x00], 68],
      ["MPEG-2.5 Layer III 64 kbps 8 kHz", [0xff, 0xe3, 0x88, 0x00], 576],
    ])("measures %s", (_label, header, length) => {
      expect(mpegFrameLength(Buffer.from(header), 0)).toBe(length);
    });

    it.each([
      ["a free-format bitrate", [0xff, 0xfb, 0x00, 0x64]],
      ["the forbidden bitrate", [0xff, 0xfb, 0xf0, 0x64]],
      ["the reserved sample rate", [0xff, 0xfb, 0x9c, 0x64]],
      ["the reserved version", [0xff, 0xeb, 0x90, 0x64]],
      ["the reserved layer", [0xff, 0xf9, 0x90, 0x64]],
      ["no sync", [0xfe, 0xfb, 0x90, 0x64]],
      ["a header cut short", [0xff, 0xfb, 0x90]],
    ])("has no length with %s", (_label, header) => {
      expect(mpegFrameLength(Buffer.from(header), 0)).toBeNull();
    });
  });

  it.each([
    ["an ID3v2 tag followed by two MPEG frames", mp3Bytes("payload")],
    [
      "an ID3v2.4 tag with 20 bytes of body, then frames",
      Buffer.concat([
        id3Header([0, 0, 0, 20], 0x00, 0x04),
        Buffer.alloc(20),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "a tag whose synchsafe size spans two bytes (130 = 0x01 0x02)",
      Buffer.concat([
        id3Header([0, 0, 0x01, 0x02]),
        Buffer.alloc(130),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "a v2.4 tag with a footer (10 more bytes), then frames",
      Buffer.concat([
        id3Header([0, 0, 0, 0], 0x10, 0x04),
        Buffer.from("3DI\u0004\u0000\u0010\u0000\u0000\u0000\u0000"),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "a v2.3 tag with the footer bit set (no footer in v2.3), then frames",
      Buffer.concat([id3Header([0, 0, 0, 0], 0x10, 0x03), TWO_MPEG_FRAMES]),
    ],
    [
      "zero padding written past the declared tag size",
      Buffer.concat([id3Tag(64), Buffer.alloc(2048), TWO_MPEG_FRAMES]),
    ],
    [
      "two stacked ID3v2 tags",
      Buffer.concat([id3Tag(32), id3Tag(16), TWO_MPEG_FRAMES]),
    ],
    [
      "junk between the tag and two valid frames",
      Buffer.concat([id3Tag(8), junk(1000), TWO_MPEG_FRAMES]),
    ],
    [
      "junk then two valid frames, without a tag",
      Buffer.concat([junk(500), TWO_MPEG_FRAMES]),
    ],
    [
      "a stray header in the padding, then the real frames",
      Buffer.concat([
        ID3_EMPTY_TAG,
        MPEG_FRAME_HEADER,
        junk(100),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "frames starting at the last offset of the scan window",
      Buffer.concat([
        ID3_EMPTY_TAG,
        Buffer.alloc(MP3_FRAME_SCAN_BYTES),
        TWO_MPEG_FRAMES,
      ]),
    ],
    ["two MPEG-1 Layer III frames", TWO_MPEG_FRAMES],
    ["two MPEG-2 Layer III frames", twoFrames([0xff, 0xf3, 0x48, 0xc4], 144)],
    ["two MPEG-2.5 Layer III frames", twoFrames([0xff, 0xe3, 0x88, 0x00], 576)],
    ["two MPEG-1 Layer II frames", twoFrames([0xff, 0xfd, 0x94, 0x00], 480)],
  ])("recognises %s as MP3", (_label, buffer) => {
    expect(isMp3(buffer)).toBe(true);
  });

  it.each([
    ["a WAV file", Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ")],
    [
      "ID3 followed by WAV bytes",
      Buffer.from("ID3RIFF\u0000\u0000\u0000\u0000WAVEfmt "),
    ],
    [
      "ID3 followed by garbage",
      Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 1)]),
    ],
    [
      "a valid empty tag followed by garbage instead of a frame",
      Buffer.concat([ID3_EMPTY_TAG, Buffer.from("not an mpeg frame")]),
    ],
    [
      "a valid tag followed by a WAV file",
      Buffer.concat([
        ID3_EMPTY_TAG,
        Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVE"),
        junk(4000),
      ]),
    ],
    [
      "a single stray header followed by garbage",
      Buffer.concat([ID3_EMPTY_TAG, mpegFrame(), junk(2000)]),
    ],
    [
      "a single stray header without a tag",
      Buffer.concat([mpegFrame(), junk(2000)]),
    ],
    [
      "a second header one byte off the computed frame length",
      Buffer.concat([mpegFrame(MPEG_FRAME_HEADER, 418), mpegFrame()]),
    ],
    [
      "a tag with no frame at all within 8 KB",
      Buffer.concat([
        ID3_EMPTY_TAG,
        Buffer.alloc(MP3_FRAME_SCAN_BYTES + 1),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "five stacked tags (more than the four walked)",
      Buffer.concat([
        id3Tag(0),
        id3Tag(0),
        id3Tag(0),
        id3Tag(0),
        id3Tag(0),
        Buffer.from("not a frame"),
      ]),
    ],
    ["a bare ID3 header with nothing after it", ID3_EMPTY_TAG],
    ["a short ID3 prefix", Buffer.from("ID3\u0003\u0000")],
    [
      "a tag with version byte 0xFF",
      Buffer.concat([id3Header([0, 0, 0, 0], 0x00, 0xff), TWO_MPEG_FRAMES]),
    ],
    [
      "a tag whose size is not synchsafe",
      Buffer.concat([
        id3Header([0, 0, 0, 0x80]),
        Buffer.alloc(128),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "a second stacked tag whose size is not synchsafe",
      Buffer.concat([
        id3Tag(0),
        id3Header([0, 0, 0, 0x80]),
        Buffer.alloc(128),
        TWO_MPEG_FRAMES,
      ]),
    ],
    [
      "a tag whose size points past the end of the file",
      Buffer.concat([id3Header([0, 0, 0, 0x7f]), MPEG_FRAME_HEADER]),
    ],
    [
      "a frame cut short right after a tag",
      Buffer.concat([ID3_EMPTY_TAG, bytes(0xff, 0xfb, 0x90)]),
    ],
    [
      "a footer flag without the footer's 10 bytes before the frame",
      Buffer.concat([id3Header([0, 0, 0, 0], 0x10, 0x04), MPEG_FRAME_HEADER]),
    ],
    ["an ADTS AAC frame (layer 00)", bytes(0xff, 0xf1, 0x50, 0x80)],
    ["two ADTS AAC frames", twoFrames([0xff, 0xf1, 0x50, 0x80], 417)],
    ["a frame with the reserved MPEG version", bytes(0xff, 0xeb, 0x90, 0x64)],
    ["a frame with the forbidden bitrate", bytes(0xff, 0xfb, 0xf0, 0x64)],
    ["a lone MPEG-1 Layer III header", MPEG_FRAME_HEADER],
    ["a PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["an empty file", Buffer.alloc(0)],
    ["a two-byte file", bytes(0xff, 0xfb)],
  ])("refuses %s", (_label, buffer) => {
    expect(isMp3(buffer)).toBe(false);
  });

  it("names the artwork after its content", () => {
    expect(artworkExtension(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe(
      "jpg",
    );
    expect(
      artworkExtension(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00),
      ),
    ).toBe("png");
    expect(artworkExtension(Buffer.from("GIF89a"))).toBeNull();
    expect(artworkExtension(Buffer.from("ID3"))).toBeNull();
    expect(artworkExtension(bytes(0x89, 0x50, 0x4e))).toBeNull();
  });
});
