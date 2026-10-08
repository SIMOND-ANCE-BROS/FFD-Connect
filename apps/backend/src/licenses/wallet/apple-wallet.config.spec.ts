import {
  APPLE_WALLET_ENV,
  loadAppleWalletConfig,
  normalizePem,
  redactPem,
} from "./apple-wallet.config";
import {
  createTestPassCertificates,
  TEST_PASS_TYPE_ID,
  TEST_TEAM_ID,
  testAppleWalletEnv,
} from "./test-certificates.mock";

function load(env: Record<string, string | undefined>, now?: Date) {
  return loadAppleWalletConfig((key) => env[key], now);
}

function reasonOf(env: Record<string, string | undefined>, now?: Date) {
  const result = load(env, now);
  if (result.enabled) throw new Error("expected a disabled config");
  return result.reason;
}

describe("loadAppleWalletConfig", () => {
  // Throwaway RSA keys, generated synchronously with openssl at collection
  // time (outside any test timeout).
  const certs = createTestPassCertificates();

  it("enables the feature with five valid variables", () => {
    const result = load(testAppleWalletEnv(certs));
    expect(result).toEqual({
      enabled: true,
      credentials: {
        passTypeIdentifier: TEST_PASS_TYPE_ID,
        teamIdentifier: TEST_TEAM_ID,
        signerCert: certs.signerCert.trim(),
        signerKey: certs.signerKey.trim(),
        wwdr: certs.wwdr.trim(),
      },
    });
  });

  it("accepts single-line PEMs with literal \\n", () => {
    const env = testAppleWalletEnv(certs);
    env.WALLET_APPLE_PASS_CERT = certs.signerCert.replace(/\n/g, "\\n");
    expect(load(env).enabled).toBe(true);
  });

  it("is 'not configured' when no variable is set", () => {
    expect(load({})).toEqual({
      enabled: false,
      reason: "not configured",
      notConfigured: true,
    });
  });

  it("lists the missing variables by name (blank counts as missing)", () => {
    const env = testAppleWalletEnv(certs);
    delete env.WALLET_APPLE_WWDR_CERT;
    env.WALLET_APPLE_TEAM_ID = "  ";
    expect(load(env)).toEqual({
      enabled: false,
      reason: "missing WALLET_APPLE_WWDR_CERT, WALLET_APPLE_TEAM_ID",
      notConfigured: false,
    });
  });

  it("rejects a malformed Pass Type ID", () => {
    const env = {
      ...testAppleWalletEnv(certs),
      WALLET_APPLE_PASS_TYPE_ID: "x",
    };
    expect(reasonOf(env)).toContain(APPLE_WALLET_ENV.passTypeId);
  });

  it("rejects a malformed Team ID", () => {
    const env = { ...testAppleWalletEnv(certs), WALLET_APPLE_TEAM_ID: "abc" };
    expect(reasonOf(env)).toContain(APPLE_WALLET_ENV.teamId);
  });

  it("rejects an invalid pass certificate without echoing it", () => {
    const env = {
      ...testAppleWalletEnv(certs),
      WALLET_APPLE_PASS_CERT: "-----BEGIN CERTIFICATE-----\nnope",
    };
    const reason = reasonOf(env);
    expect(reason).toBe(
      "WALLET_APPLE_PASS_CERT is not a valid PEM certificate",
    );
    expect(reason).not.toContain("nope");
  });

  it("rejects an invalid WWDR certificate", () => {
    const env = { ...testAppleWalletEnv(certs), WALLET_APPLE_WWDR_CERT: "x" };
    expect(reasonOf(env)).toBe(
      "WALLET_APPLE_WWDR_CERT is not a valid PEM certificate",
    );
  });

  it("rejects an encrypted private key", () => {
    const env = {
      ...testAppleWalletEnv(certs),
      WALLET_APPLE_PASS_KEY: certs.encryptedKey,
    };
    expect(reasonOf(env)).toBe(
      "WALLET_APPLE_PASS_KEY is not a valid unencrypted PEM private key",
    );
  });

  it("rejects a key that does not match the certificate", () => {
    const env = {
      ...testAppleWalletEnv(certs),
      WALLET_APPLE_PASS_KEY: certs.otherKey,
    };
    expect(reasonOf(env)).toBe(
      "WALLET_APPLE_PASS_KEY does not match WALLET_APPLE_PASS_CERT",
    );
  });

  it("rejects an expired pass certificate", () => {
    const inThreeDays = new Date(Date.now() + 3 * 86_400_000);
    expect(reasonOf(testAppleWalletEnv(certs), inThreeDays)).toBe(
      "WALLET_APPLE_PASS_CERT has expired",
    );
  });
});

describe("normalizePem", () => {
  it("turns literal \\n into newlines and trims", () => {
    expect(normalizePem("  a\\nb\n")).toBe("a\nb");
  });
});

describe("redactPem", () => {
  it("removes complete and truncated PEM blocks", () => {
    expect(
      redactPem(
        "x -----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY----- y -----BEGIN CERTIFICATE-----\nBBB",
      ),
    ).toBe("x [PEM redacted] y [PEM redacted]");
  });

  it("leaves other messages untouched", () => {
    expect(redactPem("Invalid certificate(s) loaded")).toBe(
      "Invalid certificate(s) loaded",
    );
  });
});
