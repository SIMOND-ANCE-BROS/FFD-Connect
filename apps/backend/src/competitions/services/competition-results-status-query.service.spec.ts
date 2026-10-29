import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import type { PrismaService } from "../../prisma/prisma.service";
import {
  CompetitionResultsStatusQueryService,
  resultsStatusOf,
} from "./competition-results-status-query.service";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

const row = (competitionId: string, count: number) => ({
  competitionId,
  _count: { _all: count },
});

describe("resultsStatusOf (#846)", () => {
  it.each([
    [0, 0, "NONE"],
    [3, 0, "NONE"],
    [3, 1, "PARTIAL"],
    [3, 2, "PARTIAL"],
    [3, 3, "COMPLETE"],
    [1, 1, "COMPLETE"],
  ] as const)(
    "%i events, %i with results → %s",
    (eventCount, withResults, expected) => {
      expect(resultsStatusOf(eventCount, withResults)).toBe(expected);
    },
  );
});

describe("CompetitionResultsStatusQueryService (#846)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: CompetitionResultsStatusQueryService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new CompetitionResultsStatusQueryService(
      prisma as unknown as PrismaService,
    );
  });

  it("asks nothing for an empty list", async () => {
    await expect(service.getStatuses([])).resolves.toEqual([]);
    expect(prisma.event.groupBy).not.toHaveBeenCalled();
  });

  it("aggregates in two bounded queries, whatever the number of competitions", async () => {
    prisma.event.groupBy
      .mockResolvedValueOnce([row(A, 3), row(B, 2), row(C, 4)] as never)
      .mockResolvedValueOnce([row(A, 3), row(B, 1)] as never);

    await expect(service.getStatuses([A, B, C, D, A])).resolves.toEqual([
      {
        competitionId: A,
        eventCount: 3,
        eventsWithResults: 3,
        resultsStatus: "COMPLETE",
      },
      {
        competitionId: B,
        eventCount: 2,
        eventsWithResults: 1,
        resultsStatus: "PARTIAL",
      },
      {
        competitionId: C,
        eventCount: 4,
        eventsWithResults: 0,
        resultsStatus: "NONE",
      },
      // Unknown, or no event at all.
      {
        competitionId: D,
        eventCount: 0,
        eventsWithResults: 0,
        resultsStatus: "NONE",
      },
    ]);

    expect(prisma.event.groupBy).toHaveBeenCalledTimes(2);
    const ids = [A, B, C, D];
    expect(prisma.event.groupBy).toHaveBeenNthCalledWith(1, {
      by: ["competitionId"],
      where: { competitionId: { in: ids } },
      _count: { _all: true },
      orderBy: { competitionId: "asc" },
      take: 4,
    });
    expect(prisma.event.groupBy).toHaveBeenNthCalledWith(2, {
      by: ["competitionId"],
      where: { competitionId: { in: ids }, results: { some: {} } },
      _count: { _all: true },
      orderBy: { competitionId: "asc" },
      take: 4,
    });
  });
});
