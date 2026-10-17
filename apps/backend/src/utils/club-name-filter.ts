import { Prisma } from "@prisma/client";

/**
 * Escapes the LIKE metacharacters of `value` (`\`, `%`, `_`; backslash is
 * PostgreSQL's default LIKE escape).
 *
 * Prisma 7 translates `{ equals, mode: "insensitive" }` into `col ILIKE $1`
 * with the value bound unescaped (checked on PostgreSQL, #625), so a `_` or
 * `%` in a club name acted as a wildcard: `Club_A` also matched `ClubXA`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Club names are copied as free text (User.clubName, License.clubName,
 * Competition.organizer) and compared case-insensitively across the
 * codebase: exact equality up to case — never a pattern. Pass a trimmed name.
 */
export function sameClubName(name: string): Prisma.StringFilter {
  return { equals: escapeLikePattern(name), mode: "insensitive" };
}
