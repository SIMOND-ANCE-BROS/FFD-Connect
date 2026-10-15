import type {
  CompetitionProgramDto,
  ReplaceCompetitionProgramDto,
} from "../../../api/generated/types.gen";
import type {
  EventItem,
  ScheduleItem,
} from "./useClubCompetitionEditorLogic.types";

/**
 * Programme (« Épreuves » + « Planning » tabs) of the club competition editor
 * ↔ GET / PUT /competitions/:id/program (#442).
 *
 * A stored event is sent back with its `id` and its stored values untouched
 * (the server keeps it without re-validating it, e.g. events imported from
 * the FFD); an event added in the editor has no `id` yet.
 */

const SCHEDULE_TYPES: readonly ScheduleItem["type"][] = [
  "ROUND",
  "BREAK",
  "CEREMONY",
  "OTHER",
];

function toScheduleType(value: string): ScheduleItem["type"] {
  return (SCHEDULE_TYPES as readonly string[]).includes(value)
    ? (value as ScheduleItem["type"])
    : "OTHER";
}

export function eventsFromProgram(program: CompetitionProgramDto): EventItem[] {
  return program.events.map((event) => ({
    id: event.id,
    type: event.eventType === "SOLO" ? "Solo" : "Couple",
    category: event.category,
    ageGroup: event.ageGroup,
    ...(event.ageGroups.length > 0 ? { ageGroups: event.ageGroups } : {}),
    ...(event.openLevels.length > 0 ? { openLevels: event.openLevels } : {}),
    ...(event.eventKind ? { kind: event.eventKind } : {}),
    ...(event.level !== null ? { level: event.level } : {}),
    persisted: true,
    locked: event.locked,
  }));
}

export function scheduleFromProgram(
  program: CompetitionProgramDto,
): ScheduleItem[] {
  return program.schedule.map((item) => ({
    id: item.id,
    startTime: item.startTime,
    type: toScheduleType(item.type),
    title: item.title,
    duration: item.durationMinutes ?? 0,
    persisted: true,
  }));
}

export function buildProgramPayload(
  events: readonly EventItem[],
  schedule: readonly ScheduleItem[],
): ReplaceCompetitionProgramDto {
  return {
    events: events.map((event) => ({
      ...(event.persisted ? { id: event.id } : {}),
      eventKind: event.kind ?? null,
      eventType: event.type === "Solo" ? "SOLO" : "COUPLE",
      category: event.category,
      ageGroup: event.ageGroup,
      ageGroups: event.ageGroups ?? [],
      level: event.level ?? null,
      openLevels: event.openLevels ?? [],
    })),
    schedule: schedule.map((item) => ({
      ...(item.persisted ? { id: item.id } : {}),
      startTime: item.startTime,
      durationMinutes: Math.max(0, Math.round(item.duration)),
      type: item.type,
      title: item.title,
    })),
  };
}
