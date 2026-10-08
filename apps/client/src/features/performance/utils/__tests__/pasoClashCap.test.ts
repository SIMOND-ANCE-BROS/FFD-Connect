import type { TrackData } from "../../../player/context/PlayerContext";
import type { PlaylistItem } from "../../../../stores/performance.store";
import {
  capPasoClashes,
  effectivePasoClashes,
  selectPasoPool,
} from "../pasoClashCap";

const track = (clashTimecodes?: number[], id = "t1"): TrackData => ({
  id,
  title: "España Cañí",
  artist: "Orchestre",
  url: "file:///t1.mp3",
  baseBpm: 60,
  style: "Paso Doble",
  clashTimecodes,
});

const item = (overrides: Partial<PlaylistItem> = {}): PlaylistItem => ({
  track: track(),
  style: "Paso Doble",
  duration: 120,
  isPaso: true,
  groupIndex: 1,
  totalGroups: 1,
  roundIndex: 1,
  totalRounds: 1,
  roundType: "Final",
  category: "Latin",
  mixed: false,
  opensCategory: false,
  danceIndex: 3,
  dancesInRound: 5,
  announcementText: "Place au paso doble",
  ...overrides,
});

describe("effectivePasoClashes", () => {
  it("réglage 3 sur une piste à 2 clashs → 2", () => {
    expect(effectivePasoClashes(3, [40, 80])).toBe(2);
  });

  it("réglage 3 sur une piste à 3 clashs → 3", () => {
    expect(effectivePasoClashes(3, [40, 80, 120])).toBe(3);
  });

  it("réglage 2 sur une piste à 3 clashs → 2", () => {
    expect(effectivePasoClashes(2, [40, 80, 120])).toBe(2);
  });

  it("piste sans clash saisi → le réglage", () => {
    expect(effectivePasoClashes(3, undefined)).toBe(3);
    expect(effectivePasoClashes(3, [])).toBe(3);
    expect(effectivePasoClashes(2, undefined)).toBe(2);
  });

  it("piste à 1 seul clash → 1", () => {
    expect(effectivePasoClashes(3, [40])).toBe(1);
  });
});

describe("capPasoClashes", () => {
  const cfg3 = { duration: 90, pasoClashes: 3 as const };

  it("réglage « 3 clashs » sur un paso à 2 clashs : joué 80 s", () => {
    const [capped] = capPasoClashes([item({ track: track([40, 80]) })], cfg3);
    expect(capped.duration).toBe(80);
  });

  it("réglage « 3 clashs » sur un paso à 3 clashs : 120 s (même objet)", () => {
    const original = item({ track: track([40, 80, 120]) });
    const [same] = capPasoClashes([original], cfg3);
    expect(same).toBe(original);
    expect(same.duration).toBe(120);
  });

  it("réglage « 3 clashs » sur un paso sans clash saisi : 120 s", () => {
    const original = item();
    const [same] = capPasoClashes([original], cfg3);
    expect(same.duration).toBe(120);
  });

  it("réglage « 2 clashs » : rien ne change", () => {
    const original = item({ duration: 80, track: track([40, 80, 120]) });
    const [same] = capPasoClashes([original], {
      duration: 90,
      pasoClashes: 2,
    });
    expect(same).toBe(original);
  });

  it("ne touche pas aux autres danses", () => {
    const samba = item({
      style: "Samba",
      isPaso: false,
      duration: 90,
      track: { ...track([40]), style: "Samba" },
    });
    const [same] = capPasoClashes([samba], cfg3);
    expect(same).toBe(samba);
  });

  it("piste à 1 clash : garde la durée « 2 clashs » (liste probablement incomplète)", () => {
    const [capped] = capPasoClashes([item({ track: track([40]) })], cfg3);
    expect(capped.duration).toBe(80);
  });
});

describe("selectPasoPool", () => {
  const two = track([40, 80], "p2");
  const three = track([40, 80, 120], "p3");
  const estimated = track(undefined, "p0");
  const samba: TrackData = { ...track(undefined, "s1"), style: "Samba" };
  const ids = (list: TrackData[]) => list.map((t) => t.id);

  it("« 3 clashs » : écarte les pasos à 2 clashs (et les estimés), garde les autres danses", () => {
    expect(ids(selectPasoPool([two, three, estimated, samba], 3))).toEqual([
      "p3",
      "s1",
    ]);
  });

  it("« 3 clashs » sans piste à 3 clashs : repli sur les pasos estimés", () => {
    expect(ids(selectPasoPool([two, estimated, samba], 3))).toEqual([
      "p0",
      "s1",
    ]);
  });

  it("« 3 clashs » : jamais une piste à 2 clashs, même seule", () => {
    expect(ids(selectPasoPool([two, samba], 3))).toEqual(["s1"]);
  });

  it("« 2 clashs » : tous les pasos sont éligibles", () => {
    const all = [two, three, estimated, samba];
    expect(selectPasoPool(all, 2)).toBe(all);
  });

  it("« 2 clashs » : une piste à 3 clashs est coupée au 2e (80 s)", () => {
    const [capped] = capPasoClashes([item({ track: three, duration: 80 })], {
      duration: 90,
      pasoClashes: 2,
    });
    expect(capped.duration).toBe(80);
  });
});
