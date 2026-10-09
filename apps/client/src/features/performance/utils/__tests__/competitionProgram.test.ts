import type { TrackData } from "../../../player/context/PlayerContext";
import {
  createDefaultConfig,
  createRound,
  DANCES,
  MAX_ROUND_GROUPS,
  type Category,
  type PerformanceConfig,
  type RoundConfig,
} from "../../../../stores/performance.store";
import {
  addGroup,
  addRound,
  buildPlaylist,
  describeGroup,
  describeItem,
  describeValidation,
  getAnnouncementText,
  moveDance,
  normalizeRound,
  ordinal,
  removeGroup,
  removeRound,
  roundCategories,
  roundSequence,
  setGroupCategory,
  setRoundType,
  sortDances,
  toggleRoundDance,
  trackMatchesDance,
  validateProgram,
} from "../competitionProgram";
import {
  OFFICIAL_DANCE_ORDER,
  type DanceOrder,
} from "../../../../stores/danceOrder.store";

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

/** Round with the given groups; dances default to every dance. */
const round = (
  groups: Category[],
  patch: Partial<Omit<RoundConfig, "dances">> & {
    dances?: Partial<RoundConfig["dances"]>;
  } = {},
): RoundConfig => {
  const base = createRound("Latin", patch.type ?? "Round");
  return {
    ...base,
    ...patch,
    groups,
    dances: { ...base.dances, ...patch.dances },
  };
};

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

describe("rounds and groups", () => {
  it("defaults to one Passage round of 2 Latin groups, every dance", () => {
    const def = createDefaultConfig();
    expect(def.rounds).toHaveLength(1);
    expect(def.rounds[0]).toMatchObject({
      type: "Round",
      groups: ["Latin", "Latin"],
      dances: { Standard: [...DANCES.Standard], Latin: [...DANCES.Latin] },
    });
  });

  it("a new Final starts with a single group", () => {
    expect(createRound("Standard", "Final").groups).toEqual(["Standard"]);
  });

  it("adds groups (same category as the last) up to the maximum", () => {
    let program = cfg([round(["Standard", "Latin"])]);
    const id = program.rounds[0].id;
    program = addGroup(id)(program);
    expect(program.rounds[0].groups).toEqual(["Standard", "Latin", "Latin"]);
    for (let i = 0; i < 20; i++) program = addGroup(id)(program);
    expect(program.rounds[0].groups).toHaveLength(MAX_ROUND_GROUPS);
  });

  it("removes a group but always keeps one", () => {
    const r = round(["Standard", "Latin", "Standard"]);
    const two = removeGroup(r.id, 1)(cfg([r]));
    expect(two.rounds[0].groups).toEqual(["Standard", "Standard"]);
    const one = removeGroup(r.id, 0)(two);
    expect(removeGroup(r.id, 0)(one).rounds[0].groups).toEqual(["Standard"]);
  });

  it("changes the category of one group only", () => {
    const r = round(["Standard", "Standard", "Standard"]);
    const next = setGroupCategory(r.id, 1, "Latin")(cfg([r]));
    expect(next.rounds[0].groups).toEqual(["Standard", "Latin", "Standard"]);
  });

  it("switching to Final keeps the groups (wording only)", () => {
    const r = round(["Latin", "Latin"]);
    const final = setRoundType(r.id, "Final")(cfg([r]));
    expect(final.rounds[0]).toMatchObject({
      type: "Final",
      groups: ["Latin", "Latin"],
    });
  });

  it("new round copies the previous round's groups and dances", () => {
    const r = round(["Standard", "Latin"], {
      type: "Final",
      dances: { Latin: ["Jive"] },
    });
    const next = addRound(cfg([r]));
    expect(next.rounds[1]).toMatchObject({
      type: "Round",
      groups: ["Standard", "Latin"],
      dances: { Standard: [...DANCES.Standard], Latin: ["Jive"] },
    });
    expect(next.rounds[1].id).not.toBe(r.id);
    // A copy, not a shared reference.
    next.rounds[1].groups.push("Latin");
    expect(r.groups).toHaveLength(2);
  });

  it("never removes the last round", () => {
    const r = round(["Latin"]);
    expect(removeRound(r.id)(cfg([r])).rounds).toHaveLength(1);
    const r2 = round(["Latin"]);
    expect(removeRound(r.id)(cfg([r, r2])).rounds).toEqual([r2]);
  });

  it("toggles dances per category, in canonical order", () => {
    const r = round(["Latin"], { dances: { Latin: ["Jive"] } });
    const next = toggleRoundDance(r.id, "Latin", "Samba")(cfg([r]));
    expect(next.rounds[0].dances.Latin).toEqual(["Samba", "Jive"]);
    expect(
      toggleRoundDance(r.id, "Latin", "Jive")(next).rounds[0].dances.Latin,
    ).toEqual(["Samba"]);
    expect(next.rounds[0].dances.Standard).toEqual([...DANCES.Standard]);
  });

  it("normalizeRound drops dances of another category", () => {
    const r = round(["Latin"], { dances: { Latin: ["Tango", "Rumba"] } });
    expect(normalizeRound(r).dances.Latin).toEqual(["Rumba"]);
  });

  it("lists the categories danced, in order of appearance", () => {
    expect(roundCategories(round(["Latin", "Standard", "Latin"]))).toEqual([
      "Latin",
      "Standard",
    ]);
  });
});

