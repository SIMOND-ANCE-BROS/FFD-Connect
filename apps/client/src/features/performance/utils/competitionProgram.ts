/**
 * Pure logic of the competition mode ("Programme de tours"): dance matching,
 * playlist generation (rounds of Standard / Latin groups), validation and the French MC
 * announcements. No React, no audio — fully unit-testable.
 */
import type { TrackData } from "../../player/context/PlayerContext";
import {
  createRound,
  DANCES,
  MAX_ROUND_GROUPS,
  MIN_ROUND_GROUPS,
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

/** Keeps dances in the canonical order of their category. */
export const sortDances = (category: Category, dances: string[]): string[] =>
  DANCES[category].filter((d) => dances.includes(d));

/** Categories danced in the round, in order of first appearance. */
export const roundCategories = (round: Pick<RoundConfig, "groups">) =>
  round.groups.filter((c, i) => round.groups.indexOf(c) === i);

/** Enforces the round invariants (group count bounds, canonical dances). */
export const normalizeRound = (round: RoundConfig): RoundConfig => ({
  ...round,
  groups:
    round.groups.length >= MIN_ROUND_GROUPS
      ? round.groups.slice(0, MAX_ROUND_GROUPS)
      : ["Latin"],
  dances: {
    Standard: sortDances("Standard", round.dances.Standard),
    Latin: sortDances("Latin", round.dances.Latin),
  },
});

// --- Programme edition (pure updaters for setConfig) ------------------------

type RoundPatch = (round: RoundConfig) => RoundConfig;

const patchRound =
  (id: string, patch: RoundPatch) =>
  (cfg: PerformanceConfig): PerformanceConfig => ({
    ...cfg,
    rounds: cfg.rounds.map((r) => (r.id === id ? normalizeRound(patch(r)) : r)),
  });

/** New round = same groups and dances as the previous one, as a Passage. */
export const addRound = (cfg: PerformanceConfig): PerformanceConfig => {
  const last = cfg.rounds[cfg.rounds.length - 1] as RoundConfig | undefined;
  const round = createRound("Latin", "Round");
  return {
    ...cfg,
    rounds: [
      ...cfg.rounds,
      last
        ? {
            ...round,
            groups: [...last.groups],
            dances: {
              Standard: [...last.dances.Standard],
              Latin: [...last.dances.Latin],
            },
          }
        : round,
    ],
  };
};

/** Removes a round — the programme always keeps at least one. */
export const removeRound =
  (id: string) =>
  (cfg: PerformanceConfig): PerformanceConfig =>
    cfg.rounds.length <= 1
      ? cfg
      : { ...cfg, rounds: cfg.rounds.filter((r) => r.id !== id) };

export const setRoundType = (id: string, type: RoundConfig["type"]) =>
  patchRound(id, (r) => ({ ...r, type }));

/** Adds a group at the end, of the same category as the last one. */
export const addGroup = (id: string) =>
  patchRound(id, (r) =>
    r.groups.length >= MAX_ROUND_GROUPS
      ? r
      : { ...r, groups: [...r.groups, r.groups[r.groups.length - 1]] },
  );

/** Removes a group — a round always keeps at least one. */
export const removeGroup = (id: string, index: number) =>
  patchRound(id, (r) =>
    r.groups.length <= MIN_ROUND_GROUPS
      ? r
      : { ...r, groups: r.groups.filter((_, i) => i !== index) },
  );

export const setGroupCategory = (
  id: string,
  index: number,
  category: Category,
) =>
  patchRound(id, (r) => ({
    ...r,
    groups: r.groups.map((c, i) => (i === index ? category : c)),
  }));

export const toggleRoundDance = (
  id: string,
  category: Category,
  dance: string,
) =>
  patchRound(id, (r) => {
    const list = r.dances[category];
    return {
      ...r,
      dances: {
        ...r.dances,
        [category]: list.includes(dance)
          ? list.filter((d) => d !== dance)
          : [...list, dance],
      },
    };
  });

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

export interface RoundCategoryProblem {
  roundIndex: number;
  category: Category;
}

export interface MissingDances extends RoundCategoryProblem {
  dances: string[];
}

export interface ProgramValidation {
  /** Rounds (1-based) with a group whose category has no dance selected. */
  emptyRounds: RoundCategoryProblem[];
  /** Dances for which the library has no track, grouped by round. */
  missing: MissingDances[];
}

export const validateProgram = (
  cfg: PerformanceConfig,
  tracks: TrackData[],
): ProgramValidation => {
  const emptyRounds: RoundCategoryProblem[] = [];
  const missing: MissingDances[] = [];
  cfg.rounds.forEach((raw, i) => {
    const round = normalizeRound(raw);
    for (const category of roundCategories(round)) {
      const dances = round.dances[category];
      if (dances.length === 0) {
        emptyRounds.push({ roundIndex: i + 1, category });
        continue;
      }
      const absent = dances.filter(
        (d) => !tracks.some((t) => trackMatchesDance(t.style, d)),
      );
      if (absent.length > 0) {
        missing.push({ roundIndex: i + 1, category, dances: absent });
      }
    }
  });
  return { emptyRounds, missing };
};

/** French, user-facing description of the validation problems (or null). */
export const describeValidation = (v: ProgramValidation): string | null => {
  if (v.emptyRounds.length > 0) {
    const list = v.emptyRounds
      .map((e) => `tour ${e.roundIndex} (${CATEGORY_LABELS[e.category]})`)
      .join(", ");
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

export interface RoundStep {
  dance: string;
  category: Category;
  /** 1-based group number. */
  groupIndex: number;
  /** 0-based position of the dance in its category. */
  danceIndex: number;
}

/**
 * Floor order of a round: for every dance position, the groups in order, each
 * dancing its category's dance (a category with fewer dances drops out).
 */
export const roundSequence = (raw: RoundConfig): RoundStep[] => {
  const round = normalizeRound(raw);
  const steps: RoundStep[] = [];
  const maxDances = Math.max(
    ...round.groups.map((c) => round.dances[c].length),
  );
  for (let d = 0; d < maxDances; d++) {
    round.groups.forEach((category, g) => {
      const dances = round.dances[category];
      if (d < dances.length) {
        steps.push({
          dance: dances[d],
          category,
          groupIndex: g + 1,
          danceIndex: d,
        });
      }
    });
  }
  return steps;
};

/**
 * Builds the competition playlist. In each round, for every dance position,
 * the groups take the floor in order, each dancing its category's dance:
 * groups Standard, Latines, Standard → Valse lente, Samba, Valse lente, then
 * Tango, Cha-cha-cha, Tango… A category with fewer dances simply drops out.
 * A track is picked per group, cycling through a shuffled pool so consecutive
 * groups of the same dance get different music whenever the library allows it.
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

  cfg.rounds.forEach((raw, r) => {
    const round = normalizeRound(raw);
    const mixed = roundCategories(round).length > 1;
    for (const step of roundSequence(round)) {
      const track = pick(step.dance);
      if (!track) continue;
      items.push({
        track,
        style: step.dance,
        duration: danceDuration(step.dance, cfg),
        isPaso: isPasoDoble(step.dance),
        groupIndex: step.groupIndex,
        totalGroups: round.groups.length,
        roundIndex: r + 1,
        totalRounds,
        roundType: round.type,
        category: step.category,
        mixed,
        danceIndex: step.danceIndex,
        dancesInRound: round.dances[step.category].length,
        opensCategory:
          mixed &&
          step.danceIndex === 0 &&
          round.groups.indexOf(step.category) === step.groupIndex - 1 &&
          step.groupIndex > 1,
      });
    }
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
  | "groupIndex"
  | "totalGroups"
  | "roundIndex"
  | "totalRounds"
  | "roundType"
  | "danceIndex"
  | "dancesInRound"
  | "category"
  | "mixed"
  | "opensCategory"
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

/** « Place aux latines » / « Place au standard ». */
const CATEGORY_TO: Record<Category, string> = {
  Standard: "au standard",
  Latin: "aux latines",
};
/** « Et maintenant les latines… » */
const CATEGORY_THE: Record<Category, string> = {
  Standard: "le standard",
  Latin: "les latines",
};

/**
 * Deterministic template choice: same item → same text (preload == playback).
 * `salt` lets two parts of one sentence vary independently.
 */
const choose = (
  item: AnnouncementItem,
  templates: string[],
  salt = "",
): string => {
  const key = `${item.roundIndex}|${item.style}|${item.groupIndex}|${item.danceIndex}${salt}`;
  const idx = parseInt(fnv1aHash(key), 16) % templates.length;
  return templates[idx];
};

/**
 * Closing call of an announcement, sending the couples to the floor:
 * « Deuxième groupe, en piste ! » — or, with a single group, the couples (the
 * finalists in a final) without naming any group.
 */
const floorCall = (item: AnnouncementItem): string => {
  if (item.totalGroups <= 1) {
    return choose(
      item,
      item.roundType === "Final"
        ? ["Les finalistes, en piste !", "Finalistes… à vous la piste !"]
        : [
            "Les couples, en piste !",
            "Tous les couples, en piste, s'il vous plaît !",
          ],
      "|call",
    );
  }
  const groupOrd = ordinal(item.groupIndex);
  return choose(
    item,
    [
      `${capitalize(groupOrd)} groupe, en piste !`,
      `${capitalize(groupOrd)} groupe, à vous la piste !`,
      `On attend le ${groupOrd} groupe sur la piste !`,
    ],
    "|call",
  );
};

/**
 * Natural French announcement, in the voice of a ballroom MC calling the
 * NEXT dance at the start of the preparation break (« préparez-vous… »), not
 * a "here it is" line. Punctuation and ellipses are deliberate: they give the
 * neural TTS voice its breathing and its rising intonation. The group is only
 * named when the round has several.
 */
export const getAnnouncementText = (item: AnnouncementItem): string => {
  const a = articles(item.style);
  const isFinal = item.roundType === "Final";
  const call = floorCall(item);
  const groupOrd = ordinal(item.groupIndex);
  const firstOfRound = item.danceIndex === 0 && item.groupIndex === 1;
  const lastDance =
    item.danceIndex === item.dancesInRound - 1 && item.dancesInRound > 1;

  if (firstOfRound) {
    if (isFinal) {
      return choose(item, [
        `Mesdames et messieurs… voici la finale ! Nous commençons avec ${a.the}. ${call}`,
        `Place à la grande finale ! Préparez-vous pour ${a.the}… ${call}`,
        `Et voici le moment tant attendu… la finale ! On ouvre avec ${a.the}. ${call}`,
      ]);
    }
    const roundOrd = ordinal(item.roundIndex);
    return choose(item, [
      `Mesdames et messieurs, bienvenue pour le ${roundOrd} tour ! Préparez-vous pour ${a.the}… ${call}`,
      `Le ${roundOrd} tour va commencer… et on ouvre avec ${a.the} ! ${call}`,
      `C'est parti pour le ${roundOrd} tour ! Première danse… ${a.the}. ${call}`,
    ]);
  }

  if (item.opensCategory) {
    // Mixed round: the first group of the other category takes the floor.
    return choose(item, [
      `Et maintenant, place ${CATEGORY_TO[item.category]}… on commence avec ${a.the} ! ${call}`,
      `On change d'ambiance… voici ${CATEGORY_THE[item.category]}, avec ${a.the} ! ${call}`,
    ]);
  }

  if (item.groupIndex > 1) {
    const lastGroup =
      item.groupIndex === item.totalGroups && item.totalGroups > 2;
    // In a mixed round the previous group danced another category: no
    // « toujours / encore » wording then.
    if (item.mixed) {
      return lastGroup
        ? choose(item, [
            `Et pour finir… ${a.the}, avec le ${groupOrd} et dernier groupe !`,
            `${capitalize(a.the)}… ${groupOrd} et dernier groupe, en piste !`,
          ])
        : choose(item, [
            `Au tour du ${groupOrd} groupe… avec ${a.the} !`,
            `${capitalize(a.the)}… ${groupOrd} groupe, en piste !`,
          ]);
    }
    if (lastGroup) {
      return choose(item, [
        `Toujours ${a.the}… ${groupOrd} et dernier groupe, en piste !`,
        `Et pour terminer ${a.the}… le dernier groupe, à vous !`,
      ]);
    }
    return choose(item, [
      `Toujours ${a.the}… ${groupOrd} groupe, préparez-vous !`,
      `On reste sur ${a.the}… au tour du ${groupOrd} groupe !`,
      `${capitalize(a.the)}, encore une fois… ${groupOrd} groupe, en piste !`,
    ]);
  }

  // First group of a dance that is not the first of the round.
  if (lastDance) {
    return choose(
      item,
      isFinal
        ? [
            `Et voici la dernière danse de cette finale… ${a.the} ! ${call}`,
            `Pour terminer en beauté… ${a.the} ! ${call}`,
          ]
        : [
            `Dernière danse de ce tour… préparez-vous pour ${a.the} ! ${call}`,
            `Et pour finir ce tour en beauté… ${a.the} ! ${call}`,
          ],
    );
  }
  return choose(item, [
    `On enchaîne avec ${a.the}… ${call}`,
    `Préparez-vous pour ${a.the} ! ${call}`,
    `Danse suivante… ${a.the} ! ${call}`,
    `Et maintenant, place ${a.to}… ${call}`,
  ]);
};

export const CLOSING_ANNOUNCEMENT =
  "Merci à tous, c'est terminé ! Bravo aux danseurs.";

/** Group label: « Groupe 2/3 », or « Groupe unique ». */
export const describeGroup = (
  item: Pick<PlaylistItem, "groupIndex" | "totalGroups">,
): string =>
  item.totalGroups <= 1
    ? "Groupe unique"
    : `Groupe ${item.groupIndex}/${item.totalGroups}`;

/** Short French context line for the player screen. */
export const describeItem = (item: PlaylistItem): string => {
  const parts = [
    `Tour ${item.roundIndex}`,
    CATEGORY_LABELS[item.category],
    danceLabel(item.style),
    ...(item.roundType === "Final" ? ["Finale"] : []),
    ...(item.roundType === "Final" && item.totalGroups <= 1
      ? []
      : [describeGroup(item)]),
  ];
  return parts.join(" · ");
};
