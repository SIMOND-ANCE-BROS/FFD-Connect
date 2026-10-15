/**
 * Payment connector per organising club (#388), on a real database: the
 * additive migration defaults every club and booking to HELLOASSO, the
 * club's choice is read through the organising club id (#408), and neither
 * the club API nor the back-office ever returns a credential.
 */
import { TestingModule } from "@nestjs/testing";
import { BookingStatus, PaymentProvider, UserRole } from "@prisma/client";
import { AdminClubsQueryService } from "../src/admin/admin-clubs.query-service";
import { AdminClubsService } from "../src/admin/admin-clubs.service";
import { ClubPaymentProviderQueryService } from "../src/clubs/club-payment-provider.query-service";
import { ClubPaymentProviderService } from "../src/clubs/club-payment-provider.service";
import { HelloAssoPaymentConnector } from "../src/payment/connectors/helloasso-payment.connector";
import { PaymentConnectorRegistry } from "../src/payment/connectors/payment-connector.registry";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

describe("Payment connector per club (#388, integration, real DB)", () => {
  const suffix = `pay-connector-${Date.now()}`;
  const SECRET = `secret-${suffix}`;
  let module: TestingModule;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let registry: PaymentConnectorRegistry;
  let clubQuery: ClubPaymentProviderQueryService;
  let clubWriter: ClubPaymentProviderService;
  let adminQuery: AdminClubsQueryService;
  let adminClubs: AdminClubsService;

  beforeAll(async () => {
    ({ module, prisma } = await buildServiceModule());
    f = createFactories(prisma, suffix);
    registry = module.get(PaymentConnectorRegistry);
    clubQuery = module.get(ClubPaymentProviderQueryService);
    clubWriter = module.get(ClubPaymentProviderService);
    adminQuery = module.get(AdminClubsQueryService);
    adminClubs = module.get(AdminClubsService);
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({
      where: { competition: { title: { contains: suffix } } },
    });
    await f.cleanup();
    await module.close();
  });

  it("defaults a new club and a new booking to HELLOASSO (column DEFAULT)", async () => {
    const club = await f.club({ name: `Club Défaut ${suffix}` });
    const { user } = await f.user(UserRole.LICENSEE);
    const competition = await f.competition({
      title: `Compétition défaut ${suffix}`,
      organizer: club.name,
      organizerClubId: club.id,
    });
    const booking = await prisma.seatBooking.create({
      data: {
        competitionId: competition.id,
        userId: user.id,
        itemId: "item-1",
        status: BookingStatus.PENDING,
      },
      select: { paymentProvider: true },
    });

    expect(
      await prisma.club.findUniqueOrThrow({
        where: { id: club.id },
        select: { paymentProvider: true },
      }),
    ).toEqual({ paymentProvider: PaymentProvider.HELLOASSO });
    expect(booking).toEqual({ paymentProvider: PaymentProvider.HELLOASSO });
  });

  it("routes a competition to its organising club's connector, NULL read as HelloAsso", async () => {
    const club = await f.club({ name: `Club Routage ${suffix}` });
    await prisma.club.update({
      where: { id: club.id },
      data: { paymentProvider: null },
      select: { id: true },
    });
    const competition = await f.competition({
      title: `Compétition routage ${suffix}`,
      organizer: club.name,
      organizerClubId: club.id,
    });

    const connector = await registry.forCompetition(competition.id);

    expect(connector).toBe(module.get(HelloAssoPaymentConnector));
    await expect(
      registry.forCompetition("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBe(connector);
  });

  it("lets the organiser choose its connector and never returns a credential", async () => {
    const club = await f.club({
      name: `Club Choix ${suffix}`,
      helloAssoClientId: `id-${suffix}`,
      helloAssoClientSecret: SECRET,
      helloAssoOrgSlug: `slug-${suffix}`,
    });
    const { user } = await f.user(UserRole.CLUB, {
      clubId: club.id,
      clubName: club.name,
    });
    await prisma.club.update({
      where: { id: club.id },
      data: { paymentProvider: null },
      select: { id: true },
    });

    const before = await clubQuery.getMyClubPaymentProvider(user.id);
    const after = await clubWriter.setMyClubPaymentProvider(user.id, {
      paymentProvider: PaymentProvider.HELLOASSO,
    });

    const expected = {
      clubName: club.name,
      paymentProvider: PaymentProvider.HELLOASSO,
      configured: true,
      selectableProviders: [PaymentProvider.HELLOASSO],
    };
    expect(before).toEqual(expected);
    expect(after).toEqual(expected);
    expect(JSON.stringify([before, after])).not.toContain(SECRET);
    const stored = await prisma.club.findUniqueOrThrow({
      where: { id: club.id },
      select: {
        paymentProvider: true,
        helloAssoClientSecret: true,
        helloAssoOrgSlug: true,
      },
    });
    // The choice is stored; the credentials are left as they were.
    expect(stored).toEqual({
      paymentProvider: PaymentProvider.HELLOASSO,
      helloAssoClientSecret: SECRET,
      helloAssoOrgSlug: `slug-${suffix}`,
    });
  });

  it("shows and sets the connector from the back-office, audited, without the secret", async () => {
    const club = await f.club({
      name: `Club Back-office ${suffix}`,
      helloAssoClientSecret: SECRET,
    });
    const { user: admin } = await f.user(UserRole.ADMIN);
    await prisma.club.update({
      where: { id: club.id },
      data: { paymentProvider: null },
      select: { id: true },
    });

    const detail = await adminQuery.detail(club.id);
    expect(detail.paymentProvider).toBe(PaymentProvider.HELLOASSO);
    expect(JSON.stringify(detail)).not.toContain(SECRET);

    await adminClubs.update(admin.id, club.id, {
      paymentProvider: PaymentProvider.HELLOASSO,
    });
    expect(
      await prisma.club.findUniqueOrThrow({
        where: { id: club.id },
        select: { paymentProvider: true },
      }),
    ).toEqual({ paymentProvider: PaymentProvider.HELLOASSO });
    const audit = await prisma.adminAuditLog.findFirst({
      where: { targetId: club.id, actorId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit)).toContain("paymentProvider");
    expect(JSON.stringify(audit)).not.toContain(SECRET);
  });
});
