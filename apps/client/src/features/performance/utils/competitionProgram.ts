/**
 * Pure logic of the competition mode ("Programme de tours"): dance matching,
 * playlist generation for a mixed programme, validation and the French MC
 * announcements. No React, no audio — fully unit-testable.
 */
import type { TrackData } from "../../player/context/PlayerContext";
import {
  createRound,
  DANCES,
  MAX_ROUND_HEATS,
  MIN_ROUND_HEATS,
  type Category,
  type PerformanceConfig,
  type PlaylistItem,
  type RoundConfig,
} from "../../../stores/performance.store";
import { fnv1aHash } from "../../../utils/stableHash";

// --- Dances -----------------------------------------------------------------

interface DanceInfo {
  /** French display/spoken name. */
  label: string;
  /** Grammatical gender of the dance name in French ("la Samba", "le Tango"). */
  feminine: boolean;
  /** Matches a track `style` coming from the library. */
  pattern: RegExp;
}

const DANCE_INFO: Partial<Record<string, DanceInfo>> = {
  "Valse Lente": {
    label: "Valse lente",
    feminine: true,
    pattern: /valse\s*lente|valse\s*anglaise|slow\s*waltz|^waltz$|^valse$/,
  },
  Tango: { label: "Tango", feminine: false, pattern: /tango/ },
  "Valse Viennoise": {
    label: "Valse viennoise",
    feminine: true,
    pattern: /vienn|valse\s*rapide/,
  },
  "Slow Fox": {
    label: "Slow fox",
    feminine: false,
    pattern: /slow\s*-?\s*fox|foxtrot|^fox$/,
  },
  Quickstep: { label: "Quickstep", feminine: false, pattern: /quick\s*-?step/ },
  Samba: { label: "Samba", feminine: true, pattern: /samba/ },
  "Cha-Cha-Cha": {
    label: "Cha-cha-cha",
    feminine: false,
    pattern: /cha[\s-]*cha/,
  },
  Rumba: { label: "Rumba", feminine: true, pattern: /rumba/ },
  "Paso Doble": { label: "Paso doble", feminine: false, pattern: /paso/ },
  Jive: { label: "Jive", feminine: false, pattern: /jive/ },
};

export const CATEGORY_LABELS: Record<Category, string> = {
  Standard: "Standard",
  Latin: "Latines",
};

export const danceLabel = (dance: string): string =>
  DANCE_INFO[dance]?.label ?? dance;

export const isPasoDoble = (dance: string): boolean =>
  dance.toLowerCase().includes("paso");

/** True when a library track `style` corresponds to the canonical dance. */
export const trackMatchesDance = (
  style: string | undefined,
  dance: string,
): boolean => {
  if (!style) return false;
  const info = DANCE_INFO[dance];
  const s = style.toLowerCase().trim();
  // Regex per dance (mirrors features/player/utils/danceTempo normalizeDance):
  // the library stores "Valse Viennoise", "Cha-cha", "Slowfox"… so a plain
  // substring match on the UI label is not enough.
  if (info) return info.pattern.test(s);
  const clean = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");
  return clean(s) === clean(dance);
};

/** Legacy + current heuristics for "pause music" tracks. */
export const isAmbianceTrack = (t: TrackData): boolean =>
  t.style?.toLowerCase() === "ambiance" ||
  t.title.toLowerCase().includes("ambiance") ||
  t.artist.toLowerCase().includes("ambiance");

// --- Rounds -----------------------------------------------------------------

export const clampHeats = (round: Pick<RoundConfig, "type">, heats: number) =>
  round.type === "Final"
    ? 1
    : Math.min(
        MAX_ROUND_HEATS,
        Math.max(MIN_ROUND_HEATS, Math.round(heats) || MIN_ROUND_HEATS),
      );

/** Keeps dances in the canonical order of the round's category. */
export const sortDances = (category: Category, dances: string[]): string[] =>
  DANCES[category].filter((d) => dances.includes(d));

/** Enforces the round invariants (heats bounds, dances of its category). */
export const normalizeRound = (round: RoundConfig): RoundConfig => ({
  ...round,
  heats: clampHeats(round, round.heats),
  selectedDances: sortDances(round.category, round.selectedDances),
});

// --- Programme edition (pure updaters for setConfig) ------------------------

type RoundPatch = (round: RoundConfig) => RoundConfig;

const patchRound =
  (id: string, patch: RoundPatch) =>
  (cfg: PerformanceConfig): PerformanceConfig => ({
    ...cfg,
    rounds: cfg.rounds.map((r) => (r.id === id ? normalizeRound(patch(r)) : r)),
  });

/** New round = previous round's category, Passage, 2 heats, all dances. */
export const addRound = (cfg: PerformanceConfig): PerformanceConfig => {
  const last = cfg.rounds[cfg.rounds.length - 1] as RoundConfig | undefined;
  return {
    ...cfg,
    rounds: [...cfg.rounds, createRound(last?.category ?? "Latin", "Round")],
  };
};

