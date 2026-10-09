import { artworkExtension, isMp3 } from "./track-file-signature.util";

const bytes = (...values: number[]) => Buffer.from(values);

describe("track file signatures", () => {
  it.each([
    ["an ID3v2 tag", Buffer.from("ID3\u0003\u0000")],
    ["an MPEG-1 Layer III frame", bytes(0xff, 0xfb, 0x90, 0x64)],
    ["an MPEG-2 Layer III frame", bytes(0xff, 0xf3, 0x48, 0xc4)],
  ])("recognises %s as MP3", (_label, buffer) => {
    expect(isMp3(buffer)).toBe(true);
  });

  it.each([
    ["a WAV file", Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt ")],
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
