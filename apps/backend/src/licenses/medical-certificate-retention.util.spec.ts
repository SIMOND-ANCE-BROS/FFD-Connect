import {
  HEALTH_DATA_RETENTION_MONTHS,
  MEDICAL_CERTIFICATE_VALIDITY_MONTHS,
  medicalCertificatePurgeDueAt,
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

    /**
     * Les décalages valent toujours 12 ou 24 mois, donc le mois d'arrivée a la
     * même longueur que celui de départ — sauf au 29 février. Le bornage ne
     * sert QUE là ; les cas « 31 du mois » ci-dessous vérifient justement qu'il
     * ne se déclenche pas à tort.
     */
    /**
     * `ocrData` vient de l'OCR d'un document FOURNI PAR L'UTILISATEUR : il en
     * contrôle le contenu. Sans plafond, une date future rendrait la donnée de
     * santé impurgeable — l'engagement publié contourné par la seule partie qui
     * y a intérêt. Et ce n'est pas qu'une attaque : la regex retient la
     * PREMIÈRE date du document, donc un « valable jusqu'au 31/12/2027 » suffit
     * à produire spontanément une date d'émission future.
     */
    describe("date d'émission postérieure au dépôt (falsifiée ou mal lue)", () => {
      it.each([
        ["un an plus tard", "2027-10-06T00:00:00Z"],
        ["un siècle plus tard", "2099-01-01T00:00:00Z"],
        ["absurde", "9999-01-01T00:00:00Z"],
      ])("la ramène au dépôt — %s", (_label, hostileDate) => {
        const due = medicalCertificatePurgeDueAt({
          createdAt: at("2026-10-06T00:00:00Z"),
          ocrData: { date: hostileDate },
        });

        // Plafond : dépôt + validité + rétention, et jamais au-delà.
        expect(due.toISOString().slice(0, 10)).toBe("2028-10-06");
      });

      it("laisse intacte une date antérieure au dépôt, cas normal", () => {
        const due = medicalCertificatePurgeDueAt({
          createdAt: at("2026-10-06T00:00:00Z"),
          ocrData: { date: "2026-09-01T00:00:00Z" },
        });

        expect(due.toISOString().slice(0, 10)).toBe("2028-09-01");
      });
    });

    it("conserve le 31 quand le mois d'arrivée le permet", () => {
      expect(
        medicalCertificatePurgeDueAt({
          createdAt: at("2026-08-31T00:00:00Z"),
          ocrData: null,
        })
          .toISOString()
          .slice(0, 10),
      ).toBe("2027-08-31");

      expect(
        medicalCertificatePurgeDueAt({
          createdAt: at("2026-12-31T00:00:00Z"),
          ocrData: { date: "2024-08-31T00:00:00Z" },
        })
          .toISOString()
          .slice(0, 10),
      ).toBe("2026-08-31");
    });

    // LE seul cas où `Math.min(day, lastDayOfTargetMonth)` mord réellement.
    it("ramène le 29 février au 28 d'une année non bissextile", () => {
      expect(
        medicalCertificatePurgeDueAt({
          createdAt: at("2028-02-29T00:00:00Z"),
          ocrData: null,
        })
          .toISOString()
          .slice(0, 10),
      ).toBe("2029-02-28");

      // Même bornage sur la branche « date connue » (+24 mois).
      expect(
        medicalCertificatePurgeDueAt({
          createdAt: at("2032-06-01T00:00:00Z"),
          ocrData: { date: "2032-02-29T00:00:00Z" },
        })
          .toISOString()
          .slice(0, 10),
      ).toBe("2034-02-28");
    });
  });

  it("expose les durées annoncées publiquement", () => {
    expect(MEDICAL_CERTIFICATE_VALIDITY_MONTHS).toBe(12);
    expect(HEALTH_DATA_RETENTION_MONTHS).toBe(12);
  });
});
