import type { TrackData } from "../../../player/context/PlayerContext";
import {
  createDefaultConfig,
  createRound,
  DANCES,
  type PerformanceConfig,
  type RoundConfig,
} from "../../../../stores/performance.store";
import {
  addRound,
  buildPlaylist,
  clampHeats,
  describeItem,
  describeValidation,
  getAnnouncementText,
  normalizeRound,
  ordinal,
  removeRound,
  setRoundCategory,
  setRoundType,
  stepRoundHeats,
  toggleRoundDance,
  trackMatchesDance,
  validateProgram,
} from "../competitionProgram";

const track = (id: string, style: string): TrackData => ({
  id,
  title: `${style} ${id}`,
  artist: "Artiste",
  url: `https://cdn/${id}.mp3`,
  baseBpm: 30,
  style,
});

// Library styles as stored by the backend (not the UI ids).
const LIBRARY: TrackData[] = [
  track("vl1", "Valse Lente"),
  track("t1", "Tango"),
  track("t2", "Tango"),
  track("vv1", "Valse Viennoise"),
  track("sf1", "Slowfox"),
  track("q1", "Quickstep"),
  track("s1", "Samba"),
  track("s2", "Samba"),
  track("c1", "Cha-cha"),
  track("r1", "Rumba"),
  track("p1", "Paso Doble"),
  track("j1", "Jive"),
];

const round = (patch: Partial<RoundConfig>): RoundConfig => ({
  ...createRound(patch.category ?? "Latin", patch.type ?? "Round"),
  ...patch,
});

const cfg = (rounds: RoundConfig[]): PerformanceConfig => ({
  ...createDefaultConfig(),
  rounds,
});

describe("trackMatchesDance", () => {
  it.each([
    ["Valse Viennoise", "Valse Viennoise"],
    ["Cha-cha", "Cha-Cha-Cha"],
    ["Slowfox", "Slow Fox"],
    ["slow fox", "Slow Fox"],
    ["Valse Lente", "Valse Lente"],
    ["Paso Doble", "Paso Doble"],
  ])("matches library style %p to %p", (style, dance) => {
    expect(trackMatchesDance(style, dance)).toBe(true);
  });

  it("does not confuse the two waltzes", () => {
    expect(trackMatchesDance("Valse Viennoise", "Valse Lente")).toBe(false);
    expect(trackMatchesDance("Valse Lente", "Valse Viennoise")).toBe(false);
  });

  it("returns false without style", () => {
    expect(trackMatchesDance(undefined, "Samba")).toBe(false);
  });
});

describe("heats rules", () => {
  it("defaults to one Latin round, Passage, 2 heats, all 5 dances", () => {
    const def = createDefaultConfig();
    expect(def.rounds).toHaveLength(1);
    expect(def.rounds[0]).toMatchObject({
      category: "Latin",
      type: "Round",
      heats: 2,
      selectedDances: [...DANCES.Latin],
    });
  });

  it("clamps a Passage to at least 2 heats and a Final to exactly 1", () => {
    expect(clampHeats({ type: "Round" }, 1)).toBe(2);
    expect(clampHeats({ type: "Round" }, 0)).toBe(2);
    expect(clampHeats({ type: "Round" }, 4)).toBe(4);
    expect(clampHeats({ type: "Round" }, 99)).toBe(10);
    expect(clampHeats({ type: "Final" }, 3)).toBe(1);
  });

  it("stepper never goes below 2", () => {
    const r = round({ heats: 2 });
    const next = stepRoundHeats(r.id, -1)(cfg([r]));
    expect(next.rounds[0].heats).toBe(2);
    expect(stepRoundHeats(r.id, 1)(next).rounds[0].heats).toBe(3);
  });

  it("switching to Final forces 1 heat and back to Passage restores 2", () => {
    const r = round({ heats: 3 });
    const final = setRoundType(r.id, "Final")(cfg([r]));
    expect(final.rounds[0].heats).toBe(1);
    const back = setRoundType(r.id, "Round")(final);
    expect(back.rounds[0].heats).toBe(2);
  });
});

