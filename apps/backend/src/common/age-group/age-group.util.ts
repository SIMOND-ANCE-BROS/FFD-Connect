/**
 * Calcul des classes d'âge selon le Règlement Sportif FFDanse – Danses Latines et Standards
 * (Article 4 – Couples et solos, Article 5 – Classes d'âge).
 * Âge retenu au 31 décembre de l'année de référence.
 */

/** Classe d'âge pour les couples (Article 5 – LES COUPLES). */
export const COUPLE_AGE_GROUPS = [
  "Juvénile I",
  "Juvénile II",
  "Junior I",
  "Junior II",
  "Youth",
  "Adulte",
  "Senior I",
  "Senior II",
  "Senior III",
  "Senior IV",
  "Senior V",
] as const;

/** Classe d'âge pour les solos (Article 5 – LES SOLOS). */
export const SOLO_AGE_GROUPS = [
  "Solo Juvénile",
  "Solo Junior 1",
  "Solo Junior 2",
  "Solo Youth",
  "Solo Adulte",
  "Solo Senior",
] as const;

export type CoupleAgeGroup = (typeof COUPLE_AGE_GROUPS)[number];

/**
 * « Espoir » (moins de 21 ans) : classe d'ÉPREUVE couple, pas une classe d'âge
 * individuelle — un couple Youth ou Adulte peut s'y inscrire si les deux
 * partenaires ont entre 16 et 20 ans au 31 décembre.
 */
export const ESPOIR_AGE_GROUP = "Espoir";
export const ESPOIR_MIN_AGE = 16;
export const ESPOIR_MAX_AGE = 20;
export type SoloAgeGroup = (typeof SOLO_AGE_GROUPS)[number];

/** Niveaux de compétition (table Niveaux – règlement technique). */
export const COMPETITION_LEVELS = [
  "International",
  "Avancé",
  "Intermédiaire",
  "Débutant",
] as const;

export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];

/**
 * Niveaux autorisés par type d'épreuve et classe d'âge (table Niveaux).
 * Couple : Juvénile I/II → Intermédiaire, Débutant ; Junior I/II, Youth → Avancé, Intermédiaire, Débutant ;
 * Adulte, Senior I/II/IV/V → International, Avancé, Intermédiaire ; Senior III → + Débutant.
 * Solo : Juvénile → Intermédiaire, Débutant ; Junior 1/2, Youth, Adulte, Senior → Avancé, Intermédiaire, Débutant.
 */
const ALLOWED_LEVELS_BY_COUPLE_AGE_GROUP: Record<
  string,
  readonly CompetitionLevel[]
> = {
  "Juvénile I": ["Intermédiaire", "Débutant"],
  "Juvénile II": ["Intermédiaire", "Débutant"],
  "Junior I": ["Avancé", "Intermédiaire", "Débutant"],
  "Junior II": ["Avancé", "Intermédiaire", "Débutant"],
  Youth: ["Avancé", "Intermédiaire", "Débutant"],
  Adulte: ["International", "Avancé", "Intermédiaire"],
  [ESPOIR_AGE_GROUP]: ["International", "Avancé", "Intermédiaire"],
  "Senior I": ["International", "Avancé", "Intermédiaire"],
  "Senior II": ["International", "Avancé", "Intermédiaire"],
  "Senior III": ["International", "Avancé", "Intermédiaire", "Débutant"],
  "Senior IV": ["International", "Avancé", "Intermédiaire"],
  "Senior V": ["International", "Avancé", "Intermédiaire"],
};

const ALLOWED_LEVELS_BY_SOLO_AGE_GROUP: Record<
  string,
  readonly CompetitionLevel[]
> = {
  "Solo Juvénile": ["Intermédiaire", "Débutant"],
  "Solo Junior 1": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Junior 2": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Youth": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Adulte": ["Avancé", "Intermédiaire", "Débutant"],
  "Solo Senior": ["Avancé", "Intermédiaire", "Débutant"],
};

/**
 * Retourne les niveaux de compétition autorisés pour une classe d'âge et un type d'épreuve.
 * @param eventType - COUPLE ou SOLO
 * @param ageGroup - Classe d'âge (ex. "Junior I", "Solo Youth")
 * @returns Liste des niveaux autorisés (ex. ["Avancé", "Intermédiaire", "Débutant"])
 */
