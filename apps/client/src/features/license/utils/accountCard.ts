import type { LicenseUser } from "../components/license-card/license-card.types";
import { getFfdSeason } from "./licenseSeason";

/**
 * Card of a STAFF or CLUB account on the Licence screen (#234).
 *
 * These accounts hold no FFD license: the card shows who the account is, from
 * the real profile (`GET /users/me`) only. No license number exists for them,
 * so the card has no number row and no QR code; a missing value is shown as a
 * neutral label, never as a demo value.
 */

/** Holder data of the account, as known from the profile (or the session). */
export interface AccountHolder {
  firstName?: string | null;
  lastName?: string | null;
  clubName?: string | null;
  birthDate?: string | null;
}

export type AccountCardRole = "STAFF" | "CLUB";

/** Shown when the profile has no name for a STAFF account. */
export const ACCOUNT_NAME_UNKNOWN = "Nom non communiqué";
/** Shown when the profile has no club name for a CLUB account. */
export const ACCOUNT_CLUB_UNKNOWN = "Club non communiqué";

const clean = (value: string | null | undefined): string => value?.trim() ?? "";

function formatBirthDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("fr-FR");
}

export function buildAccountCard(
  role: AccountCardRole,
  holder: AccountHolder | null,
  now: Date = new Date(),
): LicenseUser {
  const clubName = clean(holder?.clubName);
  const common = {
    // No license, hence no number: the card hides the row.
    licenseNumber: "",
    validUntil: "",
    season: getFfdSeason(now),
  };

  if (role === "CLUB") {
    return {
      ...common,
      // The club is the holder: its name is the card's name.
      firstName: "",
      lastName: clubName || ACCOUNT_CLUB_UNKNOWN,
      type: "CLUB / ASSOCIATION",
      // A season is not an expiry date: shown as a status.
      status: "Active",
      birthDate: "",
    };
  }

  const firstName = clean(holder?.firstName);
  const lastName = clean(holder?.lastName);
  const hasName = firstName !== "" || lastName !== "";
  return {
    ...common,
    firstName: hasName ? firstName : "",
    lastName: hasName ? lastName : ACCOUNT_NAME_UNKNOWN,
    type: "STAFF / ORGANISATEUR",
    // The account's own club, when it has one; no invented structure.
    structure: clubName || undefined,
    // A permanent card has no expiry date: shown as a status.
    status: "Permanente",
    birthDate: formatBirthDate(holder?.birthDate),
  };
}
