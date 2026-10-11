import type { LicenseUser } from "../components/license-card/license-card.types";

/** Label/value pair of the validity row at the bottom of a license card. */
export interface LicenseValidityRow {
  label: string;
  value: string;
}

/**
 * Card copy, in the language of each card: the FFD card is French, the WDSF
 * card mirrors the (English) WDSF license.
 */
const LABELS = {
  FFD: {
    expiresOn: "Licence valable jusqu'au",
    status: "Statut de la licence",
  },
  WDSF: { expiresOn: "License expires on", status: "License status" },
} as const;

/** A formatted expiry date always carries digits; a status ("Active") never. */
const isDate = (value: string): boolean => /\d/.test(value);

/**
 * Validity row of a license card. An expiry date goes under the "expires on"
 * label; without one, the license status goes under the "status" label — a
 * status must never be presented as an expiry date ("expires on: Active").
 *
 * `validUntil` holding a status is tolerated: offline snapshots saved by an
 * older version stored "Active" / "PERMANENT" there.
 */
export function getLicenseValidityRow(
  isFFD: boolean,
  user: Pick<LicenseUser, "validUntil" | "status">,
): LicenseValidityRow {
  const labels = isFFD ? LABELS.FFD : LABELS.WDSF;
  const validUntil = user.validUntil.trim();
  if (isDate(validUntil)) {
    return { label: labels.expiresOn, value: validUntil };
  }
  const status = user.status?.trim() ?? "";
  // Empty strings fall through: status, then a legacy status, then a dash.
  const value = [status, validUntil].find((text) => text !== "") ?? "—";
  return { label: labels.status, value };
}
