import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { seatBookingHoldSelect } from "../utils/prisma-selects";
import {
  DEFAULT_REHOLD_COOLDOWN_MINUTES,
  MAX_HOLD_LIFETIME_MS,
  MAX_PENDING_PER_COMPETITION,
  SEAT_HOLD_DURATION_MS,
  SeatHoldService,
  resolveReholdCooldownMs,
  resumedHoldDeadline,
  type HeldBooking,
  type HoldRequest,
} from "./seat-hold.service";

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint", {
    code: "P2002",
    clientVersion: "7",
  });

describe("SeatHoldService (#428)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let service: SeatHoldService;

  const created = { id: "booking-new" } as unknown as HeldBooking;
  const numbered: HoldRequest = {
    userId: "user-1",
    competitionId: "comp-1",
    itemId: "table-1",
    seats: { mode: "numbered", seats: 4, locked: new Set([1]) },
    seatIndex: 2,
    seatLabel: "Table 1, place 3",
    amountCents: 1500,
  };

  /** findMany is called for the pending slots first, then the seats. */
  const occupancy = (
    pendingSlots: (number | null)[],
    seatIndexes: (number | null)[],
  ) => {
    prisma.seatBooking.findMany
      .mockResolvedValueOnce(
        pendingSlots.map((pendingSlot) => ({ pendingSlot })) as never,
      )
      .mockResolvedValueOnce(
        seatIndexes.map((seatIndex) => ({ seatIndex })) as never,
      );
  };

  const config = (value: unknown) =>
    ({ get: jest.fn().mockReturnValue(value) }) as unknown as ConfigService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SeatHoldService(
      prisma as unknown as PrismaService,
      config(undefined),
    );
    prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });
    prisma.seatBooking.findFirst.mockResolvedValue(null);
    prisma.seatBooking.create.mockResolvedValue(created as never);
  });

  const createdData = () => prisma.seatBooking.create.mock.calls[0][0].data;

  describe("hold", () => {
    it("expires the lapsed holds of the element and of the user first", async () => {
      occupancy([], []);

      await service.hold(numbered);

      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith({
        where: {
          competitionId: "comp-1",
          AND: [
            { OR: [{ itemId: "table-1" }, { userId: "user-1" }] },
            {
              status: "PENDING",
              OR: [
                { expiresAt: null },
                { expiresAt: { lte: expect.any(Date) } },
              ],
            },
          ],
        },
        data: { status: "EXPIRED" },
      });
      expect(
        prisma.seatBooking.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.seatBooking.create.mock.invocationCallOrder[0]);
    });

    it("holds the requested seat for 50 minutes in a free pending slot", async () => {
      occupancy([0], [0, 3]);
      const before = Date.now();

      const result = await service.hold(numbered);

      expect(result).toEqual({ resumed: false, booking: created });
      const data = createdData();
      expect(data).toEqual(
        expect.objectContaining({
          competitionId: "comp-1",
          userId: "user-1",
          itemId: "table-1",
          seatIndex: 2,
          seatLabel: "Table 1, place 3",
          pendingSlot: 1,
          status: "PENDING",
          expectedAmountCents: 1500,
        }),
      );
      const ms = (data.expiresAt as Date).getTime() - before;
      expect(SEAT_HOLD_DURATION_MS).toBe(50 * 60 * 1000);
      expect(ms).toBeGreaterThanOrEqual(SEAT_HOLD_DURATION_MS);
      expect(ms).toBeLessThan(SEAT_HOLD_DURATION_MS + 5000);
      expect(prisma.seatBooking.create).toHaveBeenCalledWith(
        expect.objectContaining({ select: seatBookingHoldSelect }),
      );
    });

    it("bounds its reads (pending cap + 1, element seats + 1)", async () => {
      occupancy([], []);

      await service.hold(numbered);

      const [pending, seats] = prisma.seatBooking.findMany.mock.calls;
      expect(pending[0]).toEqual({
        where: { competitionId: "comp-1", userId: "user-1", status: "PENDING" },
        select: { pendingSlot: true },
        take: MAX_PENDING_PER_COMPETITION + 1,
      });
      expect(seats[0]).toEqual({
        where: {
          competitionId: "comp-1",
          itemId: "table-1",
          status: { in: ["PENDING", "CONFIRMED"] },
        },
        select: { seatIndex: true },
        take: 1001,
      });
    });

    it("picks the first free, unlocked seat when none is requested", async () => {
      occupancy([], [0, 2]);

      await service.hold({ ...numbered, seatIndex: undefined });

      expect(createdData().seatIndex).toBe(3);
    });

    it("answers 409 when the requested seat is taken", async () => {
      occupancy([], [2]);

      await expect(service.hold(numbered)).rejects.toThrow(/déjà réservée/);
      expect(prisma.seatBooking.create).not.toHaveBeenCalled();
    });

    it("answers 409 when the numbered element is full", async () => {
      occupancy([], [0, 2, 3]);

      await expect(
        service.hold({ ...numbered, seatIndex: undefined }),
      ).rejects.toThrow(/plus de place/);
    });

    it("answers 409 on any seat of an element sold whole before #428", async () => {
      occupancy([], [null]);

      await expect(service.hold(numbered)).rejects.toThrow(ConflictException);
    });

    it.each([
      ["outside the element", 4, /n'existe pas/],
      ["locked", 1, /pas réservable/],
    ])(
      "answers 400 for a seat %s, before any write",
      async (_label, seatIndex, message) => {
        await expect(service.hold({ ...numbered, seatIndex })).rejects.toThrow(
          message,
        );
        expect(prisma.seatBooking.updateMany).not.toHaveBeenCalled();
      },
    );

    it("refuses a seat index on a free-placement element", async () => {
      await expect(
        service.hold({
          ...numbered,
          seats: { mode: "free", places: 10 },
          seatIndex: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe("free placement", () => {
      const free: HoldRequest = {
        ...numbered,
        seats: { mode: "free", places: 3 },
        seatIndex: undefined,
      };

      it("takes the first free place slot", async () => {
        occupancy([], [0, 2]);

        await service.hold(free);

        expect(createdData().seatIndex).toBe(1);
      });

      it("answers 409 when every place is taken", async () => {
        occupancy([], [0, 1, 2]);

        await expect(service.hold(free)).rejects.toThrow(/plus de place/);
      });

      it("counts the places even when slots sit beyond a reduced capacity", async () => {
        occupancy([], [3, 4, 5]);

        await expect(service.hold(free)).rejects.toThrow(/plus de place/);
      });
    });

    describe("cap of 4 pending bookings per competition", () => {
      it("answers 409 when the 4 pending slots are taken", async () => {
        occupancy([0, 1, 2, 3], []);

        await expect(service.hold(numbered)).rejects.toThrow(
          /déjà 4 réservations en attente/,
        );
        expect(prisma.seatBooking.create).not.toHaveBeenCalled();
      });

      it("counts the pending bookings without a slot (before #428)", async () => {
        occupancy([null, null, 0, 1], []);

        await expect(service.hold(numbered)).rejects.toThrow(
          /réservations en attente/,
        );
      });

      it("takes a slot left free by a booking that is no longer pending", async () => {
        occupancy([0, 1, 3], []);

        await service.hold(numbered);

        expect(createdData().pendingSlot).toBe(2);
      });
    });

    describe("re-hold cooldown after an expired hold (#455)", () => {
      const MINUTE = 60 * 1000;
      const lapsedAgo = (ms: number) => ({
        expiresAt: new Date(Date.now() - ms),
      });
      /** findFirst: own pending hold first (none), then the recent lapse. */
      const recentLapse = (lapse: { expiresAt: Date | null } | null) => {
        prisma.seatBooking.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(lapse as never);
      };

      it("refuses (409) a seat the user let expire, with the minutes left", async () => {
        recentLapse(lapsedAgo(10 * MINUTE));

        const error = await service.hold(numbered).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe(
          "Vous avez laissé expirer votre réservation de cette place. Vous pourrez la réserver de nouveau dans 20 minutes.",
        );
        expect(prisma.seatBooking.findMany).not.toHaveBeenCalled();
        expect(prisma.seatBooking.create).not.toHaveBeenCalled();
      });

      it("says « 1 minute » (singular, never 0) at the very end", async () => {
        recentLapse(lapsedAgo(30 * MINUTE - 1000));

        await expect(service.hold(numbered)).rejects.toThrow(
          /de nouveau dans 1 minute\.$/,
        );
      });

      it("looks only for this user's unpaid lapse of that seat, within the cooldown", async () => {
        recentLapse(null);
        occupancy([], []);
        const before = Date.now();

        await service.hold(numbered);

        const query = prisma.seatBooking.findFirst.mock.calls[1][0];
        expect(query).toEqual({
          where: {
            competitionId: "comp-1",
            userId: "user-1",
            itemId: "table-1",
            status: "EXPIRED",
            expiresAt: { gt: expect.any(Date) },
            refundOwedPaymentIds: { isEmpty: true },
            cancelReason: null,
            seatIndex: 2,
          },
          orderBy: { expiresAt: "desc" },
          select: { expiresAt: true },
        });
        const since = (query?.where?.expiresAt as { gt: Date }).gt.getTime();
        expect(before - since).toBeGreaterThanOrEqual(
          DEFAULT_REHOLD_COOLDOWN_MINUTES * MINUTE,
        );
        expect(before - since).toBeLessThan(
          DEFAULT_REHOLD_COOLDOWN_MINUTES * MINUTE + 5000,
        );
        expect(prisma.seatBooking.create).toHaveBeenCalled();
      });

      it("checks the whole element when no seat index is requested", async () => {
        recentLapse(lapsedAgo(MINUTE));

        await expect(
          service.hold({ ...numbered, seatIndex: undefined }),
        ).rejects.toThrow(ConflictException);
        expect(
          prisma.seatBooking.findFirst.mock.calls[1][0]?.where,
        ).not.toHaveProperty("seatIndex");
      });

      it("ignores a lapse without deadline (legacy row)", async () => {
        recentLapse({ expiresAt: null });
        occupancy([], []);

        await expect(service.hold(numbered)).resolves.toEqual({
          resumed: false,
          booking: created,
        });
      });

      it("never blocks resuming one's own pending hold", async () => {
        const own = { id: "booking-own" } as unknown as HeldBooking;
        prisma.seatBooking.findFirst.mockResolvedValueOnce(own as never);

        await expect(service.hold(numbered)).resolves.toEqual({
          resumed: true,
          booking: own,
        });
        expect(prisma.seatBooking.findFirst).toHaveBeenCalledTimes(1);
      });

      it("uses the configured cooldown, and 0 disables it", async () => {
        service = new SeatHoldService(
          prisma as unknown as PrismaService,
          config(0),
        );
        occupancy([], []);

        await service.hold(numbered);

        expect(prisma.seatBooking.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.seatBooking.create).toHaveBeenCalled();
      });
    });

    describe("resume", () => {
      const own = { id: "booking-own" } as unknown as HeldBooking;

      it("returns the user's own pending booking of the requested seat", async () => {
        prisma.seatBooking.findFirst.mockResolvedValue(own as never);

        const result = await service.hold(numbered);

        expect(result).toEqual({ resumed: true, booking: own });
        expect(prisma.seatBooking.findFirst).toHaveBeenCalledWith({
          where: {
            competitionId: "comp-1",
            itemId: "table-1",
            userId: "user-1",
            status: "PENDING",
            seatIndex: 2,
          },
          orderBy: { createdAt: "desc" },
          select: seatBookingHoldSelect,
        });
        expect(prisma.seatBooking.create).not.toHaveBeenCalled();
      });

      it("matches any own pending booking of the element without a seat index", async () => {
        prisma.seatBooking.findFirst.mockResolvedValue(own as never);

        await service.hold({ ...numbered, seatIndex: undefined });

        expect(
          prisma.seatBooking.findFirst.mock.calls[0][0]?.where,
        ).not.toHaveProperty("seatIndex");
      });
    });

    describe("concurrency", () => {
      it("retries after losing a race, then answers 409 from a fresh read", async () => {
        occupancy([], []);
        occupancy([], [2]);
        prisma.seatBooking.create.mockRejectedValueOnce(uniqueViolation());

        await expect(service.hold(numbered)).rejects.toThrow(/déjà réservée/);
        expect(prisma.seatBooking.create).toHaveBeenCalledTimes(1);
      });

      it("retries on another free seat after losing a race", async () => {
        occupancy([], []);
        occupancy([], [0]);
        prisma.seatBooking.create.mockRejectedValueOnce(uniqueViolation());

        await service.hold({ ...numbered, seatIndex: undefined });

        expect(prisma.seatBooking.create.mock.calls[1][0].data.seatIndex).toBe(
          2,
        );
      });

      it("gives up with a 409 after 5 lost races", async () => {
        prisma.seatBooking.findMany.mockResolvedValue([]);
        prisma.seatBooking.create.mockRejectedValue(uniqueViolation());

        await expect(service.hold(numbered)).rejects.toThrow(
          /vient d'être réservée/,
        );
        expect(prisma.seatBooking.create).toHaveBeenCalledTimes(5);
      });

      it("propagates any other database error", async () => {
        occupancy([], []);
        prisma.seatBooking.create.mockRejectedValue(new Error("DB down"));

        await expect(service.hold(numbered)).rejects.toThrow("DB down");
      });
    });
  });

  describe("recordIntent", () => {
    it("stores the intent id, its page and its creation time", async () => {
      const now = new Date();

      await service.recordIntent(
        "b-1",
        { id: "4242", redirectUrl: "https://ha/4242" },
        now,
      );

      expect(prisma.seatBooking.update).toHaveBeenCalledWith({
        where: { id: "b-1" },
        data: {
          paymentId: "4242",
          checkoutRedirectUrl: "https://ha/4242",
          checkoutCreatedAt: now,
        },
        select: { id: true },
      });
    });
  });

  describe("replaceIntent", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const booking = {
      id: "b-1",
      paymentId: "4000",
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    } as HeldBooking;

    it("swaps the intent, keeps the previous one and extends the hold", async () => {
      prisma.seatBooking.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.replaceIntent(
        booking,
        { id: "5000", redirectUrl: "https://ha/5000" },
        now,
      );

      const expiresAt = new Date(now.getTime() + SEAT_HOLD_DURATION_MS);
      expect(result).toEqual({ replaced: true, expiresAt });
      expect(prisma.seatBooking.updateMany).toHaveBeenCalledWith({
        where: {
          id: "b-1",
          status: "PENDING",
          paymentId: "4000",
          expiresAt: { gt: now },
        },
        data: {
          paymentId: "5000",
          checkoutRedirectUrl: "https://ha/5000",
          checkoutCreatedAt: now,
          expiresAt,
          supersededPaymentIds: { push: "4000" },
        },
      });
    });

    it("reports a booking changed meanwhile", async () => {
      prisma.seatBooking.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.replaceIntent(
        { ...booking, paymentId: null },
        { id: "5000", redirectUrl: "https://ha/5000" },
        now,
      );

      expect(result.replaced).toBe(false);
      expect(
        prisma.seatBooking.updateMany.mock.calls[0][0].data,
      ).not.toHaveProperty("supersededPaymentIds");
    });
  });

  describe("resolveReholdCooldownMs (#455)", () => {
    const MINUTE = 60 * 1000;

    it.each([
      [undefined, DEFAULT_REHOLD_COOLDOWN_MINUTES],
      [45, 45],
      ["15", 15],
      [0, 0],
      [1440, 1440],
      [1441, DEFAULT_REHOLD_COOLDOWN_MINUTES],
      [-1, DEFAULT_REHOLD_COOLDOWN_MINUTES],
      [2.5, DEFAULT_REHOLD_COOLDOWN_MINUTES],
      ["", DEFAULT_REHOLD_COOLDOWN_MINUTES],
      ["abc", DEFAULT_REHOLD_COOLDOWN_MINUTES],
    ])("reads %p as %p minutes", (value, minutes) => {
      expect(resolveReholdCooldownMs(config(value))).toBe(minutes * MINUTE);
    });

    it("reads SEAT_REHOLD_COOLDOWN_MINUTES", () => {
      const configService = config(10);

      resolveReholdCooldownMs(configService);

      expect(configService.get).toHaveBeenCalledWith(
        "SEAT_REHOLD_COOLDOWN_MINUTES",
      );
    });
  });

  describe("resumedHoldDeadline", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

    it("gives a fresh page a full hold", () => {
      expect(
        resumedHoldDeadline({ createdAt: at(-30), expiresAt: at(20) }, now),
      ).toEqual(at(50));
    });

    it("never goes beyond the hold lifetime from creation", () => {
      expect(MAX_HOLD_LIFETIME_MS).toBe(100 * 60 * 1000);
      expect(
        resumedHoldDeadline({ createdAt: at(-80), expiresAt: at(5) }, now),
      ).toEqual(at(20));
    });

    it("never shortens the current deadline", () => {
      expect(
        resumedHoldDeadline({ createdAt: at(-99), expiresAt: at(10) }, now),
      ).toEqual(at(10));
      expect(
        resumedHoldDeadline({ createdAt: at(-99), expiresAt: null }, now),
      ).toEqual(at(1));
    });
  });

  describe("release", () => {
    it("deletes the hold only while it is still pending, never throwing", async () => {
      prisma.seatBooking.deleteMany.mockRejectedValue(new Error("DB down"));

      await expect(service.release("b-1")).resolves.toBeUndefined();
      expect(prisma.seatBooking.deleteMany).toHaveBeenCalledWith({
        where: { id: "b-1", status: "PENDING" },
      });
    });
  });
});