/** Removes a round — the programme always keeps at least one. */
export const removeRound =
  (id: string) =>
  (cfg: PerformanceConfig): PerformanceConfig =>
    cfg.rounds.length <= 1
      ? cfg
      : { ...cfg, rounds: cfg.rounds.filter((r) => r.id !== id) };

/** Changing category resets the dances to the whole new category. */
export const setRoundCategory = (id: string, category: Category) =>
  patchRound(id, (r) =>
    r.category === category
      ? r
      : { ...r, category, selectedDances: [...DANCES[category]] },
  );

export const setRoundType = (id: string, type: RoundConfig["type"]) =>
  patchRound(id, (r) => ({
    ...r,
    type,
    heats: type === "Final" ? 1 : Math.max(MIN_ROUND_HEATS, r.heats),
  }));

export const stepRoundHeats = (id: string, delta: number) =>
  patchRound(id, (r) => ({ ...r, heats: r.heats + delta }));

export const toggleRoundDance = (id: string, dance: string) =>
  patchRound(id, (r) => ({
    ...r,
    selectedDances: r.selectedDances.includes(dance)
      ? r.selectedDances.filter((d) => d !== dance)
      : [...r.selectedDances, dance],
  }));

// --- Playlist ---------------------------------------------------------------

const ORDINALS = [
  "premier",
  "deuxième",
  "troisième",
  "quatrième",
  "cinquième",
  "sixième",
  "septième",
  "huitième",
  "neuvième",
  "dixième",
];

export const ordinal = (n: number): string => ORDINALS[n - 1] ?? `${n}e`;

/** Dance duration in seconds, Paso Doble driven by the clash count. */
export const danceDuration = (
  dance: string,
  cfg: Pick<PerformanceConfig, "duration" | "pasoClashes">,
): number => {
  if (isPasoDoble(dance)) return cfg.pasoClashes === 2 ? 80 : 120;
  return cfg.duration;
};

export interface MissingDances {
  roundIndex: number;
  category: Category;
  dances: string[];
}

export interface ProgramValidation {
  /** 1-based indexes of rounds with no dance selected. */
  emptyRounds: number[];
  /** Dances for which the library has no track, grouped by round. */
  missing: MissingDances[];
}

export const validateProgram = (
  cfg: PerformanceConfig,
  tracks: TrackData[],
): ProgramValidation => {
  const emptyRounds: number[] = [];
  const missing: MissingDances[] = [];
  cfg.rounds.forEach((round, i) => {
    const dances = sortDances(round.category, round.selectedDances);
    if (dances.length === 0) {
      emptyRounds.push(i + 1);
      return;
    }
    const absent = dances.filter(
      (d) => !tracks.some((t) => trackMatchesDance(t.style, d)),
    );
    if (absent.length > 0) {
      missing.push({
        roundIndex: i + 1,
        category: round.category,
        dances: absent,
      });
    }
  });
  return { emptyRounds, missing };
};

/** French, user-facing description of the validation problems (or null). */
export const describeValidation = (v: ProgramValidation): string | null => {
  if (v.emptyRounds.length > 0) {
    const list = v.emptyRounds.map((n) => `tour ${n}`).join(", ");
    return `Sélectionnez au moins une danse pour : ${list}.`;
  }
  if (v.missing.length > 0) {
    const lines = v.missing.map(
      (m) =>
        `• Tour ${m.roundIndex} (${CATEGORY_LABELS[m.category]}) : ${m.dances
          .map(danceLabel)
          .join(", ")}`,
    );
    return `Aucune musique disponible pour :\n${lines.join("\n")}`;
  }
  return null;
};

/**
 * Builds the competition playlist: for each round, for each dance (canonical
 * order), for each heat — dance-major, like a real competition. A track is
 * picked per heat, cycling through a shuffled pool so consecutive heats of the
 * same dance get different music whenever the library allows it.
 */
export const buildPlaylist = (
  cfg: PerformanceConfig,
  tracks: TrackData[],
  random: () => number = Math.random,
): PlaylistItem[] => {
  const items: Omit<PlaylistItem, "announcementText">[] = [];
  const totalRounds = cfg.rounds.length;
  // Shared per-dance pools so a dance repeated in several rounds keeps
  // rotating through the library instead of replaying the same track.
  const pools = new Map<string, { list: TrackData[]; next: number }>();

  const pick = (dance: string): TrackData | null => {
    let pool = pools.get(dance);
    if (!pool) {
      const candidates = tracks.filter((t) =>
        trackMatchesDance(t.style, dance),
      );
      if (candidates.length === 0) return null;
      const list = [...candidates];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      pool = { list, next: 0 };
      pools.set(dance, pool);
    }
    const track = pool.list[pool.next % pool.list.length];
    pool.next += 1;
    return track;
  };

  cfg.rounds.forEach((rawRound, r) => {
    const round = normalizeRound(rawRound);
    const dances = round.selectedDances;
    dances.forEach((dance, d) => {
      for (let h = 1; h <= round.heats; h++) {
        const track = pick(dance);
        if (!track) continue;
        items.push({
          track,
          style: dance,
          duration: danceDuration(dance, cfg),
          isPaso: isPasoDoble(dance),
          heatIndex: h,
          totalHeats: round.heats,
          roundIndex: r + 1,
          totalRounds,
          roundType: round.type,
          category: round.category,
          danceIndex: d,
          dancesInRound: dances.length,
        });
      }
    });
  });

  return items.map((item) => ({
    ...item,
    announcementText: getAnnouncementText(item),
  }));
};

