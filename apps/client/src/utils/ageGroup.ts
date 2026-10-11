/**
 * Tolerant comparison of FFD age classes ("ageGroup").
 *
 * Competition events can carry several spellings of the same class:
 * - canonical names deduced from the federation documents: `Adulte`,
 *   `Senior I`…`Senior V`, `Junior I/II`, `Juvénile I/II`, `Youth`,
 *   `Solo Youth`, `Solo Junior 1`…
 * - legacy placeholder events: `Adult`, `Senior` (no subdivision);
 * - `Espoir` (couples under 21, also spelled `Under 21`), open to Youth and
 *   Adulte couples — the server enforces the actual age at registration;
 * - profiles / club members: usually the canonical couple class.
 *
 * The server stays the source of truth for eligibility (GET /for-user); this
 * is only used for the client-side fallbacks and filters.
 */

const ROMAN_BY_DIGIT: Record<string, string> = {
  "1": "i",
  "2": "ii",
  "3": "iii",
  "4": "iv",
  "5": "v",
};

/**
 * Normalises an age class: lower case, no accents, no `Solo` prefix,
 * `Adult` → `adulte`, `Under 21` → `espoir`, arabic subdivision → roman
 * (`Junior 1` → `junior i`).
 */
export function normalizeAgeGroup(value: string | null | undefined): string {
  if (!value) return "";
  const tokens = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens[0] === "solo") tokens.shift();
  if (tokens[0] === "adult") tokens[0] = "adulte";
  const normalized = tokens.map((t) => ROMAN_BY_DIGIT[t] ?? t).join(" ");
  return normalized === "under 21" ? "espoir" : normalized;
}

/**
 * True when both age classes designate the same group. A bare family
 * (`Senior`, `Junior`, `Juvénile`) matches any of its subdivisions, in
 * either direction. An empty value matches nothing (callers decide whether
 * a missing class means "open to all").
 */
export function ageGroupsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeAgeGroup(a);
  const nb = normalizeAgeGroup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [familyA, ...restA] = na.split(" ");
  const [familyB, ...restB] = nb.split(" ");
  return familyA === familyB && (restA.length === 0 || restB.length === 0);
}

/** Couple classes allowed to enter an `Espoir` (under 21) event. */
const ESPOIR_ENTRANTS = new Set(["espoir", "youth", "adulte"]);

/**
 * True when a person of class `personAgeGroup` may enter an event of class
 * `eventAgeGroup` (client-side approximation, the server decides).
 * Same as `ageGroupsMatch`, plus Youth and Adulte entering `Espoir` events.
 */
export function isAgeGroupAllowedForEvent(
  eventAgeGroup: string | null | undefined,
  personAgeGroup: string | null | undefined,
): boolean {
  if (ageGroupsMatch(eventAgeGroup, personAgeGroup)) return true;
  return (
    normalizeAgeGroup(eventAgeGroup) === "espoir" &&
    ESPOIR_ENTRANTS.has(normalizeAgeGroup(personAgeGroup))
  );
}
