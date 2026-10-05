/**
 * Legal majority, expressed so that "we do not know" can never be mistaken for
 * "adult".
 *
 * `User.birthDate` is nullable and, for accounts created before #60, often
 * absent or synthetic (see `scripts/sync-licensees-from-compete.ts`, which
 * invents the month and the day). Any API shaped like `isMinor(): boolean`
 * would silently collapse that third state into `false` — i.e. into "adult" —
 * which is exactly the failure the parental-consent work (#61, epic #23) must
 * not inherit. Hence a three-state discriminated union, and `matchLegalAge`
 * for callers that must provably handle all three.
 *
 * All comparisons are done on UTC calendar components: birth dates are stored
 * at UTC midnight, so a local-time comparison would shift the calendar day by
 * one in some timezones. At the exact moment of an 18th birthday this can
 * report MINOR for a few hours longer than a local-time rule would — the
 * protective direction, deliberately.
 */

/** Age of majority in French law (Code civil, art. 414). */
export const LEGAL_MAJORITY_AGE_YEARS = 18;

/**
 * Age status of a person. UNKNOWN deliberately carries no `age`, so a caller
 * cannot read one without first narrowing on `status`.
 */
export type LegalAgeAssessment =
  | { readonly status: "MINOR"; readonly age: number }
  | { readonly status: "ADULT"; readonly age: number }
  | { readonly status: "UNKNOWN" };

/**
 * Whole years elapsed between two dates, on UTC calendar components.
 * Negative when `from` is after `to`.
 */
export function completedYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDiff = to.getUTCMonth() - from.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && to.getUTCDate() < from.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
}

/**
 * Classifies a birth date as MINOR, ADULT or UNKNOWN.
 *
 * UNKNOWN is returned for a missing date, an invalid `Date`, and a date in the
 * future — in every case the honest answer is "we cannot conclude", never a
 * default to adulthood.
 */
export function assessLegalAge(
  birthDate: Date | null | undefined,
  now: Date = new Date(),
): LegalAgeAssessment {
  if (!birthDate || Number.isNaN(birthDate.getTime())) {
    return { status: "UNKNOWN" };
  }
  if (birthDate.getTime() > now.getTime()) {
    return { status: "UNKNOWN" };
  }
  const age = completedYearsBetween(birthDate, now);
  return age < LEGAL_MAJORITY_AGE_YEARS
    ? { status: "MINOR", age }
    : { status: "ADULT", age };
}

/**
 * Exhaustive dispatch over a {@link LegalAgeAssessment}.
 *
 * Prefer this over an `if (status === "MINOR")` chain: omitting a handler is a
 * compile error, so "we do not know" cannot quietly fall into the adult path.
 */
export function matchLegalAge<T>(
  assessment: LegalAgeAssessment,
  handlers: {
    onMinor: (age: number) => T;
    onAdult: (age: number) => T;
    onUnknown: () => T;
  },
): T {
  switch (assessment.status) {
    case "MINOR":
      return handlers.onMinor(assessment.age);
    case "ADULT":
      return handlers.onAdult(assessment.age);
    case "UNKNOWN":
      return handlers.onUnknown();
  }
}
