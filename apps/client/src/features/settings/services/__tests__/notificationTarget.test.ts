import { notificationTargetOf } from "../notificationTarget";

describe("notificationTargetOf", () => {
  it("ouvre la compétition désignée par la charge utile", () => {
    expect(notificationTargetOf({ competitionId: "comp-42" })).toEqual({
      screen: "CompetitionDetail",
      params: { competitionId: "comp-42" },
    });
  });

  it("ignore les champs qui l'accompagnent", () => {
    expect(
      notificationTargetOf({
        type: "registration_confirmed_by_club",
        competitionId: "comp-7",
        eventId: "ev-1",
        registrationId: "reg-1",
      }),
    ).toEqual({
      screen: "CompetitionDetail",
      params: { competitionId: "comp-7" },
    });
  });

  /**
   * `null` n'est pas un échec : une notification de test, un signalement de
   * musique ou un partenariat ne pointent vers aucun écran. Les deux appelants
   * en tirent des conclusions différentes — l'écran ne bouge pas, la push ouvre
   * le centre de notifications.
   */
  it.each([
    ["charge utile de test", { type: "test" }],
    ["type inconnu d'un client plus ancien", { somethingNew: "x" }],
    ["identifiant vide", { competitionId: "" }],
    ["identifiant non-chaîne", { competitionId: 42 }],
    ["objet nul", null],
    ["absent", undefined],
    ["scalaire", "pas un objet"],
    ["tableau", ["competitionId"]],
  ])("ne désigne aucune destination — %s", (_label, data) => {
    expect(notificationTargetOf(data)).toBeNull();
  });

  // Un producteur ajouté côté serveur ne doit pas exiger une nouvelle version
  // de l'application : l'inconnu est ignoré, jamais fatal.
  it("ne lève jamais, quelle que soit la charge utile", () => {
    const hostile = JSON.parse('{"__proto__": {"competitionId": "pwned"}}');
    expect(() => notificationTargetOf(hostile)).not.toThrow();
    expect(notificationTargetOf(hostile)).toBeNull();
  });
});
