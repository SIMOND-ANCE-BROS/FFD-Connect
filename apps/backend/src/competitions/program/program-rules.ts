/**
 * Rules of the events (épreuves) a club enters in its competition editor
 * (#442). Pure functions — no Nest, no Prisma.
 *
 * The stored values are the canonical ones the eligibility rules read:
 * disciplines `Latin` / `Standard` / `Ten Dance`, couple classes of Article 5
 * plus `Espoir`, solo classes `Solo …`, levels of the Niveaux table.
 * Domain rules (confirmed 2026-10-09): the level belongs to a discipline,
 * « 10 danses » events are MAJEURE events without a level, « Espoir » is a
 * couple event (16–20 year-olds, checked at registration).
 */
import type { CompetitionType, EventKind, EventType } from "@prisma/client";
import {
  COMPETITION_LEVELS,
  COUPLE_AGE_GROUPS,
  ESPOIR_AGE_GROUP,
  SOLO_AGE_GROUPS,
  getAllowedLevelsForAgeGroup,
} from "../../common/age-group";
import {
  disciplineLabel,
  normalizeDiscipline,
} from "../../common/competition-level";
import {
  ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE,
  LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE,
} from "../../common/participation-rules";

/** Upper bound of a programme (same order as the deduced ones, #318). */
export const MAX_PROGRAM_EVENTS = 400;
export const MAX_SCHEDULE_ITEMS = 200;

/** Kinds of schedule slot offered by the editor. */
export const SCHEDULE_ITEM_TYPES = [
  "ROUND",
  "BREAK",
  "CEREMONY",
  "OTHER",
] as const;
export type ScheduleItemType = (typeof SCHEDULE_ITEM_TYPES)[number];

/** `HH:MM`, 24-hour clock. */
export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Category stored on Solo Danse Team events (no discipline). */
export const SOLO_TEAM_CATEGORY = "Solo Team";
/** Team classes (average age on 31 December). */
export const SOLO_TEAM_AGE_GROUPS = [
  "Juvénile",
  "Junior",
  "Adulte",
  "Senior",
] as const;
export const SOLO_TEAM_LEVELS = ["Débutant", "Intermédiaire"] as const;

const KIND_LABELS: Record<EventKind, string> = {
  CLASSIFICATRICE: "classificatrice",
  OPEN: "Open",
  MAJEURE: "majeure",
  SOLO_TEAM: "Solo Team",
  SHOW_DANSE: "Show danse",
};

const COMPETITION_TYPE_LABELS: Record<CompetitionType, string> = {
  PROXIMITE: "de proximité",
  NATIONALE: "nationale",
  MAJEURE: "majeure",
  INTERNATIONALE: "internationale",
};

/** An event as the club entered it. */
export interface ProgramEventInput {
  eventKind?: EventKind | null;
  eventType: EventType;
  category: string;
  ageGroup?: string;
  ageGroups?: string[];
  level?: string | null;
  openLevels?: string[];
}

type KindedEventInput = ProgramEventInput & { eventKind: EventKind };

/** The same event, validated, in its stored form. */
export interface NormalizedProgramEvent {
  eventKind: EventKind;
  eventType: EventType;
  category: string;
  ageGroup: string;
  ageGroups: string[];
  level: string | null;
  openLevels: string[];
}

/** A rule of the programme is broken; `message` is shown to the club. */
export class ProgramRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgramRuleError";
  }
}

/** Age classes an event of this type and discipline can be held for. */
export function ageGroupsForEvent(
  eventType: EventType,
  discipline: string,
): readonly string[] {
  if (eventType === "SOLO") return SOLO_AGE_GROUPS;
  // No « Senior V » class in Latin: those couples dance Senior IV.
  const couple = COUPLE_AGE_GROUPS.filter(
    (age) => !(discipline === "Latin" && age === "Senior V"),
  );
  return [...couple, ESPOIR_AGE_GROUP];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()))];
}

function requireAgeGroup(
  value: string | undefined,
  allowed: readonly string[],
): string {
  const ageGroup = value?.trim() ?? "";
  if (!ageGroup) throw new ProgramRuleError("la classe d'âge est requise.");
  if (!allowed.includes(ageGroup)) {
    throw new ProgramRuleError(
      `la classe d'âge « ${ageGroup} » n'existe pas pour cette épreuve.`,
    );
  }
  return ageGroup;
}

function assertNoOpenFields(input: ProgramEventInput): void {
  if (
    (input.ageGroups?.length ?? 0) > 0 ||
    (input.openLevels?.length ?? 0) > 0
  ) {
    throw new ProgramRuleError(
      "plusieurs classes d'âge ou une restriction par niveaux ne s'appliquent qu'aux épreuves Open.",
    );
  }
}

function assertNoLevel(input: KindedEventInput): void {
  if (input.level != null && input.level.trim() !== "") {
    throw new ProgramRuleError(
      `une épreuve ${KIND_LABELS[input.eventKind]} n'a pas de niveau.`,
    );
  }
}

