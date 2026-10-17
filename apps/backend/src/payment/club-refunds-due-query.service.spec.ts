import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import {
  competitionIdOrganizerSelect,
  seatBookingRefundDueSelect,
  userRolesClubNameSelect,
} from "../utils/prisma-selects";
import {
  ClubRefundsDueQueryService,
  DEFAULT_REFUNDS_DUE_PAGE_SIZE,
  MAX_COMPETITIONS_WITH_REFUNDS,
} from "./club-refunds-due-query.service";

describe("ClubRefundsDueQueryService (#516)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: ClubRefundsDueQueryService;

  const clubManager = {
    role: UserRole.CLUB,
    extraRoles: [],
    clubId: "club-a",
    clubName: null,
    club: { disabledAt: null, name: "Club A" },
  };

  const refundOwedAt = new Date("2026-10-10T10:00:00Z");
  const row = {
    id: "booking-1",
    seatIndex: 4,
    expectedAmountCents: 1550,
    refundOwedPaymentIds: ["111", "222"],
    refundOwedAt,
    competition: {
      id: "comp-1",
      title: "Open de Lyon",
      date: new Date("2026-11-01T00:00:00Z"),
    },
    user: { id: "u-1", firstName: "Jeanne", lastName: "Martin" },
  };

  const linked = (id: string, clubId: string) => ({
    id,
    organizer: "Club A",
    organizerClubId: clubId,
  });
  const unlinked = (id: string, organizer: string | null) => ({
    id,
    organizer,
    organizerClubId: null,
  });

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ClubRefundsDueQueryService(
      prisma as unknown as PrismaService,
    );
    prisma.user.findUnique.mockResolvedValue(clubManager as never);
    prisma.competition.findMany.mockResolvedValue([
      linked("comp-1", "club-a"),
    ] as never);
    // Labels of unlinked competitions: "Club A" names exactly one club.
    prisma.club.findMany.mockResolvedValue([
      { id: "club-a", name: "Club A" },
    ] as never);
    prisma.seatBooking.findMany.mockResolvedValue([row] as never);
    prisma.seatBooking.count.mockResolvedValue(1);
  });

  const listedCompetitionIds = () =>
    (
      prisma.seatBooking.findMany.mock.calls[0][0] as {
        where: { competitionId: { in: string[] } };
      }
    ).where.competitionId.in;

  it("lists the refunds owed on the club's competitions, oldest first", async () => {
    const page = await service.listForClubManager("user-1", 0, 20);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: userRolesClubNameSelect,
    });
    expect(prisma.competition.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { organizerClubId: "club-a" },
              {
                organizerClubId: null,
                organizer: { equals: "Club A", mode: "insensitive" },
              },
            ],
          },
          { seatBookings: { some: { refundOwedAt: { not: null } } } },
        ],
      },
      select: competitionIdOrganizerSelect,
      orderBy: { date: "desc" },
      take: MAX_COMPETITIONS_WITH_REFUNDS,
    });
    const where = {
      competitionId: { in: ["comp-1"] },
      refundOwedAt: { not: null },
    };
    expect(prisma.seatBooking.findMany).toHaveBeenCalledWith({
      where,
      select: seatBookingRefundDueSelect,
      orderBy: [{ refundOwedAt: "asc" }, { id: "asc" }],
      skip: 0,
      take: 20,
    });
    expect(prisma.seatBooking.count).toHaveBeenCalledWith({ where });
    expect(page).toEqual({
      data: [
        {
          bookingId: "booking-1",
          competition: row.competition,
          dancer: { firstName: "Jeanne", lastName: "Martin" },
          seatNumber: 5,
          amountCents: 1550,
          helloAssoCheckoutIntentIds: ["111", "222"],
          refundOwedAt,
        },
      ],
      meta: { total: 1, skip: 0, take: 20, hasMore: false },
    });
  });

  it("includes an unlinked competition whose label designates exactly the caller's club", async () => {
    prisma.competition.findMany.mockResolvedValue([
      linked("comp-1", "club-a"),
      unlinked("comp-3", " club a "),
    ] as never);

    await service.listForClubManager("user-1");

    expect(listedCompetitionIds()).toEqual(["comp-1", "comp-3"]);
  });

  it("never shows a homonym club's competitions (linked to another club)", async () => {
    // Club B is also named "Club A": linked by id, it is not the caller's.
    prisma.competition.findMany.mockResolvedValue([
      linked("comp-1", "club-a"),
      linked("comp-b", "club-b"),
    ] as never);

    await service.listForClubManager("user-1");

    expect(listedCompetitionIds()).toEqual(["comp-1"]);
  });

  it("skips an unlinked competition whose label is ambiguous between homonym clubs", async () => {
    prisma.competition.findMany.mockResolvedValue([
      unlinked("comp-x", "Club A"),
    ] as never);
    prisma.club.findMany.mockResolvedValue([
      { id: "club-a", name: "Club A" },
      { id: "club-b", name: "club a" },
    ] as never);

    const page = await service.listForClubManager("user-1", 0, 20);

    expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
    expect(page).toEqual({
      data: [],
      meta: { total: 0, skip: 0, take: 20, hasMore: false },
    });
  });

  it("matches a legacy account whose name designates no club on unlinked rows only (#625)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      clubId: null,
      club: null,
      clubName: "  Club A ",
    } as never);
    // No club carries that name: the account stays without club id.
    prisma.club.findMany.mockResolvedValue([]);
    prisma.competition.findMany.mockResolvedValue([
      unlinked("comp-3", "club a"),
      unlinked("comp-4", "Club A Bis"),
    ] as never);

    await service.listForClubManager("user-1");

    expect(prisma.competition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizerClubId: null,
              OR: [{ organizer: { equals: "Club A", mode: "insensitive" } }],
            },
            { seatBookings: { some: { refundOwedAt: { not: null } } } },
          ],
        },
      }),
    );
    expect(listedCompetitionIds()).toEqual(["comp-3"]);
  });

  it("resolves a legacy account to its club and never matches a linked row on its label (#625)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      clubId: null,
      club: null,
      clubName: "Club A",
    } as never);
    // Name resolution: the one club named "Club A" is club-7.
    prisma.club.findMany.mockResolvedValueOnce([{ id: "club-7" }] as never);
    prisma.competition.findMany.mockResolvedValue([
      { id: "comp-5", organizer: "Club A", organizerClubId: "club-other" },
      { id: "comp-6", organizer: "Autre", organizerClubId: "club-7" },
    ] as never);

    await service.listForClubManager("user-1");

    expect(listedCompetitionIds()).toEqual(["comp-6"]);
  });

  it("uses the default page and reports more pages", async () => {
    prisma.seatBooking.count.mockResolvedValue(45);

    const page = await service.listForClubManager("user-1");

    expect(prisma.seatBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: DEFAULT_REFUNDS_DUE_PAGE_SIZE }),
    );
    expect(page.meta).toEqual({
      total: 45,
      skip: 0,
      take: DEFAULT_REFUNDS_DUE_PAGE_SIZE,
      hasMore: true,
    });
  });

  it("maps a booking made before per-seat sales to a null seat number", async () => {
    prisma.seatBooking.findMany.mockResolvedValue([
      { ...row, seatIndex: null, expectedAmountCents: null },
    ] as never);

    const page = await service.listForClubManager("user-1");

    expect(page.data[0]).toEqual(
      expect.objectContaining({ seatNumber: null, amountCents: null }),
    );
  });

  it("returns an empty page when no competition has a refund owed", async () => {
    prisma.competition.findMany.mockResolvedValue([]);

    const page = await service.listForClubManager("user-1");

    expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
    expect(page.data).toEqual([]);
  });

  it("returns an empty page for a club account without any club", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      clubId: null,
      club: null,
      clubName: "   ",
    } as never);

    const page = await service.listForClubManager("user-1");

    expect(prisma.competition.findMany).not.toHaveBeenCalled();
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it("counts an extra CLUB role of an active club", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      role: UserRole.LICENSEE,
      extraRoles: [UserRole.CLUB],
    } as never);

    await service.listForClubManager("user-1");

    expect(listedCompetitionIds()).toEqual(["comp-1"]);
  });

  it("refuses an account without an effective CLUB role", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      role: UserRole.LICENSEE,
      // Extra CLUB of a disabled club does not count.
      extraRoles: [UserRole.CLUB],
      club: { disabledAt: new Date(), name: "Club A" },
    } as never);

    await expect(service.listForClubManager("user-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.competition.findMany).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown account", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.listForClubManager("ghost")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
