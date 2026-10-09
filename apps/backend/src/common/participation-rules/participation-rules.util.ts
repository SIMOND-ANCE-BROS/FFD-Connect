/**
 * Règles de participation aux épreuves – Article 9 du Règlement Sportif FFDanse.
 * Types de compétitions (Article 8), éligibilité classe d'âge / niveau, une épreuve par spécialité (majeures).
 */

import {
  type CompetitionLevel,
  getAllowedLevelsForAgeGroup,
} from "../age-group";

/** Type de compétition (Article 8). */
export const COMPETITION_TYPES = [
  "PROXIMITE",
  "NATIONALE",
  "MAJEURE",
  "INTERNATIONALE",
] as const;
export type CompetitionTypeValue = (typeof COMPETITION_TYPES)[number];

/** Nature de l'épreuve pour application des règles (Article 9). */
export const EVENT_KINDS = [
  "CLASSIFICATRICE",
  "OPEN",
  "MAJEURE",
  "SOLO_TEAM",
  "SHOW_DANSE",
] as const;
export type EventKindValue = (typeof EVENT_KINDS)[number];

/**
 * Types d'épreuves autorisés par type de compétition (Article 8 + usages FFDanse).
 * - Proximité : classificatrices (niveaux débutant et intermédiaire uniquement), Open, loisir, solo team, danse en solo.
 * - Nationale : tous types (classificatrices, opens nationaux, solo, solo team).
 * - Majeure : tous types (Championnats régionaux, CF Latines/Standards/10, CF Show Danse, CF Solo Team, Coupe de France, Critériums).
 * - Internationale : tous types (WDSF).
 */
export const ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE: Record<
  CompetitionTypeValue,
  readonly EventKindValue[]
> = {
  PROXIMITE: ["CLASSIFICATRICE", "OPEN", "SOLO_TEAM", "SHOW_DANSE"],
  NATIONALE: ["CLASSIFICATRICE", "OPEN", "MAJEURE", "SOLO_TEAM", "SHOW_DANSE"],
  MAJEURE: ["CLASSIFICATRICE", "OPEN", "MAJEURE", "SOLO_TEAM", "SHOW_DANSE"],
  INTERNATIONALE: [
    "CLASSIFICATRICE",
    "OPEN",
    "MAJEURE",
    "SOLO_TEAM",
    "SHOW_DANSE",
  ],
};

/**
 * En compétition de proximité, les épreuves classificatrices ne peuvent être organisées
 * que pour les niveaux Débutant et Intermédiaire (pas Avancé ni International).
 */
export const LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE = [
  "Débutant",
  "Intermédiaire",
] as const;
export type ProximiteClassificatriceLevel =
  (typeof LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE)[number];

/** Résultat d'une vérification d'éligibilité. */
export interface ParticipationCheckResult {
  allowed: boolean;
  reason?: string;
}

// ----- Article 9 – Toutes compétitions : participations supplémentaires autorisées -----
// Juvénile I peut aussi participer à Juvénile II
// Junior I peut aussi participer à Junior II
// Senior V peut participer en Latines aux épreuves Senior IV

function isCoupleAgeGroupAllowedInEvent(
  registrantCoupleAgeGroup: string,
  eventAgeGroup: string,
  eventCategory: string,
): boolean {
  const r = registrantCoupleAgeGroup.trim();
  const e = eventAgeGroup.trim();
  if (r === e) return true;
  if (r === "Juvénile I" && e === "Juvénile II") return true;
  if (r === "Junior I" && e === "Junior II") return true;
  if (r === "Senior V" && e === "Senior IV") {
    const cat = (eventCategory || "").toLowerCase();
    return cat === "latin" || cat === "latines" || cat === "ten dance";
  }
  return false;
}

function isSoloAgeGroupAllowedInEvent(
  registrantSoloAgeGroup: string,
  eventAgeGroup: string,
): boolean {
  const r = registrantSoloAgeGroup.trim();
  const e = eventAgeGroup.trim();
  if (r === e) return true;
  // Pas de "also participate" spécifique pour solos dans le texte (sauf choix vers le haut ci‑dessous)
  return false;
}

