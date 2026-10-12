import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import {
  idOnlySelect,
  notificationNameScrubSelect,
  partnershipMembersSelect,
} from "../utils/prisma-selects";
import {
  buildNotificationNameScrubOps,
  MAX_NOTIFICATION_SCRUB_PAGES,
  MAX_NOTIFICATION_SCRUB_ROWS,
} from "./notification-name-scrub";

// Fictitious names only.
describe("buildNotificationNameScrubOps (#423)", () => {
  let prisma: MockProxy<PrismaClient>;
  let logger: { warn: jest.Mock };

  const run = () => buildNotificationNameScrubOps(prisma, "deleted", logger);

  /** Each op is the update call's argument, so tests read what is written. */
  const updates = () =>
    prisma.notification.updateMany.mock.calls.map(([args]) => args);

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    logger = { warn: jest.fn() };
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.partnership.findMany.mockResolvedValue([]);
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.updateMany.mockImplementation(
      (args) => ({ op: "notification", args }) as never,
    );
  });

  it("reads the structural links with shared, bounded selects", async () => {
    prisma.registration.findMany.mockResolvedValue([{ id: "reg1" }] as never);
    prisma.partnership.findMany.mockResolvedValue([
      { id: "p1", user1Id: "deleted", user2Id: "u2" },
    ] as never);

    await expect(run()).resolves.toEqual([]);

    expect(prisma.registration.findMany).toHaveBeenCalledWith({
      where: { userId: "deleted" },
      select: idOnlySelect,
      take: MAX_NOTIFICATION_SCRUB_ROWS,
    });
    expect(prisma.partnership.findMany).toHaveBeenCalledWith({
      where: { OR: [{ user1Id: "deleted" }, { user2Id: "deleted" }] },
      select: partnershipMembersSelect,
      take: MAX_NOTIFICATION_SCRUB_ROWS,
    });
    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: {
        userId: { not: "deleted" },
        OR: [
          { data: { path: ["registrationId"], equals: "reg1" } },
          { data: { path: ["partnershipId"], equals: "p1" } },
          { data: { path: ["member1UserId"], equals: "deleted" } },
          { data: { path: ["member2UserId"], equals: "deleted" } },
        ],
      },
      select: notificationNameScrubSelect,
      orderBy: { id: "asc" },
      take: MAX_NOTIFICATION_SCRUB_ROWS,
    });
  });

  it("reads the next page after a full one, from the last id", async () => {
    const full = Array.from(
      { length: MAX_NOTIFICATION_SCRUB_ROWS },
      (_, i) => ({
        id: `n${String(i).padStart(4, "0")}`,
        body: "x",
        data: null,
      }),
    );
    prisma.notification.findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([]);

    await expect(run()).resolves.toHaveLength(0);

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.notification.findMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({ cursor: { id: "n0999" }, skip: 1 }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rewrites an organiser's registration notification found by registrationId", async () => {
    prisma.registration.findMany.mockResolvedValue([{ id: "reg1" }] as never);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        body: 'Alex MARTIN s\'est inscrit à "Open" - Latines Adulte.',
        data: { type: "club_member_auto_registered", registrationId: "reg1" },
      },
    ] as never);

    const ops = await run();

    expect(ops).toHaveLength(1);
    expect(updates()).toEqual([
      {
        where: { id: "n1", userId: { not: "deleted" } },
        data: {
          body: 'Membre supprimé s\'est inscrit à "Open" - Latines Adulte.',
        },
      },
    ]);
  });

  it("ignores a row whose registrationId is not one of the user's", async () => {
    prisma.registration.findMany.mockResolvedValue([{ id: "reg1" }] as never);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        body: 'Sam PETIT s\'est inscrit à "Open" - Latines Adulte.',
        data: { type: "club_member_auto_registered", registrationId: "other" },
      },
    ] as never);

    await expect(run()).resolves.toEqual([]);
  });

  it("rewrites an old partnership notification through the Partnership row (user2 half)", async () => {
    prisma.partnership.findMany.mockResolvedValue([
      { id: "p1", user1Id: "u1", user2Id: "deleted" },
    ] as never);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n2",
        body: "Sam PETIT & Alex MARTIN : le couple inter-club a été clôturé par l'autre club.",
        data: { type: "partnership_interclub_ended", partnershipId: "p1" },
      },
    ] as never);

    await expect(run()).resolves.toHaveLength(1);

    expect(updates()).toEqual([
      {
        where: { id: "n2", userId: { not: "deleted" } },
        data: {
          body: "Sam PETIT & Partenaire supprimé : le couple inter-club a été clôturé par l'autre club.",
        },
      },
    ]);
  });

  it("rewrites a partnership notification by its member ids once the Partnership row is gone, and drops the deleted id", async () => {
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n3",
        body: "Partenaire supprimé & Alex MARTIN : le club X a validé le couple inter-club.",
        data: {
          type: "partnership_interclub_accepted",
          partnershipId: "gone",
          member1UserId: "u1",
          member2UserId: "deleted",
        },
      },
    ] as never);

    await expect(run()).resolves.toHaveLength(1);

    expect(updates()).toEqual([
      {
        where: { id: "n3", userId: { not: "deleted" } },
        data: {
          body: "Partenaire supprimé & Partenaire supprimé : le club X a validé le couple inter-club.",
          data: {
            type: "partnership_interclub_accepted",
            partnershipId: "gone",
            member1UserId: "u1",
          },
        },
      },
    ]);
  });

  it("skips a partnership notification with no link to the user", async () => {
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n4",
        body: "Sam PETIT & Noa ROUX : clôturé.",
        data: { type: "partnership_interclub_ended", partnershipId: "p9" },
      },
    ] as never);

    await expect(run()).resolves.toEqual([]);
  });

  it("skips notifications of other types and rows already scrubbed", async () => {
    prisma.registration.findMany.mockResolvedValue([{ id: "reg1" }] as never);
    prisma.notification.findMany.mockResolvedValue([
      {
        id: "n5",
        body: "Votre inscription est confirmée.",
        data: { type: "registration_auto_confirmed", registrationId: "reg1" },
      },
      {
        id: "n6",
        body: 'Membre supprimé s\'est désinscrit de "Open" - Standard.',
        data: { type: "club_member_unregistered", registrationId: "reg1" },
      },
      { id: "n7", body: "x", data: null },
    ] as never);

    await expect(run()).resolves.toEqual([]);
  });

  it("warns, without any user identifier, when every page is full", async () => {
    prisma.notification.findMany.mockResolvedValue(
      Array.from({ length: MAX_NOTIFICATION_SCRUB_ROWS }, (_, i) => ({
        id: `n${i}`,
        body: "x",
        data: null,
      })),
    );

    await expect(run()).resolves.toHaveLength(0);

    expect(prisma.notification.findMany).toHaveBeenCalledTimes(
      MAX_NOTIFICATION_SCRUB_PAGES,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain("deleted");
  });
});
