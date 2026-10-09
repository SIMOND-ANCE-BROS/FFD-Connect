import {
  ID3_EMPTY_TAG,
  MPEG_FRAME_HEADER,
  mp3Bytes,
} from "../../test/fixtures/mp3.fixture";
import { artworkExtension, isMp3 } from "./track-file-signature.util";

const bytes = (...values: number[]) => Buffer.from(values);

/** ID3v2 header: "ID3", version, revision, flags, synchsafe size (4 bytes). */
const id3Header = (size: number[], flags = 0x00, version = 0x03) =>
  bytes(0x49, 0x44, 0x33, version, 0x00, flags, ...size);

describe("track file signatures", () => {
  it.each([
    ["an ID3v2 tag followed by an MPEG frame", mp3Bytes("payload")],
    [
      "an ID3v2.4 tag with 20 bytes of body, then a frame",
      Buffer.concat([
        id3Header([0, 0, 0, 20], 0x00, 0x04),
        Buffer.alloc(20),
        MPEG_FRAME_HEADER,
      ]),
    ],
    [
      "a tag whose synchsafe size spans two bytes (130 = 0x01 0x02)",
      Buffer.concat([
        id3Header([0, 0, 0x01, 0x02]),
        Buffer.alloc(130),
        MPEG_FRAME_HEADER,
      ]),
    ],
    [
      "a tag with a footer (10 more bytes), then a frame",
      Buffer.concat([
        id3Header([0, 0, 0, 0], 0x10, 0x04),
        Buffer.from("3DI\u0004\u0000\u0010\u0000\u0000\u0000\u0000"),
        MPEG_FRAME_HEADER,
      ]),
    ],
    ["an MPEG-1 Layer III frame", bytes(0xff, 0xfb, 0x90, 0x64)],
    ["an MPEG-2 Layer III frame", bytes(0xff, 0xf3, 0x48, 0xc4)],
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
      ]),
    ],
    ["a bare ID3 header with nothing after it", ID3_EMPTY_TAG],
    ["a short ID3 prefix", Buffer.from("ID3\u0003\u0000")],
    [
      "a tag with version byte 0xFF",
      Buffer.concat([id3Header([0, 0, 0, 0], 0x00, 0xff), MPEG_FRAME_HEADER]),
    ],
    [
      "a tag whose size is not synchsafe",
      Buffer.concat([
        id3Header([0, 0, 0, 0x80]),
        Buffer.alloc(128),
        MPEG_FRAME_HEADER,
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
    ["a frame with the reserved MPEG version", bytes(0xff, 0xeb, 0x90, 0x64)],
    ["a frame with the forbidden bitrate", bytes(0xff, 0xfb, 0xf0, 0x64)],
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
