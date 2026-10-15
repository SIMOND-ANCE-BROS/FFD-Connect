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

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ClubRefundsDueQueryService(
      prisma as unknown as PrismaService,
    );
    prisma.user.findUnique.mockResolvedValue(clubManager as never);
    prisma.competition.findMany.mockResolvedValue([
      { id: "comp-1", organizer: " club a " },
      // Contains the name but is another club: excluded.
      { id: "comp-2", organizer: "Club A Bis" },
    ] as never);
    prisma.seatBooking.findMany.mockResolvedValue([row] as never);
    prisma.seatBooking.count.mockResolvedValue(1);
  });

  it("lists the refunds owed on the club's competitions, oldest first", async () => {
    const page = await service.listForClubManager("user-1", 0, 20);

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: userRolesClubNameSelect,
    });
    expect(prisma.competition.findMany).toHaveBeenCalledWith({
      where: {
        organizer: { contains: "Club A", mode: "insensitive" },
        seatBookings: { some: { refundOwedAt: { not: null } } },
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

  it("matches on the profile's club name when the account has no club row", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...clubManager,
      clubId: null,
      club: null,
      clubName: "  Club A ",
    } as never);

    await service.listForClubManager("user-1");

    expect(prisma.competition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizer: { contains: "Club A", mode: "insensitive" },
        }) as unknown,
      }),
    );
  });

  it("returns an empty page without querying bookings when no competition matches", async () => {
    prisma.competition.findMany.mockResolvedValue([
      { id: "comp-2", organizer: "Club A Bis" },
      { id: "comp-3", organizer: null },
    ] as never);

    const page = await service.listForClubManager("user-1", 0, 20);

    expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
    expect(page).toEqual({
      data: [],
      meta: { total: 0, skip: 0, take: 20, hasMore: false },
    });
  });

  it("returns an empty page for a club account without a club", async () => {
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

    await expect(service.listForClubManager("user-1")).resolves.toEqual(
      expect.objectContaining({ data: expect.any(Array) as unknown }),
    );
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
