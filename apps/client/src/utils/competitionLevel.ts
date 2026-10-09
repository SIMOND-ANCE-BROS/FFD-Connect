/**
 * Competition level per discipline (client mirror of the backend helper
 * `apps/backend/src/common/competition-level`).
 *
 * The FFD competition level (Débutant, Intermédiaire, Avancé, International)
 * is held separately for Latin and Standard. It has nothing to do with the
 * Passeport Danse colours. The single `competitionLevel` field is deprecated
 * and only read as a fallback (older accounts, older backends).
 *
 * Ten Dance (10 danses) events have no level: they are open to dancers who
 * practise both disciplines.
 */
import { DISCIPLINE_LABELS, formatDiscipline } from "./discipline";

export type Discipline = "Latin" | "Standard" | "Ten Dance";

/** Levels from the lowest to the highest. */
export const COMPETITION_LEVEL_ORDER = [
  "Débutant",
  "Intermédiaire",
  "Avancé",
  "International",
] as const;

export type CompetitionLevel = (typeof COMPETITION_LEVEL_ORDER)[number];

/** Profile fields carrying discipline / level information. */
export interface CompetitionLevelProfile {
  competitionLevelLatin?: string | null;
  competitionLevelStandard?: string | null;
  /** @deprecated single legacy level, read only as a fallback. */
  competitionLevel?: string | null;
  /** Declared discipline (User.category): Latin, Standard or Ten Dance. */
  category?: string | null;
}

/** Maps any spelling of a discipline to its canonical value (null if unknown). */
export function normalizeDiscipline(
  value: string | null | undefined,
): Discipline | null {
  switch (formatDiscipline(value)) {
    case DISCIPLINE_LABELS.latin:
      return "Latin";
    case DISCIPLINE_LABELS.standard:
      return "Standard";
    case DISCIPLINE_LABELS.tenDance:
      return "Ten Dance";
    default:
      return null;
  }
}

/** Returns the value as a known competition level, or null. */
export function toCompetitionLevel(
  value: string | null | undefined,
): CompetitionLevel | null {
  const v = value?.trim();
  if (!v) return null;
  return (COMPETITION_LEVEL_ORDER as readonly string[]).includes(v)
    ? (v as CompetitionLevel)
    : null;
}

/** Rank of a level (0 = Débutant); -1 when unknown. */
export function competitionLevelRank(value: string | null | undefined): number {
  const level = toCompetitionLevel(value);
  return level ? COMPETITION_LEVEL_ORDER.indexOf(level) : -1;
}

/**
 * Level of a dancer for an event discipline: the discipline level, falling
 * back to the legacy single level. Ten Dance has no level (null).
 */
export function getCompetitionLevelForCategory(
  profile: CompetitionLevelProfile | null | undefined,
  category: string | null | undefined,
): CompetitionLevel | null {
  if (!profile) return null;
  const legacy = toCompetitionLevel(profile.competitionLevel);
  switch (normalizeDiscipline(category)) {
    case "Latin":
      return toCompetitionLevel(profile.competitionLevelLatin) ?? legacy;
    case "Standard":
      return toCompetitionLevel(profile.competitionLevelStandard) ?? legacy;
    case "Ten Dance":
      return null;
    default:
      return legacy;
  }
}

/** Highest level held in any discipline (legacy level as fallback). */
export function getHighestCompetitionLevel(
  profile: CompetitionLevelProfile | null | undefined,
): CompetitionLevel | null {
  if (!profile) return null;
  let best: CompetitionLevel | null = null;
  for (const candidate of [
    profile.competitionLevelLatin,
    profile.competitionLevelStandard,
    profile.competitionLevel,
  ]) {
    const level = toCompetitionLevel(candidate);
    if (level && competitionLevelRank(level) > competitionLevelRank(best)) {
      best = level;
    }
  }
  return best;
}

/**
 * Does the dancer practise this discipline? A per-discipline level or the
 * declared discipline counts ("Ten Dance" = both). Ten Dance requires both
 * Latin and Standard. Null when the profile carries no discipline information
 * or the event discipline is unknown (callers must not block then).
 */
export function practisesDiscipline(
  profile: CompetitionLevelProfile | null | undefined,
  category: string | null | undefined,
): boolean | null {
  if (!profile) return null;
  const declared = normalizeDiscipline(profile.category);
  const hasLatinLevel = toCompetitionLevel(profile.competitionLevelLatin);
  const hasStandardLevel = toCompetitionLevel(profile.competitionLevelStandard);
  if (!declared && !hasLatinLevel && !hasStandardLevel) return null;

  const latin =
    !!hasLatinLevel || declared === "Latin" || declared === "Ten Dance";
  const standard =
    !!hasStandardLevel || declared === "Standard" || declared === "Ten Dance";

  switch (normalizeDiscipline(category)) {
    case "Latin":
      return latin;
    case "Standard":
      return standard;
    case "Ten Dance":
      return latin && standard;
    default:
      return null;
  }
}

/**
 * User-facing summary of the levels: « Latines : Avancé · Standards :
 * Débutant » (only the disciplines that have a level). Falls back to the
 * legacy single level when no discipline level is set; null when nothing is
 * known.
 */
export function formatCompetitionLevels(
  profile: CompetitionLevelProfile | null | undefined,
): string | null {
  if (!profile) return null;
  const parts: string[] = [];
  const latin = profile.competitionLevelLatin?.trim();
  const standard = profile.competitionLevelStandard?.trim();
  if (latin) parts.push(`${DISCIPLINE_LABELS.latin} : ${latin}`);
  if (standard) parts.push(`${DISCIPLINE_LABELS.standard} : ${standard}`);
  if (parts.length > 0) return parts.join(" · ");
  const legacy = profile.competitionLevel?.trim();
  if (legacy) return legacy;
  return null;
}

/**
 * Suggested couple level(s) returned on couple creation: one per discipline
 * (« Latines : Avancé · Standards : Débutant »), or the deprecated single
 * `suggestedLevel` from an older backend. "—" when nothing is suggested.
 */
export function formatSuggestedCoupleLevels(suggestion: {
  suggestedLevelLatin?: string | null;
  suggestedLevelStandard?: string | null;
  suggestedLevel?: string | null;
}): string {
  return (
    formatCompetitionLevels({
      competitionLevelLatin: suggestion.suggestedLevelLatin,
      competitionLevelStandard: suggestion.suggestedLevelStandard,
      competitionLevel: suggestion.suggestedLevel,
    }) ?? "—"
  );
}