// --- Announcements ----------------------------------------------------------

type AnnouncementItem = Pick<
  PlaylistItem,
  | "style"
  | "heatIndex"
  | "totalHeats"
  | "roundIndex"
  | "totalRounds"
  | "roundType"
  | "danceIndex"
  | "dancesInRound"
>;

interface Articles {
  /** "la Samba" / "le Tango" */
  the: string;
  /** "de la Samba" / "du Tango" */
  of: string;
  /** "à la Samba" / "au Tango" */
  to: string;
  /** Bare name: "Samba" */
  name: string;
}

const articles = (dance: string): Articles => {
  const name = danceLabel(dance);
  const feminine = DANCE_INFO[dance]?.feminine ?? false;
  return feminine
    ? { the: `la ${name}`, of: `de la ${name}`, to: `à la ${name}`, name }
    : { the: `le ${name}`, of: `du ${name}`, to: `au ${name}`, name };
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Deterministic template choice: same item → same text (preload == playback). */
const choose = (item: AnnouncementItem, templates: string[]): string => {
  const key = `${item.roundIndex}|${item.style}|${item.heatIndex}|${item.danceIndex}`;
  const idx = parseInt(fnv1aHash(key), 16) % templates.length;
  return templates[idx];
};

/**
 * Natural French announcement, in the voice of a ballroom MC. Punctuation and
 * ellipses are deliberate: they drive the prosody of the neural TTS voice.
 */
export const getAnnouncementText = (item: AnnouncementItem): string => {
  const a = articles(item.style);
  const isFinal = item.roundType === "Final" || item.totalHeats <= 1;
  const firstOfRound = item.danceIndex === 0 && item.heatIndex === 1;
  const lastDance =
    item.danceIndex === item.dancesInRound - 1 && item.dancesInRound > 1;
  const heatOrd = ordinal(item.heatIndex);

  if (firstOfRound) {
    if (isFinal) {
      return choose(item, [
        `Et voici la finale… on commence avec ${a.the} !`,
        `Mesdames et messieurs, place à la finale… ${a.name} !`,
        `C'est l'heure de la finale ! Première danse : ${a.the}.`,
      ]);
    }
    const roundOrd = ordinal(item.roundIndex);
    return choose(item, [
      `Mesdames et messieurs, place au ${roundOrd} tour… on commence avec ${a.the}, premier passage !`,
      `Bienvenue pour le ${roundOrd} tour ! On ouvre avec ${a.the}… premier passage !`,
      `Mesdames et messieurs, ${roundOrd} tour ! ${capitalize(a.name)}, premier passage, à vous !`,
    ]);
  }

  if (item.heatIndex > 1) {
    const lastHeat = item.heatIndex === item.totalHeats && item.totalHeats > 2;
    if (lastHeat) {
      return choose(item, [
        `${a.name}, ${heatOrd} et dernier passage !`,
        `Dernier passage ${a.of}… à vous !`,
      ]);
    }
    return choose(item, [
      `${a.name}, ${heatOrd} passage !`,
      `${capitalize(heatOrd)} passage ${a.of}, à vous !`,
      `Et voici le ${heatOrd} passage… ${a.name} !`,
    ]);
  }

  // First heat of a dance that is not the first of the round.
  if (isFinal) {
    if (lastDance) {
      return choose(item, [
        `Dernière danse : ${a.the} !`,
        `Et pour terminer… ${a.the} !`,
      ]);
    }
    return choose(item, [
      `On enchaîne avec ${a.the}.`,
      `Et maintenant… ${a.the} !`,
      `Place ${a.to} !`,
    ]);
  }
  if (lastDance) {
    return choose(item, [
      `Dernière danse du tour : ${a.the}… premier passage !`,
      `Et pour finir ce tour… ${a.the}, premier passage !`,
    ]);
  }
  return choose(item, [
    `On enchaîne avec ${a.the}… premier passage !`,
    `Place ${a.to}, premier passage !`,
    `Et maintenant, ${a.the} ! Premier passage, à vous !`,
  ]);
};

export const CLOSING_ANNOUNCEMENT =
  "Merci à tous, c'est terminé ! Bravo aux danseurs.";

/** Short French context line for the player screen. */
export const describeItem = (item: PlaylistItem): string => {
  const parts = [
    `Tour ${item.roundIndex}`,
    CATEGORY_LABELS[item.category],
    danceLabel(item.style),
    item.roundType === "Final"
      ? "Finale"
      : `Passage ${item.heatIndex}/${item.totalHeats}`,
  ];
  return parts.join(" · ");
};
