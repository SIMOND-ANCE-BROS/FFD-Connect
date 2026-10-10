import { HttpError } from "../httpInterceptor";
import { beforeScreenshot, isExpectedServerRefusal } from "../sentryPrivacy";

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
