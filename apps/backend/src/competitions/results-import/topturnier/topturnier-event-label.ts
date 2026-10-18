import { COUPLE_AGE_GROUPS, SOLO_AGE_GROUPS } from "../../../common/age-group";
import {
  normalizeDiscipline,
  toCompetitionLevel,
  type Discipline,
} from "../../../common/competition-level/competition-level.util";
import type { CompetitionLevel } from "../../../common/age-group";

/**
 * Event labels of a TopTurnier export (#786) and their mapping onto the
 * competition's events. Pure module, no I/O.
 *
 * A label reads `<type>, [Solos] <classes> [<level>] [-] <discipline>`:
 *   « Nat, Adults Avancé Latin »          classificatrice, Adulte, Avancé
 *   « Nat, Sen.II Intermédiaire Standard »
 *   « Nat, Youth/Adults Débutant Latin »  classes combined
 *   « OC, Juv.I/II/Jun.I/II Latin »       open, four classes
 *   « OC, Sen.III/IV Standard »
 *   « Nat, Solos Juv. Intermédiaire Latin »
 *   « OC, Solos Youth/Adults - Standard »
 * « Nat » = national classifying event, « OC » = open. A class without
 * number (« Sen. ») names all its numbered classes (« Senior I » to « V »).
 *
 * Nothing is guessed: a label with a word not understood is « unknown »; a
 * label that fits several events is « ambiguous ».
 */

export type TopTurnierEventKind = "CLASSIFICATRICE" | "OPEN";

export interface TopTurnierEventDescriptor {
  kind: TopTurnierEventKind | null;
  solo: boolean;
  /** Canonical age groups (src/common/age-group), sorted. */
  ageGroups: string[];
  level: CompetitionLevel | null;
  discipline: Discipline;
}

export type TopTurnierLabelParse =
  | { ok: true; descriptor: TopTurnierEventDescriptor }
  | { ok: false; reason: string };

/** What an event of the competition is matched on. */
export interface TopTurnierMatchableEvent {
  id: string;
  category: string | null;
  ageGroup: string | null;
  ageGroups: readonly string[];
  eventType: string;
  level: string | null;
  eventKind: string | null;
}

export type TopTurnierEventMatch =
  | { kind: "match"; eventId: string; exact: boolean }
  | { kind: "unknown"; reason: string }
  | { kind: "ambiguous"; count: number };

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const KIND_PREFIXES: Partial<Record<string, TopTurnierEventKind>> = {
  nat: "CLASSIFICATRICE",
  national: "CLASSIFICATRICE",
  oc: "OPEN",
  open: "OPEN",
};

const LEVELS: Partial<Record<string, CompetitionLevel>> = {
  debutant: "Débutant",
  debutants: "Débutant",
  intermediaire: "Intermédiaire",
  intermediaires: "Intermédiaire",
  avance: "Avancé",
  avances: "Avancé",
  international: "International",
};

type AgeClass = "juv" | "jun" | "youth" | "adult" | "sen";

const AGE_CLASSES: Partial<Record<string, AgeClass>> = {
  juv: "juv",
  juvenile: "juv",
  juveniles: "juv",
  jun: "jun",
  junior: "jun",
  juniors: "jun",
  youth: "youth",
  adult: "adult",
  adults: "adult",
  adulte: "adult",
  adultes: "adult",
  sen: "sen",
  senior: "sen",
  seniors: "sen",
};

const ROMAN: Partial<Record<string, number>> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
};
const ROMAN_LABEL = ["I", "II", "III", "IV", "V"];

function classNumber(token: string): number | null {
  if (/^[1-5]$/.test(token)) return Number(token);
  return ROMAN[token] ?? null;
}

/** Canonical age groups of one class (+ numbers), or null when impossible. */
function ageGroupsOf(
  ageClass: AgeClass,
  numbers: number[],
  solo: boolean,
): string[] | null {
  const max: Record<AgeClass, number> = {
    juv: 2,
    jun: 2,
    youth: 0,
    adult: 0,
    sen: 5,
  };
  if (numbers.some((n) => n > max[ageClass])) return null;
  if (solo) {
    // One solo class for juveniles and seniors: « Solos Juv.I/II » is it.
    switch (ageClass) {
      case "juv":
        return ["Solo Juvénile"];
      case "jun":
        return (numbers.length > 0 ? numbers : [1, 2]).map(
          (n) => `Solo Junior ${n}`,
        );
      case "youth":
        return ["Solo Youth"];
      case "adult":
        return ["Solo Adulte"];
      case "sen":
        return ["Solo Senior"];
    }
  }
  const all = (count: number) =>
    numbers.length > 0
      ? numbers
      : Array.from({ length: count }, (_, i) => i + 1);
  switch (ageClass) {
    case "juv":
      return all(2).map((n) => `Juvénile ${ROMAN_LABEL[n - 1]}`);
    case "jun":
      return all(2).map((n) => `Junior ${ROMAN_LABEL[n - 1]}`);
    case "youth":
      return ["Youth"];
    case "adult":
      return ["Adulte"];
    case "sen":
      return all(5).map((n) => `Senior ${ROMAN_LABEL[n - 1]}`);
  }
}

const AGE_ORDER: readonly string[] = [...COUPLE_AGE_GROUPS, ...SOLO_AGE_GROUPS];

function sortAgeGroups(groups: Iterable<string>): string[] {
  return [...new Set(groups)].sort(
    (a, b) => AGE_ORDER.indexOf(a) - AGE_ORDER.indexOf(b),
  );
}

