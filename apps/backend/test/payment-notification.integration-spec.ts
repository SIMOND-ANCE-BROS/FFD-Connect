import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { BookingStatus, NotificationType, UserRole } from "@prisma/client";
import { NotificationsService } from "../src/notifications/notifications.service";
import type { WebhookPayloadDto } from "../src/payment/dto/webhook-payload.dto";
import { PaymentService } from "../src/payment/payment.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * HelloAsso payment notification (#39) on a real database: the REAL
 * NotificationsService (Firebase not configured, and this type is feed-only
 * anyway) behind PaymentService.handleOrderWebhook, the method the webhook
 * calls, fed with orders that pass the #381 checks.
 * Also proves CLUB_PAYMENT_RECEIVED exists in the migrated Postgres enum.
 */
describe("HelloAsso payment notification (integration, real DB)", () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let payments: PaymentService;
  let notifications: NotificationsService;

  const userIds: string[] = [];
  const clubIds: string[] = [];
  const competitionIds: string[] = [];

  const createUser = async (
    role: UserRole,
    club?: { id: string; name: string },
  ) => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Payment",
        role,
        clubId: club?.id,
        clubName: club?.name,
      },
      select: { id: true },
    });
    userIds.push(user.id);
    return user;
  };

  const createClub = async () => {
    const club = await prisma.club.create({
      data: { name: `Club Paiement ${randomUUID()}` },
      select: { id: true, name: true },
    });
    clubIds.push(club.id);
    return club;
  };

  const AMOUNT_CENTS = 1500;
  const checkoutIntentId = 4242;

  /** A competition organised by `club`, and a PENDING booking on it. */
  const pendingBooking = async (club: { name: string }, payerId: string) => {
    const competition = await prisma.competition.create({
      data: {
        title: "Open de test",
        date: new Date("2099-06-01T00:00:00Z"),
        location: "Lyon",
        organizer: club.name,
      },
      select: { id: true },
    });
    competitionIds.push(competition.id);
    return prisma.seatBooking.create({
      data: {
        competitionId: competition.id,
        userId: payerId,
        itemId: "item-1",
        seatLabel: "Rang A, Place 5",
        status: BookingStatus.PENDING,
        paymentId: String(checkoutIntentId),
        expectedAmountCents: AMOUNT_CENTS,
      },
      select: { id: true, competitionId: true },
    });
  };

  /** A signed-and-valid HelloAsso `Order` paying `booking` in full. */
  const paidOrder = (booking: {
    id: string;
    competitionId: string;
  }): WebhookPayloadDto => ({
    eventType: "Order",
    metadata: { bookingId: booking.id, competitionId: booking.competitionId },
    data: {
      id: 98765,
      checkoutIntentId,
      payments: [{ id: 1, amount: AMOUNT_CENTS, state: "Authorized" }],
    },
  });

  const paymentRows = (userId: string) =>
    prisma.notification.findMany({
      where: { userId, type: NotificationType.CLUB_PAYMENT_RECEIVED },
      select: { title: true, body: true, data: true },
      take: 10,
    });

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule({
      extra: (builder) =>
        builder
          // The shared builder mocks notifications; this suite needs the
          // real feed writes.
          .overrideProvider(NotificationsService)
          .useClass(NotificationsService),
    }));
    payments = module.get(PaymentService);
    notifications = module.get(NotificationsService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    // Cascades to the bookings.
    await prisma.competition.deleteMany({
      where: { id: { in: competitionIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: { in: clubIds } } });
    userIds.length = 0;
    clubIds.length = 0;
    competitionIds.length = 0;
  });

  afterAll(async () => {
    await module.close();
  });

  it("notifies the organizer club's managers once, even when the webhook is replayed", async () => {
    const club = await createClub();
    const otherClub = await createClub();
    const manager = await createUser(UserRole.CLUB, club);
    const otherManager = await createUser(UserRole.CLUB, otherClub);
    const member = await createUser(UserRole.LICENSEE, club);
    const booking = await pendingBooking(club, member.id);

    await payments.handleOrderWebhook(paidOrder(booking));
    await payments.handleOrderWebhook(paidOrder(booking)); // HelloAsso replay

    const rows = await paymentRows(manager.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      title: "Paiement HelloAsso reçu",
      body: "Un paiement a été reçu pour « Open de test » (Rang A, Place 5).",
      data: expect.objectContaining({
        type: "CLUB_PAYMENT_RECEIVED",
        bookingId: booking.id,
      }) as unknown,
    });
    // Only that club, and only its managers.
    expect(await paymentRows(otherManager.id)).toHaveLength(0);
    expect(await paymentRows(member.id)).toHaveLength(0);
    expect(
      await prisma.seatBooking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.CONFIRMED });
  });

  it("never resurrects a cancelled booking nor notifies, and does not throw", async () => {
    const club = await createClub();
    const manager = await createUser(UserRole.CLUB, club);
    const member = await createUser(UserRole.LICENSEE, club);
    const booking = await pendingBooking(club, member.id);
    await prisma.seatBooking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED },
      select: { id: true },
    });

    await expect(
      payments.handleOrderWebhook(paidOrder(booking)),
    ).resolves.toBeUndefined();

    expect(
      await prisma.seatBooking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.CANCELLED });
    expect(await paymentRows(manager.id)).toHaveLength(0);
  });

  it("answers without throwing for an unknown booking", async () => {
    await expect(
      payments.handleOrderWebhook(
        paidOrder({ id: randomUUID(), competitionId: randomUUID() }),
      ),
    ).resolves.toBeUndefined();
  });

  it("confirms the payment even when the notification write fails", async () => {
    const club = await createClub();
    await createUser(UserRole.CLUB, club);
    const member = await createUser(UserRole.LICENSEE, club);
    const booking = await pendingBooking(club, member.id);
    jest
      .spyOn(notifications, "createManyForUsers")
      .mockRejectedValue(new Error("feed down"));

    await expect(
      payments.handleOrderWebhook(paidOrder(booking)),
    ).resolves.toBeUndefined();

    expect(
      await prisma.seatBooking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      }),
    ).toEqual({ status: BookingStatus.CONFIRMED });
  });
});
