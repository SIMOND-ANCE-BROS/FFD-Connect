import { parisStartOfDay, toLicenseQrExpiry } from "./qr/license-qr";

/**
 * Single license expiry rule of the backend (#384) — pure, no Nest.
 *
 * A license is valid through the WHOLE calendar day of its `validUntil` in
 * Europe/Paris, and expired from the next Paris day on. This is the rule of
 * the signed QR (`toLicenseQrExpiry`), the Wallet pass, the season end
 * (`license-season.ts`) and the app (`licenseExpiry.ts`, #372): a license
 * whose `validUntil` falls at 10:00 on day D is still valid at 23:00 on D
 * (Paris time) and expired at 00:01 on D+1.
 *
 * Never compare `validUntil` to an instant (`validUntil < new Date()`): a
 * stored time of day would make the license expire mid-day on the backend
 * while the app, the QR and Wallet still show it valid.
 */

/** True when the license ending at `validUntil` is expired at `now`. */
export function isLicenseExpired(
  validUntil: Date,
  now: Date = new Date(),
): boolean {
  // `YYYY-MM-DD` strings compare chronologically.
  return toLicenseQrExpiry(now) > toLicenseQrExpiry(validUntil);
}

/**
 * Lower bound for database filters: a license is valid at `now` exactly when
 * `validUntil >= licenseValidityFloor(now)`, i.e. its `validUntil` falls on
 * or after the start (00:00 Paris) of the current Paris day. Equivalent to
 * `!isLicenseExpired(validUntil, now)`, expressed as an instant Prisma can
 * compare against (`{ validUntil: { gte: licenseValidityFloor() } }`).
 */
export function licenseValidityFloor(now: Date = new Date()): Date {
  return parisStartOfDay(toLicenseQrExpiry(now));
}
