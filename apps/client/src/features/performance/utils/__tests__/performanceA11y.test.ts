import {
  phaseA11yLabel,
  phaseChangeAnnouncement,
  roundChipA11yLabel,
} from "../performanceA11y";

describe("performanceA11y (#22)", () => {
  it("reads the round chip without a slash", () => {
    expect(roundChipA11yLabel(1, 3)).toBe("Tour 1 sur 3");
  });

  it("reads the phase block as one sentence with a spoken clock", () => {
    expect(
      phaseA11yLabel({ phase: "dance", danceName: "Samba", timeRemaining: 65 }),
    ).toBe("En cours, Samba, il reste 1 minute 5 secondes");
    expect(
      phaseA11yLabel({
        phase: "break",
        danceName: "Samba",
        timeRemaining: 20,
        detail: "Suivant : Cha-cha-cha",
      }),
    ).toBe("Pause, il reste 20 secondes, Suivant : Cha-cha-cha");
    expect(
      phaseA11yLabel({
        phase: "preparation",
        timeRemaining: 60,
        detail: "Préparez-vous",
      }),
    ).toBe("Préparation, il reste 1 minute, Préparez-vous");
  });

  it("announces a phase change without the clock", () => {
    expect(
      phaseChangeAnnouncement({
        phase: "dance",
        danceName: "Samba",
        detail: "ignored",
      }),
    ).toBe("En cours, Samba");
    expect(
      phaseChangeAnnouncement({
        phase: "break",
        danceName: "Samba",
        detail: "Suivant : Rumba",
      }),
    ).toBe("Pause, Suivant : Rumba");
  });
});
