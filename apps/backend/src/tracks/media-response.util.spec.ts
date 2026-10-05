import { validateHeaderValue } from "http";
import {
  buildContentDisposition,
  contentTypeForFilename,
  isFlatMediaFilename,
  parseByteRange,
} from "./media-response.util";

const REAL_TRACK = "04-JIVE ｜ Dj Ice - Blinding Lights (39 MPM)";

describe("media-response.util", () => {
  describe("contentTypeForFilename", () => {
    it.each([
      ["a.mp3", "audio/mpeg"],
      ["a.MP3", "audio/mpeg"],
      ["a.m4a", "audio/mp4"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
      ["a.pdf", "application/octet-stream"],
      ["noext", "application/octet-stream"],
    ])("%s -> %s", (name, type) => {
      expect(contentTypeForFilename(name)).toBe(type);
    });
  });

  describe("isFlatMediaFilename", () => {
    it.each([`${REAL_TRACK}.mp3`, `${REAL_TRACK}.jpg`, "x.webp", "x.PNG"])(
      "accepts %s",
      (name) => {
        expect(isFlatMediaFilename(name)).toBe(true);
      },
    );

    it.each([
      "",
      "../secret.mp3",
      "..",
      "certificates/scan.jpg",
      "renewal/doc.png",
      "a\\b.mp3",
      ".hidden.mp3",
      "doc.pdf",
      "certificates",
      "tts_cache",
      "evil\u0000.mp3",
      "line\nbreak.mp3",
      `${"a".repeat(600)}.mp3`,
    ])("rejects %j", (name) => {
      expect(isFlatMediaFilename(name)).toBe(false);
    });
  });

  describe("buildContentDisposition", () => {
    it("produces a header value Node accepts for a non-ASCII track name", () => {
      const value = buildContentDisposition(`${REAL_TRACK}.mp3`);
      expect(() =>
        validateHeaderValue("Content-Disposition", value),
      ).not.toThrow();
      expect(value).toBe(
        `attachment; filename="04-JIVE _ Dj Ice - Blinding Lights (39 MPM).mp3"; ` +
          `filename*=UTF-8''04-JIVE%20%EF%BD%9C%20Dj%20Ice%20-%20Blinding%20Lights%20%2839%20MPM%29.mp3`,
      );
    });

    it("strips quotes and backslashes from the ASCII fallback", () => {
      expect(buildContentDisposition('a"b\\c.mp3', "inline")).toBe(
        `inline; filename="a_b_c.mp3"; filename*=UTF-8''a%22b%5Cc.mp3`,
      );
    });

    it("falls back to a placeholder name for an empty input", () => {
      expect(buildContentDisposition("")).toBe(
        `attachment; filename="file"; filename*=UTF-8''`,
      );
    });
  });

  describe("parseByteRange", () => {
    it("returns full when no header", () => {
      expect(parseByteRange(undefined, 100)).toEqual({ kind: "full" });
    });

    it.each(["bytes=-", "items=0-1", "bytes=0-1,5-9", "garbage"])(
      "returns full for unsupported header %s",
      (h) => {
        expect(parseByteRange(h, 100)).toEqual({ kind: "full" });
      },
    );

    it("parses a closed range", () => {
      expect(parseByteRange("bytes=0-1", 100)).toEqual({
        kind: "partial",
        start: 0,
        end: 1,
      });
    });

    it("parses an open-ended range", () => {
      expect(parseByteRange("bytes=10-", 100)).toEqual({
        kind: "partial",
        start: 10,
        end: 99,
      });
    });

    it("clamps the end to the resource size", () => {
      expect(parseByteRange("bytes=90-500", 100)).toEqual({
        kind: "partial",
        start: 90,
        end: 99,
      });
    });

    it("parses a suffix range", () => {
      expect(parseByteRange("bytes=-10", 100)).toEqual({
        kind: "partial",
        start: 90,
        end: 99,
      });
      expect(parseByteRange("bytes=-500", 100)).toEqual({
        kind: "partial",
        start: 0,
        end: 99,
      });
    });

    it.each([
      ["bytes=100-", 100],
      ["bytes=50-10", 100],
      ["bytes=-0", 100],
      ["bytes=-5", 0],
    ])("flags %s on size %d as unsatisfiable", (h, size) => {
      expect(parseByteRange(h, size)).toEqual({ kind: "unsatisfiable" });
    });
  });
});
