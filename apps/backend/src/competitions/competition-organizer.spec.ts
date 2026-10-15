import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import {
  findClubIdByName,
  isOrganizedByClub,
  matchClubByName,
  organizedByClubWhere,
  resolveOrganizerClubId,
} from "./competition-organizer";

describe("competition-organizer (#408)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("matchClubByName", () => {
    it.each([undefined, null, "", "   "])(
      "matches nothing for a blank name (%p), without lookup",
      async (name) => {
        await expect(matchClubByName(prisma, name)).resolves.toEqual({
          kind: "none",
        });
        expect(prisma.club.findMany).not.toHaveBeenCalled();
      },
    );

    it("matches the one club, trimmed and case-insensitive, bounded to 2 rows", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c1" }] as never);

      await expect(matchClubByName(prisma, "  club a ")).resolves.toEqual({
        kind: "match",
        clubId: "c1",
      });
      expect(prisma.club.findMany).toHaveBeenCalledWith({
        where: { name: { equals: "club a", mode: "insensitive" } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 2,
      });
    });

    it("reports no club", async () => {
      prisma.club.findMany.mockResolvedValue([]);
      await expect(matchClubByName(prisma, "Club A")).resolves.toEqual({
        kind: "none",
      });
    });

    it("reports two clubs differing only by case as ambiguous", async () => {
      prisma.club.findMany.mockResolvedValue([
        { id: "c1" },
        { id: "c2" },
      ] as never);
      await expect(matchClubByName(prisma, "Club X")).resolves.toEqual({
        kind: "ambiguous",
      });
      await expect(findClubIdByName(prisma, "Club X")).resolves.toBeNull();
    });
  });

  describe("resolveOrganizerClubId", () => {
    it("returns the stored link without any name lookup", async () => {
      await expect(
        resolveOrganizerClubId(prisma, {
          organizerClubId: "c1",
          organizer: "Whatever",
        }),
      ).resolves.toBe("c1");
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("falls back to the label while the row is unlinked", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c9" }] as never);
      await expect(
        resolveOrganizerClubId(prisma, {
          organizerClubId: null,
          organizer: "Club A",
        }),
      ).resolves.toBe("c9");
    });
  });

  describe("isOrganizedByClub", () => {
    it("decides on ids when both sides are linked (rename, homonyms)", () => {
      const competition = { organizerClubId: "c1", organizer: "Old name" };
      expect(
        isOrganizedByClub(competition, { clubId: "c1", clubNames: ["New"] }),
      ).toBe(true);
      expect(
        isOrganizedByClub(
          { organizerClubId: "c1", organizer: "Club X" },
          { clubId: "c2", clubNames: ["club x"] },
        ),
      ).toBe(false);
    });

    it("matches the label for an unlinked competition (case, spaces ignored)", () => {
      expect(
        isOrganizedByClub(
          { organizerClubId: null, organizer: "  dance CLUB " },
          { clubId: "c1", clubNames: [null, "Dance Club"] },
        ),
      ).toBe(true);
    });

    it("matches the label for a legacy account without clubId", () => {
      expect(
        isOrganizedByClub(
          { organizerClubId: "c1", organizer: "Dance Club" },
          { clubId: null, clubNames: ["dance club"] },
        ),
      ).toBe(true);
    });

    it("never matches an empty organiser", () => {
      expect(
        isOrganizedByClub(
          { organizer: "  " },
          { clubId: null, clubNames: ["", " "] },
        ),
      ).toBe(false);
      expect(isOrganizedByClub({}, { clubNames: [undefined] })).toBe(false);
    });
  });

  describe("organizedByClubWhere", () => {
    it("matches the link, or unlinked rows by name, for a linked club", () => {
      expect(
        organizedByClubWhere({
          clubId: "c1",
          clubNames: [" Club A ", "club a", null],
        }),
      ).toEqual({
        OR: [
          { organizerClubId: "c1" },
          {
            organizerClubId: null,
            organizer: { equals: "Club A", mode: "insensitive" },
          },
          {
            organizerClubId: null,
            organizer: { equals: "club a", mode: "insensitive" },
          },
        ],
      });
    });

    it("matches names only for a legacy account without clubId", () => {
      expect(
        organizedByClubWhere({ clubId: null, clubNames: ["Club A"] }),
      ).toEqual({
        OR: [{ organizer: { equals: "Club A", mode: "insensitive" } }],
      });
    });

    it("returns null for an account with neither id nor name", () => {
      expect(organizedByClubWhere({ clubNames: [" ", null] })).toBeNull();
    });
  });
});
