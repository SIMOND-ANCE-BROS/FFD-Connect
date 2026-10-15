import {
  assessLegalAge,
  LEGAL_MAJORITY_AGE_YEARS,
  matchLegalAge,
} from "../common/birth-date/legal-age.util";

/**
 * Parental consent rules (#61, epic #23). Pure functions and constants only:
 * every legal knob of the feature lives here, in one reviewable place.
 */

/**
 * Age under which a parent must consent.
 *
 * GDPR art. 8 lets France set the age of digital consent at 15 (loi
 * Informatique et Libertés, art. 45). The app also processes HEALTH data
 * (the medical certificate, art. 9), and the published CGU require a parent's
 * consent for ANY minor. Conservative choice, pending Gabin's decision: every
 * minor (< 18). Lowering it to 15 is a one-line change here.
 */
export const PARENTAL_CONSENT_AGE_YEARS = LEGAL_MAJORITY_AGE_YEARS;

/** How long the parent has to CONFIRM. Revocation through the link has no deadline. */
export const PARENTAL_CONSENT_CONFIRMATION_TTL_DAYS = 7;

/**
 * Version of the CGU the parent accepts on the minor's behalf. Must equal the
 * client's `CGU_VERSION` (apps/client/src/features/legal/cguConsent.ts): v3
 * is the version whose §6 opens the app to minors with a parent's consent.
 */
export const PARENTAL_CONSENT_CGU_VERSION = "3";

/** Stored statuses of a `ParentalConsent` row. */
export const PARENTAL_CONSENT_STATUSES = [
  "PENDING",
  "GRANTED",
  "REVOKED",
  "SUPERSEDED",
] as const;
export type ParentalConsentStatus = (typeof PARENTAL_CONSENT_STATUSES)[number];

/**
 * Whether an account needs a parent's consent, from its birth date alone.
 *
 * UNKNOWN (no birth date, or one that cannot be trusted) is NOT folded into
 * either answer: the caller decides, and `isConsentGateApplicable` documents
 * what the gate does with it.
 */
export type ParentalConsentRequirement =
  | "REQUIRED"
  | "NOT_REQUIRED"
  | "UNKNOWN";

export function parentalConsentRequirement(
  birthDate: Date | null | undefined,
  now: Date = new Date(),
): ParentalConsentRequirement {
  return matchLegalAge<ParentalConsentRequirement>(
    assessLegalAge(birthDate, now),
    {
      onMinor: (age) =>
        age < PARENTAL_CONSENT_AGE_YEARS ? "REQUIRED" : "NOT_REQUIRED",
      // An adult is never subject to the flow (acceptance criterion of #61).
      onAdult: () => "NOT_REQUIRED",
      // Pending Gabin's decision (see PR): an account whose age is unknown is
      // not gated. Gating it would lock every account whose licence number
      // does not encode a birth date (all beta licences, accounts created
      // before #60) out of the medical certificate, with no way for them to
      // prove their age. Kept as its own state so the choice stays visible.
      onUnknown: () => "UNKNOWN",
    },
  );
}

/**
 * Effective state of an account, as the app shows it.
 *
 * - NOT_REQUIRED: adult (or age unknown, see above) — never shown the flow.
 * - REQUIRED: minor without a usable consent (none asked yet, link expired,
 *   or consent withdrawn — `lastOutcome` says which).
 * - PENDING: a link was sent to a parent and is still valid.
 * - GRANTED: a parent confirmed.
 */
export type ParentalConsentState =
  | "NOT_REQUIRED"
  | "REQUIRED"
  | "PENDING"
  | "GRANTED";

/** Why a minor is back to REQUIRED. */
export type ParentalConsentOutcome = "EXPIRED" | "REVOKED";

export interface ParentalConsentRecordSnapshot {
  status: string;
  expiresAt: Date;
}

/**
 * Effective state from the requirement and the latest non-superseded record.
 * A record is read for minors only: an adult's old consent no longer matters.
 */
export function effectiveParentalConsentState(
  requirement: ParentalConsentRequirement,
  latest: ParentalConsentRecordSnapshot | null,
  now: Date = new Date(),
): { state: ParentalConsentState; lastOutcome: ParentalConsentOutcome | null } {
  if (requirement !== "REQUIRED") {
    return { state: "NOT_REQUIRED", lastOutcome: null };
  }
  if (!latest) return { state: "REQUIRED", lastOutcome: null };
  switch (latest.status) {
    case "GRANTED":
      return { state: "GRANTED", lastOutcome: null };
    case "PENDING":
      return latest.expiresAt.getTime() > now.getTime()
        ? { state: "PENDING", lastOutcome: null }
        : { state: "REQUIRED", lastOutcome: "EXPIRED" };
    case "REVOKED":
      return { state: "REQUIRED", lastOutcome: "REVOKED" };
    default:
      // SUPERSEDED rows are filtered out by the query; anything else is a
      // value this code does not know: never read it as a consent.
      return { state: "REQUIRED", lastOutcome: null };
  }
}

/** Whether health data (medical certificate) may be processed for this state. */
export function healthDataAllowed(state: ParentalConsentState): boolean {
  return state === "NOT_REQUIRED" || state === "GRANTED";
}
