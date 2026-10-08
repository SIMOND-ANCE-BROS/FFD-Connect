import { createPrivateKey, KeyObject, X509Certificate } from "crypto";

/**
 * Apple Wallet pass signing configuration (#162).
 *
 * Every value comes from an environment variable (read through ConfigService
 * by the caller). PEM contents are never logged: every failure reason below
 * names the variable, never its value.
 */
export const APPLE_WALLET_ENV = {
  passCert: "WALLET_APPLE_PASS_CERT",
  passKey: "WALLET_APPLE_PASS_KEY",
  wwdrCert: "WALLET_APPLE_WWDR_CERT",
  passTypeId: "WALLET_APPLE_PASS_TYPE_ID",
  teamId: "WALLET_APPLE_TEAM_ID",
} as const;

/** Pass Type ID registered with Apple, e.g. `pass.org.example.license`. */
const PASS_TYPE_ID_PATTERN = /^pass\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

/** Apple Developer Team ID: 10 upper-case alphanumeric characters. */
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;

export interface AppleWalletCredentials {
  passTypeIdentifier: string;
  teamIdentifier: string;
  /** PEM of the pass signing certificate. */
  signerCert: string;
  /** PEM of the (unencrypted) private key of the signing certificate. */
  signerKey: string;
  /** PEM of the Apple WWDR intermediate certificate (G4). */
  wwdr: string;
}

export type AppleWalletConfig =
  | { enabled: true; credentials: AppleWalletCredentials }
  | {
      enabled: false;
      /** Safe to log: names variables, never their values. */
      reason: string;
      /** True when no variable at all is set (feature simply not set up). */
      notConfigured: boolean;
    };

/**
 * Normalises a PEM read from an environment variable: trims it and turns
 * literal `\n` sequences (single-line secrets) into real newlines.
 */
export function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function parseCertificate(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem);
  } catch {
    return null;
  }
}

function parsePrivateKey(pem: string): KeyObject | null {
  try {
    // Throws on an encrypted key (no passphrase given) as well as on garbage.
    return createPrivateKey({ key: pem, format: "pem" });
  } catch {
    return null;
  }
}

function disabled(reason: string, notConfigured = false): AppleWalletConfig {
  return { enabled: false, reason, notConfigured };
}

/**
 * Reads and validates the configuration. Never throws: an incomplete or
 * invalid configuration disables the feature (the backend still boots).
 */
export function loadAppleWalletConfig(
  get: (key: string) => string | undefined,
  now: Date = new Date(),
): AppleWalletConfig {
  const raw = Object.fromEntries(
    Object.entries(APPLE_WALLET_ENV).map(([field, envName]) => [
      field,
      get(envName)?.trim() ?? "",
    ]),
  ) as Record<keyof typeof APPLE_WALLET_ENV, string>;

  const missing = (
    Object.keys(APPLE_WALLET_ENV) as (keyof typeof APPLE_WALLET_ENV)[]
  )
    .filter((field) => raw[field] === "")
    .map((field) => APPLE_WALLET_ENV[field]);
  if (missing.length === Object.keys(APPLE_WALLET_ENV).length) {
    return disabled("not configured", true);
  }
  if (missing.length > 0) {
    return disabled(`missing ${missing.join(", ")}`);
  }

  if (!PASS_TYPE_ID_PATTERN.test(raw.passTypeId)) {
    return disabled(
      `${APPLE_WALLET_ENV.passTypeId} must look like "pass.<reverse-domain>"`,
    );
  }
  if (!TEAM_ID_PATTERN.test(raw.teamId)) {
    return disabled(
      `${APPLE_WALLET_ENV.teamId} must be 10 upper-case alphanumeric characters`,
    );
  }

  const signerCert = normalizePem(raw.passCert);
  const signerKey = normalizePem(raw.passKey);
  const wwdr = normalizePem(raw.wwdrCert);

  const cert = parseCertificate(signerCert);
  if (!cert) {
    return disabled(
      `${APPLE_WALLET_ENV.passCert} is not a valid PEM certificate`,
    );
  }
  if (!parseCertificate(wwdr)) {
    return disabled(
      `${APPLE_WALLET_ENV.wwdrCert} is not a valid PEM certificate`,
    );
  }
  const key = parsePrivateKey(signerKey);
  if (!key) {
    return disabled(
      `${APPLE_WALLET_ENV.passKey} is not a valid unencrypted PEM private key`,
    );
  }
  if (!cert.checkPrivateKey(key)) {
    return disabled(
      `${APPLE_WALLET_ENV.passKey} does not match ${APPLE_WALLET_ENV.passCert}`,
    );
  }
  if (new Date(cert.validTo).getTime() <= now.getTime()) {
    return disabled(`${APPLE_WALLET_ENV.passCert} has expired`);
  }

  return {
    enabled: true,
    credentials: {
      passTypeIdentifier: raw.passTypeId,
      teamIdentifier: raw.teamId,
      signerCert,
      signerKey,
      wwdr,
    },
  };
}

/**
 * Removes anything that looks like a PEM block from a message, so an error
 * raised while signing can be logged or sent to Sentry safely.
 */
export function redactPem(message: string): string {
  return message.replace(
    /-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g,
    "[PEM redacted]",
  );
}