describe("roundSequence / buildPlaylist", () => {
  const steps = (r: RoundConfig) =>
    roundSequence(r).map((s) => `${s.dance}:G${s.groupIndex}`);

  it("2 Standard groups and 1 Latin group: Valse, Samba, Valse, then Tango…", () => {
    const r = round(["Standard", "Latin", "Standard"], {
      dances: {
        Standard: ["Valse Lente", "Tango"],
        Latin: ["Samba", "Cha-Cha-Cha"],
      },
    });
    expect(steps(r)).toEqual([
      "Valse Lente:G1",
      "Samba:G2",
      "Valse Lente:G3",
      "Tango:G1",
      "Cha-Cha-Cha:G2",
      "Tango:G3",
    ]);
  });

  it("a single-category round is dance-major, groups in order", () => {
    const r = round(["Latin", "Latin"], {
      dances: { Latin: ["Samba", "Jive"] },
    });
    expect(steps(r)).toEqual(["Samba:G1", "Samba:G2", "Jive:G1", "Jive:G2"]);
  });

  it("a category with fewer dances drops out", () => {
    const r = round(["Standard", "Latin"], {
      dances: { Standard: ["Valse Lente", "Tango"], Latin: ["Samba"] },
    });
    expect(steps(r)).toEqual(["Valse Lente:G1", "Samba:G2", "Tango:G1"]);
  });

  it("a Final is group-major: each group dances all its dances in a row", () => {
    const dances = { Latin: ["Samba", "Cha-Cha-Cha", "Jive"] };
    const prelim = round(["Latin", "Latin"], { dances });
    const final = round(["Latin", "Latin"], { type: "Final", dances });
    expect(steps(prelim)).toEqual([
      "Samba:G1",
      "Samba:G2",
      "Cha-Cha-Cha:G1",
      "Cha-Cha-Cha:G2",
      "Jive:G1",
      "Jive:G2",
    ]);
    expect(steps(final)).toEqual([
      "Samba:G1",
      "Cha-Cha-Cha:G1",
      "Jive:G1",
      "Samba:G2",
      "Cha-Cha-Cha:G2",
      "Jive:G2",
    ]);
    expect(roundSequence(final)[3]).toEqual({
      dance: "Samba",
      category: "Latin",
      groupIndex: 2,
      danceIndex: 0,
    });
  });

  it("a mixed Final keeps each group's own dances, in group order", () => {
    const r = round(["Standard", "Latin"], {
      type: "Final",
      dances: { Standard: ["Valse Lente", "Tango"], Latin: ["Samba"] },
    });
    expect(steps(r)).toEqual(["Valse Lente:G1", "Tango:G1", "Samba:G2"]);
  });

  it("a single-group Final keeps the plain dance order", () => {
    const r = round(["Latin"], {
      type: "Final",
      dances: { Latin: ["Samba", "Rumba", "Jive"] },
    });
    expect(steps(r)).toEqual(["Samba:G1", "Rumba:G1", "Jive:G1"]);
  });

  describe("multi-group Final playlist", () => {
    const finalList = buildPlaylist(
      cfg([
        round(["Standard", "Latin", "Latin"], {
          type: "Final",
          dances: { Standard: ["Valse Lente"], Latin: ["Samba", "Jive"] },
        }),
      ]),
      LIBRARY,
      () => 0.42,
    );

    it("plays the groups one after the other", () => {
      expect(
        finalList.map((i) => `${i.style}:${i.groupIndex}:${i.danceIndex}`),
      ).toEqual([
        "Valse Lente:1:0",
        "Samba:2:0",
        "Jive:2:1",
        "Samba:3:0",
        "Jive:3:1",
      ]);
    });

    it("flags only the first Latin group as opening the category", () => {
      expect(finalList.map((i) => i.opensCategory)).toEqual([
        false,
        true,
        false,
        false,
        false,
      ]);
    });

    it("announces each group as it takes the floor, then the dance changes", () => {
      const texts = finalList.map((i) => i.announcementText);
      expect(texts[0]).toMatch(/finale/i);
      expect(texts[1]).toMatch(/latines/);
      expect(texts[1]).toMatch(/deuxième groupe/i);
      // Last dance of group 2: not the end of the final yet.
      expect(texts[2]).toMatch(/le Jive/);
      expect(texts[2]).not.toMatch(/terminer|dernier groupe/i);
      expect(texts[3]).toMatch(/troisième et dernier groupe|dernier groupe/);
      expect(texts[3]).toMatch(/la Samba/);
      expect(texts[4]).toMatch(/le Jive/);
      expect(texts[4]).toMatch(/troisième groupe/);
    });

    it("rotates the music between the groups of a dance", () => {
      const samba = finalList.filter((i) => i.style === "Samba");
      expect(samba[0].track.id).not.toBe(samba[1].track.id);
    });
  });

  const program = cfg([
    round(["Standard", "Standard"], {
      dances: { Standard: ["Valse Lente", "Tango"] },
    }),
    round(["Standard", "Latin", "Standard"], {
      dances: { Standard: ["Tango"], Latin: ["Samba"] },
    }),
    round(["Latin"], { type: "Final", dances: { Latin: ["Samba", "Jive"] } }),
  ]);
  const list = buildPlaylist(program, LIBRARY, () => 0.42);

  it("chains rounds with group numbers and counts", () => {
    expect(
      list.map(
        (i) => `${i.roundIndex}:${i.style}:${i.groupIndex}/${i.totalGroups}`,
      ),
    ).toEqual([
      "1:Valse Lente:1/2",
      "1:Valse Lente:2/2",
      "1:Tango:1/2",
      "1:Tango:2/2",
      "2:Tango:1/3",
      "2:Samba:2/3",
      "2:Tango:3/3",
      "3:Samba:1/1",
      "3:Jive:1/1",
    ]);
  });

  it("flags mixed rounds and the group opening a category", () => {
    expect(list.filter((i) => i.mixed).map((i) => i.roundIndex)).toEqual([
      2, 2, 2,
    ]);
    expect(list.filter((i) => i.opensCategory).map((i) => i.style)).toEqual([
      "Samba",
    ]);
  });

  it("picks tracks of the right dance and rotates between groups", () => {
    const tango = list.filter((i) => i.roundIndex === 1 && i.style === "Tango");
    expect(tango.map((i) => i.track.style)).toEqual(["Tango", "Tango"]);
    expect(tango[0].track.id).not.toBe(tango[1].track.id);
  });

  it("uses the clash setting for the Paso Doble duration", () => {
    const paso = buildPlaylist(
      {
        ...cfg([round(["Latin"], { dances: { Latin: ["Paso Doble"] } })]),
        pasoClashes: 3,
      },
      LIBRARY,
    );
    expect(paso[0].duration).toBe(120);
  });

  it("is reproducible with the same random source", () => {
    const again = buildPlaylist(program, LIBRARY, () => 0.42);
    expect(again.map((i) => i.track.id)).toEqual(list.map((i) => i.track.id));
  });

  it("describes items for the player screen", () => {
    expect(describeItem(list[5])).toBe("Tour 2 · Latines · Samba · Groupe 2/3");
    expect(describeItem(list[7])).toBe("Tour 3 · Latines · Samba · Finale");
    expect(describeGroup({ groupIndex: 1, totalGroups: 1 })).toBe(
      "Groupe unique",
    );
  });
});

