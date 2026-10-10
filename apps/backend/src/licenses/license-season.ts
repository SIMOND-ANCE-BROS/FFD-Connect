import { parisEndOfDay, toLicenseQrExpiry } from "./qr/license-qr";

/**
 * End of validity of a license granted or renewed at a given instant — pure,
 * no Nest.
 *
 * Season rule (product decision, #250). An FFD season runs from September 1
 * to August 31 (Europe/Paris). A license granted on Paris day D ends:
 * - from July 1 to August 31 (summer renewal campaign): at the end of the
 *   NEXT season, i.e. August 31 of year(D) + 1;
 * - otherwise: at the end of the CURRENT season, i.e. the August 31 that
 *   closes the season containing D (year(D) + 1 from September to December,
 *   year(D) from January to June).
 *
 * Examples: granted 15/10/2026 → 31/08/2027; 15/03/2027 → 31/08/2027;
 * 01/07/2027 → 31/08/2028; 01/09/2027 → 31/08/2028.
 *
 * Time convention (#238): a computed `validUntil` is the LAST instant of
 * August 31 in Europe/Paris (23:59:59.999 Paris time), never the time of day
 * of the action that granted it. This is the same Paris-day rule as the
 * signed QR (`toLicenseQrExpiry`) and the Wallet pass (`parisEndOfDay`): the
 * license shows "31/08" everywhere and stays valid for the whole of that day
 * in France. The month and year of D are read in Paris too (00:30 Paris on
 * July 1 is still June 30 in UTC). Everything is computed from UTC instants
 * and `Intl` with an explicit time zone, so the result depends neither on the
 * clock time nor on the server's own time zone.
 */

/** Month (1-12) and day the federation season ends on. */
const SEASON_END_MONTH = 8;
const SEASON_END_DAY = 31;
/**
 * First month (1-12) of the summer renewal campaign: a license granted from
 * this month up to the season end covers the following season.
 */
const RENEWAL_CAMPAIGN_START_MONTH = 7;

/**
 * `YYYY-MM-DD` (Paris calendar) of the season end a license granted at `now`
 * runs until.
 */
export function grantedLicenseSeasonEndDay(now: Date = new Date()): string {
  const [year, month] = toLicenseQrExpiry(now).split("-").map(Number);
  const endYear = month >= RENEWAL_CAMPAIGN_START_MONTH ? year + 1 : year;
  const endMonth = String(SEASON_END_MONTH).padStart(2, "0");
  const endDay = String(SEASON_END_DAY).padStart(2, "0");
  return `${endYear}-${endMonth}-${endDay}`;
}

/**
 * `validUntil` of a license granted at `now`: last millisecond of
 * {@link grantedLicenseSeasonEndDay} in Europe/Paris.
 */
export function grantedLicenseSeasonEnd(now: Date = new Date()): Date {
  return new Date(parisEndOfDay(grantedLicenseSeasonEndDay(now)).getTime() - 1);
}

/**
 * True when a license valid until `validUntil` already covers everything a
 * renewal granted at `now` would give, so renewing is pointless.
 *
 * Compared as Paris calendar days (#238): a license stored with a stray time
 * of day on August 31 still counts. Example: a license ending 31/08/2027 is
 * covered from January to June 2027 (a renewal would give the same date), but
 * NOT from July 1, 2027 (the summer campaign renews it until 31/08/2028).
 */
export function isLicenseCoveredForRenewal(
  validUntil: Date,
  now: Date = new Date(),
): boolean {
  return toLicenseQrExpiry(validUntil) >= grantedLicenseSeasonEndDay(now);
}
