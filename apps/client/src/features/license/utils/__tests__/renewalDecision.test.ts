import { rejectionReasonLabel } from "../renewalDecision";

describe("rejectionReasonLabel (#268)", () => {
  it("gives the readable label of a known code", () => {
    expect(rejectionReasonLabel("ILLEGIBLE")).toBe("Document illisible");
    expect(rejectionReasonLabel("MEDICAL_RESTRICTION")).toBe(
      "Contre-indication médicale",
    );
  });

  it("is null without a reason (request older than the moderation)", () => {
    expect(rejectionReasonLabel(null)).toBeNull();
    expect(rejectionReasonLabel(undefined)).toBeNull();
    expect(rejectionReasonLabel("")).toBeNull();
  });

  it("never shows a raw code added server-side after this app version", () => {
    expect(rejectionReasonLabel("SOME_FUTURE_CODE")).toBe("Autre motif");
    expect(rejectionReasonLabel("toString")).toBe("Autre motif");
  });
});
