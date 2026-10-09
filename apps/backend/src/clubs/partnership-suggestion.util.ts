import {
  computeCoupleAgeGroup,
  getReferenceYear,
  type CompetitionLevel,
} from "../common/age-group/age-group.util";
import {
  disciplineLabel,
  getCompetitionLevelForCategory,
  practisesDiscipline,
  type CompetitionLevelProfile,
} from "../common/competition-level";
import { getAllowedLevelsForCouple } from "../common/level-accession/level-accession.util";

export const LEVEL_ORDER: CompetitionLevel[] = [
  "Débutant",
  "Intermédiaire",
  "Avancé",
  "International",
];

export function levelOrder(l: string | null | undefined): number {
  const i = LEVEL_ORDER.indexOf(l as CompetitionLevel);
  return i >= 0 ? i : 999;
}

export interface PartnershipUserInput extends CompetitionLevelProfile {
  birthDate: Date | null;
  category: string | null;
}

export interface PartnershipSuggestion {
  coupleAgeGroup: string | null;
  /** Suggested level in Latin (null if the couple does not dance Latin). */
  suggestedLevelLatin: CompetitionLevel | null;
  /** Suggested level in Standard (null if the couple does not dance Standard). */
  suggestedLevelStandard: CompetitionLevel | null;
  /**
   * @deprecated single level kept for older clients: the LOWER of the
   * per-discipline suggestions. Use suggestedLevelLatin / suggestedLevelStandard.
   */
  suggestedLevel: CompetitionLevel | null;
  /** French labels of the disciplines the couple can dance (Latines, Standards, 10 danses). */
  suggestedCategories: string[];
}

/**
 * Suggested level for one discipline: the highest level allowed for the
 * couple age class that does not exceed the lower partner level IN THAT
 * DISCIPLINE (lowest allowed level when a partner has no level).
 */
function suggestLevelForDiscipline(
  allowedLevels: CompetitionLevel[],
  u1: PartnershipUserInput,
  u2: PartnershipUserInput,
  discipline: "Latin" | "Standard",
): CompetitionLevel | null {
  if (allowedLevels.length === 0) return null;
  const o1 = levelOrder(getCompetitionLevelForCategory(u1, discipline));
  const o2 = levelOrder(getCompetitionLevelForCategory(u2, discipline));
  const minPartnerOrder = o1 < 999 && o2 < 999 ? Math.min(o1, o2) : 0;
  const possibleLevels = allowedLevels.filter(
    (l) => levelOrder(l) <= minPartnerOrder,
  );
  return possibleLevels.length > 0
    ? possibleLevels.reduce((a, b) => (levelOrder(a) >= levelOrder(b) ? a : b))
    : allowedLevels[allowedLevels.length - 1];
}

/** Both partners practise the discipline (missing information does not exclude). */
function coupleDances(
  u1: PartnershipUserInput,
  u2: PartnershipUserInput,
  discipline: "Latin" | "Standard" | "Ten Dance",
): boolean {
  return (
    practisesDiscipline(u1, discipline) !== false &&
    practisesDiscipline(u2, discipline) !== false
  );
}

export function computePartnershipSuggestion(
  u1: PartnershipUserInput,
  u2: PartnershipUserInput,
  startDate: Date,
): PartnershipSuggestion {
  const refYear = getReferenceYear(startDate);
  const b1 = u1.birthDate ? new Date(u1.birthDate) : null;
  const b2 = u2.birthDate ? new Date(u2.birthDate) : null;
  const [birthOlder, birthYounger] =
    b1 && b2
      ? b1.getTime() <= b2.getTime()
        ? [b2, b1]
        : [b1, b2]
      : [null, null];
  const coupleAgeGroup =
    birthOlder !== null
      ? computeCoupleAgeGroup(birthOlder, birthYounger, refYear)
      : null;

  // Age class only: the competition level never depends on the passport.
  const allowedLevels = getAllowedLevelsForCouple(coupleAgeGroup);

  const dancesLatin = coupleDances(u1, u2, "Latin");
  const dancesStandard = coupleDances(u1, u2, "Standard");

  const suggestedLevelLatin = dancesLatin
    ? suggestLevelForDiscipline(allowedLevels, u1, u2, "Latin")
    : null;
  const suggestedLevelStandard = dancesStandard
    ? suggestLevelForDiscipline(allowedLevels, u1, u2, "Standard")
    : null;

  const perDiscipline = [suggestedLevelLatin, suggestedLevelStandard].filter(
    (l): l is CompetitionLevel => l !== null,
  );
  const suggestedLevel =
    perDiscipline.length > 0
      ? perDiscipline.reduce((a, b) => (levelOrder(a) <= levelOrder(b) ? a : b))
      : null;

  const categories: ("Latin" | "Standard" | "Ten Dance")[] = [];
  if (dancesLatin) categories.push("Latin");
  if (dancesStandard) categories.push("Standard");
  // 10 danses only when both partners are known to practise both disciplines.
  if (
    practisesDiscipline(u1, "Ten Dance") === true &&
    practisesDiscipline(u2, "Ten Dance") === true
  ) {
    categories.push("Ten Dance");
  }
  const suggestedCategories = (
    categories.length > 0 ? categories : ["Latin", "Standard"]
  ).map((c) => disciplineLabel(c));

  return {
    coupleAgeGroup,
    suggestedLevelLatin,
    suggestedLevelStandard,
    suggestedLevel,
    suggestedCategories,
  };
}
