import {
  effectiveParentalConsentState,
  healthDataAllowed,
  PARENTAL_CONSENT_AGE_YEARS,
  parentalConsentRequirement,
} from "./parental-consent.policy";

const NOW = new Date("2026-10-15T12:00:00Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("parental consent policy (#61)", () => {
  describe("parentalConsentRequirement", () => {
    it("applies to every minor (conservative threshold: legal majority)", () => {
      expect(PARENTAL_CONSENT_AGE_YEARS).toBe(18);
      expect(parentalConsentRequirement(utc("2012-03-01"), NOW)).toBe(
        "REQUIRED",
      );
      // 17, the day before the 18th birthday.
      expect(parentalConsentRequirement(utc("2008-10-16"), NOW)).toBe(
        "REQUIRED",
      );
    });

    it("never applies to an adult, from the 18th birthday on", () => {
      expect(parentalConsentRequirement(utc("2008-10-15"), NOW)).toBe(
        "NOT_REQUIRED",
      );
      expect(parentalConsentRequirement(utc("1990-01-01"), NOW)).toBe(
        "NOT_REQUIRED",
      );
    });

    it("keeps an unknown age apart instead of calling it adult or minor", () => {
      expect(parentalConsentRequirement(null, NOW)).toBe("UNKNOWN");
      expect(parentalConsentRequirement(undefined, NOW)).toBe("UNKNOWN");
      expect(parentalConsentRequirement(utc("2030-01-01"), NOW)).toBe(
        "UNKNOWN",
      );
    });

    it("defaults to the current date", () => {
      expect(parentalConsentRequirement(utc("1990-01-01"))).toBe(
        "NOT_REQUIRED",
      );
    });
  });

  describe("effectiveParentalConsentState", () => {
    const future = new Date("2026-10-20T00:00:00Z");
    const past = new Date("2026-10-10T00:00:00Z");

    it("is NOT_REQUIRED for an adult or an unknown age, whatever the records", () => {
      for (const requirement of ["NOT_REQUIRED", "UNKNOWN"] as const) {
        expect(
          effectiveParentalConsentState(
            requirement,
            { status: "REVOKED", expiresAt: past },
            NOW,
          ),
        ).toEqual({ state: "NOT_REQUIRED", lastOutcome: null });
      }
    });

    it("is REQUIRED for a minor who never asked", () => {
      expect(effectiveParentalConsentState("REQUIRED", null, NOW)).toEqual({
        state: "REQUIRED",
        lastOutcome: null,
      });
    });

    it("is PENDING while the link is valid, REQUIRED/EXPIRED after", () => {
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "PENDING", expiresAt: future },
          NOW,
        ),
      ).toEqual({ state: "PENDING", lastOutcome: null });
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "PENDING", expiresAt: past },
          NOW,
        ),
      ).toEqual({ state: "REQUIRED", lastOutcome: "EXPIRED" });
      // Exactly at the deadline: expired.
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "PENDING", expiresAt: NOW },
          NOW,
        ),
      ).toEqual({ state: "REQUIRED", lastOutcome: "EXPIRED" });
    });

    it("is GRANTED after confirmation, even past the link's deadline", () => {
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "GRANTED", expiresAt: past },
          NOW,
        ),
      ).toEqual({ state: "GRANTED", lastOutcome: null });
    });

    it("is REQUIRED/REVOKED after a withdrawal", () => {
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "REVOKED", expiresAt: future },
          NOW,
        ),
      ).toEqual({ state: "REQUIRED", lastOutcome: "REVOKED" });
    });

    it("never reads an unknown stored status as a consent", () => {
      expect(
        effectiveParentalConsentState(
          "REQUIRED",
          { status: "SOMETHING_ELSE", expiresAt: future },
          NOW,
        ),
      ).toEqual({ state: "REQUIRED", lastOutcome: null });
    });

    it("defaults to the current date", () => {
      expect(
        effectiveParentalConsentState("REQUIRED", {
          status: "PENDING",
          expiresAt: new Date(Date.now() + 60_000),
        }).state,
      ).toBe("PENDING");
    });
  });

  describe("healthDataAllowed", () => {
    it("allows health data only without requirement or with a granted consent", () => {
      expect(healthDataAllowed("NOT_REQUIRED")).toBe(true);
      expect(healthDataAllowed("GRANTED")).toBe(true);
      expect(healthDataAllowed("REQUIRED")).toBe(false);
      expect(healthDataAllowed("PENDING")).toBe(false);
    });
  });
});
