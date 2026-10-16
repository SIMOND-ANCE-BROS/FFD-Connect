import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import {
  erasedLicenceFingerprint,
  resultsPseudonym,
  resultsPseudonymisationKey,
} from "./results-pseudonym";

const configOf = (values: Record<string, string | undefined>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;

const KEY = "a-results-pseudonymisation-key-of-32+chars";

describe("results pseudonymisation (#652)", () => {
  it("uses the configured key, trimmed, when it has at least 32 characters", () => {
    expect(
      resultsPseudonymisationKey(
        configOf({
          RESULTS_PSEUDONYMISATION_KEY: `  ${KEY}  `,
          NODE_ENV: "production",
        }),
      ),
    ).toBe(KEY);
  });

  it("has no key in production without a usable one (the import is then refused)", () => {
    expect(
      resultsPseudonymisationKey(configOf({ NODE_ENV: "production" })),
    ).toBeNull();
    expect(
      resultsPseudonymisationKey(
        configOf({
          NODE_ENV: "production",
          RESULTS_PSEUDONYMISATION_KEY: "too-short",
        }),
      ),
    ).toBeNull();
  });

  it("falls back to a fixed development key outside production", () => {
    const dev = resultsPseudonymisationKey(configOf({ NODE_ENV: "test" }));
    expect(dev).toEqual(expect.any(String));
    expect(resultsPseudonymisationKey(configOf({}))).toBe(dev);
  });

  it("is an HMAC-SHA-256 of the value with the key", () => {
    expect(resultsPseudonym(KEY, "x")).toBe(
      createHmac("sha256", KEY).update("x").digest("hex"),
    );
  });

  it("fingerprints a licence number case-insensitively, never in clear", () => {
    const fingerprint = erasedLicenceFingerprint(KEY, "ab123");
    expect(fingerprint).toBe(erasedLicenceFingerprint(KEY, "AB123"));
    expect(fingerprint).not.toContain("123");
    expect(fingerprint).not.toBe(erasedLicenceFingerprint(`${KEY}!`, "AB123"));
  });
});
