import {
  consentCopy,
  formatConsentDate,
  isMinorLicenseNumber,
  looksLikeEmail,
  needsParentalAction,
} from "../parentalConsent";

const NOW = new Date("2026-10-15T12:00:00Z");

describe("parentalConsent helpers (#61)", () => {
  describe("isMinorLicenseNumber", () => {
    it("detects a minor from the federal licence number", () => {
      expect(isMinorLicenseNumber("20120301-mar-le01", NOW)).toBe(true);
      // Capitals and spaces do not change the encoded date.
      expect(isMinorLicenseNumber(" 20081016-MAR-LE01 ", NOW)).toBe(true);
    });

    it("is false from the 18th birthday on", () => {
      expect(isMinorLicenseNumber("20081015-mar-le01", NOW)).toBe(false);
      expect(isMinorLicenseNumber("19900101-dup-ga42", NOW)).toBe(false);
    });

    it("is false when the number encodes nothing usable", () => {
      expect(isMinorLicenseNumber("TEST-LICENSEE-001", NOW)).toBe(false);
      expect(isMinorLicenseNumber("20120231-mar-le01", NOW)).toBe(false);
      expect(isMinorLicenseNumber("20300101-mar-le01", NOW)).toBe(false);
      expect(isMinorLicenseNumber("", NOW)).toBe(false);
    });

    it("defaults to the current date", () => {
      expect(isMinorLicenseNumber("19900101-dup-ga42")).toBe(false);
    });
  });

  it("checks the shape of an e-mail", () => {
    expect(looksLikeEmail(" parent@example.fr ")).toBe(true);
    expect(looksLikeEmail("parent@example")).toBe(false);
    expect(looksLikeEmail("parent example.fr")).toBe(false);
  });

  it("asks for action only while required or pending", () => {
    expect(needsParentalAction({ state: "REQUIRED" })).toBe(true);
    expect(needsParentalAction({ state: "PENDING" })).toBe(true);
    expect(needsParentalAction({ state: "GRANTED" })).toBe(false);
    expect(needsParentalAction({ state: "NOT_REQUIRED" })).toBe(false);
    expect(needsParentalAction(undefined)).toBe(false);
    expect(needsParentalAction(null)).toBe(false);
  });

  it("formats dates in French", () => {
    expect(formatConsentDate("2026-10-22T10:00:00.000Z")).toBe(
      "22 octobre 2026",
    );
    expect(formatConsentDate(null)).toBe("");
    expect(formatConsentDate("nope")).toBe("");
  });

  describe("consentCopy", () => {
    it("names the masked address and the deadline while pending", () => {
      const copy = consentCopy({
        state: "PENDING",
        parentEmailMasked: "p***@e***.fr",
        expiresAt: "2026-10-22T10:00:00.000Z",
      });
      expect(copy.title).toContain("En attente");
      expect(copy.message).toContain("p***@e***.fr");
      expect(copy.message).toContain("22 octobre 2026");
    });

    it("stays readable without address or deadline", () => {
      expect(consentCopy({ state: "PENDING" }).message).toContain(
        "votre représentant légal",
      );
      expect(
        consentCopy({ state: "PENDING", parentEmailMasked: "p***@e***.fr" })
          .message,
      ).not.toContain("valable");
    });

    it("explains each reason to ask again", () => {
      expect(consentCopy({ state: "REQUIRED" }).message).toContain("mineur(e)");
      expect(
        consentCopy({ state: "REQUIRED", lastOutcome: "EXPIRED" }).message,
      ).toContain("expiré");
      expect(
        consentCopy({ state: "REQUIRED", lastOutcome: "REVOKED" }).message,
      ).toContain("retiré");
    });

    it("describes a granted consent, with or without its date", () => {
      expect(
        consentCopy({ state: "GRANTED", grantedAt: "2026-10-16T08:00:00Z" })
          .message,
      ).toContain("16 octobre 2026");
      expect(consentCopy({ state: "GRANTED" }).message).toContain(
        "a donné son accord",
      );
    });

    it("has a neutral wording for an account that needs nothing", () => {
      expect(consentCopy({ state: "NOT_REQUIRED" }).title).toBe(
        "Aucun accord parental nécessaire",
      );
    });
  });
});
