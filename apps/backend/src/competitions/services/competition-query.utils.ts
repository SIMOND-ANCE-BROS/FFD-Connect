import {
  checkParticipationEligibility,
  type CompetitionTypeValue,
  type EventKindValue,
} from "../../common/participation-rules";

/**
 * Ajoute `isRegistered` et `isEligible` à chaque compétition selon l'utilisateur.
 * Fonction pure — pas de Prisma.
 */
export function enrichCompetitionsForUser<
  T extends {
    events: {
      category: string;
      ageGroup: string;
      registrations: unknown[];
    }[];
  },
>(
  competitions: T[],
  user: { category: string | null; ageGroup: string | null } | null,
): (T & { isRegistered: boolean; isEligible: boolean })[] {
  return competitions.map((comp) => {
    const isRegistered = comp.events.some((e) => e.registrations.length > 0);
    const isEligible =
      user === null ||
      comp.events.some((event) => {
        const categoryMatch =
          !user.category || event.category === user.category;
        const ageGroupMatch =
          !user.ageGroup || event.ageGroup === user.ageGroup;
        return categoryMatch && ageGroupMatch;
      });

    return { ...comp, isRegistered, isEligible };
  });
}

/**
 * Calcule l'éligibilité d'un utilisateur pour chaque épreuve d'une compétition.
 * Fonction pure — pas de Prisma.
 */
export function mapEventsWithEligibility<
  T extends {
    eventType: string;
    ageGroup: string;
    category: string;
    level: string | null;
    eventKind: string | null;
  },
>(
  events: T[],
  competition: { competitionType?: string | null },
  registrantAgeGroup: string | null,
  registrantCategory: string | null,
): (T & { eligibility: { eligible: boolean; reason?: string } })[] {
  return events.map((event) => {
    let eligible = true;
    let reason: string | undefined;

    if (!registrantAgeGroup) {
      eligible = false;
      reason = "AGE_GROUP_REQUIRED";
    } else if (registrantCategory && event.category) {
      const normCat = (s: string) => s.trim().toLowerCase();
      if (normCat(registrantCategory) !== normCat(event.category)) {
        eligible = false;
        reason = "WRONG_CATEGORY";
      }
    }

    if (eligible && registrantAgeGroup) {
      const result = checkParticipationEligibility({
        eventType: event.eventType as "COUPLE" | "SOLO",
        eventAgeGroup: event.ageGroup,
        eventCategory: event.category,
        eventLevel: event.level ?? undefined,
        eventKind: (event.eventKind as EventKindValue | null) ?? undefined,
        competitionType:
          (competition.competitionType as CompetitionTypeValue | null) ??
          undefined,
        registrantAgeGroup,
        registrantLevel: undefined,
      });
      if (!result.allowed) {
        eligible = false;
        reason = result.reason ?? "NOT_ALLOWED";
      }
    }

    return { ...event, eligibility: { eligible, reason } };
  });
}
