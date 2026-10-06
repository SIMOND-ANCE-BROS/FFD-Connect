import type { TrackCorrectionAdminDto } from "../../../../services/api/track-correction-api";
import { trackCorrectionTargetOf } from "../notificationTarget";
import {
  buildCorrectionDiff,
  formatClashList,
  formatClashTime,
  formatCorrectionDate,
  parseClashList,
  parseMpm,
  reasonLabel,
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

  it("refuse l'illisible, le hors-bornes et plus de 10 appels", () => {
    expect(parseClashList("abc")).toBeNull();
    expect(parseClashList("1:75")).toBeNull();
    expect(parseClashList("3601")).toBeNull();
    expect(parseClashList("1,2,3,4,5,6,7,8,9,10,11")).toBeNull();
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
    });
    expect(diff.map((l) => l.field)).toEqual(["title", "artist", "style"]);
    expect(diff[2].current).toBe("—");
  });

  it("vide pour une proposition « commentaire seul »", () => {
    expect(buildCorrectionDiff({ track, proposed: noChange })).toEqual([]);
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
