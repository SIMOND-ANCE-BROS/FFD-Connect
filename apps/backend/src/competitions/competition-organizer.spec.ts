import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import {
  clubManagersOfClubWhere,
  findClubIdByName,
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

    it("never lets a label override the link (#625)", async () => {
      // Row linked to c2 but labelled with c1's exact name.
      prisma.club.findMany.mockResolvedValue([
        { id: "c1", name: "Club A" },
      ] as never);
      const isMine = await organizerMatcher(
        prisma,
        [{ organizerClubId: "c2", organizer: "Club A" }],
        { clubId: "c1", clubNames: ["Club A"] },
      );
      expect(isMine({ organizerClubId: "c2", organizer: "Club A" })).toBe(
        false,
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

    it("grants nothing to an actor without club id, even on an exact label (#625)", async () => {
      const isMine = await organizerMatcher(prisma, rows, {
        clubId: null,
        clubNames: ["club x", "Club A", "Old label"],
      });
      expect(rows.map(isMine)).toEqual([false, false, false, false, false]);
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

    it("resolves a legacy account to the one active club its name designates", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c7" }] as never);
      prisma.club.findFirst.mockResolvedValue({ id: "c7" } as never);
      await expect(
        organizerActorOf(prisma, { clubId: null, clubName: " Club A " }),
      ).resolves.toEqual({ clubId: "c7", clubNames: [" Club A "] });
      expect(prisma.club.findFirst).toHaveBeenCalledWith({
        where: { id: "c7", disabledAt: null },
        select: { id: true },
      });
    });

    it("leaves a legacy account of a disabled club without id", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c7" }] as never);
      prisma.club.findFirst.mockResolvedValue(null);
      await expect(
        organizerActorOf(prisma, { clubId: null, clubName: "Club A" }),
      ).resolves.toEqual({ clubId: null, clubNames: ["Club A"] });
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
      expect(prisma.club.findFirst).not.toHaveBeenCalled();
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

    it("escapes LIKE wildcards in the names (#625)", () => {
      expect(
        organizedByClubWhere({ clubId: "c1", clubNames: ["Club_A 100%"] }),
      ).toEqual({
        OR: [
          { organizerClubId: "c1" },
          {
            organizerClubId: null,
            organizer: { equals: "Club\\_A 100\\%", mode: "insensitive" },
          },
        ],
      });
    });

    it("returns null for an actor without club id, whatever its names (#625)", () => {
      expect(
        organizedByClubWhere({ clubId: null, clubNames: ["Club A"] }),
      ).toBeNull();
      expect(organizedByClubWhere({ clubNames: [" ", null] })).toBeNull();
    });
  });

  describe("clubManagersOfClubWhere (#625)", () => {
    it("addresses linked managers and legacy accounts named after a unique club", async () => {
      prisma.club.findMany.mockResolvedValue([{ id: "c1" }] as never);
      await expect(
        clubManagersOfClubWhere(prisma, { id: "c1", name: " Club_A " }),
      ).resolves.toEqual({
        OR: [
          { clubId: "c1" },
          {
            clubId: null,
            clubName: { equals: "Club\\_A", mode: "insensitive" },
          },
        ],
      });
    });

    it("addresses linked managers only when a homonym club exists", async () => {
      prisma.club.findMany.mockResolvedValue([
        { id: "c1" },
        { id: "c2" },
      ] as never);
      await expect(
        clubManagersOfClubWhere(prisma, { id: "c1", name: "Club X" }),
      ).resolves.toEqual({ clubId: "c1" });
    });
  });
});
