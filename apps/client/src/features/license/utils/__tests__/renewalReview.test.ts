import {
  getRenewalOcrWarnings,
  isRenewalUnderReview,
  RENEWAL_REJECTION_LABELS,
  rejectionReasonLabel,
} from "../renewalReview";

const NOW = new Date("2026-10-11T10:00:00Z");

describe("rejectionReasonLabel (#268)", () => {
  it("gives a readable French label for every reason code", () => {
    for (const [code, label] of Object.entries(RENEWAL_REJECTION_LABELS)) {
      expect(rejectionReasonLabel(code)).toBe(label);
      expect(label).not.toMatch(/^[A-Z_]+$/);
    }
    expect(rejectionReasonLabel("ILLEGIBLE")).toBe("Document illisible");
  });

  it("returns null without a reason", () => {
    expect(rejectionReasonLabel(null)).toBeNull();
    expect(rejectionReasonLabel(undefined)).toBeNull();
    expect(rejectionReasonLabel("")).toBeNull();
  });

  it("falls back to a generic label for a code unknown to this app version", () => {
    expect(rejectionReasonLabel("SOMETHING_NEW")).toBe("Autre motif");
  });
});

describe("isRenewalUnderReview (#268)", () => {
  it("is true only for a PENDING request", () => {
    expect(isRenewalUnderReview({ status: "PENDING" })).toBe(true);
    expect(isRenewalUnderReview({ status: "DRAFT" })).toBe(false);
    expect(isRenewalUnderReview({ status: "APPROVED" })).toBe(false);
    expect(isRenewalUnderReview({ status: "REJECTED" })).toBe(false);
    expect(isRenewalUnderReview(null)).toBe(false);
    expect(isRenewalUnderReview(undefined)).toBe(false);
  });
});

describe("getRenewalOcrWarnings (#268)", () => {
  it("has no warning for a fit, recent medical certificate", () => {
    expect(
      getRenewalOcrWarnings(
        {
          type: "MEDICAL_CERTIFICATE",
          ocrData: { isApte: true, date: "2026-09-01" },
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it("warns when the fitness or the date could not be read", () => {
    expect(
      getRenewalOcrWarnings({ type: "MEDICAL_CERTIFICATE", ocrData: {} }, NOW),
    ).toEqual([
      "La lecture automatique n'a pas confirmé l'aptitude à la pratique.",
      "La date du certificat n'a pas pu être lue.",
    ]);
    expect(
      getRenewalOcrWarnings(
        {
          type: "MEDICAL_CERTIFICATE",
          ocrData: { isApte: false, date: "pas une date" },
        },
        NOW,
      ),
    ).toHaveLength(2);
  });

  it("warns about a certificate older than 12 months", () => {
    expect(
      getRenewalOcrWarnings(
        {
          type: "MEDICAL_CERTIFICATE",
          ocrData: { isApte: true, date: "2025-09-01" },
        },
        NOW,
      ),
    ).toEqual(["Le certificat semble dater de plus de 12 mois."]);
  });

  it("warns when no licence number was read on the licence certificate", () => {
    expect(
      getRenewalOcrWarnings(
        { type: "LICENSE_CERTIFICATE", ocrData: { licenseNumber: "  " } },
        NOW,
      ),
    ).toEqual(["Le numéro de licence n'a pas pu être lu."]);
    expect(
      getRenewalOcrWarnings(
        { type: "LICENSE_CERTIFICATE", ocrData: { licenseNumber: "FFD-1" } },
        NOW,
      ),
    ).toEqual([]);
  });

  it("warns when the document was not read at all", () => {
    expect(
      getRenewalOcrWarnings({ type: "LICENSE_CERTIFICATE", ocrData: null }),
    ).toEqual(["Le document n'a pas pu être lu automatiquement."]);
  });
});
