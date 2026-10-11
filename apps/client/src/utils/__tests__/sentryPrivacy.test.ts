import { HttpError } from "../httpInterceptor";
import {
  beforeScreenshot,
  isExpectedServerRefusal,
  isSensitiveScreenShown,
  markSensitiveScreenShown,
} from "../sentryPrivacy";

const refusal = new HttpError(400, "Bad Request", null, "Échec", {
  code: "MEDICAL_UNFIT",
  userMessage: "Certificat refusé",
});

describe("isExpectedServerRefusal (#225)", () => {
  it("is true for an HttpError carrying a server code", () => {
    expect(isExpectedServerRefusal(refusal)).toBe(true);
  });

  it.each([
    ["an uncoded HttpError", new HttpError(500, "Error")],
    [
      "an empty code",
      new HttpError(400, "Bad Request", null, "x", { code: "" }),
    ],
    ["a plain Error", new Error("boom")],
    ["nothing", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isExpectedServerRefusal(error)).toBe(false);
  });
});

describe("beforeScreenshot (#225)", () => {
  it("refuses a screenshot for an expected server refusal", () => {
    expect(beforeScreenshot({}, { originalException: refusal })).toBe(false);
  });

  it("keeps screenshots for real errors and hint-less events", () => {
    expect(
      beforeScreenshot({}, { originalException: new Error("crash") }),
    ).toBe(true);
    expect(beforeScreenshot({}, {})).toBe(true);
  });
});

describe("sensitive screen flag (#242)", () => {
  it("refuses every screenshot while a sensitive screen is shown", () => {
    const release = markSensitiveScreenShown();
    try {
      expect(isSensitiveScreenShown()).toBe(true);
      expect(
        beforeScreenshot({}, { originalException: new Error("crash") }),
      ).toBe(false);
      expect(beforeScreenshot({}, {})).toBe(false);
    } finally {
      release();
    }
    expect(isSensitiveScreenShown()).toBe(false);
    expect(beforeScreenshot({}, {})).toBe(true);
  });

  it("counts overlapping screens and ignores a double release", () => {
    const releaseA = markSensitiveScreenShown();
    const releaseB = markSensitiveScreenShown();

    releaseA();
    releaseA();
    expect(isSensitiveScreenShown()).toBe(true);

    releaseB();
    expect(isSensitiveScreenShown()).toBe(false);
  });
});