describe("programme edition", () => {
  it("adds a round copying the previous category, Passage, 2 heats, all dances", () => {
    const std = round({ category: "Standard", type: "Final", heats: 1 });
    const next = addRound(cfg([std]));
    expect(next.rounds).toHaveLength(2);
    expect(next.rounds[1]).toMatchObject({
      category: "Standard",
      type: "Round",
      heats: 2,
      selectedDances: [...DANCES.Standard],
    });
    expect(next.rounds[1].id).not.toBe(std.id);
  });

  it("never removes the last round", () => {
    const r = round({});
    expect(removeRound(r.id)(cfg([r])).rounds).toHaveLength(1);
    const r2 = round({});
    expect(removeRound(r.id)(cfg([r, r2])).rounds).toEqual([r2]);
  });

  it("changing category resets dances to the new category", () => {
    const r = round({ selectedDances: ["Samba"] });
    const next = setRoundCategory(r.id, "Standard")(cfg([r]));
    expect(next.rounds[0].selectedDances).toEqual([...DANCES.Standard]);
  });

  it("toggling dances keeps the canonical order", () => {
    const r = round({ selectedDances: ["Jive"] });
    const next = toggleRoundDance(r.id, "Samba")(cfg([r]));
    expect(next.rounds[0].selectedDances).toEqual(["Samba", "Jive"]);
    expect(
      toggleRoundDance(r.id, "Jive")(next).rounds[0].selectedDances,
    ).toEqual(["Samba"]);
  });

  it("normalizeRound drops dances of another category", () => {
    expect(
      normalizeRound(round({ selectedDances: ["Tango", "Rumba"] }))
        .selectedDances,
    ).toEqual(["Rumba"]);
  });
});

describe("buildPlaylist — mixed programme", () => {
  const program = cfg([
    round({
      category: "Standard",
      type: "Round",
      heats: 2,
      selectedDances: ["Valse Lente", "Tango"],
    }),
    round({
      category: "Latin",
      type: "Round",
      heats: 3,
      selectedDances: ["Samba", "Jive"],
    }),
    round({
      category: "Standard",
      type: "Final",
      heats: 1,
      selectedDances: ["Tango", "Quickstep"],
    }),
  ]);

  const list = buildPlaylist(program, LIBRARY, () => 0.42);

  it("orders round → dance → heat (dance-major) with correct counts", () => {
    expect(
      list.map((i) => `${i.roundIndex}:${i.style}:${i.heatIndex}`),
    ).toEqual([
      "1:Valse Lente:1",
      "1:Valse Lente:2",
      "1:Tango:1",
      "1:Tango:2",
      "2:Samba:1",
      "2:Samba:2",
      "2:Samba:3",
      "2:Jive:1",
      "2:Jive:2",
      "2:Jive:3",
      "3:Tango:1",
      "3:Quickstep:1",
    ]);
  });

  it("a Final has exactly one heat per dance", () => {
    const finals = list.filter((i) => i.roundIndex === 3);
    expect(finals.every((i) => i.totalHeats === 1)).toBe(true);
    expect(finals.every((i) => i.roundType === "Final")).toBe(true);
  });

  it("picks tracks of the right dance and rotates between heats", () => {
    const tangoHeats = list.filter(
      (i) => i.roundIndex === 1 && i.style === "Tango",
    );
    expect(tangoHeats.map((i) => i.track.style)).toEqual(["Tango", "Tango"]);
    expect(tangoHeats[0].track.id).not.toBe(tangoHeats[1].track.id);
  });

  it("uses the clash setting for the Paso Doble duration", () => {
    const paso = buildPlaylist(
      {
        ...cfg([round({ selectedDances: ["Paso Doble"] })]),
        pasoClashes: 3,
      },
      LIBRARY,
    );
    expect(paso[0]).toMatchObject({ isPaso: true, duration: 120 });
  });

  it("attaches a deterministic French announcement to every item", () => {
    const again = buildPlaylist(program, LIBRARY, () => 0.1);
    expect(list.map((i) => i.announcementText)).toEqual(
      again.map((i) => i.announcementText),
    );
    expect(list.every((i) => i.announcementText.length > 0)).toBe(true);
  });

  it("describes an item for the player screen", () => {
    expect(describeItem(list[2])).toBe(
      "Tour 1 · Standard · Tango · Passage 1/2",
    );
    expect(describeItem(list[11])).toBe(
      "Tour 3 · Standard · Quickstep · Finale",
    );
  });
});

