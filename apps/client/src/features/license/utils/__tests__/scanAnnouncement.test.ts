import type { CheckinResponse } from "../../services/CheckinService";
import {
  checkinAnnouncement,
  checkinOutcome,
  offlineCheckinAnnouncement,
  registrationA11yLabel,
} from "../scanAnnouncement";

jest.mock("../../../../utils/discipline", () => ({
  formatDiscipline: (event: string) => event,
}));

const user = { firstName: "Jean", lastName: "Dupont" };

describe("scanAnnouncement (#22)", () => {
  it("derives the overall outcome", () => {
    expect(checkinOutcome(null, "boom")).toBe("ERROR");
    expect(checkinOutcome(null, null)).toBe("NEUTRAL");
    expect(
      checkinOutcome(
        { user, registrations: [{ event: "LATIN", status: "ERROR" }] },
        null,
      ),
    ).toBe("DENIED");
    expect(
      checkinOutcome(
        {
          user,
          registrations: [
            { event: "LATIN", status: "ERROR" },
            { event: "STANDARD", status: "ALREADY_CHECKED_IN" },
          ],
        },
        null,
      ),
    ).toBe("SUCCESS");
    expect(checkinOutcome({ user, registrations: [] }, null)).toBe("NEUTRAL");
  });

  it("reads one registration as one sentence", () => {
    expect(
      registrationA11yLabel({
        event: "Cha Cha",
        status: "SUCCESS",
        bibNumber: 12,
        partner: "Léa Martin",
      }),
    ).toBe("Cha Cha, dossard 12, validé, partenaire Léa Martin");
    expect(
      registrationA11yLabel({ event: "Cha Cha", status: "ALREADY_CHECKED_IN" }),
    ).toBe("Cha Cha, sans dossard, déjà enregistré");
    expect(
      registrationA11yLabel({
        event: "Cha Cha",
        status: "ERROR",
        message: "Non inscrit",
      }),
    ).toBe("Cha Cha, sans dossard, Non inscrit");
    expect(registrationA11yLabel({ event: "Cha Cha", status: "ERROR" })).toBe(
      "Cha Cha, sans dossard, erreur",
    );
  });

  it("announces an online result, warning included", () => {
    const result: CheckinResponse = {
      user,
      registrations: [{ event: "Cha Cha", status: "SUCCESS", bibNumber: 7 }],
      qrVerification: {
        mode: "warn",
        status: "UNSIGNED",
        warning: "QR non vérifié",
      },
    };
    expect(checkinAnnouncement(result, null)).toBe(
      "Check-in réussi, Jean Dupont, QR non vérifié, Cha Cha, dossard 7, validé",
    );
  });

  it("announces an error, and nothing without a result", () => {
    expect(checkinAnnouncement(null, "QR invalide")).toBe(
      "Erreur, QR invalide",
    );
    expect(checkinAnnouncement(null, null)).toBeNull();
  });

  it("announces an offline verdict and keeps the QR acronym", () => {
    expect(
      offlineCheckinAnnouncement("QR PÉRIMÉ", "Demandez à rouvrir.", "DUPONT"),
    ).toBe("QR périmé, DUPONT, Demandez à rouvrir.");
    expect(
      offlineCheckinAnnouncement("VÉRIFICATION IMPOSSIBLE", "Pas de clés."),
    ).toBe("Vérification impossible, Pas de clés.");
  });
});
