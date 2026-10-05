/**
 * Règles d'accession au niveau supérieur – Règlement Sportif FFDanse.
 * 2.1 Accession Intermédiaire (passeport orange min.)
 * 2.2 Accession Avancé (2 Critériums + 8 épreuves classificatrices + passeport violet) – à compléter avec données participation
 * 2.3 Accession International (Adulte/Senior, 2 derniers Critériums + 750 pts + passeport rouge) – à compléter
 * 3.1–3.5 Plafond de niveau en cas de changement de classe d'âge
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

/** Couleur minimale requise pour chaque niveau (Article 2). */
export const MIN_PASSPORT_FOR_LEVEL: Record<
  CompetitionLevel,
  PassportLevelValue
> = {
  Débutant: "BLANC", // pas de condition spécifique
  Intermédiaire: "ORANGE", // 2.1
  Avancé: "VIOLET", // 2.2
  International: "ROUGE", // 2.3
};

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
 * Vérifie si le partenaire a au moins la couleur de passeport requise.
 * On considère le meilleur des deux (Latine et Standard) pour chaque partenaire.
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
 * Les deux partenaires doivent avoir au moins la couleur requise pour le niveau (2.1, 2.2, 2.3).
 * Pour le niveau Débutant, le règlement n'exige pas de couleur de passeport (licence C minimum).
 */
export function coupleMeetsPassportForLevel(
  partner1: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  partner2: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  level: CompetitionLevel,
): boolean {
  if (level === "Débutant") return true;
  const minColor = MIN_PASSPORT_FOR_LEVEL[level];
  return (
    hasAtLeastPassport(
      partner1.passportLevelLatin,
      partner1.passportLevelStandard,
      minColor,
    ) &&
    hasAtLeastPassport(
      partner2.passportLevelLatin,
      partner2.passportLevelStandard,
      minColor,
    )
  );
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
 * Filtre les niveaux autorisés pour un couple selon :
 * - classe d'âge (niveaux autorisés + plafond art. 3),
 * - respect de la couleur passeport minimale pour chaque niveau (2.1, 2.2, 2.3).
 * Les deux partenaires doivent avoir au moins la couleur requise pour qu'un niveau soit proposé.
 */
export function getAllowedLevelsForCouple(
  coupleAgeGroup: string | null | undefined,
  partner1: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  partner2: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
): CompetitionLevel[] {
  const allowedByAge = coupleAgeGroup
    ? getAllowedLevelsForAgeGroup("COUPLE", coupleAgeGroup)
    : [];
  if (allowedByAge.length === 0) return [];

  const maxForAge = getMaxLevelForCoupleAgeGroup(coupleAgeGroup);
  const capped = maxForAge
    ? allowedByAge.filter(
        (l) => levelOrderIndex(l) <= levelOrderIndex(maxForAge),
      )
    : allowedByAge;

  return capped.filter((level) =>
    coupleMeetsPassportForLevel(partner1, partner2, level),
  );
}

/**
 * Indique si l'accession au niveau Intermédiaire est possible (2.1).
 * Condition : couple actuellement Débutant + les deux ont au moins orange.
 * La "demande du responsable technique" n'est pas vérifiable ici (workflow à part).
 */
export function canAccessIntermediaire(
  partner1: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  partner2: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
): boolean {
  return coupleMeetsPassportForLevel(partner1, partner2, "Intermédiaire");
}

/**
 * Pour 2.2 (Avancé) et 2.3 (International), les conditions de participation (Critériums, épreuves, points)
 * doivent être évaluées côté métier quand les données d'inscriptions/résultats seront disponibles.
 * Cette fonction retourne uniquement la condition passeport.
 */
export function meetsPassportForAvance(
  partner1: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  partner2: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
): boolean {
  return coupleMeetsPassportForLevel(partner1, partner2, "Avancé");
}

export function meetsPassportForInternational(
  partner1: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
  partner2: {
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  },
): boolean {
  return coupleMeetsPassportForLevel(partner1, partner2, "International");
}
