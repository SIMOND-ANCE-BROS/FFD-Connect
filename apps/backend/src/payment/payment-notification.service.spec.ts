import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { withActiveRole } from "../auth/roles";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CLUB_PAYMENT_RECEIVED_COPY,
  CLUB_PAYMENT_RECEIVED_DATA_TYPE,
  MAX_CLUB_MANAGERS_NOTIFIED,
  PaymentNotificationService,
} from "./payment-notification.service";

describe("PaymentNotificationService", () => {
  let service: PaymentNotificationService;
  let prisma: DeepMockProxy<PrismaClient>;
  let notifications: jest.Mocked<
    Pick<NotificationsService, "createManyForUsers" | "sendToUsers">
  >;

  const booking = {
    id: "booking-1",
    seatLabel: "Rang A, Place 5",
    competition: {
      id: "comp-1",
      title: "Open de Lyon",
      organizer: "  Club Danse Lyon ",
      organizerClubId: "club-1",
    },
  };
  const unlinked = {
    ...booking,
    competition: { ...booking.competition, organizerClubId: null },
  };
  const club = { id: "club-1", name: "Club Danse Lyon", disabledAt: null };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    notifications = {
      createManyForUsers: jest.fn().mockResolvedValue({ count: 2 }),
      sendToUsers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(PaymentNotificationService);
  });

  it("writes an in-app notification for the organizer club's managers only", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue(booking as never);
    prisma.club.findUnique.mockResolvedValue(club as never);
    prisma.user.findMany.mockResolvedValue([
      { id: "manager-1" },
      { id: "manager-2" },
    ] as never);

    await service.notifyPaymentReceived("booking-1");

    // The club is the competition's linked organiser (#408), by id.
    expect(prisma.club.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "club-1" } }),
    );
    expect(prisma.club.findMany).not.toHaveBeenCalled();
    // Only this club's active, enabled CLUB managers, bounded.
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            withActiveRole(UserRole.CLUB),
            { disabledAt: null },
            {
              OR: [
                { clubId: "club-1" },
                {
                  clubId: null,
                  clubName: { equals: "Club Danse Lyon", mode: "insensitive" },
                },
              ],
            },
          ],
        },
        take: MAX_CLUB_MANAGERS_NOTIFIED,
      }),
    );
    expect(notifications.createManyForUsers).toHaveBeenCalledWith(
      ["manager-1", "manager-2"],
      NotificationType.CLUB_PAYMENT_RECEIVED,
      "Paiement HelloAsso reçu",
      "Un paiement a été reçu pour « Open de Lyon » (Rang A, Place 5).",
      {
        type: CLUB_PAYMENT_RECEIVED_DATA_TYPE,
        competitionId: "comp-1",
        bookingId: "booking-1",
      },
    );
    // In-app feed only: no push.
    expect(notifications.sendToUsers).not.toHaveBeenCalled();
  });

  it("omits the seat from the copy when the booking has none", () => {
    expect(CLUB_PAYMENT_RECEIVED_COPY.body("Open de Lyon", null)).toBe(
      "Un paiement a été reçu pour « Open de Lyon ».",
    );
  });

  it("falls back to the one club the label names on an unlinked competition", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue(unlinked as never);
    prisma.club.findMany.mockResolvedValue([{ id: "club-1" }] as never);
    prisma.club.findUnique.mockResolvedValue(club as never);
    prisma.user.findMany.mockResolvedValue([{ id: "manager-1" }] as never);

    await service.notifyPaymentReceived("booking-1");

    // Label trimmed, case ignored.
    expect(prisma.club.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { equals: "Club Danse Lyon", mode: "insensitive" } },
      }),
    );
    expect(prisma.club.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "club-1" } }),
    );
    expect(notifications.createManyForUsers).toHaveBeenCalled();
  });

  it("notifies nobody when two clubs share the label up to case (#408)", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue(unlinked as never);
    prisma.club.findMany.mockResolvedValue([
      { id: "club-1" },
      { id: "club-2" },
    ] as never);

    await service.notifyPaymentReceived("booking-1");

    expect(prisma.club.findUnique).not.toHaveBeenCalled();
    expect(notifications.createManyForUsers).not.toHaveBeenCalled();
  });

  it.each([
    ["the booking is unknown", null],
    [
      "the competition has no organizer",
      {
        ...booking,
        competition: {
          ...booking.competition,
          organizer: " ",
          organizerClubId: null,
        },
      },
    ],
  ])("notifies nobody when %s", async (_label, found) => {
    prisma.seatBooking.findUnique.mockResolvedValue(found as never);

    await service.notifyPaymentReceived("booking-1");

    expect(prisma.club.findUnique).not.toHaveBeenCalled();
    expect(notifications.createManyForUsers).not.toHaveBeenCalled();
  });

  it.each([
    ["the organizer is not a known club", null],
    ["the club is disabled", { ...club, disabledAt: new Date() }],
  ])("notifies nobody when %s", async (_label, foundClub) => {
    prisma.seatBooking.findUnique.mockResolvedValue(booking as never);
    prisma.club.findUnique.mockResolvedValue(foundClub as never);

    await service.notifyPaymentReceived("booking-1");

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notifications.createManyForUsers).not.toHaveBeenCalled();
  });

  it("never rejects when the feed write fails", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue(booking as never);
    prisma.club.findUnique.mockResolvedValue(club as never);
    prisma.user.findMany.mockResolvedValue([{ id: "manager-1" }] as never);
    notifications.createManyForUsers.mockRejectedValue(new Error("DB down"));

    await expect(
      service.notifyPaymentReceived("booking-1"),
    ).resolves.toBeUndefined();
  });

  it("never rejects when a lookup fails", async () => {
    prisma.seatBooking.findUnique.mockRejectedValue(new Error("timeout"));

    await expect(
      service.notifyPaymentReceived("booking-1"),
    ).resolves.toBeUndefined();
    expect(notifications.createManyForUsers).not.toHaveBeenCalled();
  });
});
