import {
  HEALTH_DATA_RETENTION_MONTHS,
  MEDICAL_CERTIFICATE_VALIDITY_MONTHS,
  isMedicalCertificateDue,
  medicalCertificatePurgeDueAt,
  purgeCandidateCutoff,
} from "./medical-certificate-retention.util";

const at = (iso: string) => new Date(iso);

describe("medical certificate retention", () => {
  describe("medicalCertificatePurgeDueAt", () => {
    it("compte validité + rétention à partir de la date d'émission lue par l'OCR", () => {
      const due = medicalCertificatePurgeDueAt({
        createdAt: at("2026-06-01T00:00:00Z"),
        ocrData: { date: "2026-01-15T00:00:00Z" },
      });

      // 15 janvier 2026 + 12 mois de validité + 12 mois de rétention.
      expect(due.toISOString().slice(0, 10)).toBe("2028-01-15");
    });

    it("ignore la date de dépôt quand l'émission est connue", () => {
      const common = { ocrData: { date: "2026-01-15T00:00:00Z" } };

      const deposedEarly = medicalCertificatePurgeDueAt({
        ...common,
        createdAt: at("2026-01-16T00:00:00Z"),
      });
      const deposedLate = medicalCertificatePurgeDueAt({
        ...common,
        createdAt: at("2026-12-20T00:00:00Z"),
      });

      expect(deposedEarly).toEqual(deposedLate);
    });

    // Le cas qui protège l'engagement public : sans date, on ne peut pas savoir
    // quand la validité s'achève, donc on retient la borne la plus proche.
    it("retombe sur dépôt + rétention quand l'OCR n'a pas trouvé de date", () => {
      const due = medicalCertificatePurgeDueAt({
        createdAt: at("2026-03-10T00:00:00Z"),
        ocrData: { isApte: true },
      });

      expect(due.toISOString().slice(0, 10)).toBe("2027-03-10");
    });

    it.each([
      ["ocrData null", null],
      ["ocrData absent", undefined],
      ["ocrData scalaire", "pas un objet"],
      ["date vide", { date: "" }],
      ["date non-chaîne", { date: 20260115 }],
      ["date illisible", { date: "le 15 du mois dernier" }],
    ])("retombe sur le dépôt — %s", (_label, ocrData) => {
      const due = medicalCertificatePurgeDueAt({
        createdAt: at("2026-03-10T00:00:00Z"),
        ocrData,
      });

      expect(due.toISOString().slice(0, 10)).toBe("2027-03-10");
    });

    // Sans bornage, `setMonth` ferait déborder le 31 sur le mois suivant et on
    // conserverait la donnée quelques jours de plus que promis.
    it("borne le jour au dernier jour du mois d'arrivée plutôt que de déborder", () => {
      const due = medicalCertificatePurgeDueAt({
        createdAt: at("2026-08-31T00:00:00Z"),
        ocrData: null,
      });

      // 31 août + 12 mois → 31 août, mois qui existe : pas de bornage ici.
      expect(due.toISOString().slice(0, 10)).toBe("2027-08-31");

      const dueFromLongMonth = medicalCertificatePurgeDueAt({
        createdAt: at("2026-12-31T00:00:00Z"),
        ocrData: { date: "2024-08-31T00:00:00Z" },
      });

      // 31 août 2024 + 24 mois → 31 août 2026, et surtout pas le 1er septembre.
      expect(dueFromLongMonth.toISOString().slice(0, 10)).toBe("2026-08-31");
    });

    it("gère le 29 février en ramenant au 28", () => {
      const due = medicalCertificatePurgeDueAt({
        createdAt: at("2028-02-29T00:00:00Z"),
        ocrData: null,
      });

      expect(due.toISOString().slice(0, 10)).toBe("2029-02-28");
    });
  });

  describe("isMedicalCertificateDue", () => {
    const document = {
      createdAt: at("2026-03-10T00:00:00Z"),
      ocrData: null,
    };

    it("n'est pas dû la veille de l'échéance", () => {
      expect(
        isMedicalCertificateDue(document, at("2027-03-09T23:59:59Z")),
      ).toBe(false);
    });

    it("est dû à l'instant exact de l'échéance", () => {
      expect(
        isMedicalCertificateDue(document, at("2027-03-10T00:00:00Z")),
      ).toBe(true);
    });

    it("reste dû bien après", () => {
      expect(
        isMedicalCertificateDue(document, at("2030-01-01T00:00:00Z")),
      ).toBe(true);
    });
  });

  describe("purgeCandidateCutoff", () => {
    // La requête SQL ne sait pas lire `ocrData` : elle ne peut filtrer que sur
    // `createdAt`. Ce seuil doit donc être assez large pour ne rater AUCUN
    // document dû, quelle que soit sa date d'émission.
    it("remonte exactement de la rétention", () => {
      expect(
        purgeCandidateCutoff(at("2027-03-10T00:00:00Z"))
          .toISOString()
          .slice(0, 10),
      ).toBe("2026-03-10");
    });

    it("ne rate aucun document dû, émission connue ou non", () => {
      const now = at("2027-06-01T00:00:00Z");
      const cutoff = purgeCandidateCutoff(now);

      // Un document dû a forcément été déposé avant le seuil : on le vérifie
      // sur le cas le plus défavorable, une émission aussi tardive que possible.
      const latestPossibleIssue = {
        createdAt: at("2026-05-31T00:00:00Z"),
        ocrData: { date: "2026-05-31T00:00:00Z" },
      };
      expect(isMedicalCertificateDue(latestPossibleIssue, now)).toBe(false);
      expect(latestPossibleIssue.createdAt.getTime()).toBeLessThan(
        cutoff.getTime(),
      );
    });
  });

  it("expose les durées annoncées publiquement", () => {
    expect(MEDICAL_CERTIFICATE_VALIDITY_MONTHS).toBe(12);
    expect(HEALTH_DATA_RETENTION_MONTHS).toBe(12);
  });
});
