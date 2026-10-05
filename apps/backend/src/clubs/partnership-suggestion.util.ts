import {
  computeCoupleAgeGroup,
  getReferenceYear,
  type CompetitionLevel,
} from "../common/age-group/age-group.util";
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

export interface PartnershipUserInput {
  birthDate: Date | null;
  passportLevelLatin: string | null;
  passportLevelStandard: string | null;
  category: string | null;
  competitionLevel: string | null;
}

export interface PartnershipSuggestion {
  coupleAgeGroup: string | null;
  suggestedLevel: CompetitionLevel | null;
  suggestedCategories: string[];
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

  const allowedLevels = getAllowedLevelsForCouple(
    coupleAgeGroup,
    {
      passportLevelLatin: u1.passportLevelLatin,
      passportLevelStandard: u1.passportLevelStandard,
    },
    {
      passportLevelLatin: u2.passportLevelLatin,
      passportLevelStandard: u2.passportLevelStandard,
    },
  );

  const l1 = (u1.competitionLevel?.trim() ?? "") as CompetitionLevel;
  const l2 = (u2.competitionLevel?.trim() ?? "") as CompetitionLevel;
  const o1 = levelOrder(l1);
  const o2 = levelOrder(l2);
  const minPartnerOrder = o1 < 999 && o2 < 999 ? Math.min(o1, o2) : 0;
  const possibleLevels = allowedLevels.filter(
    (l) => levelOrder(l) <= minPartnerOrder,
  );
  const suggestedLevel =
    allowedLevels.length > 0
      ? possibleLevels.length > 0
        ? possibleLevels.reduce((a, b) =>
            levelOrder(a) >= levelOrder(b) ? a : b,
          )
        : allowedLevels[allowedLevels.length - 1]
      : null;

  const cats = new Set<string>();
  for (const c of [u1.category, u2.category].filter(Boolean) as string[]) {
    const n = c.trim().toLowerCase();
    if (n.includes("latin")) cats.add("Latine");
    if (n.includes("standard")) cats.add("Standard");
    if (n.includes("10") || n.includes("ten")) cats.add("10 danses");
  }
  if (cats.size === 0) {
    cats.add("Latine");
    cats.add("Standard");
  }

  return {
    coupleAgeGroup,
    suggestedLevel: suggestedLevel ?? null,
    suggestedCategories: Array.from(cats),
  };
}
