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

  it("describes the imported results of people without an account and how to object (#652)", () => {
    const section = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Résultats de compétition",
    );
    expect(section?.body).toContain("l'organisateur de la compétition publie");
    expect(section?.body).toContain("Base légale : intérêt légitime");
    expect(section?.body).toContain("privacy@gabin-simond.fr");
    expect(section?.body).toContain("ne sont pas conservés");
  });

  it("explains how substantial changes are notified (#734)", () => {
    const section = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Modifications de cette politique",
    );
    expect(section?.body).toContain("une seule fois par version");
    expect(section?.body).toContain("pas une nouvelle acceptation");
    expect(section?.body).toContain("J'ai compris");
  });

  it("declares the support access and lists it in the export (#387)", () => {
    const support = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Accès support",
    );
    expect(support?.body).toContain("15 minutes");
    expect(support?.body).toContain("journalisé");
    expect(support?.body).toContain("conservées 1 an");
    expect(support?.body).toContain("90 jours");
    expect(support?.body).not.toContain("pas encore fixée");

    const retention = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Durées de conservation",
    );
    expect(retention?.body).toContain(
      "Journal des accès support : 1 an, puis suppression automatique",
    );

    const rights = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Vos droits (RGPD)",
    );
    expect(rights?.body).toContain("les accès support à votre compte");
    expect(rights?.body).toContain("vos sessions de connexion");
    expect(rights?.body).toContain("journal d'audit des administrateurs");
  });
});
