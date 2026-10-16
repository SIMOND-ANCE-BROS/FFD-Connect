import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

/** Same floor as JWT_SECRET / QR_SIGNING_SECRET. */
export const RESULTS_PSEUDONYMISATION_KEY_MIN_LENGTH = 32;

/**
 * Key used outside production when RESULTS_PSEUDONYMISATION_KEY is not set
 * (local, tests). Never used when NODE_ENV=production (staging included).
 */
const DEVELOPMENT_KEY = "ffd-connect-development-results-pseudonymisation";

/**
 * HMAC key of the imported results' pseudonyms (#652), or null when the
 * feature is not configured: production without a key of at least 32
 * characters.
 */
export function resultsPseudonymisationKey(
  config: ConfigService,
): string | null {
  const key = config.get<string>("RESULTS_PSEUDONYMISATION_KEY")?.trim();
  if (key && key.length >= RESULTS_PSEUDONYMISATION_KEY_MIN_LENGTH) return key;
  return config.get<string>("NODE_ENV") === "production"
    ? null
    : DEVELOPMENT_KEY;
}

/** HMAC-SHA-256, hex. Not reversible without the key, stable for a key. */
export function resultsPseudonym(key: string, value: string): string {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

/** Pseudonym of a (normalised) licence number of a deleted account. */
export function erasedLicenceFingerprint(
  key: string,
  licenceNumber: string,
): string {
  return resultsPseudonym(key, `licence:v1|${licenceNumber.toUpperCase()}`);
}
