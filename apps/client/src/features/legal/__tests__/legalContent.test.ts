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

  it("reserves the support access to administrators and lists the blocked actions (#733)", () => {
    const support = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Accès support",
    );
    expect(support?.body).toContain("un administrateur, et lui seul");
    expect(support?.body).toContain("les membres du staff n'ont pas cet accès");
    expect(support?.body).not.toContain("un membre du staff peut");
    expect(support?.body).not.toContain("obligatoire pour le staff");
    expect(support?.body).toContain("aucun second accès");
    expect(support?.body).toContain("identifiants HelloAsso");
    expect(support?.body).toContain("moyen de paiement en ligne d'un club");
    expect(support?.body).toContain(
      "enregistrer un appareil pour recevoir vos notifications",
    );
    expect(support?.body).toContain("préférences de notification");
    expect(support?.body).toContain("l'expiration au bout de 15 minutes");

    const rights = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Vos droits (RGPD)",
    );
    expect(rights?.body).not.toContain("date de fin lorsqu'elle est connue");
    expect(rights?.body).toContain("expiration au bout de 15 minutes");
  });

  it("lists the health-data access journal in the export (#732)", () => {
    const rights = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Vos droits (RGPD)",
    );
    expect(rights?.body).toContain("les accès à vos données de santé");
    expect(rights?.body).toContain("qualité de l'auteur, sans son identité");
    expect(rights?.body).not.toContain("à ce jour le journal des accès");
  });

  it("declares the retention of the back-office audit trail (#741)", () => {
    const retention = LEGAL_DOCUMENTS.privacy.sections.find(
      (s) => s.heading === "Durées de conservation",
    );
    expect(retention?.body).toContain(
      "Journal des modifications faites par l'administration : 1 an, puis suppression automatique",
    );
  });
});