// ----- Article 9 §1.3 – Couple : choix de danser dans une classe supérieure -----
const COUPLE_UPWARD_CHOICES: Record<string, string[]> = {
  "Junior II": ["Youth"],
  // Espoir = moins de 21 ans : la borne d'âge exacte est vérifiée à
  // l'inscription quand les dates de naissance sont connues.
  Youth: ["Adulte", "Espoir"],
  Adulte: ["Espoir"],
  "Senior I": ["Adulte"],
  "Senior II": ["Senior I"],
  "Senior III": ["Senior II"],
  "Senior IV": ["Senior III"],
  // Senior V → Senior IV is handled with category check in isCoupleAgeGroupAllowedInEvent
};

// ----- Article 9 §1.4 – Solo : choix de classe supérieure -----
const SOLO_UPWARD_CHOICES: Record<string, string[]> = {
  "Solo Junior 2": ["Solo Youth"], // "Un couple Junior II" = typo règlement, il s'agit du solo
  "Solo Youth": ["Solo Adulte"],
  "Solo Senior": ["Solo Adulte"],
};

/** Liste des classes d'âge vers lesquelles le couple peut choisir (inclut sa classe). */
export function getAllowedCoupleAgeClassesForEvent(
  registrantCoupleAgeGroup: string,
  _eventAgeGroup: string,
  eventCategory: string,
): string[] {
  const r = registrantCoupleAgeGroup.trim();
  const out = new Set<string>();
  out.add(r);
  if (r === "Juvénile I") out.add("Juvénile II");
  if (r === "Junior I") out.add("Junior II");
  if (r === "Senior V") {
    const cat = (eventCategory || "").toLowerCase();
    if (cat === "latin" || cat === "latines" || cat === "ten dance")
      out.add("Senior IV");
  }
  for (const [from, toList] of Object.entries(COUPLE_UPWARD_CHOICES)) {
    if (from === r) toList.forEach((c) => out.add(c));
  }
  return Array.from(out);
}

/** Liste des classes d'âge vers lesquelles le solo peut choisir (inclut sa classe). */
export function getAllowedSoloAgeClassesForEvent(
  registrantSoloAgeGroup: string,
  _eventAgeGroup: string,
): string[] {
  const r = registrantSoloAgeGroup.trim();
  const out = new Set<string>();
  out.add(r);
  for (const [from, toList] of Object.entries(SOLO_UPWARD_CHOICES)) {
    if (from === r) toList.forEach((c) => out.add(c));
  }
  return Array.from(out);
}

/** Vérifie si la classe d'âge du participant est autorisée pour l'épreuve (toutes compétitions + choix vers le haut). */
export function isAgeGroupEligibleForEvent(
  eventType: "COUPLE" | "SOLO",
  registrantAgeGroup: string,
  eventAgeGroup: string,
  eventCategory?: string,
): ParticipationCheckResult {
  if (!registrantAgeGroup.trim() || !eventAgeGroup.trim()) {
    return { allowed: false, reason: "Classe d'âge manquante" };
  }
  const r = registrantAgeGroup.trim();
  const e = eventAgeGroup.trim();

  if (eventType === "COUPLE") {
    if (isCoupleAgeGroupAllowedInEvent(r, e, eventCategory ?? ""))
      return { allowed: true };
    const allowed = getAllowedCoupleAgeClassesForEvent(
      r,
      e,
      eventCategory ?? "",
    );
    if (allowed.includes(e)) return { allowed: true };
    return {
      allowed: false,
      reason: `Votre classe d'âge couple (${r}) ne permet pas de participer à l'épreuve ${e}.`,
    };
  }

  // eventType === "SOLO"
  if (isSoloAgeGroupAllowedInEvent(r, e)) return { allowed: true };
  const allowed = getAllowedSoloAgeClassesForEvent(r, e);
  if (allowed.includes(e)) return { allowed: true };
  return {
    allowed: false,
    reason: `Votre classe d'âge solo (${r}) ne permet pas de participer à l'épreuve ${e}.`,
  };
}

