import {
  getCompetitionLevelForCategory,
  practisesDiscipline,
  type CompetitionLevelProfile,
} from "../../common/competition-level";
import {
  ESPOIR_AGE_GROUP,
  getReferenceYear,
  isEspoirAge,
} from "../../common/age-group";
import {
  checkParticipationEligibility,
  type CompetitionTypeValue,
  type EventKindValue,
} from "../../common/participation-rules";

/** Profile fields an eligibility decision depends on. */
export interface EligibilityProfile extends CompetitionLevelProfile {
  ageGroup: string | null;
  /** Known for licence holders (derived from the licence number). */
  birthDate?: Date | null;
}

/** Event fields an eligibility decision depends on. */
export interface EligibilityEventInput {
  eventType: string;
  ageGroup: string;
  category: string;
  level: string | null;
  eventKind: string | null;
  /**
   * Club editor (#442): an Open may cover several age classes. Empty or
   * absent → the single `ageGroup` applies (FFD-imported events).
   */
  ageGroups?: string[] | null;
  /** Club editor (#442): levels admitted in an Open. Empty → no restriction. */
  openLevels?: string[] | null;
}

export interface EventEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Single source of truth for "can this dancer take part in this event?",
 * shared by the competitions list badge and the detail screen.
 * - no age class → AGE_GROUP_REQUIRED;
 * - the dancer does not practise the event discipline (Ten Dance = both
 *   Latin and Standard) → WRONG_CATEGORY; no discipline info → not blocking;
 * - Article 9 (age class + upward choices, level of the dancer IN THE EVENT
 *   DISCIPLINE) via checkParticipationEligibility.
 * Pure function — no Prisma.
 */
export function evaluateEventEligibility(
  event: EligibilityEventInput,
  competition: { competitionType?: string | null; date?: Date | string | null },
  registrant: EligibilityProfile | null,
): EventEligibility {
  const registrantAgeGroup = registrant?.ageGroup?.trim() ?? "";
  if (!registrant || registrantAgeGroup === "") {
    return { eligible: false, reason: "AGE_GROUP_REQUIRED" };
  }

  if (
    event.category &&
    practisesDiscipline(registrant, event.category) === false
  ) {
    return { eligible: false, reason: "WRONG_CATEGORY" };
  }

  const registrantLevel = getCompetitionLevelForCategory(
    registrant,
    event.category,
  );
  const result = checkEventParticipation(event, competition, {
    registrantAgeGroup,
    registrantLevel,
  });
  if (!result.allowed) {
    return { eligible: false, reason: result.reason ?? "NOT_ALLOWED" };
  }

  // Espoir is open to couple classes by age class (Youth, Adulte…), but the
  // event is for 16–20 year-olds on 31 December: decided on the birth date
  // when it is known (an Adulte born in 2000 is not « -21 »).
  if (event.ageGroup === ESPOIR_AGE_GROUP && registrant.birthDate) {
    const referenceYear = getReferenceYear(
      competition.date ? new Date(competition.date) : null,
    );
    if (!isEspoirAge(new Date(registrant.birthDate), referenceYear)) {
      return { eligible: false, reason: "ESPOIR_AGE" };
    }
  }
  return { eligible: true };
}

/**
 * Article 9 check of one event, extended to the club editor's Open (#638):
 * the registrant may enter through ANY of the event's age classes
 * (`ageGroups`, else the single `ageGroup`), and when the Open restricts
 * levels (`openLevels`) the registrant's level in the discipline must be one
 * of them. Shared by the eligibility badge and the registration check.
 */
export function checkEventParticipation(
  event: EligibilityEventInput,
  competition: { competitionType?: string | null },
  registrant: { registrantAgeGroup: string; registrantLevel?: string | null },
): { allowed: boolean; reason?: string } {
  const ageGroups =
    event.ageGroups && event.ageGroups.length > 0
      ? event.ageGroups
      : [event.ageGroup];
  let last: { allowed: boolean; reason?: string } = { allowed: false };
  for (const eventAgeGroup of ageGroups) {
    last = checkParticipationEligibility({
      eventType: event.eventType as "COUPLE" | "SOLO",
      eventAgeGroup,
      eventCategory: event.category,
      eventLevel: event.level ?? undefined,
      eventKind: (event.eventKind as EventKindValue | null) ?? undefined,
      competitionType:
        (competition.competitionType as CompetitionTypeValue | null) ??
        undefined,
      registrantAgeGroup: registrant.registrantAgeGroup,
      registrantLevel: registrant.registrantLevel ?? undefined,
    });
    if (last.allowed) break;
  }
  if (!last.allowed) return last;

  if (event.openLevels && event.openLevels.length > 0) {
    const level = registrant.registrantLevel?.trim().toLowerCase();
    const admitted = event.openLevels.some(
      (open) => open.trim().toLowerCase() === level,
    );
    if (!admitted) {
      return {
        allowed: false,
        reason: `Cet open est réservé aux niveaux ${event.openLevels.join(", ")}.`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Ajoute `isRegistered` et `isEligible` à chaque compétition selon l'utilisateur.
 * `isEligible` = au moins une épreuve éligible, avec exactement la même règle
 * que l'écran de détail (evaluateEventEligibility).
 * Fonction pure — pas de Prisma.
 */
export function enrichCompetitionsForUser<
  T extends {
    competitionType?: string | null;
    date?: Date | string | null;
    events: (EligibilityEventInput & { registrations: unknown[] })[];
  },
>(
  competitions: T[],
  user: EligibilityProfile | null,
): (T & { isRegistered: boolean; isEligible: boolean })[] {
  return competitions.map((comp) => {
    const isRegistered = comp.events.some((e) => e.registrations.length > 0);
    const isEligible =
      user === null ||
      comp.events.some(
        (event) => evaluateEventEligibility(event, comp, user).eligible,
      );

    return { ...comp, isRegistered, isEligible };
  });
}

/**
 * Calcule l'éligibilité d'un utilisateur pour chaque épreuve d'une compétition.
 * Fonction pure — pas de Prisma.
 */
export function mapEventsWithEligibility<T extends EligibilityEventInput>(
  events: T[],
  competition: { competitionType?: string | null; date?: Date | string | null },
  registrant: EligibilityProfile | null,
): (T & { eligibility: EventEligibility })[] {
  return events.map((event) => ({
    ...event,
    eligibility: evaluateEventEligibility(event, competition, registrant),
  }));
}
