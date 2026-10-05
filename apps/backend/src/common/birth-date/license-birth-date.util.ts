import { completedYearsBetween } from "./legal-age.util";

/**
 * Derives a birth date from an FFD licence number.
 *
 * The federal grammar is `YYYYMMDD-lll-ffnn`: the birth date, three letters of
 * the surname, two of the given name, then two digits
 * (e.g. `20051203-dup-ga42` — see `scripts/sync-licensees-from-compete.ts`).
 * The first eight characters are therefore an authoritative birth date: it
 * comes from the federation, not from what the registrant typed.
 *
 * The function refuses rather than guesses. Anything that does not match the
 * grammar exactly, any impossible calendar date, any date in the future and
 * any implausible age yields `null` — "we do not know". `null` must never be
 * read as "adult"; use `assessLegalAge` from `./legal-age.util`.
 *
 * Nothing here rewrites existing `User.birthDate` values: those were fabricated
 * by the sync script (random month and day) and re-deriving them would not make
 * them true.
 */

/**
 * `YYYYMMDD-lll-ffnn`. Matched against the lower-cased, trimmed number, so a
 * number typed in capitals is accepted — case cannot change the encoded date,
 * whereas a looser shape could.
 */
const FFD_LICENSE_NUMBER_PATTERN =
  /^(\d{4})(\d{2})(\d{2})-[a-z]{3}-[a-z]{2}\d{2}$/;

/**
 * Upper bound on a licensee's age. Beyond it the number is treated as
 * unparsable rather than as the birth date of a 130-year-old dancer.
 */
export const MAX_PLAUSIBLE_LICENSEE_AGE_YEARS = 120;

export function extractBirthDateFromLicenseNumber(
  licenseNumber: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (typeof licenseNumber !== "string") return null;

  const match = FFD_LICENSE_NUMBER_PATTERN.exec(
    licenseNumber.trim().toLowerCase(),
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // UTC midnight: the stored value must denote a calendar day, and a local
  // midnight would shift that day by one east/west of Greenwich.
  const birthDate = new Date(Date.UTC(year, month - 1, day));

  // Date.UTC silently rolls impossible dates over (31 February becomes 3 March)
  // and maps years 0-99 onto 1900-1999. Round-tripping the components is what
  // turns both into a refusal.
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) {
    return null;
  }

  if (birthDate.getTime() > now.getTime()) return null;

  const age = completedYearsBetween(birthDate, now);
  if (age > MAX_PLAUSIBLE_LICENSEE_AGE_YEARS) return null;

  return birthDate;
}