function normalizeSoloTeam(input: ProgramEventInput): NormalizedProgramEvent {
  assertNoOpenFields(input);
  if (input.eventType !== "SOLO") {
    throw new ProgramRuleError("une épreuve Solo Team est une épreuve solo.");
  }
  const level = input.level?.trim() ?? "";
  if (!(SOLO_TEAM_LEVELS as readonly string[]).includes(level)) {
    throw new ProgramRuleError(
      "une épreuve Solo Team est de niveau Débutant ou Intermédiaire.",
    );
  }
  return {
    eventKind: "SOLO_TEAM",
    eventType: "SOLO",
    category: SOLO_TEAM_CATEGORY,
    ageGroup: requireAgeGroup(input.ageGroup, SOLO_TEAM_AGE_GROUPS),
    ageGroups: [],
    level,
    openLevels: [],
  };
}

/**
 * Validates an event entered by a club and returns its stored form.
 * @throws ProgramRuleError with a French message when a rule is broken.
 */
export function normalizeProgramEvent(
  rawInput: ProgramEventInput,
  competitionType: CompetitionType | null,
): NormalizedProgramEvent {
  const { eventKind } = rawInput;
  if (!eventKind) {
    throw new ProgramRuleError("la nature de l'épreuve est requise.");
  }
  const input: KindedEventInput = { ...rawInput, eventKind };
  if (
    competitionType &&
    !ALLOWED_EVENT_KINDS_BY_COMPETITION_TYPE[competitionType].includes(
      input.eventKind,
    )
  ) {
    throw new ProgramRuleError(
      `une épreuve ${KIND_LABELS[input.eventKind]} n'est pas possible dans une compétition ${COMPETITION_TYPE_LABELS[competitionType]}.`,
    );
  }
  if (input.eventKind === "SOLO_TEAM") return normalizeSoloTeam(input);

  const category = normalizeDiscipline(input.category);
  if (!category) {
    throw new ProgramRuleError(
      `spécialité inconnue « ${input.category.trim()} » (Latines, Standards ou 10 danses).`,
    );
  }
  if (category === "Ten Dance" && input.eventKind !== "MAJEURE") {
    throw new ProgramRuleError(
      "les 10 danses ne se dansent qu'en épreuve majeure.",
    );
  }
  if (input.eventKind === "SHOW_DANSE" && input.eventType !== "COUPLE") {
    throw new ProgramRuleError(
      "une épreuve Show danse est une épreuve couple.",
    );
  }
  const allowedAges = ageGroupsForEvent(input.eventType, category);

  if (input.eventKind === "OPEN") {
    assertNoLevel(input);
    const ageGroups = unique(input.ageGroups ?? []).filter(Boolean);
    if (ageGroups.length === 0) {
      throw new ProgramRuleError(
        "une épreuve Open réunit au moins une classe d'âge.",
      );
    }
    ageGroups.forEach((age) => requireAgeGroup(age, allowedAges));
    const openLevels = unique(input.openLevels ?? []).filter(Boolean);
    for (const level of openLevels) {
      if (!(COMPETITION_LEVELS as readonly string[]).includes(level)) {
        throw new ProgramRuleError(`niveau inconnu « ${level} ».`);
      }
    }
    return {
      eventKind: "OPEN",
      eventType: input.eventType,
      category,
      ageGroup: ageGroups[0],
      ageGroups,
      level: null,
      openLevels,
    };
  }

  assertNoOpenFields(input);
  const ageGroup = requireAgeGroup(input.ageGroup, allowedAges);
  if (input.eventKind !== "CLASSIFICATRICE") {
    assertNoLevel(input);
    return {
      eventKind: input.eventKind,
      eventType: input.eventType,
      category,
      ageGroup,
      ageGroups: [],
      level: null,
      openLevels: [],
    };
  }

  const level = input.level?.trim() ?? "";
  if (!level) {
    throw new ProgramRuleError("une épreuve classificatrice a un niveau.");
  }
  if (
    competitionType === "PROXIMITE" &&
    !(
      LEVELS_ALLOWED_FOR_PROXIMITE_CLASSIFICATRICE as readonly string[]
    ).includes(level)
  ) {
    throw new ProgramRuleError(
      "en compétition de proximité, une classificatrice est de niveau Débutant ou Intermédiaire.",
    );
  }
  const allowedLevels: readonly string[] = getAllowedLevelsForAgeGroup(
    input.eventType,
    ageGroup,
  );
  if (!allowedLevels.includes(level)) {
    throw new ProgramRuleError(
      `le niveau ${level} n'existe pas en ${ageGroup} (niveaux possibles : ${allowedLevels.join(", ") || "aucun"}).`,
    );
  }
  return {
    eventKind: "CLASSIFICATRICE",
    eventType: input.eventType,
    category,
    ageGroup,
    ageGroups: [],
    level,
    openLevels: [],
  };
}

/** Short French name of an event for messages: « Latines Adulte Avancé ». */
export function programEventLabel(event: {
  category: string;
  ageGroup: string;
  ageGroups?: readonly string[];
  level?: string | null;
}): string {
  const ages =
    event.ageGroups && event.ageGroups.length > 0
      ? event.ageGroups.join(", ")
      : event.ageGroup;
  return [disciplineLabel(event.category), ages, event.level ?? ""]
    .filter(Boolean)
    .join(" ");
}
