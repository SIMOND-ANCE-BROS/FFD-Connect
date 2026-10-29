import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  competitionProgramEventSelect,
  competitionProgramHeaderSelect,
  competitionProgramScheduleSelect,
} from "../../utils/prisma-selects";
import type {
  CompetitionProgramDto,
  ProgramEventDto,
  ProgramScheduleItemDto,
} from "../dto/competition-program.dto";
import { parisClock } from "../program/schedule-time";

type ProgramEventRow = Prisma.EventGetPayload<{
  select: typeof competitionProgramEventSelect;
}>;
type ProgramScheduleRow = Prisma.ScheduleItemGetPayload<{
  select: typeof competitionProgramScheduleSelect;
}>;

/**
 * Bound of the reads. Above the write caps: a competition synced from the
 * FFD may hold more events than a club can send back (it then gets a 400
 * when saving, never a silently truncated programme).
 */
const READ_LIMIT = 1000;

export function toProgramEventDto(row: ProgramEventRow): ProgramEventDto {
  return {
    id: row.id,
    eventKind: row.eventKind,
    eventType: row.eventType,
    category: row.category,
    ageGroup: row.ageGroup,
    ageGroups: row.ageGroups,
    level: row.level,
    openLevels: row.openLevels,
    locked: row._count.registrations > 0 || row._count.results > 0,
    resultCount: row._count.results,
  };
}

export function toProgramScheduleItemDto(
  row: ProgramScheduleRow,
): ProgramScheduleItemDto {
  return {
    id: row.id,
    startTime: row.startClock ?? parisClock(row.startTime),
    durationMinutes: row.durationMinutes,
    type: row.type,
    title: row.title,
    eventId: row.eventId,
  };
}

/**
 * Reads the programme (events + schedule) of a competition in the shape of
 * the club editor (#442), in the order the club entered it.
 */
@Injectable()
export class CompetitionProgramQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getProgram(competitionId: string): Promise<CompetitionProgramDto> {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionProgramHeaderSelect,
    });
    if (!competition) throw new NotFoundException("Compétition non trouvée");

    const [events, schedule] = await Promise.all([
      this.prisma.event.findMany({
        where: { competitionId },
        select: competitionProgramEventSelect,
        orderBy: [
          { position: { sort: "asc", nulls: "last" } },
          { category: "asc" },
          { ageGroup: "asc" },
          { id: "asc" },
        ],
        take: READ_LIMIT,
      }),
      this.prisma.scheduleItem.findMany({
        where: { competitionId },
        select: competitionProgramScheduleSelect,
        orderBy: [
          { position: { sort: "asc", nulls: "last" } },
          { startTime: "asc" },
          { id: "asc" },
        ],
        take: READ_LIMIT,
      }),
    ]);

    return {
      competitionId: competition.id,
      syncedFromFfd: competition.ffdId !== null,
      eventsSource: competition.eventsSource,
      programEditedAt: competition.programEditedAt,
      events: events.map(toProgramEventDto),
      schedule: schedule.map(toProgramScheduleItemDto),
    };
  }
}
