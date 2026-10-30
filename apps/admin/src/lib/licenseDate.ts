import { formatParisDay, parseInstant } from './parisDate';

/**
 * License end of validity as `DD/MM/YYYY`, always the calendar day in
 * Europe/Paris whatever the browser's time zone: the backend stores the end
 * of a season as the last instant of August 31 in Paris (#238), which is
 * already September 1 east of Paris. Same day as the app, the signed QR and
 * the Wallet pass. Returns "" for an unparseable date.
 */
export function formatLicenseValidUntil(validUntil: string | Date): string {
  return parseInstant(validUntil) ? formatParisDay(validUntil) : '';
}
