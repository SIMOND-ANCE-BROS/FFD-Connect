import { LEGAL_DOCUMENTS } from "../legalContent";

describe("privacy policy in the app", () => {
  it("describes the entry QR and offline check-ins (#24)", () => {
    const section = LEGAL_DOCUMENTS.privacy.sections.find((s) =>
      s.heading?.includes("QR d'entrée"),
    );
    expect(section?.body).toContain("30 secondes");
    expect(section?.body).toContain("12 heures");
    expect(section?.body).toContain("heure de scan déclarée");
  });
});
