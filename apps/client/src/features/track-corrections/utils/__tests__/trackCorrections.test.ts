import type { TrackCorrectionAdminDto } from "../../../../services/api/track-correction-api";
import { trackCorrectionTargetOf } from "../notificationTarget";
import {
  buildCorrectionDiff,
  canonicalDance,
  formatClashList,
  formatClashListForEdit,
  formatClashTime,
  formatClashTimePrecise,
  formatCorrectionDate,
  isDanceOnlyChange,
  parseClashList,
  parseMpm,
  reasonLabel,
  sameClashes,
  sameDance,
} from "../trackCorrections";

const track: TrackCorrectionAdminDto["track"] = {
  id: "t1",
  title: "España Cañí",
  artist: "Orchestre",
  style: "Paso Doble",
  bpm: 60,
  clashTimecodes: [40, 80],
  titleMasked: false,
  blacklisted: false,
  filename: "espana-cani.mp3",
};

const noChange = {
  title: null,
  artist: null,
  style: null,
  bpm: null,
  clashTimecodes: null,
};

describe("formatage des clashs", () => {
  it("formate en m:ss", () => {
    expect(formatClashTime(83.6)).toBe("1:23");
    expect(formatClashTime(5)).toBe("0:05");
    expect(formatClashTime(-3)).toBe("0:00");
  });

  it("trie et joint la liste, « aucun » si vide", () => {
    expect(formatClashList([83, 12])).toBe("0:12, 1:23");
    expect(formatClashList([])).toBe("aucun");
  });

  it("lit m:ss, secondes brutes et dixièmes", () => {
    expect(parseClashList("1:23, 0:12")).toEqual([12, 83]);
    expect(parseClashList("45 90.5")).toEqual([45, 90.5]);
    expect(parseClashList("1:02.5")).toEqual([62.5]);
    expect(parseClashList("  ")).toEqual([]);
  });

  it("refuse l'illisible, le hors-bornes et plus de 3 appels (paso doble)", () => {
    expect(parseClashList("abc")).toBeNull();
    expect(parseClashList("1:75")).toBeNull();
    expect(parseClashList("3601")).toBeNull();
    expect(parseClashList("0:40, 1:20, 2:00, 2:40")).toBeNull();
    expect(parseClashList("0:40, 1:20, 2:00")).toEqual([40, 80, 120]);
  });
});

describe("édition des clashs sans perte des dixièmes", () => {
  it("formate m:ss.d seulement quand il y a des dixièmes", () => {
    expect(formatClashTimePrecise(83.5)).toBe("1:23.5");
    expect(formatClashTimePrecise(83)).toBe("1:23");
    expect(formatClashTimePrecise(59.96)).toBe("1:00");
  });

  it("aller-retour format → lecture sans perte", () => {
    const clashes = [90.3, 12, 45.5];
    const text = formatClashListForEdit(clashes);
    expect(text).toBe("0:12, 0:45.5, 1:30.3");
    expect(sameClashes(parseClashList(text) ?? [], clashes)).toBe(true);
    expect(formatClashListForEdit([])).toBe("");
  });

  it("compare deux listes au dixième près, ordre indifférent", () => {
    expect(sameClashes([45.5, 12], [12, 45.5])).toBe(true);
    expect(sameClashes([45], [45.5])).toBe(false);
    expect(sameClashes([45], [45, 90])).toBe(false);
  });
});

describe("danses", () => {
  it("compare sans tenir compte de la casse ni des espaces", () => {
    expect(sameDance("rumba ", "Rumba")).toBe(true);
    expect(sameDance("Rumba", null)).toBe(false);
    expect(sameDance(undefined, null)).toBe(true);
  });

  it("ramène au libellé canonique", () => {
    expect(canonicalDance("paso doble")).toBe("Paso Doble");
    expect(canonicalDance("Bachata")).toBe("Bachata");
    expect(canonicalDance(null)).toBeNull();
  });

  it("détecte un changement de danse seul", () => {
    expect(
      isDanceOnlyChange({ proposed: { ...noChange, style: "Jive" } }),
    ).toBe(true);
    expect(
      isDanceOnlyChange({ proposed: { ...noChange, style: "Jive", bpm: 44 } }),
    ).toBe(false);
  });
});

