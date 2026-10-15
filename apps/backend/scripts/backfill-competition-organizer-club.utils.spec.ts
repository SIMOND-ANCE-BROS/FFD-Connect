import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { competitionOrganizerBackfillSelect } from "../src/utils/prisma-selects";
import { backfillCompetitionOrganizerClub } from "./backfill-competition-organizer-club.utils";

const comp = (id: string, organizer: string | null) => ({
  id,
  organizer,
  organizerClubId: null,
});

describe("backfillCompetitionOrganizerClub (#408)", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.competition.updateMany.mockResolvedValue({ count: 1 });
  });

  it("links unambiguous rows, lists unmatched and ambiguous ones, pages by id", async () => {
    prisma.competition.findMany
      .mockResolvedValueOnce([
        comp("k1", " Club A "),
        comp("k2", "Inconnu"),
      ] as never)
      .mockResolvedValueOnce([comp("k3", "Club X"), comp("k4", "  ")] as never)
      .mockResolvedValueOnce([]);
    prisma.club.findMany
      .mockResolvedValueOnce([{ id: "ca" }] as never) // Club A
      .mockResolvedValueOnce([]) // Inconnu
      .mockResolvedValueOnce([{ id: "x1" }, { id: "x2" }] as never); // Club X

    const report = await backfillCompetitionOrganizerClub(prisma, false, 2);

    expect(report).toEqual({
      scanned: 3,
      linked: 1,
      unmatched: [{ id: "k2", organizer: "Inconnu" }],
      ambiguous: [{ id: "k3", organizer: "Club X" }],
    });
    expect(prisma.competition.findMany).toHaveBeenNthCalledWith(1, {
      where: { organizerClubId: null, organizer: { not: null } },
      select: competitionOrganizerBackfillSelect,
      orderBy: { id: "asc" },
      take: 2,
    });
    expect(prisma.competition.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          organizerClubId: null,
          organizer: { not: null },
          id: { gt: "k2" },
        },
      }),
    );
    // The write re-checks the row is still unlinked (idempotent, race-safe).
    expect(prisma.competition.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.competition.updateMany).toHaveBeenCalledWith({
      where: { id: "k1", organizerClubId: null },
      data: { organizerClubId: "ca" },
    });
  });

  it("dry run reports without writing", async () => {
    prisma.competition.findMany
      .mockResolvedValueOnce([comp("k1", "Club A")] as never)
      .mockResolvedValueOnce([]);
    prisma.club.findMany.mockResolvedValueOnce([{ id: "ca" }] as never);

    const report = await backfillCompetitionOrganizerClub(prisma, true);

    expect(report.linked).toBe(1);
    expect(prisma.competition.updateMany).not.toHaveBeenCalled();
  });

  it("does not count a row linked concurrently", async () => {
    prisma.competition.findMany
      .mockResolvedValueOnce([comp("k1", "Club A")] as never)
      .mockResolvedValueOnce([]);
    prisma.club.findMany.mockResolvedValueOnce([{ id: "ca" }] as never);
    prisma.competition.updateMany.mockResolvedValue({ count: 0 });

    const report = await backfillCompetitionOrganizerClub(prisma, false);

    expect(report.linked).toBe(0);
  });
});
