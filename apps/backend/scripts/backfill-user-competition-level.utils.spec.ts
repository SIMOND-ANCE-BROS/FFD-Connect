import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { userCompetitionLevelBackfillSelect } from "../src/utils/prisma-selects";
import {
  backfillUserCompetitionLevels,
  planCompetitionLevelBackfill,
} from "./backfill-user-competition-level.utils";

const user = (
  id: string,
  competitionLevel: string | null,
  category: string | null = null,
) => ({ id, competitionLevel, category });

describe("planCompetitionLevelBackfill (#239)", () => {
  it("copies to the declared discipline only", () => {
    expect(planCompetitionLevelBackfill(user("u", "Avancé", "Latin"))).toEqual({
      competitionLevelLatin: "Avancé",
    });
    expect(
      planCompetitionLevelBackfill(user("u", " Débutant ", "standards")),
    ).toEqual({ competitionLevelStandard: "Débutant" });
  });

  it("copies to both disciplines for Ten Dance or an unknown discipline", () => {
    const both = {
      competitionLevelLatin: "International",
      competitionLevelStandard: "International",
    };
    expect(
      planCompetitionLevelBackfill(user("u", "International", "Ten Dance")),
    ).toEqual(both);
    expect(planCompetitionLevelBackfill(user("u", "International"))).toEqual(
      both,
    );
    expect(
      planCompetitionLevelBackfill(user("u", "International", "Loisir")),
    ).toEqual(both);
  });

  it("is null for a value that is not one of the 4 levels", () => {
    expect(planCompetitionLevelBackfill(user("u", "Expert"))).toBeNull();
    expect(planCompetitionLevelBackfill(user("u", "  "))).toBeNull();
    expect(planCompetitionLevelBackfill(user("u", null))).toBeNull();
  });
});

describe("backfillUserCompetitionLevels (#239)", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it("writes the planned levels with a compare-and-set, pages by id, counts", async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([
        user("a", "Avancé", "Latin"),
        user("b", "Expert"),
      ] as never)
      .mockResolvedValueOnce([user("c", "Débutant", "Standard")] as never)
      .mockResolvedValueOnce([user("d", "Intermédiaire")] as never)
      .mockResolvedValueOnce([]);

    const report = await backfillUserCompetitionLevels(prisma, false, 2);

    expect(report).toEqual({
      scanned: 4,
      updated: 3,
      latinOnly: 1,
      standardOnly: 1,
      both: 1,
      skippedInvalid: 1,
      skippedConcurrent: 0,
    });
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        competitionLevel: { not: null },
        competitionLevelLatin: null,
        competitionLevelStandard: null,
      },
      select: userCompetitionLevelBackfillSelect,
      orderBy: { id: "asc" },
      take: 2,
    });
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: "b" } }),
      }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(3);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "a",
        competitionLevelLatin: null,
        competitionLevelStandard: null,
      },
      data: { competitionLevelLatin: "Avancé" },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "d",
        competitionLevelLatin: null,
        competitionLevelStandard: null,
      },
      data: {
        competitionLevelLatin: "Intermédiaire",
        competitionLevelStandard: "Intermédiaire",
      },
    });
  });

  it("counts a row changed meanwhile instead of overwriting it", async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([user("a", "Avancé")] as never)
      .mockResolvedValueOnce([]);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const report = await backfillUserCompetitionLevels(prisma, false);

    expect(report.updated).toBe(0);
    expect(report.skippedConcurrent).toBe(1);
  });

  it("dry run counts without writing", async () => {
    prisma.user.findMany
      .mockResolvedValueOnce([user("a", "Avancé", "Latin")] as never)
      .mockResolvedValueOnce([]);

    const report = await backfillUserCompetitionLevels(prisma, true);

    expect(report).toMatchObject({ scanned: 1, updated: 1, latinOnly: 1 });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing on an empty base", async () => {
    prisma.user.findMany.mockResolvedValueOnce([]);

    const report = await backfillUserCompetitionLevels(prisma, false);

    expect(report.scanned).toBe(0);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