describe("parseMpm", () => {
  it("accepte un entier dans [1, 400]", () => {
    expect(parseMpm(" 52 ")).toBe(52);
    expect(parseMpm("400")).toBe(400);
  });

  it.each(["0", "401", "5.5", "", "abc", "-3"])("refuse « %s »", (v) => {
    expect(parseMpm(v)).toBeNull();
  });
});

describe("buildCorrectionDiff", () => {
  it("ne liste que les champs proposés, avec la valeur actuelle", () => {
    const diff = buildCorrectionDiff({
      track,
      proposed: { ...noChange, bpm: 62, clashTimecodes: [30, 75, 120] },
      resultingBpm: 62,
    });
    expect(diff).toEqual([
      { field: "bpm", label: "MPM", current: "60", proposed: "62" },
      {
        field: "clash",
        label: "Clashs",
        current: "0:40, 1:20",
        proposed: "0:30, 1:15, 2:00",
      },
    ]);
  });

  it("couvre titre, artiste et danse (sans danse actuelle)", () => {
    const diff = buildCorrectionDiff({
      track: { ...track, style: null },
      proposed: { ...noChange, title: "A", artist: "B", style: "Rumba" },
      resultingBpm: 26,
    });
    expect(diff.map((l) => l.field)).toEqual([
      "title",
      "artist",
      "style",
      "resultingBpm",
    ]);
    expect(diff[3]).toMatchObject({
      label: "MPM recalculé",
      current: "60",
      proposed: "26",
    });
    expect(diff[2].current).toBe("—");
  });

  it("vide pour une proposition « commentaire seul »", () => {
    expect(
      buildCorrectionDiff({ track, proposed: noChange, resultingBpm: 60 }),
    ).toEqual([]);
  });
});

describe("libellés", () => {
  it("traduit les motifs", () => {
    expect(reasonLabel("PASO_CLASH")).toBe("Clashs paso doble");
  });

  it("formate une date, vide si invalide", () => {
    expect(formatCorrectionDate("2026-10-06T10:00:00Z")).toMatch(/2026/);
    expect(formatCorrectionDate("pas une date")).toBe("");
  });
});

describe("trackCorrectionTargetOf", () => {
  it("TRACK_CORRECTION → file admin centrée sur la proposition", () => {
    expect(
      trackCorrectionTargetOf({
        type: "TRACK_CORRECTION",
        correctionId: "c1",
        trackId: "t1",
      }),
    ).toEqual({
      screen: "TrackCorrectionsReview",
      params: { correctionId: "c1" },
    });
  });

  it("TRACK_CORRECTION sans identifiant → file admin non centrée", () => {
    expect(trackCorrectionTargetOf({ type: "TRACK_CORRECTION" })).toEqual({
      screen: "TrackCorrectionsReview",
      params: undefined,
    });
  });

  it("TRACK_CORRECTION_DECISION → Mes propositions", () => {
    expect(
      trackCorrectionTargetOf({
        type: "TRACK_CORRECTION_DECISION",
        correctionId: "c1",
        status: "APPROVED",
      }),
    ).toEqual({ screen: "MyTrackCorrections", params: undefined });
  });

  it.each([
    ["autre type", { type: "test" }],
    ["sans type", { competitionId: "x" }],
    ["null", null],
    ["tableau", ["TRACK_CORRECTION"]],
    ["scalaire", "TRACK_CORRECTION"],
    [
      "prototype pollué",
      JSON.parse('{"__proto__": {"type": "TRACK_CORRECTION"}}'),
    ],
  ])("ignore %s", (_label, data) => {
    expect(trackCorrectionTargetOf(data)).toBeNull();
  });
});
