import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import {
  findClubIdByName,
  isOrganizedByClub,
  matchClubByName,
  organizedByClubWhere,
  organizerActorOf,
  organizerMatcher,
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

    it("never matches a linked competition on its label for an actor without club id (#625)", () => {
      expect(
        isOrganizedByClub(
          { organizerClubId: "c1", organizer: "Dance Club" },
          { clubId: null, clubNames: ["dance club"] },
        ),
      ).toBe(false);
      expect(
        isOrganizedByClub(
          { organizerClubId: "c1", organizer: "Dance Club" },
          { clubNames: ["Dance Club"] },
        ),
      ).toBe(false);
    });

    it("matches the label of an unlinked competition for an actor without club id", () => {
      expect(
        isOrganizedByClub(
          { organizerClubId: null, organizer: "Dance Club" },
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

  describe("organizerMatcher", () => {
    const rows = [
      { organizerClubId: "c1", organizer: "Old label" }, // mine by id
      { organizerClubId: "c2", organizer: "Club A" }, // other club by id
      { organizerClubId: null, organizer: " club a " }, // unique label → c1
      { organizerClubId: null, organizer: "Club X" }, // homonyms c1/c3
      { organizerClubId: null, organizer: "Inconnu" }, // no club
    ];

    it("applies ids, then exact label resolution, for a linked account", async () => {
      prisma.club.findMany.mockResolvedValue([
        { id: "c1", name: "Club A" },
        { id: "c1", name: "Club X" },
        { id: "c3", name: "club x" },
      ] as never);

      const isMine = await organizerMatcher(prisma, rows, {
        clubId: "c1",
        clubNames: ["Club X", "Club A"],
      });

      expect(rows.map(isMine)).toEqual([true, false, true, false, false]);
      // One bounded read for the distinct unlinked labels.
      expect(prisma.club.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.club.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { equals: "club a", mode: "insensitive" } },
              { name: { equals: "Club X", mode: "insensitive" } },
              { name: { equals: "Inconnu", mode: "insensitive" } },
            ],
          },
          take: 200,
        }),
      );
    });

    it("needs no lookup when every row is linked", async () => {
      const isMine = await organizerMatcher(prisma, rows.slice(0, 2), {
        clubId: "c1",
        clubNames: [],
      });
      expect(rows.slice(0, 2).map(isMine)).toEqual([true, false]);
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("keeps the name rule on unlinked rows only, for an actor without club id", async () => {
      const isMine = await organizerMatcher(prisma, rows, {
        clubId: null,
        clubNames: ["club x", "Club A"],
      });
      // Linked rows (labelled "Old label" / "Club A") are never its (#625).
      expect(rows.map(isMine)).toEqual([false, false, true, true, false]);
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });
  });

  describe("organizerActorOf (#625)", () => {
    it("uses the club id and the club's current name, never User.clubName, for a linked account", async () => {
      await expect(
        organizerActorOf(prisma, {
          clubId: "c1",
          clubName: "Stale copy",
          club: { name: "Current Name" },
        }),
      ).resolves.toEqual({ clubId: "c1", clubNames: ["Current Name"] });
      expect(prisma.club.findMany).not.toHaveBeenCalled();
    });

    it("resolves a legacy account to the one club its name designates", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c7" }] as never);
      await expect(
        organizerActorOf(prisma, { clubId: null, clubName: " Club A " }),
      ).resolves.toEqual({ clubId: "c7", clubNames: [" Club A "] });
    });

    it("leaves a legacy account with an ambiguous or unknown name without id", async () => {
      prisma.club.findMany.mockResolvedValueOnce([
        { id: "c1" },
        { id: "c2" },
      ] as never);
      await expect(
        organizerActorOf(prisma, { clubId: null, clubName: "Club X" }),
      ).resolves.toEqual({ clubId: null, clubNames: ["Club X"] });

      prisma.club.findMany.mockResolvedValueOnce([]);
      await expect(
        organizerActorOf(prisma, { clubId: null, clubName: "Inconnu" }),
      ).resolves.toEqual({ clubId: null, clubNames: ["Inconnu"] });
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

    it("matches unlinked rows by name only for an actor without club id (#625)", () => {
      expect(
        organizedByClubWhere({ clubId: null, clubNames: ["Club A"] }),
      ).toEqual({
        organizerClubId: null,
        OR: [{ organizer: { equals: "Club A", mode: "insensitive" } }],
      });
    });

    it("escapes LIKE wildcards in the names (#625)", () => {
      expect(
        organizedByClubWhere({ clubId: null, clubNames: ["Club_A 100%"] }),
      ).toEqual({
        organizerClubId: null,
        OR: [{ organizer: { equals: "Club\\_A 100\\%", mode: "insensitive" } }],
      });
    });

    it("returns null for an account with neither id nor name", () => {
      expect(organizedByClubWhere({ clubNames: [" ", null] })).toBeNull();
    });
  });
});
