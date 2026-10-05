jest.mock("../../utils/TrackPlayerWrapper", () => ({
  __esModule: true,
  default: {},
  State: {},
}));
jest.mock("../../config", () => ({ BACKEND_URL: "http://test/api/v1" }));
jest.mock("../../utils/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

import TtsService, { arrayBufferToBase64 } from "../TtsService";

const toBuffer = (s: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(0, bytes.length);
};

describe("arrayBufferToBase64", () => {
  // Oracle = Node's Buffer base64 (the encoding expo-file-system expects).
  it.each(["", "M", "Ma", "Man", "hello", "any carnal pleasure."])(
    "matches Buffer base64 for %p",
    (s) => {
      expect(arrayBufferToBase64(toBuffer(s))).toBe(
        Buffer.from(s, "utf8").toString("base64"),
      );
    },
  );

  it("handles raw binary bytes with padding", () => {
    const bytes = new Uint8Array([0, 255, 16, 128, 1, 2]);
    expect(arrayBufferToBase64(bytes.buffer)).toBe(
      Buffer.from(bytes).toString("base64"),
    );
  });

  it("returns empty string for an empty buffer", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });
});

describe("TtsService API surface", () => {
  it("reports init status success", () => {
    expect(TtsService.getInitStatus()).toBe("success");
  });

  it("exposes at least one voice", () => {
    expect(TtsService.voices().length).toBeGreaterThan(0);
  });

  it("no-op setters resolve without throwing", async () => {
    await expect(TtsService.setDefaultVoice("v")).resolves.toBeUndefined();
    await expect(TtsService.setDefaultRate(1)).resolves.toBeUndefined();
    await expect(TtsService.setDefaultPitch(1)).resolves.toBeUndefined();
    await expect(TtsService.setDucking(true)).resolves.toBeUndefined();
    await expect(
      TtsService.setIgnoreSilentSwitch(true),
    ).resolves.toBeUndefined();
  });
});
