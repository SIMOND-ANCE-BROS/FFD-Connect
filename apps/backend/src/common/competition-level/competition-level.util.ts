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
 * The single `User.competitionLevel` column is deprecated (#239): read only
 * as a fallback for profiles without any per-discipline level, served to
 * older app versions as a value derived from the per-discipline levels, and
 * dropped in phase 2 (docs/exploitation/retrait-niveau-competition-unique.md).
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
 * True when the profile holds at least one valid per-discipline level. The
 * deprecated single `competitionLevel` is only a fallback for profiles where
 * this is false (rows never backfilled, or written by a pre-#210 revision):
 * once a discipline level exists, the legacy value is ignored, otherwise a
 * cleared discipline level would resurface a stale legacy one (#239).
 */
export function hasDisciplineLevel(
  user: CompetitionLevelProfile | null | undefined,
): boolean {
  return (
    toCompetitionLevel(user?.competitionLevelLatin) !== null ||
    toCompetitionLevel(user?.competitionLevelStandard) !== null
  );
}

/** Legacy single level, only when no per-discipline level is set. */
function legacyFallback(
  user: CompetitionLevelProfile,
): CompetitionLevel | null {
  return hasDisciplineLevel(user)
    ? null
    : toCompetitionLevel(user.competitionLevel);
}

/** Highest level the dancer holds in any discipline (legacy as fallback). */
export function getHighestCompetitionLevel(
  user: CompetitionLevelProfile | null | undefined,
): CompetitionLevel | null {
  if (!user) return null;
  let best: CompetitionLevel | null = null;
  for (const candidate of [
    user.competitionLevelLatin,
    user.competitionLevelStandard,
  ]) {
    const level = toCompetitionLevel(candidate);
    if (level && competitionLevelRank(level) > competitionLevelRank(best)) {
      best = level;
    }
  }
  return best ?? legacyFallback(user);
}

/**
 * Competition level of a dancer for an event discipline.
 * - Latin → `competitionLevelLatin`, Standard → `competitionLevelStandard`.
 *   The deprecated single `competitionLevel` is used only when the profile
 *   has no per-discipline level at all.
 * - Ten Dance → null: 10-dance events have no level requirement.
 * - Unknown discipline → the highest level (best effort).
 */
export function getCompetitionLevelForCategory(
  user: CompetitionLevelProfile | null | undefined,
  category: string | null | undefined,
): CompetitionLevel | null {
  if (!user) return null;
  switch (normalizeDiscipline(category)) {
    case "Latin":
      return (
        toCompetitionLevel(user.competitionLevelLatin) ?? legacyFallback(user)
      );
    case "Standard":
      return (
        toCompetitionLevel(user.competitionLevelStandard) ??
        legacyFallback(user)
      );
    case "Ten Dance":
      return null;
    default:
      return getHighestCompetitionLevel(user);
  }
}

/**
 * Value served as the deprecated `competitionLevel` API field (older app
 * versions only know it) and mirrored in the legacy column for a rolled-back
 * revision: the highest per-discipline level, the legacy value when the
 * profile has none. Removed with the column in phase 2 (#239).
 */
export const deriveLegacyCompetitionLevel = getHighestCompetitionLevel;

/**
 * Returns the record with `competitionLevel` replaced by the value derived
 * from the per-discipline levels ({@link deriveLegacyCompetitionLevel}), for
 * API responses read by older app versions.
 */
export function withDerivedCompetitionLevel<T extends CompetitionLevelProfile>(
  record: T,
): T & { competitionLevel: CompetitionLevel | null } {
  return { ...record, competitionLevel: deriveLegacyCompetitionLevel(record) };
}

/** Level fields a writer may send. `undefined` = absent, `null` = cleared. */
export interface CompetitionLevelWrite {
  competitionLevel?: string | null;
  competitionLevelLatin?: string | null;
  competitionLevelStandard?: string | null;
}

/**
 * Backward compatibility for writers that only know the deprecated single
 * `competitionLevel` (older back-office): when it is written WITHOUT any
 * per-discipline level in the same payload, it is copied to both disciplines
 * (otherwise the per-discipline values, read first, would hide the edit).
 * The legacy key itself is dropped: it is never written as such any more
 * (see {@link legacyCompetitionLevelMirror}).
 */
export function mirrorLegacyCompetitionLevel<T extends CompetitionLevelWrite>(
  fields: T,
): Omit<T, "competitionLevel"> {
  const { competitionLevel, ...rest } = fields;
  if (
    competitionLevel === undefined ||
    rest.competitionLevelLatin !== undefined ||
    rest.competitionLevelStandard !== undefined
  ) {
    return rest;
  }
  return {
    ...rest,
    competitionLevelLatin: competitionLevel,
    competitionLevelStandard: competitionLevel,
  };
}

/**
 * Rollback mirror of the legacy column (#239, phase 1): when a write touches
 * a per-discipline level, the legacy column receives the derived value, so a
 * rolled-back revision serves a fresh value and the read fallback can never
 * resurface a stale one. `undefined` when the write touches no level (column
 * left as is). `current` = the stored levels, for partial updates.
 */
export function legacyCompetitionLevelMirror(
  write: Omit<CompetitionLevelWrite, "competitionLevel">,
  current?: Omit<CompetitionLevelWrite, "competitionLevel"> | null,
): CompetitionLevel | null | undefined {
  if (
    write.competitionLevelLatin === undefined &&
    write.competitionLevelStandard === undefined
  ) {
    return undefined;
  }
  return getHighestCompetitionLevel({
    competitionLevelLatin:
      write.competitionLevelLatin !== undefined
        ? write.competitionLevelLatin
        : (current?.competitionLevelLatin ?? null),
    competitionLevelStandard:
      write.competitionLevelStandard !== undefined
        ? write.competitionLevelStandard
        : (current?.competitionLevelStandard ?? null),
  });
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

/**
 * Discipline(s) the dancer actually practises, for display (licence card,
 * Apple Wallet pass — #552). "Ten Dance" only when BOTH Latin and Standard
 * are practised.
 *
 * Source of truth is the dancer's profile, not `License.category`: the latter
 * is written once (federation import, or a placeholder for beta licences) and
 * never follows the profile edits made in the back-office. Precedence:
 * 1. a declared single discipline (User.category = Latin / Standard): an
 *    explicit choice, never a placeholder;
 * 2. the per-discipline competition levels: one set → that discipline, both
 *    set → Ten Dance (a "Ten Dance" User.category may be a registration
 *    placeholder copied from the licence, so it must not hide a Latin-only or
 *    Standard-only level);
 * 3. a declared "Ten Dance";
 * 4. the licence's own category (`fallback`), when it is a known discipline.
 * Returns null when nothing is known.
 */
export function practisedDiscipline(
  user: CompetitionLevelProfile | null | undefined,
  fallback?: string | null,
): Discipline | null {
  const declared = normalizeDiscipline(user?.category);
  if (declared === "Latin" || declared === "Standard") return declared;

  const latin = toCompetitionLevel(user?.competitionLevelLatin) !== null;
  const standard = toCompetitionLevel(user?.competitionLevelStandard) !== null;
  if (latin && standard) return "Ten Dance";
  if (latin) return "Latin";
  if (standard) return "Standard";

  return declared ?? normalizeDiscipline(fallback);
}
