import { getWebSocketCorsOrigins } from "./cors.config";

describe("getWebSocketCorsOrigins", () => {
  const original = process.env.CORS_ORIGINS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CORS_ORIGINS;
    } else {
      process.env.CORS_ORIGINS = original;
    }
  });

  it("splits CORS_ORIGINS on commas when set", () => {
    process.env.CORS_ORIGINS = "https://app.ffd.fr,https://staging.ffd.fr";
    expect(getWebSocketCorsOrigins()).toEqual([
      "https://app.ffd.fr",
      "https://staging.ffd.fr",
    ]);
  });

  it("falls back to the Metro dev origin when CORS_ORIGINS is unset", () => {
    delete process.env.CORS_ORIGINS;
    expect(getWebSocketCorsOrigins()).toEqual(["http://localhost:8081"]);
  });
});
