import type { LicenseUser } from "../components/license-card/license-card.types";

/**
 * FFD season helpers (#211). An FFD season runs from September 1st to
 * August 31st: 2026-08-31 belongs to "2025/2026", 2026-09-01 to "2026/2027".
 *
 * The card must never show invented data: a season or an expiry date is
 * derived from the license's real `validUntil`, or not shown at all.
 */

/** Month index (0-based) on which an FFD season starts: September. */
const SEASON_START_MONTH = 8;

/** Status shown on the FFD card when the server sends no expiry date. */
export const FFD_VALIDITY_UNKNOWN = "Validité non communiquée";

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * FFD season containing `date`, e.g. "2025/2026". Local calendar date, so a
 * French user sees the season of the day it is for them.
 */
export function getFfdSeason(date: Date, separator = "/"): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= SEASON_START_MONTH ? year : year - 1;
  return `${startYear}${separator}${startYear + 1}`;
}

/**
 * Season a license is valid for, derived from its expiry date. A date-only ISO
 * string ("2026-08-31") is read as UTC midnight by `Date`, so the season is
 * computed on the UTC calendar date to avoid sliding into the previous day
 * west of Greenwich. Unknown/invalid date ⇒ `undefined` (the card hides it).
 */
export function getLicenseSeason(
  validUntil: string | Date | null | undefined,
): string | undefined {
  const date = parseDate(validUntil);
  if (!date) return undefined;
  const utcDay = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return getFfdSeason(utcDay);
}

/**
 * Expiry date as shown on the FFD card ("31/08/2026"), or "" when the server
 * sent none (or an unparseable one): the card then shows a status instead.
 */
export function formatFfdValidUntil(
  validUntil: string | Date | null | undefined,
): string {
  const date = parseDate(validUntil);
  return date ? date.toLocaleDateString("fr-FR") : "";
}

/**
 * Validity fields of the FFD card, from the license's real expiry date only:
 * no date ⇒ no date, no season, a neutral status instead. Used for the live
 * profile and for offline snapshots (older ones hold an invented date).
 */
export function ffdValidityFields(
  validUntilRaw: string | null | undefined,
): Pick<LicenseUser, "validUntil" | "validUntilRaw" | "status" | "season"> {
  const validUntil = formatFfdValidUntil(validUntilRaw);
  if (!validUntil) {
    return {
      validUntil: "",
      validUntilRaw: undefined,
      status: FFD_VALIDITY_UNKNOWN,
      season: undefined,
    };
  }
  return {
    validUntil,
    validUntilRaw: validUntilRaw ?? undefined,
    status: undefined,
    season: getLicenseSeason(validUntilRaw),
  };
}
