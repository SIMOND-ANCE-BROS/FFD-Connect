import { isAgeGroupAllowedForEvent } from "../../../utils/ageGroup";
import {
  type CompetitionLevelProfile,
  normalizeDiscipline,
  practisesDiscipline,
} from "../../../utils/competitionLevel";

export interface LocalEligibility {
  eligible: boolean;
  reason?: string;
}

/** Dancer profile fields the local eligibility check depends on. */
export interface LocalEligibilityProfile extends CompetitionLevelProfile {
  ageGroup?: string | null;
}

const norm = (s: string | null | undefined) => s?.trim().toLowerCase() ?? "";

/**
 * Local fallback when the server did not send `event.eligibility` (older
 * backend, public detail). Mirrors the backend discipline rule
 * (`evaluateEventEligibility`):
 * - the dancer practises the event discipline: a level in it, or the
 *   declared category covers it (« 10 danses » = Latines + Standards);
 * - a Ten Dance event requires both disciplines and has no level;
 * - no discipline information on the profile → not blocking;
 * - an unknown event discipline is compared to the declared category as is.
 * Then the age class (tolerant to legacy spellings). The level rules
 * (Article 9) stay server-side.
 */
export function evaluateLocalEligibility(
  event: { category?: string | null; ageGroup?: string | null },
  profile: LocalEligibilityProfile,
): LocalEligibility {
  if (event.category) {
    const practises = practisesDiscipline(profile, event.category);
    const wrongCategory =
      practises === false ||
      (practises === null &&
        normalizeDiscipline(event.category) === null &&
        !!profile.category &&
        norm(event.category) !== norm(profile.category));
    if (wrongCategory) return { eligible: false, reason: "WRONG_CATEGORY" };
  }

  // Tolerant: deduced events use canonical classes (« Senior II »,
  // « Juvénile I », « Espoir »…) while legacy placeholders say « Adult »/
  // « Senior ».
  if (
    event.ageGroup &&
    !isAgeGroupAllowedForEvent(event.ageGroup, profile.ageGroup)
  ) {
    return { eligible: false, reason: "WRONG_AGE_GROUP" };
  }

  return { eligible: true };
}
