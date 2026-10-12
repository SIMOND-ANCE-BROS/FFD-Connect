/**
 * Pure helpers behind the scrubbing of a deleted account's NAME from rows
 * that belong to someone else (#395): the couple partner's registration
 * (`Registration.partnerName`) and the couple's result label
 * (`Result.details.participant`), which the import attaches to the first
 * partner only.
 *
 * Matching is never done on the name alone: callers first narrow the rows
 * with a structural link (same event + same bib number, or the partner's own
 * registration), then confirm with the name. Shared by AccountDeletionService
 * and the one-shot backfill script (scripts/backfill-registration-partner-user.ts).
 */

/** Neutral label that replaces the deleted person's half of a couple label. */
export const DELETED_PARTNER_LABEL = "Partenaire supprimé";

/** Separators the import splits couple labels on ("A / B", "A & B", "A | B"). */
const LABEL_SEPARATOR = /(\s*[/|&]\s*)/;

/** Lower case, no diacritics, single spaces: "  Émile  DUPONT " → "emile dupont". */
export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when `label` names the person `firstName lastName`, in either order
 * ("First LAST" as typed by users, "LAST First" as some result sheets print
 * it). Empty names never match.
 */
export function personNameMatches(
  label: string | null | undefined,
  firstName: string,
  lastName: string,
): boolean {
  if (!label) return false;
  const first = normalizePersonName(firstName);
  const last = normalizePersonName(lastName);
  if (!first || !last) return false;
  const candidate = normalizePersonName(label);
  return candidate === `${first} ${last}` || candidate === `${last} ${first}`;
}

/**
 * Replaces the half of a couple label that names the person with
 * DELETED_PARTNER_LABEL, keeping the separator and the other half as they
 * were. Returns null when no half names the person: the caller then leaves
 * the label alone rather than guessing (it may be another couple sharing the
 * bib, or a spelling the import did not keep).
 */
export function scrubParticipantLabel(
  label: string,
  firstName: string,
  lastName: string,
): string | null {
  const parts = label.split(LABEL_SEPARATOR);
  // split() with a capture group interleaves names (even) and separators (odd).
  const scrubbed = parts.map((part, i) => {
    if (i % 2 === 1 || !personNameMatches(part, firstName, lastName)) {
      return part;
    }
    // Keep the original surrounding whitespace of the half.
    const lead = part.slice(0, part.length - part.trimStart().length);
    const trail = part.slice(part.trimEnd().length);
    return `${lead}${DELETED_PARTNER_LABEL}${trail}`;
  });
  const result = scrubbed.join("");
  // A replaced half always differs: the neutral label names nobody.
  return result === label ? null : result;
}

/** Reads `details.participant` from the free-form import JSON. */
export function readParticipantLabel(details: unknown): string | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const value = (details as Record<string, unknown>).participant;
  return typeof value === "string" ? value : null;
}

/** Bib numbers the import never trusts as a couple key (parse failure → 0). */
export function isUsableBib(bib: number | null | undefined): bib is number {
  return typeof bib === "number" && Number.isInteger(bib) && bib > 0;
}

export interface MirrorCandidate {
  userId: string;
  bibNumber: number | null;
  partnerName: string | null;
  firstName: string;
  lastName: string;
}

/**
 * Finds the partner's user id for a registration that only carries a
 * `partnerName`: the other registration of the SAME event with the SAME bib
 * (a bib numbers a couple), whose holder is the named person, and whose own
 * `partnerName`, when set, names the registration's holder back. Returns null
 * when zero or several distinct users qualify — an ambiguous match is never
 * written.
 */
export function findMirrorPartnerUserId(
  registration: {
    userId: string;
    bibNumber: number | null;
    partnerName: string | null;
    firstName: string;
    lastName: string;
  },
  sameEventRegistrations: readonly MirrorCandidate[],
): string | null {
  if (!registration.partnerName || !isUsableBib(registration.bibNumber)) {
    return null;
  }
  const matches = new Set<string>();
  for (const other of sameEventRegistrations) {
    if (other.userId === registration.userId) continue;
    if (other.bibNumber !== registration.bibNumber) continue;
    if (
      !personNameMatches(
        registration.partnerName,
        other.firstName,
        other.lastName,
      )
    ) {
      continue;
    }
    if (
      other.partnerName &&
      !personNameMatches(
        other.partnerName,
        registration.firstName,
        registration.lastName,
      )
    ) {
      continue;
    }
    matches.add(other.userId);
  }
  return matches.size === 1 ? [...matches][0] : null;
}
