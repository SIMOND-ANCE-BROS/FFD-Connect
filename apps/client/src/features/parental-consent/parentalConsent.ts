import type { ParentalConsentStateDto } from "../../services/api/parental-consent-api";

/**
 * Parental consent of minors (#61) — pure helpers and copy.
 *
 * The backend decides who is a minor (birth date encoded in the federal
 * licence number). The app only mirrors that rule to show the parent's
 * e-mail field at sign-up; if it guesses wrong, the server state (banner)
 * still catches the account after registration.
 */

/** Age under which a parent must consent — mirrors the backend's PARENTAL_CONSENT_AGE_YEARS. */
export const PARENTAL_CONSENT_AGE_YEARS = 18;

/** `YYYYMMDD-lll-ffnn` — mirrors apps/backend/src/common/birth-date/license-birth-date.util.ts. */
const FFD_LICENSE_NUMBER_PATTERN =
  /^(\d{4})(\d{2})(\d{2})-[a-z]{3}-[a-z]{2}\d{2}$/;

/**
 * True when the licence number encodes the birth date of a minor. False when
 * it encodes an adult's, or nothing usable (the server then decides).
 */
export function isMinorLicenseNumber(
  licenseNumber: string,
  now: Date = new Date(),
): boolean {
  const match = FFD_LICENSE_NUMBER_PATTERN.exec(
    licenseNumber.trim().toLowerCase(),
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day ||
    birth.getTime() > now.getTime()
  ) {
    return false;
  }
  let age = now.getUTCFullYear() - year;
  const monthDiff = now.getUTCMonth() - (month - 1);
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < day)) age -= 1;
  return age < PARENTAL_CONSENT_AGE_YEARS;
}

/** Basic shape check of an e-mail address (the server validates for real). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Whether the account must still obtain (or wait for) a parent's consent. */
export function needsParentalAction(
  consent: Pick<ParentalConsentStateDto, "state"> | null | undefined,
): boolean {
  return consent?.state === "REQUIRED" || consent?.state === "PENDING";
}

export function formatConsentDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

export interface ConsentCopy {
  title: string;
  message: string;
}

/** What the banner and the screen say, per state. */
export function consentCopy(consent: ParentalConsentStateDto): ConsentCopy {
  switch (consent.state) {
    case "PENDING":
      return {
        title: "En attente de l'accord de votre représentant légal",
        message: consent.parentEmailMasked
          ? `Un lien a été envoyé à ${consent.parentEmailMasked}${
              consent.expiresAt
                ? ` (valable jusqu'au ${formatConsentDate(consent.expiresAt)})`
                : ""
            }. Tant qu'il n'a pas répondu, vous ne pouvez pas déposer de certificat médical.`
          : "Un lien a été envoyé à votre représentant légal. Tant qu'il n'a pas répondu, vous ne pouvez pas déposer de certificat médical.",
      };
    case "GRANTED":
      return {
        title: "Accord parental donné",
        message: consent.grantedAt
          ? `Votre représentant légal a donné son accord le ${formatConsentDate(consent.grantedAt)}. Il peut le retirer à tout moment avec le lien reçu par e-mail.`
          : "Votre représentant légal a donné son accord. Il peut le retirer à tout moment avec le lien reçu par e-mail.",
      };
    case "REQUIRED":
      return {
        title: "Accord parental nécessaire",
        message:
          consent.lastOutcome === "REVOKED"
            ? "Votre représentant légal a retiré son accord. Votre compte est limité : vous ne pouvez plus déposer de certificat médical. Vous pouvez lui renvoyer une demande."
            : consent.lastOutcome === "EXPIRED"
              ? "Le lien envoyé à votre représentant légal a expiré. Renvoyez-lui une demande pour pouvoir déposer votre certificat médical."
              : "Vous êtes mineur(e) : l'accord d'un parent ou représentant légal est nécessaire avant de déposer un certificat médical. Indiquez son adresse e-mail, il recevra un lien.",
      };
    case "NOT_REQUIRED":
      return {
        title: "Aucun accord parental nécessaire",
        message:
          "Votre compte n'a pas besoin de l'accord d'un représentant légal.",
      };
  }
}
