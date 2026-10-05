/**
 * Règles spécifiques aux épreuves de danse en SOLO – Règlement Sportif FFDanse.
 * - Regroupements de classes d'âges pour l'organisation des épreuves
 * - Niveaux : Novice, Confirmé, Expérimenté (avec licence et passeport)
 * - Répartition des danses par niveau et spécialité (Latines / Standards)
 */

import type { SoloAgeGroup } from "../age-group/age-group.util";
import { getAgeAtReferenceDate } from "../age-group/age-group.util";
import {
  hasAtLeastPassport,
  type PassportLevelValue,
} from "../level-accession/level-accession.util";

// ---------------------------------------------------------------------------
// Regroupements de classes d'âges (organisation des épreuves solo)
// ---------------------------------------------------------------------------

/** Regroupements d'âges pour les épreuves solo. */
export const SOLO_AGE_REGROUPEMENTS = [
  "Moins de 14 ans",
  "Moins de 19 ans",
  "Moins de 30 ans",
  "30 ans et Plus",
] as const;

export type SoloAgeRegroupement = (typeof SOLO_AGE_REGROUPEMENTS)[number];

/**
 * Moins de 14 ans = Juvénile 1, Juvénile 2, Junior 1
 * Moins de 19 ans = Junior 2, Youth
 * Moins de 30 ans = Adulte (< 30)
 * 30 ans et Plus = Senior (30+)
 */
const SOLO_AGE_GROUP_TO_REGROUPEMENT: Record<
  SoloAgeGroup,
  SoloAgeRegroupement
> = {
  "Solo Juvénile": "Moins de 14 ans",
  "Solo Junior 1": "Moins de 14 ans",
  "Solo Junior 2": "Moins de 19 ans",
  "Solo Youth": "Moins de 19 ans",
  "Solo Adulte": "Moins de 30 ans",
  "Solo Senior": "30 ans et Plus",
};

/**
 * Retourne le regroupement d'âge pour une classe d'âge solo détaillée.
 */
export function getSoloRegroupementFromAgeGroup(
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  ageGroup: SoloAgeGroup | string | null,
): SoloAgeRegroupement | null {
  if (!ageGroup?.trim()) return null;
  const key = ageGroup.trim() as SoloAgeGroup;
  return SOLO_AGE_GROUP_TO_REGROUPEMENT[key];
}

/**
 * Calcule le regroupement d'âge solo à partir de la date de naissance (au 31/12 de l'année de référence).
 */
export function computeSoloAgeRegroupement(
  birthDate: Date | null | undefined,
  referenceYear: number,
): SoloAgeRegroupement | null {
  if (!birthDate) return null;
  const age = getAgeAtReferenceDate(birthDate, referenceYear);
  if (age < 14) return "Moins de 14 ans";
  if (age < 19) return "Moins de 19 ans";
  if (age < 30) return "Moins de 30 ans";
  return "30 ans et Plus";
}

// ---------------------------------------------------------------------------
// Niveaux solo : Novice, Confirmé, Expérimenté
// ---------------------------------------------------------------------------

export const SOLO_LEVELS = ["Novice", "Confirmé", "Expérimenté"] as const;
export type SoloLevel = (typeof SOLO_LEVELS)[number];

/** Licence minimale : Novice = titre découverte ; Confirmé / Expérimenté = licence B. */
export const MIN_LICENCE_FOR_SOLO_LEVEL: Record<SoloLevel, string> = {
  Novice: "titre découverte",
  Confirmé: "licence B",
  Expérimenté: "licence B",
};

/** Couleur Passeport Danse minimale pour chaque niveau solo. */
export const MIN_PASSPORT_FOR_SOLO_LEVEL: Record<
  SoloLevel,
  PassportLevelValue | null
> = {
  Novice: null,
  Confirmé: "ORANGE",
  Expérimenté: "VERT",
};

/**
 * Vérifie si le danseur solo a la couleur de passeport requise pour le niveau.
 */
export function soloMeetsPassportForLevel(
  passportLatin: string | null | undefined,
  passportStandard: string | null | undefined,
  level: SoloLevel,
): boolean {
  const minColor = MIN_PASSPORT_FOR_SOLO_LEVEL[level];
  if (!minColor) return true;
  return hasAtLeastPassport(passportLatin, passportStandard, minColor);
}

/**
 * Pour accéder à Confirmé ou Expérimenté : 5 compétitions classificatrices + couleur passeport.
 * Cette fonction ne vérifie que le passeport ; les 5 participations sont à vérifier côté métier.
 */
export function meetsPassportForSoloConfirmé(
  passportLatin: string | null | undefined,
  passportStandard: string | null | undefined,
): boolean {
  return soloMeetsPassportForLevel(passportLatin, passportStandard, "Confirmé");
}

export function meetsPassportForSoloExperimente(
  passportLatin: string | null | undefined,
  passportStandard: string | null | undefined,
): boolean {
  return soloMeetsPassportForLevel(
    passportLatin,
    passportStandard,
    "Expérimenté",
  );
}

// ---------------------------------------------------------------------------
// Répartition des danses par niveau et spécialité (Article 5)
// ---------------------------------------------------------------------------

/** Nombre de danses par niveau : Novice 3, Confirmé 4, Expérimenté 5. */
export const DANCE_COUNT_BY_SOLO_LEVEL: Record<SoloLevel, number> = {
  Novice: 3,
  Confirmé: 4,
  Expérimenté: 5,
};

/** Danses Latines par niveau solo. */
export const SOLO_LATINES_DANCES_BY_LEVEL: Record<
  SoloLevel,
  readonly string[]
> = {
  Novice: ["Cha cha cha", "Rumba", "Jive"],
  Confirmé: ["Samba", "Cha cha cha", "Rumba", "Jive"],
  Expérimenté: ["Samba", "Cha cha cha", "Rumba", "Paso Doble", "Jive"],
};

/** Danses Standards par niveau solo. */
export const SOLO_STANDARDS_DANCES_BY_LEVEL: Record<
  SoloLevel,
  readonly string[]
> = {
  Novice: ["Valse Anglaise", "Tango", "Quickstep"],
  Confirmé: ["Valse Anglaise", "Tango", "Valse Viennoise", "Quickstep"],
  Expérimenté: [
    "Valse Anglaise",
    "Tango",
    "Valse Viennoise",
    "Slowfox",
    "Quickstep",
  ],
};

/**
 * Retourne la liste des danses pour un niveau et une spécialité (Latines ou Standards).
 */
export function getSoloDancesForLevelAndCategory(
  level: SoloLevel,
  category: "LATINE" | "STANDARD" | "LATINES" | "STANDARDS",
): string[] {
  const c = category.toUpperCase();
  if (c === "LATINE" || c === "LATINES")
    return [...SOLO_LATINES_DANCES_BY_LEVEL[level]];
  return [...SOLO_STANDARDS_DANCES_BY_LEVEL[level]];
}
