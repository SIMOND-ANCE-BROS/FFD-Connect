import { parisEndOfDay, toLicenseQrExpiry } from "./qr/license-qr";

/**
 * End of validity of a license granted or renewed now (#238) — pure, no Nest.
 *
 * Convention: a computed `validUntil` is the LAST instant of August 31 in
 * Europe/Paris (23:59:59.999 Paris time), never the time of day of the action
 * that granted it. This is the same Paris-day rule as the signed QR
 * (`toLicenseQrExpiry`) and the Wallet pass (`parisEndOfDay`): the license
 * shows "31/08" everywhere and stays valid for the whole of that day in
 * France. Everything is computed from UTC instants and `Intl` with an explicit
 * time zone, so the result depends neither on the clock time nor on the
 * server's own time zone.
 *
 * The season year keeps the historical rule: the Paris calendar year of `now`
 * plus one.
 */

/** Month (1-12) and day the federation season ends on. */
const SEASON_END_MONTH = 8;
const SEASON_END_DAY = 31;

/** `YYYY-MM-DD` of the season end following `now` (Paris calendar). */
export function nextLicenseSeasonEndDay(now: Date = new Date()): string {
  const parisYear = Number(toLicenseQrExpiry(now).slice(0, 4));
  const month = String(SEASON_END_MONTH).padStart(2, "0");
  const day = String(SEASON_END_DAY).padStart(2, "0");
  return `${parisYear + 1}-${month}-${day}`;
}

/** Last millisecond of the next season end day in Europe/Paris. */
export function nextLicenseSeasonEnd(now: Date = new Date()): Date {
  return new Date(parisEndOfDay(nextLicenseSeasonEndDay(now)).getTime() - 1);
}
