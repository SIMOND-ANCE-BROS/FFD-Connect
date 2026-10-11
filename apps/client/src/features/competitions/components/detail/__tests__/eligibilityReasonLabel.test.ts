import { getEligibilityReasonLabel } from "../competition-detail.styles";

describe("getEligibilityReasonLabel", () => {
  // Espoir (« -21 ») refused on the dancer's actual age (beta report).
  it("explains an Espoir event refused on age", () => {
    expect(getEligibilityReasonLabel("ESPOIR_AGE")).toBe(
      "Réservé aux 16-20 ans (Espoir)",
    );
  });

  it("keeps the existing labels", () => {
    expect(getEligibilityReasonLabel("WRONG_AGE_GROUP")).toBe(
      "Classe d'âge non compatible",
    );
  });
});