describe("validateProgram", () => {
  it("reports empty rounds", () => {
    const v = validateProgram(cfg([round({ selectedDances: [] })]), LIBRARY);
    expect(v.emptyRounds).toEqual([1]);
    expect(describeValidation(v)).toContain("tour 1");
  });

  it("lists missing dances per round with French names", () => {
    const v = validateProgram(
      cfg([
        round({ category: "Latin", selectedDances: ["Samba"] }),
        round({
          category: "Standard",
          selectedDances: ["Tango", "Valse Viennoise"],
        }),
      ]),
      LIBRARY.filter((t) => t.style !== "Valse Viennoise"),
    );
    expect(v.missing).toEqual([
      { roundIndex: 2, category: "Standard", dances: ["Valse Viennoise"] },
    ]);
    expect(describeValidation(v)).toContain(
      "Tour 2 (Standard) : Valse viennoise",
    );
  });

  it("returns null when everything is available", () => {
    expect(
      describeValidation(validateProgram(createDefaultConfig(), LIBRARY)),
    ).toBeNull();
  });
});

describe("getAnnouncementText", () => {
  const base = {
    style: "Samba",
    heatIndex: 1,
    totalHeats: 2,
    roundIndex: 1,
    totalRounds: 2,
    roundType: "Round" as const,
    danceIndex: 0,
    dancesInRound: 5,
  };

  it("opens a round like an MC, in French", () => {
    const text = getAnnouncementText(base);
    expect(text).toMatch(/premier tour/);
    expect(text).toMatch(/Samba/);
    expect(text).not.toMatch(/Heat|First/);
  });

  it("announces later heats with French ordinals", () => {
    const text = getAnnouncementText({ ...base, heatIndex: 2, danceIndex: 1 });
    expect(text).toMatch(/deuxième passage/i);
  });

  it("announces the last heat of a 3-heat dance as the last one", () => {
    const text = getAnnouncementText({
      ...base,
      heatIndex: 3,
      totalHeats: 3,
      danceIndex: 2,
      style: "Rumba",
    });
    expect(text).toMatch(/dernier passage/i);
  });

  it("announces a final and its last dance with proper articles", () => {
    const final = { ...base, roundType: "Final" as const, totalHeats: 1 };
    expect(getAnnouncementText({ ...final, style: "Valse Lente" })).toMatch(
      /finale/i,
    );
    const last = getAnnouncementText({
      ...final,
      style: "Jive",
      danceIndex: 4,
    });
    expect(last).toMatch(/le Jive/);
  });

  it("uses French dance names and articles in transitions", () => {
    const text = getAnnouncementText({
      ...base,
      roundType: "Final",
      totalHeats: 1,
      style: "Cha-Cha-Cha",
      danceIndex: 1,
    });
    expect(text).toMatch(/Cha-cha-cha/);
    expect(text).not.toMatch(/la Cha/);
  });

  it("is deterministic", () => {
    expect(getAnnouncementText(base)).toBe(getAnnouncementText({ ...base }));
  });

  it("names rounds with ordinals", () => {
    expect(ordinal(1)).toBe("premier");
    expect(ordinal(3)).toBe("troisième");
    expect(ordinal(12)).toBe("12e");
    expect(getAnnouncementText({ ...base, roundIndex: 2 })).toMatch(
      /deuxième tour/,
    );
  });
});