/** Vérifie si le niveau du participant est autorisé pour une épreuve classificatrice. */
export function isLevelEligibleForClassificatriceEvent(
  eventType: "COUPLE" | "SOLO",
  registrantAgeGroup: string,
  registrantLevel: string | null | undefined,
  eventLevel: string | null | undefined,
): ParticipationCheckResult {
  if (!eventLevel?.trim()) return { allowed: true };
  const levelEvent = eventLevel.trim();
  const levelReg = (registrantLevel ?? "").trim();
  if (!levelReg) {
    return {
      allowed: false,
      reason:
        "Niveau du couple/solo non renseigné pour une épreuve classificatrice.",
    };
  }
  const allowed = getAllowedLevelsForAgeGroup(eventType, registrantAgeGroup);
  if (!allowed.length)
    return {
      allowed: false,
      reason: "Niveaux non définis pour cette classe d'âge.",
    };
  if (!allowed.includes(levelEvent as CompetitionLevel)) {
    return {
      allowed: false,
      reason: `L'épreuve est réservée au niveau ${levelEvent}. Votre classe d'âge permet : ${allowed.join(", ")}.`,
    };
  }
  const levelOrder = ["Débutant", "Intermédiaire", "Avancé", "International"];
  const idxReg = levelOrder.indexOf(levelReg);
  const idxEvt = levelOrder.indexOf(levelEvent);
  if (idxReg === -1 || idxEvt === -1) return { allowed: true };
  if (idxReg < idxEvt) {
    return {
      allowed: false,
      reason: `Épreuve classificatrice niveau ${levelEvent} : votre niveau (${levelReg}) est insuffisant.`,
    };
  }
  return { allowed: true };
}

/** Paramètres pour la vérification complète de participation. */
export interface ParticipationParams {
  eventType: "COUPLE" | "SOLO";
  eventAgeGroup: string;
  eventCategory?: string;
  eventLevel?: string | null;
  eventKind?: EventKindValue | null;
  competitionType?: CompetitionTypeValue | null;
  registrantAgeGroup: string;
  registrantLevel?: string | null;
}

/**
 * Vérifie si un couple/solo peut s'inscrire à une épreuve (Article 9).
 * Ne gère pas la règle "une épreuve par spécialité" en majeure (à faire côté service avec les inscriptions existantes).
 *
 * Solo Danse Team (eventKind SOLO_TEAM) : règlement chapitre 4.2.3 — équipe min. 6 danseurs, âge = moyenne arrondie.
 * Show Danse (eventKind SHOW_DANSE) : article 16 du règlement technique. Pas d'éligibilité individuelle stricte ici.
 */
export function checkParticipationEligibility(
  params: ParticipationParams,
): ParticipationCheckResult {
  const {
    eventType,
    eventAgeGroup,
    eventCategory,
    eventLevel,
    eventKind,
    registrantAgeGroup,
    registrantLevel,
  } = params;

  // Solo Danse Team et Show Danse : règles spécifiques (équipe, chorégraphie), pas d'application des seuils couple/solo individuels
  if (eventKind === "SOLO_TEAM" || eventKind === "SHOW_DANSE") {
    return { allowed: true };
  }

  const ageCheck = isAgeGroupEligibleForEvent(
    eventType,
    registrantAgeGroup,
    eventAgeGroup,
    eventCategory,
  );
  if (!ageCheck.allowed) return ageCheck;

  if (eventKind === "CLASSIFICATRICE") {
    return isLevelEligibleForClassificatriceEvent(
      eventType,
      registrantAgeGroup,
      registrantLevel,
      eventLevel ?? null,
    );
  }

  if (eventKind === "OPEN" && eventLevel?.trim()) {
    const allowed = getAllowedLevelsForAgeGroup(eventType, registrantAgeGroup);
    const levelEvent = eventLevel.trim();
    if (allowed.length && !allowed.includes(levelEvent as CompetitionLevel)) {
      return {
        allowed: false,
        reason: `Votre classe d'âge ne permet pas le niveau ${levelEvent} pour cette épreuve Open.`,
      };
    }
  }

  return { allowed: true };
}

// ----- Règles type de compétition ↔ types d'épreuves (Article 8) -----

/** Retourne la liste des natures d'épreuve autorisées pour un type de compétition. */
export function getAllowedEventKindsForCompetitionType(
  competitionType: CompetitionTypeValue,
): readonly EventKindValue[] {
  return ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE[competitionType];
}

/** Indique si une nature d'épreuve est autorisée pour un type de compétition. */
export function isEventKindAllowedForCompetitionType(
  competitionType: CompetitionTypeValue,
  eventKind: EventKindValue,
): boolean {
  const allowed = ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE[competitionType];
  return allowed.includes(eventKind);
}

/** Indique si un niveau est autorisé pour une épreuve classificatrice en compétition de proximité. */
export function isLevelAllowedForProximiteClassificatrice(
  level: string | null | undefined,
): boolean {
  if (!level?.trim()) return true;
  return LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE.includes(
    level.trim() as ProximiteClassificatriceLevel,
  );
}
