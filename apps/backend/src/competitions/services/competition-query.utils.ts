import {
  getCompetitionLevelForCategory,
  practisesDiscipline,
  type CompetitionLevelProfile,
} from "../../common/competition-level";
import {
  checkParticipationEligibility,
  type CompetitionTypeValue,
  type EventKindValue,
} from "../../common/participation-rules";

/** Profile fields an eligibility decision depends on. */
export interface EligibilityProfile extends CompetitionLevelProfile {
  ageGroup: string | null;
}

/** Event fields an eligibility decision depends on. */
export interface EligibilityEventInput {
  eventType: string;
  ageGroup: string;
  category: string;
  level: string | null;
  eventKind: string | null;
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
  competition: { competitionType?: string | null },
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

  const result = checkParticipationEligibility({
    eventType: event.eventType as "COUPLE" | "SOLO",
    eventAgeGroup: event.ageGroup,
    eventCategory: event.category,
    eventLevel: event.level ?? undefined,
    eventKind: (event.eventKind as EventKindValue | null) ?? undefined,
    competitionType:
      (competition.competitionType as CompetitionTypeValue | null) ?? undefined,
    registrantAgeGroup,
    registrantLevel: getCompetitionLevelForCategory(registrant, event.category),
  });
  if (!result.allowed) {
    return { eligible: false, reason: result.reason ?? "NOT_ALLOWED" };
  }
  return { eligible: true };
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
  competition: { competitionType?: string | null },
  registrant: EligibilityProfile | null,
): (T & { eligibility: EventEligibility })[] {
  return events.map((event) => ({
    ...event,
    eligibility: evaluateEventEligibility(event, competition, registrant),
  }));
}
