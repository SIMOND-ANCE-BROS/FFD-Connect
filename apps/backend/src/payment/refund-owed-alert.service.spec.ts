import { Logger } from "@nestjs/common";
import { NotificationType, PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { RefundOwedAlertService } from "./refund-owed-alert.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

describe("RefundOwedAlertService (#428)", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let sendToUsers: jest.Mock;
  let service: RefundOwedAlertService;

  const booking = {
    id: "booking-1",
    seatIndex: 4,
    expectedAmountCents: 1550,
    // Unlinked (#408): resolved through the label fallback.
    competition: {
      id: "comp-1",
      title: "Open de Lyon",
      organizer: " Club A ",
      organizerClubId: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    prisma = mockDeep<PrismaClient>();
    sendToUsers = jest.fn().mockResolvedValue({ recipients: 2 });
    service = new RefundOwedAlertService(
      prisma as unknown as PrismaService,
      { sendToUsers } as unknown as NotificationsService,
    );
    prisma.seatBooking.findUnique.mockResolvedValue(booking as never);
    prisma.club.findMany.mockResolvedValue([{ id: "club-a" }] as never);
    prisma.club.findUnique.mockResolvedValue({
      id: "club-a",
      name: "Club A",
    } as never);
    prisma.user.findMany.mockResolvedValue([
      { id: "m-1" },
      { id: "m-2" },
    ] as never);
  });

  const expectUnalerted = (reason: string) => {
    expect(sendToUsers).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "HelloAsso refund owed: club not alerted",
      expect.objectContaining({
        tags: { payment: "helloasso-refund-owed-unalerted", reason },
        extra: { bookingId: "booking-1" },
      }),
    );
  };

  it("alerts the organising club's managers, without payer data", async () => {
    await service.alertClub("booking-1", 98765);

    expect(prisma.club.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { equals: "Club A", mode: "insensitive" } },
        take: 2,
      }),
    );
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-a" },
      select: { id: true, name: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, select: { id: true } }),
    );
    expect(sendToUsers).toHaveBeenCalledWith(
      ["m-1", "m-2"],
      NotificationType.CLUB_PAYMENT_RECEIVED,
      "Remboursement à effectuer",
      "Un paiement HelloAsso de 15,50 € (commande n° 98765) pour « Open de Lyon » (place 5) n'a pas pu être attribué à une place. Remboursez-le depuis votre espace HelloAsso.",
      {
        type: "club_payment_refund_owed",
        competitionId: "comp-1",
        bookingId: "booking-1",
        orderId: "98765",
      },
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("words the alert without order, amount nor seat when unknown", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue({
      ...booking,
      seatIndex: null,
      expectedAmountCents: null,
    } as never);

    await service.alertClub("booking-1", undefined);

    const [, , , body, data] = sendToUsers.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      string,
      Record<string, string>,
    ];
    expect(body).toBe(
      "Un paiement HelloAsso pour « Open de Lyon » n'a pas pu être attribué à une place. Remboursez-le depuis votre espace HelloAsso.",
    );
    expect(data).not.toHaveProperty("orderId");
  });

  it.each([
    ["the booking is gone", "no_organizer", () => null],
    [
      "the competition has no organiser",
      "no_organizer",
      () => ({
        ...booking,
        competition: { ...booking.competition, organizer: null },
      }),
    ],
  ])("reports to Sentry when %s", async (_label, reason, value) => {
    prisma.seatBooking.findUnique.mockResolvedValue(value() as never);

    await service.alertClub("booking-1", 1);

    expectUnalerted(reason);
  });

  it("alerts the linked club by id, whatever the label (#408)", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue({
      ...booking,
      competition: {
        ...booking.competition,
        organizer: null,
        organizerClubId: "club-a",
      },
    } as never);

    await service.alertClub("booking-1", 1);

    expect(prisma.club.findMany).not.toHaveBeenCalled();
    expect(prisma.club.findUnique).toHaveBeenCalledWith({
      where: { id: "club-a" },
      select: { id: true, name: true },
    });
    expect(sendToUsers).toHaveBeenCalled();
  });

  it("reports to Sentry when the organising club is unknown", async () => {
    prisma.club.findMany.mockResolvedValue([]);

    await service.alertClub("booking-1", 1);

    expect(prisma.club.findUnique).not.toHaveBeenCalled();
    expectUnalerted("club_not_found");
  });

  it("reports to Sentry when the linked club is gone", async () => {
    prisma.seatBooking.findUnique.mockResolvedValue({
      ...booking,
      competition: { ...booking.competition, organizerClubId: "club-gone" },
    } as never);
    prisma.club.findUnique.mockResolvedValue(null);

    await service.alertClub("booking-1", 1);

    expectUnalerted("club_not_found");
  });

  it("never guesses between two clubs differing only by case (#408)", async () => {
    prisma.club.findMany.mockResolvedValue([
      { id: "club-a" },
      { id: "club-a-lower" },
    ] as never);

    await service.alertClub("booking-1", 1);

    expect(prisma.club.findUnique).not.toHaveBeenCalled();
    expectUnalerted("club_not_found");
  });

  it("reports to Sentry when the club has no manager", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.alertClub("booking-1", 1);

    expectUnalerted("no_club_manager");
  });

  it("never throws, and reports a failed send", async () => {
    sendToUsers.mockRejectedValue(new Error("DB down"));

    await expect(service.alertClub("booking-1", 1)).resolves.toBeUndefined();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "HelloAsso refund owed: club not alerted",
      expect.objectContaining({
        tags: expect.objectContaining({ reason: "send_failed" }),
      }),
    );
  });

  it("reports a non-Error failure as well", async () => {
    prisma.seatBooking.findUnique.mockRejectedValue("boom");

    await service.alertClub("booking-1", 1);

    expect(Sentry.captureMessage).toHaveBeenCalled();
  });
});
