/**
 * TEMPORARY (#801, with #787) — matching of an entry of the TopTurnier list
 * of recent competitions to the competitions of the app. Explicit, never
 * guessed: the same day AND a common place name (city, location or title of
 * the competition against the town of the export folder or the head of the
 * entry title). Exactly one competition → MATCHED, several → AMBIGUOUS (the
 * staff picks one), none → NONE. Pure module.
 */

export type ChairpersonMatchStatus = "MATCHED" | "AMBIGUOUS" | "NONE";

/** What the matching reads of a competition of the app. */
export interface MatchableCompetition {
  id: string;
  title: string;
  /** Paris calendar days of the competition, `YYYY-MM-DD`. */
  firstDay: string;
  lastDay: string;
  city: string | null;
  location: string | null;
}

export interface ChairpersonMatchInput {
  date: string | null;
  title: string;
  folder: string;
}

export interface ChairpersonMatch {
  status: ChairpersonMatchStatus;
  /** The competition of a MATCHED entry. */
  competitionId: string | null;
  /** The competitions an AMBIGUOUS entry may be one of (ids + titles). */
  candidates: { id: string; title: string }[];
}

/** Max characters of a name compared (the inputs are already capped). */
const MAX_KEY_INPUT = 300;
/** A key shorter than this is only compared for equality, never contained. */
const MIN_CONTAINED_KEY = 4;
/** A key shorter than this is never compared. */
const MIN_KEY = 3;

/**
 * Comparable form of a place name: accents and case dropped, « Saint » /
 * « Sainte » shortened like the folder names do (`stexemplesurloire`), then
 * letters and digits only (`Saint-Exemple-sur-Loire` → `stexemplesurloire`).
 */
export function placeKey(value: string): string {
  return value
    .slice(0, MAX_KEY_INPUT)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bsainte\b/g, "ste")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Town of an export folder: the leading `AAAAMMJJ` and separators dropped
 * (`20261017_exempleville` → `exempleville`).
 */
export function folderPlaceKey(folder: string): string {
  return placeKey(folder.replace(/^\d{0,8}/, ""));
}

/** Head of an entry title, before its first comma (« Exempleville, Trophée »). */
export function titleHeadKey(title: string): string {
  const comma = title.indexOf(",");
  return placeKey(comma < 0 ? title : title.slice(0, comma));
}

function keysMatch(a: string, b: string): boolean {
  if (a.length < MIN_KEY || b.length < MIN_KEY) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_CONTAINED_KEY && long.includes(short);
}

function sharesPlace(
  entry: ChairpersonMatchInput,
  competition: MatchableCompetition,
): boolean {
  const entryKeys = [folderPlaceKey(entry.folder), titleHeadKey(entry.title)];
  const competitionKeys = [
    competition.city,
    competition.location,
    competition.title,
  ]
    .filter((value): value is string => value !== null)
    .map(placeKey);
  return entryKeys.some((entryKey) =>
    competitionKeys.some((key) => keysMatch(entryKey, key)),
  );
}

/** True when the competition takes place on `day` (first to last day). */
export function coversDay(
  competition: Pick<MatchableCompetition, "firstDay" | "lastDay">,
  day: string,
): boolean {
  const last =
    competition.lastDay < competition.firstDay
      ? competition.firstDay
      : competition.lastDay;
  return competition.firstDay <= day && day <= last;
}

export function matchChairpersonEntry(
  entry: ChairpersonMatchInput,
  competitions: readonly MatchableCompetition[],
): ChairpersonMatch {
  const date = entry.date;
  if (date === null) {
    return { status: "NONE", competitionId: null, candidates: [] };
  }
  const found = competitions.filter(
    (competition) =>
      coversDay(competition, date) && sharesPlace(entry, competition),
  );
  if (found.length === 1) {
    return { status: "MATCHED", competitionId: found[0].id, candidates: [] };
  }
  if (found.length > 1) {
    return {
      status: "AMBIGUOUS",
      competitionId: null,
      candidates: found.map(({ id, title }) => ({ id, title })),
    };
  }
  return { status: "NONE", competitionId: null, candidates: [] };
}
