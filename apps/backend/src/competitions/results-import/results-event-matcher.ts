import { disciplineLabel } from "../../common/competition-level/competition-level.util";

/**
 * Event of the `epreuve` column of a results file (#690): either the event
 * id (as listed by `GET /competitions/:id/program`) or its name, i.e. the
 * discipline, the age group and, for a classifying event, the level —
 * « Latines Adultes Avancé », « Latin Adultes Avancé » or « latines - adultes
 * - avance » all name the same event. Pure module, no I/O.
 */

/** What forms an event's name. */
export interface ResultImportEventRef {
  id: string;
  category: string | null;
  ageGroup: string | null;
  level: string | null;
}

export type EventNameMatch =
  | { kind: "match"; eventId: string }
  | { kind: "unknown" }
  | { kind: "ambiguous"; count: number };

/** Accents, case and punctuation dropped, spaces collapsed. */
export function normalizeEventName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesOf(event: ResultImportEventRef): {
  full: Set<string>;
  short: Set<string>;
} {
  const disciplines = [
    ...new Set([disciplineLabel(event.category), event.category ?? ""]),
  ].filter((d) => d.trim() !== "");
  const full = new Set<string>();
  const short = new Set<string>();
  for (const discipline of disciplines) {
    const base = `${discipline} ${event.ageGroup ?? ""}`;
    short.add(normalizeEventName(base));
    full.add(normalizeEventName(`${base} ${event.level ?? ""}`));
  }
  return { full, short };
}

/**
 * Resolves an event name against the competition's events. The full name
 * (with the level) wins; the name without level is accepted only when it
 * designates one event. Several matches are never guessed: the line is
 * refused and the id must be used.
 */
export function buildEventNameMatcher(
  events: readonly ResultImportEventRef[],
): (name: string) => EventNameMatch {
  const named = events.map((event) => ({ id: event.id, ...namesOf(event) }));
  return (name) => {
    const wanted = normalizeEventName(name);
    if (!wanted) return { kind: "unknown" };
    for (const level of ["full", "short"] as const) {
      const ids = named.filter((e) => e[level].has(wanted)).map((e) => e.id);
      if (ids.length === 1) return { kind: "match", eventId: ids[0] };
      if (ids.length > 1) return { kind: "ambiguous", count: ids.length };
    }
    return { kind: "unknown" };
  };
}
