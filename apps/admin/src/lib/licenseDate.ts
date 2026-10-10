/** Time zone the FFD license validity day is expressed in (backend #238). */
const FFD_TIME_ZONE = 'Europe/Paris';

/**
 * License end of validity as `DD/MM/YYYY`, always the calendar day in
 * Europe/Paris whatever the browser's time zone: the backend stores the end
 * of a season as the last instant of August 31 in Paris (#238), which is
 * already September 1 east of Paris. Same day as the app, the signed QR and
 * the Wallet pass. Returns "" for an unparseable date.
 */
export function formatLicenseValidUntil(validUntil: string | Date): string {
  const date = validUntil instanceof Date ? validUntil : new Date(validUntil);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { timeZone: FFD_TIME_ZONE });
}
