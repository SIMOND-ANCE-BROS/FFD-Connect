import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  CompetitionResultsStatus,
  CompetitionResultsStatusDto,
} from "../dto/competition-results-status.dto";

export function resultsStatusOf(
  eventCount: number,
  eventsWithResults: number,
): CompetitionResultsStatus {
  if (eventsWithResults === 0) return "NONE";
  return eventsWithResults >= eventCount ? "COMPLETE" : "PARTIAL";
}

/**
 * Whether the results of a page of competitions are already imported (#846),
 * for the back-office list. Two aggregate queries whatever the number of
 * competitions (no N+1), each bounded by the ids asked (at most one row per
 * competition). Never cached: the status changes with each import.
 */
@Injectable()
export class CompetitionResultsStatusQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatuses(ids: string[]): Promise<CompetitionResultsStatusDto[]> {
    const competitionIds = [...new Set(ids)];
    if (competitionIds.length === 0) return [];

    const [events, eventsWithResults] = await Promise.all([
      this.prisma.event.groupBy({
        by: ["competitionId"],
        where: { competitionId: { in: competitionIds } },
        _count: { _all: true },
        orderBy: { competitionId: "asc" },
        take: competitionIds.length,
      }),
      this.prisma.event.groupBy({
        by: ["competitionId"],
        where: {
          competitionId: { in: competitionIds },
          results: { some: {} },
        },
        _count: { _all: true },
        orderBy: { competitionId: "asc" },
        take: competitionIds.length,
      }),
    ]);

    const eventCounts = new Map(
      events.map((row) => [row.competitionId, row._count._all]),
    );
    const withResults = new Map(
      eventsWithResults.map((row) => [row.competitionId, row._count._all]),
    );

    return competitionIds.map((competitionId) => {
      const eventCount = eventCounts.get(competitionId) ?? 0;
      const withResultsCount = withResults.get(competitionId) ?? 0;
      return {
        competitionId,
        eventCount,
        eventsWithResults: withResultsCount,
        resultsStatus: resultsStatusOf(eventCount, withResultsCount),
      };
    });
  }
}
