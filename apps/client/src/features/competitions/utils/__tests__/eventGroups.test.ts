import type { Event } from "../../../../stores/competition.store";
import { eventVariantLabel, groupEvents } from "../eventGroups";

const ev = (id: string, o: Partial<Event> = {}): Event => ({
  id,
  competitionId: "c1",
  category: "Latin",
  ageGroup: "Junior I",
  eventType: "COUPLE",
  ...o,
});

describe("groupEvents", () => {
  it("puts the levels of one discipline / age class / type in one group", () => {
    const groups = groupEvents([
      ev("1", { eventKind: "OPEN" }),
      ev("2", { eventKind: "CLASSIFICATRICE", level: "Avancé" }),
      ev("3", { eventKind: "CLASSIFICATRICE", level: "Débutant" }),
      ev("4", { eventKind: "CLASSIFICATRICE", level: "Intermédiaire" }),
      ev("5", { category: "Standard" }),
      ev("6", { eventType: "SOLO" }),
    ]);

    expect(groups).toHaveLength(3);
    // Levels in ascending order, the Open after the classificatrices.
    expect(groups[0].events.map((e) => e.id)).toEqual(["3", "4", "2", "1"]);
    expect(groups[1].events.map((e) => e.id)).toEqual(["5"]);
    expect(groups[2].events.map((e) => e.id)).toEqual(["6"]);
  });

  it("keeps the first-seen order of the groups", () => {
    const groups = groupEvents([
      ev("1", { category: "Standard", ageGroup: "Adulte" }),
      ev("2", { ageGroup: "Youth" }),
      ev("3", { category: "Standard", ageGroup: "Adulte", eventKind: "OPEN" }),
    ]);

    expect(groups.map((g) => g.events.map((e) => e.id).sort())).toEqual([
      ["1", "3"],
      ["2"],
    ]);
  });

  it("treats a missing event type as a couple (legacy events)", () => {
    const groups = groupEvents([
      ev("1", { eventType: undefined }),
      ev("2", { eventType: "COUPLE", eventKind: "OPEN" }),
    ]);

    expect(groups).toHaveLength(1);
  });
});

describe("eventVariantLabel", () => {
  it.each([
    [{ eventKind: "CLASSIFICATRICE", level: "Débutant" }, "Débutant"],
    [{ eventKind: "CLASSIFICATRICE" }, "Classificatrice"],
    [{ eventKind: "OPEN" }, "Open"],
    [{ eventKind: "MAJEURE" }, "Majeure"],
    [{ level: "Avancé" }, "Avancé"],
    [{}, null],
  ] as [Partial<Event>, string | null][])("%o → %s", (o, label) => {
    expect(eventVariantLabel(ev("1", o))).toBe(label);
  });
});