export function getAllowedLevelsForAgeGroup(
  eventType: "COUPLE" | "SOLO",
  ageGroup: string,
): CompetitionLevel[] {
  if (!ageGroup.trim()) return [];
  const key = ageGroup.trim();
  if (eventType === "COUPLE") {
    return [...(ALLOWED_LEVELS_BY_COUPLE_AGE_GROUP[key] ?? [])];
  }
  return [...(ALLOWED_LEVELS_BY_SOLO_AGE_GROUP[key] ?? [])];
}

/** Retourne l'âge en années au 31 décembre de l'année de référence. */
export function getAgeAtReferenceDate(
  birthDate: Date,
  referenceYear: number,
): number {
  const refDate = new Date(referenceYear, 11, 31); // 31 décembre
  const birth = birthDate instanceof Date ? birthDate : new Date(birthDate);
  let age = refDate.getFullYear() - birth.getFullYear();
  const monthDiff = refDate.getMonth() - birth.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && refDate.getDate() < birth.getDate())
  ) {
    age -= 1;
  }
  return Math.max(0, age);
}

/**
 * Calcule la classe d'âge SOLO (Article 5 – LES SOLOS).
 * Âge retenu au 31 décembre de l'année de référence.
 */
export function computeSoloAgeGroup(
  birthDate: Date | null | undefined,
  referenceYear: number,
): SoloAgeGroup | null {
  if (!birthDate) return null;
  const age = getAgeAtReferenceDate(birthDate, referenceYear);
  if (age <= 11) return "Solo Juvénile";
  if (age <= 13) return "Solo Junior 1";
  if (age <= 15) return "Solo Junior 2";
  if (age <= 18) return "Solo Youth";
  if (age >= 30) return "Solo Senior";
  return "Solo Adulte"; // 19–29
}

/**
 * Calcule la classe d'âge COUPLE (Article 5 – LES COUPLES).
 * Âge retenu au 31 décembre de l'année de référence.
 * Pour les Seniors, les deux partenaires doivent respecter les bornes (plus âgé / plus jeune).
 */
export function computeCoupleAgeGroup(
  birthDateOlder: Date | null | undefined,
  birthDateYounger: Date | null | undefined,
  referenceYear: number,
): CoupleAgeGroup | null {
  if (!birthDateOlder || !birthDateYounger) return null;
  const older = getAgeAtReferenceDate(birthDateOlder, referenceYear);
  const younger = getAgeAtReferenceDate(birthDateYounger, referenceYear);
  // On s'assure que older >= younger (si inversé, on swap)
  const [a, b] = older >= younger ? [older, younger] : [younger, older];
  const ageOlder = a;
  const ageYounger = b;

  if (ageOlder <= 9) return "Juvénile I";
  if (ageOlder <= 11) return "Juvénile II";
  if (ageOlder >= 12 && ageOlder <= 13) return "Junior I";
  if (ageOlder >= 14 && ageOlder <= 15) return "Junior II";
  if (ageOlder >= 16 && ageOlder <= 18) return "Youth";
  if (ageOlder >= 19 && ageOlder < 30) return "Adulte";

  // Seniors : conditions sur les deux partenaires
  if (ageOlder >= 70 && ageYounger >= 70) return "Senior V";
  if (ageOlder >= 65 && ageYounger >= 60) return "Senior IV";
  if (ageOlder >= 55 && ageYounger >= 50) return "Senior III";
  if (ageOlder >= 45 && ageYounger >= 40) return "Senior II";
  if (ageOlder >= 35 && ageYounger >= 30) return "Senior I";

  // Adulte si 19+ pour le plus âgé mais pas encore senior
  if (ageOlder >= 19) return "Adulte";

  return null;
}

/** Vrai si le couple a l'âge Espoir : les deux partenaires ont 16 à 20 ans au 31 décembre. */
export function isCoupleEspoirEligible(
  birthDateA: Date,
  birthDateB: Date,
  referenceYear: number,
): boolean {
  return [birthDateA, birthDateB].every((birthDate) => {
    const age = getAgeAtReferenceDate(birthDate, referenceYear);
    return age >= ESPOIR_MIN_AGE && age <= ESPOIR_MAX_AGE;
  });
}

/**
 * Retourne l'année de référence (année civile) pour une date donnée.
 * Par défaut : année en cours.
 */
export function getReferenceYear(date?: Date | null): number {
  if (!date) return new Date().getFullYear();
  return date instanceof Date
    ? date.getFullYear()
    : new Date(date).getFullYear();
}