describe("validateProgram", () => {
  it("reports a danced category without any dance", () => {
    const v = validateProgram(
      cfg([round(["Standard", "Latin"], { dances: { Latin: [] } })]),
      LIBRARY,
    );
    expect(v.emptyRounds).toEqual([{ roundIndex: 1, category: "Latin" }]);
    expect(describeValidation(v)).toContain("tour 1 (Latines)");
  });

  it("ignores the dances of a category no group dances", () => {
    const v = validateProgram(
      cfg([round(["Latin"], { dances: { Standard: [] } })]),
      LIBRARY,
    );
    expect(v.emptyRounds).toEqual([]);
  });

  it("lists missing dances per round with French names", () => {
    const v = validateProgram(
      cfg([
        round(["Latin"], { dances: { Latin: ["Samba"] } }),
        round(["Standard"], {
          dances: { Standard: ["Tango", "Valse Viennoise"] },
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
    groupIndex: 1,
    totalGroups: 2,
    roundIndex: 1,
    totalRounds: 2,
    roundType: "Round" as const,
    category: "Latin" as const,
    mixed: false,
    opensCategory: false,
    danceIndex: 0,
    dancesInRound: 5,
  };

  it("opens a round like an MC, in French, naming the group", () => {
    const text = getAnnouncementText(base);
    expect(text).toMatch(/premier tour/);
    expect(text).toMatch(/Samba/);
    expect(text).toMatch(/premier groupe/i);
  });

  it("does not name the group when the round has only one", () => {
    const text = getAnnouncementText({ ...base, totalGroups: 1 });
    expect(text).not.toMatch(/groupe|passage|finale/i);
  });

  it("announces later groups with French ordinals", () => {
    const text = getAnnouncementText({ ...base, groupIndex: 2, danceIndex: 1 });
    expect(text).toMatch(/deuxième groupe/i);
  });

  it("announces the last group of 3 as the last one", () => {
    const text = getAnnouncementText({
      ...base,
      groupIndex: 3,
      totalGroups: 3,
      danceIndex: 2,
      style: "Rumba",
    });
    expect(text).toMatch(/dernier groupe/i);
  });

  it("introduces the other category in a mixed round", () => {
    const text = getAnnouncementText({
      ...base,
      mixed: true,
      opensCategory: true,
      groupIndex: 2,
      totalGroups: 3,
    });
    expect(text).toMatch(/latines/);
    expect(text).toMatch(/deuxième groupe/i);
  });

  it("announces a final and its last dance with proper articles", () => {
    const final = { ...base, roundType: "Final" as const, totalGroups: 1 };
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

  describe("in a multi-group Final (group-major)", () => {
    const final = {
      ...base,
      roundType: "Final" as const,
      totalGroups: 3,
      dancesInRound: 3,
      style: "Samba",
    };

    it("announces a new group on its first dance", () => {
      const text = getAnnouncementText({ ...final, groupIndex: 2 });
      expect(text).toMatch(/deuxième groupe/);
      expect(text).toMatch(/la Samba/);
      expect(text).not.toMatch(/dernier/);
    });

    it("announces the last group of the final as the last one", () => {
      const text = getAnnouncementText({ ...final, groupIndex: 3 });
      expect(text).toMatch(/dernier groupe/);
    });

    it("announces the dance changes within a group, naming it", () => {
      const text = getAnnouncementText({
        ...final,
        groupIndex: 2,
        danceIndex: 1,
        style: "Rumba",
      });
      expect(text).toMatch(/la Rumba/);
      expect(text).toMatch(/deuxième groupe/i);
      expect(text).not.toMatch(/dernier groupe/);
    });

    it("only says « pour terminer » on the last dance of the last group", () => {
      const lastOfG1 = getAnnouncementText({
        ...final,
        groupIndex: 1,
        danceIndex: 2,
        style: "Jive",
      });
      expect(lastOfG1).toMatch(/ce groupe|ce passage/);
      expect(lastOfG1).toMatch(/premier groupe/i);
      const lastOfFinal = getAnnouncementText({
        ...final,
        groupIndex: 3,
        danceIndex: 2,
        style: "Jive",
      });
      expect(lastOfFinal).toMatch(/dernière danse|pour terminer/i);
    });
  });

  it("uses French dance names and articles in transitions", () => {
    const text = getAnnouncementText({
      ...base,
      totalGroups: 1,
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

  describe("MC style (spoken at the start of the preparation break)", () => {
    /** Every announcement of a 2-round programme: 3 groups, then a final. */
    const programme = () => {
      const texts: string[] = [];
      const latin = DANCES.Latin;
      for (const roundType of ["Round", "Final"] as const) {
        const totalGroups = roundType === "Final" ? 1 : 3;
        latin.forEach((style, danceIndex) => {
          for (let g = 1; g <= totalGroups; g++) {
            texts.push(
              getAnnouncementText({
                ...base,
                style,
                roundType,
                roundIndex: roundType === "Final" ? 2 : 1,
                groupIndex: g,
                totalGroups,
                danceIndex,
                dancesInRound: latin.length,
              }),
            );
          }
        });
      }
      return texts;
    };

    it("never sounds like a robotic label (« Dernière danse : … »)", () => {
      for (const text of programme()) {
        expect(text).not.toMatch(/ : /);
        expect(text).not.toMatch(/^Dernière danse :/);
        // Ends like a spoken call, for the TTS falling intonation.
        expect(text).toMatch(/[!.]$/);
      }
    });

    it("varies its wording along a programme", () => {
      const openings = new Set(
        programme().map((text) => text.split(/[…,!.]/)[0]),
      );
      expect(openings.size).toBeGreaterThanOrEqual(6);
    });

    it("calls the dancers to the floor", () => {
      expect(
        getAnnouncementText({ ...base, danceIndex: 2, groupIndex: 1 }),
      ).toMatch(/premier groupe/i);
      const final = getAnnouncementText({
        ...base,
        roundType: "Final",
        totalGroups: 1,
        danceIndex: 2,
      });
      expect(final).toMatch(/finalistes/i);
      expect(final).not.toMatch(/groupe/);
    });

    it("never says « toujours / encore » after another category in a mixed round", () => {
      for (const groupIndex of [2, 3]) {
        for (const style of ["Tango", "Samba", "Jive"]) {
          const text = getAnnouncementText({
            ...base,
            style,
            mixed: true,
            groupIndex,
            totalGroups: 3,
            danceIndex: 1,
          });
          expect(text).not.toMatch(/toujours|encore|on reste/i);
          expect(text).toMatch(/groupe/);
        }
      }
    });

    it("announces the last dance as coming up, with its article", () => {
      const text = getAnnouncementText({
        ...base,
        style: "Paso Doble",
        danceIndex: 4,
      });
      expect(text).toMatch(/le Paso doble/);
      expect(text).toMatch(/finir|dernière/i);
    });
  });
});

describe("custom dance order (per category, every round)", () => {
  const ORDER: DanceOrder = {
    Standard: [
      "Tango",
      "Valse Lente",
      "Valse Viennoise",
      "Slow Fox",
      "Quickstep",
    ],
    Latin: ["Cha-Cha-Cha", "Samba", "Rumba", "Paso Doble", "Jive"],
  };

  it("sortDances follows the configured order, official by default", () => {
    expect(sortDances("Latin", ["Samba", "Cha-Cha-Cha"])).toEqual([
      "Samba",
      "Cha-Cha-Cha",
    ]);
    expect(sortDances("Latin", ["Samba", "Cha-Cha-Cha"], ORDER)).toEqual([
      "Cha-Cha-Cha",
      "Samba",
    ]);
    // Dances of another category are still dropped.
    expect(sortDances("Latin", ["Tango", "Jive"], ORDER)).toEqual(["Jive"]);
  });

  it("sortDances tolerates an incomplete order (missing dances appended)", () => {
    const partial: DanceOrder = { ...OFFICIAL_DANCE_ORDER, Latin: ["Jive"] };
    expect(sortDances("Latin", ["Samba", "Jive", "Rumba"], partial)).toEqual([
      "Jive",
      "Samba",
      "Rumba",
    ]);
  });

  it("normalizeRound sorts both categories with the order", () => {
    const r = round(["Standard", "Latin"], {
      dances: {
        Standard: ["Valse Lente", "Tango"],
        Latin: ["Samba", "Cha-Cha-Cha"],
      },
    });
    expect(normalizeRound(r, ORDER).dances).toEqual({
      Standard: ["Tango", "Valse Lente"],
      Latin: ["Cha-Cha-Cha", "Samba"],
    });
  });

  it("roundSequence interleaves groups in the custom order", () => {
    const r = round(["Standard", "Latin"], {
      dances: {
        Standard: ["Valse Lente", "Tango"],
        Latin: ["Samba", "Cha-Cha-Cha"],
      },
    });
    expect(
      roundSequence(r, ORDER).map((s) => `${s.dance}:G${s.groupIndex}`),
    ).toEqual(["Tango:G1", "Cha-Cha-Cha:G2", "Valse Lente:G1", "Samba:G2"]);
  });

  it("buildPlaylist applies the order to every round, finals included", () => {
    const program = cfg([
      round(["Latin", "Latin"], {
        dances: { Latin: ["Samba", "Cha-Cha-Cha", "Jive"] },
      }),
      round(["Latin"], {
        type: "Final",
        dances: { Latin: ["Samba", "Cha-Cha-Cha"] },
      }),
    ]);
    const list = buildPlaylist(program, LIBRARY, () => 0.42, ORDER);
    expect(
      list.map((i) => `${i.roundIndex}:${i.style}:${i.groupIndex}`),
    ).toEqual([
      "1:Cha-Cha-Cha:1",
      "1:Cha-Cha-Cha:2",
      "1:Samba:1",
      "1:Samba:2",
      "1:Jive:1",
      "1:Jive:2",
      "2:Cha-Cha-Cha:1",
      "2:Samba:1",
    ]);
    // Positions and MC announcements follow the custom order too.
    expect(list[0].danceIndex).toBe(0);
    expect(list[0].announcementText).toMatch(/Cha-cha-cha/);
    expect(list[2].danceIndex).toBe(1);
    expect(list[6].announcementText).toMatch(/finale/);
    expect(list[6].announcementText).toMatch(/Cha-cha-cha/);
    expect(list[7].danceIndex).toBe(1);
    expect(list[7].announcementText).toMatch(/Samba/);
    expect(list[7].announcementText).toMatch(/dernière danse|pour terminer/i);
  });

  it("validateProgram lists missing dances in the custom order", () => {
    const v = validateProgram(
      cfg([round(["Latin"], { dances: { Latin: ["Samba", "Cha-Cha-Cha"] } })]),
      [],
      ORDER,
    );
    expect(v.missing[0].dances).toEqual(["Cha-Cha-Cha", "Samba"]);
  });

  it("moveDance moves an item and clamps the target", () => {
    const latin = [...DANCES.Latin];
    expect(moveDance(latin, 1, 0)).toEqual([
      "Cha-Cha-Cha",
      "Samba",
      "Rumba",
      "Paso Doble",
      "Jive",
    ]);
    expect(moveDance(latin, 0, 99)).toEqual([
      "Cha-Cha-Cha",
      "Rumba",
      "Paso Doble",
      "Jive",
      "Samba",
    ]);
    expect(moveDance(latin, 9, 0)).toEqual(latin);
    // Pure: the input is untouched.
    expect(latin).toEqual([...DANCES.Latin]);
  });
});
