/**
 * Competition level per discipline.
 *
 * The FFD competition level (Débutant, Intermédiaire, Avancé, International)
 * is held SEPARATELY for each discipline: a dancer can be Débutant in
 * Standard and International in Latin. It is not derived from the Passeport
 * Danse colours (`passportLevelLatin` / `passportLevelStandard`), which are a
 * distinct concept.
 *
 * Every level-dependent rule (eligibility, notifications, partnership
 * suggestions, solo teams…) must read the level through
 * {@link getCompetitionLevelForCategory} with the event's discipline.
 *
 * Ten Dance (10 danses): events are only "majeures", open to dancers who
 * practise BOTH Latin and Standard, with no level requirement (product owner
 * decision). So there is no "Ten Dance level": the helper returns null for it,
 * and eligibility checks {@link practisesDiscipline} instead.
 *
 * Pure module — no I/O.
 */
import { COMPETITION_LEVELS, type CompetitionLevel } from "../age-group";

/** Canonical discipline values stored on Event.category / User.category. */
export const DISCIPLINES = ["Latin", "Standard", "Ten Dance"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/** Levels from the lowest to the highest. */
export const COMPETITION_LEVEL_ORDER: readonly CompetitionLevel[] = [
  "Débutant",
  "Intermédiaire",
  "Avancé",
  "International",
];

/** Fields of a user that carry discipline / level information. */
export interface CompetitionLevelProfile {
  competitionLevelLatin?: string | null;
  competitionLevelStandard?: string | null;
  /** @deprecated single legacy level, read only as a fallback. */
  competitionLevel?: string | null;
  /** Declared discipline (User.category): Latin, Standard or Ten Dance. */
  category?: string | null;
}

const DISCIPLINE_ALIASES: Record<string, Discipline> = {
  latin: "Latin",
  latine: "Latin",
  latines: "Latin",
  standard: "Standard",
  standards: "Standard",
  "ten dance": "Ten Dance",
  "ten dances": "Ten Dance",
  "10 danses": "Ten Dance",
  "dix danses": "Ten Dance",
};

/** Maps any spelling of a discipline to its canonical value (null if unknown). */
export function normalizeDiscipline(
  category: string | null | undefined,
): Discipline | null {
  if (!category) return null;
  const key = category.trim().toLowerCase().replace(/\s+/g, " ");
  return DISCIPLINE_ALIASES[key] ?? null;
}

const DISCIPLINE_LABELS: Record<Discipline, string> = {
  Latin: "Latines",
  Standard: "Standards",
  "Ten Dance": "10 danses",
};

/**
 * French label of a discipline for user-facing text ("Latines", "Standards",
 * "10 danses"). Stored values are unchanged; an unknown value is returned
 * trimmed as is.
 */
export function disciplineLabel(category: string | null | undefined): string {
  const discipline = normalizeDiscipline(category);
  return discipline ? DISCIPLINE_LABELS[discipline] : (category ?? "").trim();
}

/** Returns the value as a known competition level, or null. */
export function toCompetitionLevel(
  value: string | null | undefined,
): CompetitionLevel | null {
  const v = value?.trim();
  if (!v) return null;
  return (COMPETITION_LEVELS as readonly string[]).includes(v)
    ? (v as CompetitionLevel)
    : null;
}

/** Rank of a level (0 = Débutant); -1 when unknown. */
export function competitionLevelRank(value: string | null | undefined): number {
  const level = toCompetitionLevel(value);
  return level ? COMPETITION_LEVEL_ORDER.indexOf(level) : -1;
}

/**
 * Competition level of a dancer for an event discipline.
 * - Latin → `competitionLevelLatin`, Standard → `competitionLevelStandard`,
 *   each falling back to the deprecated single `competitionLevel`.
 * - Ten Dance → null: 10-dance events have no level requirement.
 * - Unknown discipline → the legacy level (best effort).
 */
export function getCompetitionLevelForCategory(
  user: CompetitionLevelProfile | null | undefined,
  category: string | null | undefined,
): CompetitionLevel | null {
  if (!user) return null;
  const legacy = toCompetitionLevel(user.competitionLevel);
  switch (normalizeDiscipline(category)) {
    case "Latin":
      return toCompetitionLevel(user.competitionLevelLatin) ?? legacy;
    case "Standard":
      return toCompetitionLevel(user.competitionLevelStandard) ?? legacy;
    case "Ten Dance":
      return null;
    default:
      return legacy;
  }
}

/**
 * Backward compatibility for writers that only know the deprecated single
 * `competitionLevel` (older back-office): when it is written WITHOUT any
 * per-discipline level in the same payload, it is copied to both disciplines
 * (otherwise the per-discipline values, read first, would hide the edit).
 * `undefined` = field absent (unchanged), `null` = cleared.
 */
export function mirrorLegacyCompetitionLevel<
  T extends {
    competitionLevel?: string | null;
    competitionLevelLatin?: string | null;
    competitionLevelStandard?: string | null;
  },
>(fields: T): T {
  if (
    fields.competitionLevel === undefined ||
    fields.competitionLevelLatin !== undefined ||
    fields.competitionLevelStandard !== undefined
  ) {
    return fields;
  }
  return {
    ...fields,
    competitionLevelLatin: fields.competitionLevel,
    competitionLevelStandard: fields.competitionLevel,
  };
}

/** Highest level the dancer holds in any discipline (legacy as fallback). */
export function getHighestCompetitionLevel(
  user: CompetitionLevelProfile | null | undefined,
): CompetitionLevel | null {
  if (!user) return null;
  const candidates = [
    user.competitionLevelLatin,
    user.competitionLevelStandard,
    user.competitionLevel,
  ];
  let best: CompetitionLevel | null = null;
  for (const candidate of candidates) {
    const level = toCompetitionLevel(candidate);
    if (level && competitionLevelRank(level) > competitionLevelRank(best)) {
      best = level;
    }
  }
  return best;
}

/**
 * Does the dancer practise this discipline?
 * Signals: a per-discipline level set, or the declared discipline
 * (User.category; "Ten Dance" means both Latin and Standard).
 * - Latin / Standard → that discipline is covered.
 * - Ten Dance → BOTH Latin and Standard are covered.
 * Returns null when the profile carries no discipline information at all
 * (callers then do not block on the discipline).
 */
export function practisesDiscipline(
  user: CompetitionLevelProfile | null | undefined,
  category: string | null | undefined,
): boolean | null {
  if (!user) return null;
  const declared = normalizeDiscipline(user.category);
  const hasLatinLevel = toCompetitionLevel(user.competitionLevelLatin) !== null;
  const hasStandardLevel =
    toCompetitionLevel(user.competitionLevelStandard) !== null;
  if (!declared && !hasLatinLevel && !hasStandardLevel) return null;

  const latin =
    hasLatinLevel || declared === "Latin" || declared === "Ten Dance";
  const standard =
    hasStandardLevel || declared === "Standard" || declared === "Ten Dance";

  switch (normalizeDiscipline(category)) {
    case "Latin":
      return latin;
    case "Standard":
      return standard;
    case "Ten Dance":
      return latin && standard;
    default:
      // Unknown event discipline: nothing to compare against.
      return null;
  }
}