/**
 * Age groups of the classes part (« Juv.I/II/Jun.I/II », « Youth/Adults »,
 * « Sen. »), or null when a piece is not understood.
 */
function parseClasses(text: string, solo: boolean): string[] | null {
  const groups: string[] = [];
  let current: { ageClass: AgeClass; numbers: number[] } | null = null;
  const flush = (): boolean => {
    if (!current) return true;
    const found = ageGroupsOf(current.ageClass, current.numbers, solo);
    if (!found) return false;
    groups.push(...found);
    current = null;
    return true;
  };
  for (const raw of text.split("/")) {
    const piece = raw.trim();
    const named = /^([a-z]+)\.?\s*([ivx]+|[1-5])?\.?$/.exec(piece);
    const ageClass = named ? AGE_CLASSES[named[1]] : undefined;
    if (named && ageClass) {
      if (!flush()) return null;
      current = { ageClass, numbers: [] };
      if (named[2]) {
        const n = classNumber(named[2]);
        if (n === null) return null;
        current.numbers.push(n);
      }
      continue;
    }
    // « II » after « Juv.I »: one more number of the same class.
    const n = classNumber(piece.replace(/\.$/, ""));
    if (n === null || !current) return null;
    current.numbers.push(n);
  }
  if (!flush()) return null;
  return groups.length > 0 ? sortAgeGroups(groups) : null;
}

/** Reads a TopTurnier event label. */
export function parseTopTurnierLabel(label: string): TopTurnierLabelParse {
  const text = fold(label).replace(/\s+/g, " ").trim();
  let rest = text;
  let kind: TopTurnierEventKind | null = null;
  const comma = rest.indexOf(",");
  if (comma >= 0) {
    const prefix = rest.slice(0, comma).trim();
    const known = KIND_PREFIXES[prefix];
    if (!known) {
      return { ok: false, reason: `type d'épreuve « ${prefix} » non reconnu` };
    }
    kind = known;
    rest = rest.slice(comma + 1).trim();
  }

  const words = rest.split(" ").filter((w) => w !== "" && w !== "-");
  let solo = false;
  if (words[0] === "solo" || words[0] === "solos") {
    solo = true;
    words.shift();
  }

  // Discipline: the last word(s).
  let discipline: Discipline | null = null;
  const lastTwo = words.slice(-2).join(" ");
  if (words.length >= 2 && normalizeDiscipline(lastTwo)) {
    discipline = normalizeDiscipline(lastTwo);
    words.splice(-2, 2);
  } else {
    const last = words.at(-1) ?? "";
    const alias: Partial<Record<string, string>> = {
      lat: "latin",
      std: "standard",
      "10dances": "ten dance",
    };
    discipline = normalizeDiscipline(alias[last] ?? last);
    if (discipline) words.pop();
  }
  if (!discipline) return { ok: false, reason: "spécialité non reconnue" };

  // Level: optional, just before the discipline.
  let level: CompetitionLevel | null = null;
  const levelWord = LEVELS[words.at(-1) ?? ""];
  if (levelWord) {
    level = levelWord;
    words.pop();
  }

  if (words.length === 0) return { ok: false, reason: "classe d'âge absente" };
  const ageGroups = parseClasses(words.join(" "), solo);
  if (!ageGroups) return { ok: false, reason: "classe d'âge non reconnue" };
  return {
    ok: true,
    descriptor: { kind, solo, ageGroups, level, discipline },
  };
}

function eventAgeGroups(event: TopTurnierMatchableEvent): string[] {
  const groups =
    event.ageGroups.length > 0
      ? event.ageGroups
      : event.ageGroup
        ? [event.ageGroup]
        : [];
  return sortAgeGroups(groups.map((g) => g.trim()));
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Event of the competition a TopTurnier event designates. Candidates share
 * the discipline, the solo/couple type, the level (none for an open) and,
 * when the event says it, the kind (classificatrice / open). Among them:
 *   - the one with exactly the same age groups (`exact`);
 *   - otherwise the ONE whose age groups all belong to the label — a combined
 *     TopTurnier event (« Youth/Adults ») entered as one class in the app
 *     (`exact: false`, shown as such in the preview).
 * Several candidates at either step: ambiguous, never picked.
 */
export function matchTopTurnierEvent(
  descriptor: TopTurnierEventDescriptor,
  events: readonly TopTurnierMatchableEvent[],
): TopTurnierEventMatch {
  const candidates = events.filter((event) => {
    if (normalizeDiscipline(event.category) !== descriptor.discipline) {
      return false;
    }
    if ((event.eventType === "SOLO") !== descriptor.solo) return false;
    const level = toCompetitionLevel(event.level);
    if (level !== descriptor.level) return false;
    if (descriptor.kind && event.eventKind) {
      const open = event.eventKind === "OPEN";
      if (open !== (descriptor.kind === "OPEN")) return false;
    }
    return true;
  });
  const exact = candidates.filter((e) =>
    sameSet(eventAgeGroups(e), descriptor.ageGroups),
  );
  if (exact.length === 1) {
    return { kind: "match", eventId: exact[0].id, exact: true };
  }
  if (exact.length > 1) return { kind: "ambiguous", count: exact.length };

  const wanted = new Set(descriptor.ageGroups);
  const within = candidates.filter((e) => {
    const groups = eventAgeGroups(e);
    return groups.length > 0 && groups.every((g) => wanted.has(g));
  });
  if (within.length === 1) {
    return { kind: "match", eventId: within[0].id, exact: false };
  }
  if (within.length > 1) return { kind: "ambiguous", count: within.length };
  return {
    kind: "unknown",
    reason: "aucune épreuve correspondante dans le programme",
  };
}
