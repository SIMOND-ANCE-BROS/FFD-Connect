import type { Event } from "../../../stores/competition.store";

/**
 * Events of one discipline, age class and couple/solo type (#beta: a
 * circular lists one event per level, which looked like duplicates).
 */
export interface EventGroup {
  key: string;
  category: string;
  ageGroup: string;
  eventType: "COUPLE" | "SOLO";
  dance?: string;
  /** Classificatrices by ascending level, then Open, Majeure… */
  events: Event[];
}

const LEVEL_ORDER = ["Débutant", "Intermédiaire", "Avancé", "International"];
const KIND_ORDER = [
  "CLASSIFICATRICE",
  "OPEN",
  "MAJEURE",
  "SOLO_TEAM",
  "SHOW_DANSE",
];

const rank = (event: Event): number => {
  const kind = event.eventKind ? KIND_ORDER.indexOf(event.eventKind) : -1;
  const level = event.level ? LEVEL_ORDER.indexOf(event.level) : -1;
  // Kind first (unknown/none last), then the level (unknown last).
  return (
    (kind === -1 ? KIND_ORDER.length : kind) * 100 +
    (level === -1 ? LEVEL_ORDER.length : level)
  );
};

/** Groups events by discipline, age class, type and dance, first-seen order. */
export function groupEvents(events: Event[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const event of events) {
    const eventType = event.eventType === "SOLO" ? "SOLO" : "COUPLE";
    const key = [
      event.category,
      event.ageGroup,
      eventType,
      event.dance ?? "",
    ].join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        category: event.category,
        ageGroup: event.ageGroup,
        eventType,
        dance: event.dance,
        events: [],
      };
      groups.set(key, group);
    }
    group.events.push(event);
  }
  for (const group of groups.values()) {
    // Stable: equal ranks keep their original order.
    group.events = group.events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => rank(a.event) - rank(b.event) || a.index - b.index)
      .map(({ event }) => event);
  }
  return [...groups.values()];
}

/**
 * What tells the events of a group apart: the level of a classificatrice,
 * otherwise the kind of event. `null` when there is nothing to show.
 */
export function eventVariantLabel(event: Event): string | null {
  switch (event.eventKind) {
    case "CLASSIFICATRICE":
      return event.level ?? "Classificatrice";
    case "OPEN":
      return "Open";
    case "MAJEURE":
      return "Majeure";
    case "SOLO_TEAM":
      return "Solo Team";
    case "SHOW_DANSE":
      return "Show danse";
    default:
      return event.level ?? null;
  }
}
