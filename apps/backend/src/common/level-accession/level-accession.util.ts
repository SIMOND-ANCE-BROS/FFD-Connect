/**
 * Niveaux de compétition des couples – Règlement Sportif FFDanse.
 * 3.1–3.5 Plafond de niveau en cas de changement de classe d'âge.
 *
 * Le niveau de compétition (Débutant, Intermédiaire, Avancé, International)
 * est propre à chaque discipline et N'EST PAS déduit des couleurs du Passeport
 * Danse (décision produit) : aucune règle ici ne filtre un niveau selon un
 * passeport. Le niveau d'un danseur se lit via getCompetitionLevelForCategory
 * (src/common/competition-level).
 *
 * L'ordre des couleurs du Passeport Danse reste exposé : il sert aux niveaux
 * SOLO (Novice / Confirmé / Expérimenté, src/common/solo-rules), concept
 * distinct du niveau de compétition.
 */

import type { CompetitionLevel } from "../age-group/age-group.util";
import { getAllowedLevelsForAgeGroup } from "../age-group/age-group.util";

/** Ordre des couleurs Passeport Danse (du plus bas au plus haut). */
export const PASSPORT_LEVEL_ORDER = [
  "BLANC",
  "BEIGE",
  "JAUNE",
  "ORANGE",
  "VERT",
  "VIOLET",
  "BLEU",
  "ROUGE",
  "NOIR",
] as const;

export type PassportLevelValue = (typeof PASSPORT_LEVEL_ORDER)[number];

/**
 * Retourne l'ordre (index) d'une couleur passeport. Plus l'index est élevé, plus le niveau est élevé.
 */
export function passportOrder(level: string | null | undefined): number {
  if (!level?.trim()) return -1;
  const idx = PASSPORT_LEVEL_ORDER.indexOf(
    level.trim().toUpperCase() as PassportLevelValue,
  );
  return idx >= 0 ? idx : -1;
}

/**
 * Vérifie si le danseur a au moins la couleur de passeport requise.
 * On considère le meilleur des deux (Latine et Standard).
 * Utilisé par les niveaux SOLO uniquement (solo-rules).
 */
export function hasAtLeastPassport(
  passportLatin: string | null | undefined,
  passportStandard: string | null | undefined,
  minColor: PassportLevelValue,
): boolean {
  const minOrder = passportOrder(minColor);
  if (minOrder < 0) return false;
  const lat = passportOrder(passportLatin);
  const std = passportOrder(passportStandard);
  const best = Math.max(lat, std);
  return best >= minOrder;
}

/**
 * Plafond de niveau selon la classe d'âge du couple (Article 3 – changement de classe d'âge).
 * Ex. : Juvénile I → au mieux Intermédiaire ; Junior II → au mieux Avancé.
 */
const MAX_LEVEL_BY_COUPLE_AGE_GROUP: Record<string, CompetitionLevel> = {
  "Juvénile I": "Intermédiaire",
  "Juvénile II": "Intermédiaire",
  "Junior I": "Intermédiaire",
  "Junior II": "Avancé",
  Youth: "Avancé",
  Adulte: "International",
  "Senior I": "International",
  "Senior II": "International",
  "Senior III": "International",
  "Senior IV": "International",
  "Senior V": "International",
};

const LEVEL_ORDER: CompetitionLevel[] = [
  "Débutant",
  "Intermédiaire",
  "Avancé",
  "International",
];

function levelOrderIndex(l: CompetitionLevel): number {
  const i = LEVEL_ORDER.indexOf(l);
  return i >= 0 ? i : 999;
}

/**
 * Retourne le niveau maximum autorisé pour une classe d'âge (Article 3.1–3.5).
 * Si la classe n'est pas dans la table, pas de plafond (on s'appuie sur getAllowedLevelsForAgeGroup).
 */
export function getMaxLevelForCoupleAgeGroup(
  ageGroup: string | null | undefined,
): CompetitionLevel | null {
  if (!ageGroup?.trim()) return null;
  return MAX_LEVEL_BY_COUPLE_AGE_GROUP[ageGroup.trim()] ?? null;
}

/**
 * Niveaux autorisés pour un couple selon sa classe d'âge uniquement
 * (niveaux autorisés + plafond art. 3). Le Passeport Danse n'intervient pas.
 */
export function getAllowedLevelsForCouple(
  coupleAgeGroup: string | null | undefined,
): CompetitionLevel[] {
  const allowedByAge = coupleAgeGroup
    ? getAllowedLevelsForAgeGroup("COUPLE", coupleAgeGroup)
    : [];
  if (allowedByAge.length === 0) return [];

  const maxForAge = getMaxLevelForCoupleAgeGroup(coupleAgeGroup);
  return maxForAge
    ? allowedByAge.filter(
        (l) => levelOrderIndex(l) <= levelOrderIndex(maxForAge),
      )
    : allowedByAge;
}
