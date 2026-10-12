/**
 * Calendar days in Europe/Paris, the federation's time zone: licence validity
 * (backend `toLicenseQrExpiry`, #238) and registration deadlines are expressed
 * in Paris days, whatever the phone's time zone.
 */

export const PARIS_TIME_ZONE = "Europe/Paris";

const MS_PER_DAY = 86_400_000;

/**
 * Index of the Paris calendar day of `instant` (days since the epoch), to
 * diff whole days. `toLocaleDateString("en-CA")` gives "YYYY-MM-DD", read
 * back as UTC midnight. Returns `NaN` when the runtime cannot format the
 * date: callers must check `Number.isFinite` on their diff.
 */
export function parisDayIndex(instant: Date): number {
  const ymd = instant.toLocaleDateString("en-CA", {
    timeZone: PARIS_TIME_ZONE,
  });
  return Math.floor(new Date(`${ymd}T00:00:00Z`).getTime() / MS_PER_DAY);
}
