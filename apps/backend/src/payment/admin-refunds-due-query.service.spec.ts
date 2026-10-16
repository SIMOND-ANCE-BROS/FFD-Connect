import { BadRequestException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { adminSeatBookingRefundDueSelect } from "../utils/prisma-selects";
import { AdminRefundsDueQueryService } from "./admin-refunds-due-query.service";

describe("AdminRefundsDueQueryService (#627)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: AdminRefundsDueQueryService;

  const refundOwedAt = new Date("2026-10-10T10:00:00Z");
  const row = (over: Record<string, unknown> = {}) => ({
    id: "booking-1",
    seatIndex: 4,
    expectedAmountCents: 1550,
    refundOwedPaymentIds: ["111", "222"],
    refundOwedAt,
    competition: {
      id: "comp-1",
      title: "Open de Lyon",
      date: new Date("2026-11-01T00:00:00Z"),
      organizer: "Label libre",
      organizerClub: { id: "club-a", name: "Club A" },
    },
    user: { id: "u-1", firstName: "Jeanne", lastName: "Martin" },
    ...over,
  });

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new AdminRefundsDueQueryService(
      prisma as unknown as PrismaService,
    );
    prisma.seatBooking.findMany.mockResolvedValue([row()] as never);
    prisma.seatBooking.count.mockResolvedValue(1);
  });

  it("lists every club's refunds owed, oldest first, with the shared select", async () => {
    const page = await service.list({});

    expect(prisma.seatBooking.findMany).toHaveBeenCalledWith({
      where: { refundOwedAt: { not: null } },
      select: adminSeatBookingRefundDueSelect,
      orderBy: [{ refundOwedAt: "asc" }, { id: "asc" }],
      skip: 0,
      take: 20,
    });
    expect(prisma.seatBooking.count).toHaveBeenCalledWith({
      where: { refundOwedAt: { not: null } },
    });
    expect(page).toEqual({
      data: [
        {
          bookingId: "booking-1",
          club: { id: "club-a", name: "Club A" },
          competition: {
            id: "comp-1",
            title: "Open de Lyon",
            date: new Date("2026-11-01T00:00:00Z"),
          },
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

  it("falls back to the organiser label for an unlinked competition", async () => {
    prisma.seatBooking.findMany.mockResolvedValue([
      row({
        seatIndex: null,
        expectedAmountCents: null,
        competition: {
          id: "comp-2",
          title: "Bal",
          date: new Date("2026-11-02T00:00:00Z"),
          organizer: "Club sans lien",
          organizerClub: null,
        },
      }),
    ] as never);

    const [first] = (await service.list({})).data;

    expect(first.club).toEqual({ id: null, name: "Club sans lien" });
    expect(first.seatNumber).toBeNull();
    expect(first.amountCents).toBeNull();
  });

  it("pages, sorts and filters on the whitelisted columns", async () => {
    prisma.seatBooking.count.mockResolvedValue(120);

    const page = await service.list({
      skip: 50,
      take: 50,
      sortBy: "club",
      sortOrder: "desc",
      filters: [
        { field: "club", op: "contains", value: "lyon" },
        { field: "refundOwedAt", op: "lt", value: "2026-10-12" },
      ],
    });

    const args = prisma.seatBooking.findMany.mock.calls[0][0];
    expect(args?.orderBy).toEqual([
      { competition: { organizerClub: { name: "desc" } } },
      { competition: { organizer: "desc" } },
      { id: "desc" },
    ]);
    expect(args?.skip).toBe(50);
    expect(args?.take).toBe(50);
    expect(args?.where).toEqual({
      refundOwedAt: { not: null },
      AND: [
        {
          competition: {
            is: {
              OR: [
                {
                  organizerClub: {
                    is: { name: { contains: "lyon", mode: "insensitive" } },
                  },
                },
                {
                  organizerClubId: null,
                  organizer: { contains: "lyon", mode: "insensitive" },
                },
              ],
            },
          },
        },
        { refundOwedAt: { lt: expect.any(Date) as unknown } },
      ],
    });
    expect(page.meta).toEqual({
      total: 120,
      skip: 50,
      take: 50,
      hasMore: true,
    });
  });

  it.each([
    ["competition", [{ competition: { title: "asc" } }, { id: "asc" }]],
    ["competitionDate", [{ competition: { date: "asc" } }, { id: "asc" }]],
    [
      "amount",
      [{ expectedAmountCents: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    ],
    ["refundOwedAt", [{ refundOwedAt: "asc" }, { id: "asc" }]],
  ] as const)("sorts on %s with an id tie-breaker", async (sortBy, orderBy) => {
    await service.list({ sortBy });

    expect(prisma.seatBooking.findMany.mock.calls[0][0]?.orderBy).toEqual(
      orderBy,
    );
  });

  it("matches the dancer on first or last name", async () => {
    await service.list({
      filters: [{ field: "dancer", op: "equals", value: "Martin" }],
    });

    const condition = { equals: "Martin", mode: "insensitive" };
    expect(prisma.seatBooking.findMany.mock.calls[0][0]?.where).toEqual({
      refundOwedAt: { not: null },
      AND: [
        {
          user: {
            is: { OR: [{ lastName: condition }, { firstName: condition }] },
          },
        },
      ],
    });
  });

  it("rejects a field outside the whitelist", async () => {
    await expect(
      service.list({
        filters: [{ field: "paymentId", op: "equals", value: "1" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
