/**
 * Organising club linked by id (#408), on a real database: the HelloAsso
 * credentials, the payment notification and the organiser rights resolve the
 * club through `Competition.organizerClubId`, so a club rename breaks nothing
 * and two clubs whose names only differ by case are never confused. Also runs
 * the re-runnable backfill against real rows.
 */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { TestingModule } from "@nestjs/testing";
import { BookingStatus, UserRole } from "@prisma/client";
import { backfillCompetitionOrganizerClub } from "../scripts/backfill-competition-organizer-club.utils";
import { AdminClubsService } from "../src/admin/admin-clubs.service";
import { ClubsHelloAssoService } from "../src/clubs/clubs-helloasso.service";
import { PaginationParamsDto } from "../src/common/dto/pagination-params.dto";
import { CompetitionAccessService } from "../src/competitions/services/competition-access.service";
import { CompetitionManagementService } from "../src/competitions/services/competition-management.service";
import { CompetitionQueryService } from "../src/competitions/services/competition-query.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PaymentNotificationService } from "../src/payment/payment-notification.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

describe("Competition organising club by id (#408, integration, real DB)", () => {
  const suffix = `org-club-${Date.now()}`;
  let module: TestingModule;
  let prisma: PrismaService;
  let f: ReturnType<typeof createFactories>;
  let helloAsso: ClubsHelloAssoService;
  let paymentNotification: PaymentNotificationService;
  let notifications: { createManyForUsers: jest.Mock };
  let access: CompetitionAccessService;
  let management: CompetitionManagementService;
  let query: CompetitionQueryService;
  let adminClubs: AdminClubsService;

  const credentials = (slug: string) => ({
    helloAssoClientId: `id-${slug}`,
    helloAssoClientSecret: `secret-${slug}`,
    helloAssoOrgSlug: slug,
  });

  const clubActor = (userId: string) => ({
    userId,
    role: UserRole.CLUB,
    roles: [UserRole.CLUB],
  });

  const booking = async (competitionId: string, userId: string) =>
    prisma.seatBooking.create({
      data: {
        competitionId,
        userId,
        itemId: "item-1",
        seatLabel: "Rang A, Place 1",
        status: BookingStatus.CONFIRMED,
      },
      select: { id: true },
    });

  beforeAll(async () => {
    // Redis mocked: the competition list is never served from cache.
    ({ module, prisma } = await buildServiceModule({ redis: true }));
    f = createFactories(prisma, suffix);
    helloAsso = module.get(ClubsHelloAssoService);
    paymentNotification = module.get(PaymentNotificationService);
    // The shared builder replaces NotificationsService with jest mocks.
    notifications = module.get<{ createManyForUsers: jest.Mock }>(
      NotificationsService,
    );
    access = module.get(CompetitionAccessService);
    management = module.get(CompetitionManagementService);
    query = module.get(CompetitionQueryService);
    adminClubs = module.get(AdminClubsService);
  });

  beforeEach(() => {
    notifications.createManyForUsers.mockClear();
  });

  afterAll(async () => {
    await prisma.seatBooking.deleteMany({
      where: { competition: { title: { contains: suffix } } },
    });
    await f.cleanup();
    await module.close();
  });

  it("stamps organizerClubId on a competition created by a CLUB account", async () => {
    const club = await f.club({ name: `Club Créateur ${suffix}` });
    const { user } = await f.user(UserRole.CLUB, {
      clubId: club.id,
      clubName: club.name,
    });

    const organizer = await access.organizerForNewCompetition(
      clubActor(user.id),
    );
    const created = await management.create(
      { title: `Créée ${suffix}`, date: "2099-06-01", location: "Lyon" },
      organizer,
    );

    expect(created).toMatchObject({
      organizer: club.name,
      organizerClubId: club.id,
    });
  });

  it("keeps payment credentials, notification and rights after a club rename", async () => {
    const club = await f.club({
      name: `Club Renommé ${suffix}`,
      ...credentials("renomme"),
    });
    const { user: manager } = await f.user(UserRole.CLUB, {
      clubId: club.id,
      clubName: club.name,
    });
    const { user: admin } = await f.user(UserRole.ADMIN);
    const competition = await f.competition({
      title: `Compétition renommage ${suffix}`,
      organizer: club.name,
      organizerClubId: club.id,
    });
    const paid = await booking(competition.id, manager.id);
    // Still unlinked, labelled with the (unambiguous) old name.
    const unlinked = await f.competition({
      title: `Compétition non reliée ${suffix}`,
      organizer: club.name.toUpperCase(),
    });

    await adminClubs.update(admin.id, club.id, {
      name: `Club Nouveau Nom ${suffix}`,
    });
    // The rename relabels the unlinked row and links it explicitly.
    expect(
      await prisma.competition.findUniqueOrThrow({
        where: { id: unlinked.id },
        select: { organizer: true, organizerClubId: true },
      }),
    ).toEqual({
      organizer: `Club Nouveau Nom ${suffix}`,
      organizerClubId: club.id,
    });
    // The label follows the rename (display only)…
    expect(
      await prisma.competition.findUniqueOrThrow({
        where: { id: competition.id },
        select: { organizer: true, organizerClubId: true },
      }),
    ).toEqual({
      organizer: `Club Nouveau Nom ${suffix}`,
      organizerClubId: club.id,
    });
    // …and even a label left stale elsewhere changes nothing.
    await prisma.competition.update({
      where: { id: competition.id },
      data: { organizer: "Nom périmé" },
      select: { id: true },
    });

    await expect(
      helloAsso.getHelloAssoCredentialsForCompetition(competition.id),
    ).resolves.toEqual({
      clientId: "id-renomme",
      clientSecret: "secret-renomme",
      organizationSlug: "renomme",
    });

    await paymentNotification.notifyPaymentReceived(paid.id);
    expect(notifications.createManyForUsers).toHaveBeenCalledWith(
      [manager.id],
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ bookingId: paid.id }),
    );

    await expect(
      access.assertCanManageCompetition(competition.id, clubActor(manager.id)),
    ).resolves.toBeUndefined();
  });

  it("never confuses two clubs whose names only differ by case", async () => {
    const upper = await f.club({
      name: `Club Homonyme ${suffix}`,
      ...credentials("upper"),
    });
    const lower = await f.club({
      name: `club homonyme ${suffix}`,
      ...credentials("lower"),
    });
    const { user: upperManager } = await f.user(UserRole.CLUB, {
      clubId: upper.id,
      clubName: upper.name,
    });
    const { user: lowerManager } = await f.user(UserRole.CLUB, {
      clubId: lower.id,
      clubName: lower.name,
    });
    // Dated first so they sit on the first page of the public list.
    const ofUpper = await f.competition({
      title: `Compétition upper ${suffix}`,
      date: new Date("1900-01-01"),
      organizer: upper.name,
      organizerClubId: upper.id,
    });
    const ofLower = await f.competition({
      title: `Compétition lower ${suffix}`,
      date: new Date("1900-01-02"),
      organizer: lower.name,
      organizerClubId: lower.id,
    });
    const unlinked = await f.competition({
      title: `Compétition ambiguë ${suffix}`,
      date: new Date("1900-01-03"),
      organizer: upper.name,
    });

    await expect(
      helloAsso.getHelloAssoCredentialsForCompetition(ofUpper.id),
    ).resolves.toMatchObject({ organizationSlug: "upper" });
    await expect(
      helloAsso.getHelloAssoCredentialsForCompetition(ofLower.id),
    ).resolves.toMatchObject({ organizationSlug: "lower" });
    // Unlinked + ambiguous label: no club is guessed.
    await expect(
      helloAsso.getHelloAssoCredentialsForCompetition(unlinked.id),
    ).resolves.toBeNull();

    const paid = await booking(ofLower.id, lowerManager.id);
    await paymentNotification.notifyPaymentReceived(paid.id);
    expect(notifications.createManyForUsers).toHaveBeenCalledWith(
      [lowerManager.id],
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );

    await expect(
      access.assertCanManageCompetition(ofUpper.id, clubActor(lowerManager.id)),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      access.assertCanManageCompetition(ofUpper.id, clubActor(upperManager.id)),
    ).resolves.toBeUndefined();

    // List, flag and edit rights agree for each homonym: its own linked
    // competition only — the ambiguous unlinked row is nobody's.
    const page = Object.assign(new PaginationParamsDto(), {
      skip: 0,
      take: 100,
    });
    for (const [manager, own, other] of [
      [upperManager, ofUpper, ofLower],
      [lowerManager, ofLower, ofUpper],
    ] as const) {
      const listed = (await query.findOrganizedByClub(manager.id)).map(
        (c) => c.id,
      );
      expect(listed).toContain(own.id);
      expect(listed).not.toContain(other.id);
      expect(listed).not.toContain(unlinked.id);

      const all = (await query.findAll(manager.id, page)) as {
        data: { id: string; isOrganizedByMyClub?: boolean }[];
      };
      const flag = (id: string) =>
        all.data.find((c) => c.id === id)?.isOrganizedByMyClub;
      expect([flag(own.id), flag(other.id), flag(unlinked.id)]).toEqual([
        true,
        false,
        false,
      ]);

      await expect(
        access.assertCanManageCompetition(own.id, clubActor(manager.id)),
      ).resolves.toBeUndefined();
      await expect(
        access.assertCanManageCompetition(unlinked.id, clubActor(manager.id)),
      ).rejects.toThrow(ForbiddenException);
    }

    // Renaming a homonym is refused while the ambiguous unlinked row exists:
    // it would otherwise silently fall to the other homonym.
    const { user: admin } = await f.user(UserRole.ADMIN);
    const refused = await adminClubs
      .update(admin.id, upper.id, { name: `Club Homonyme Renommé ${suffix}` })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toEqual(
      expect.objectContaining({ competitionIds: [unlinked.id] }),
    );
    expect(
      await prisma.club.findUniqueOrThrow({
        where: { id: upper.id },
        select: { name: true },
      }),
    ).toEqual({ name: `Club Homonyme ${suffix}` });

    // Once an admin links that row to its club, the rename goes through and
    // leaves the other homonym's competition alone.
    await prisma.competition.update({
      where: { id: unlinked.id },
      data: { organizerClubId: lower.id },
      select: { id: true },
    });
    await adminClubs.update(admin.id, upper.id, {
      name: `Club Homonyme Renommé ${suffix}`,
    });
    expect(
      await prisma.competition.findUniqueOrThrow({
        where: { id: unlinked.id },
        select: { organizer: true, organizerClubId: true },
      }),
    ).toEqual({
      organizer: `Club Homonyme ${suffix}`,
      organizerClubId: lower.id,
    });
    // Its own linked competition follows the rename.
    expect(
      await prisma.competition.findUniqueOrThrow({
        where: { id: ofUpper.id },
        select: { organizer: true },
      }),
    ).toEqual({ organizer: `Club Homonyme Renommé ${suffix}` });
  });

  describe("linked competitions are matched on ids only (#625)", () => {
    it("refuses a legacy account (no clubId) whose name is the label of another club's competition", async () => {
      const owner = await f.club({ name: `Club Alpha ${suffix}` });
      const other = await f.club({ name: `Club Beta ${suffix}` });
      // Stale label: it names Beta, but the row is linked to Alpha.
      const competition = await f.competition({
        title: `Compétition Alpha ${suffix}`,
        organizer: other.name,
        organizerClubId: owner.id,
      });
      const { user: legacyBeta } = await f.user(UserRole.CLUB, {
        clubName: ` ${other.name.toUpperCase()} `,
      });
      const { user: legacyGhost } = await f.user(UserRole.CLUB, {
        clubName: `Club Fantôme ${suffix}`,
      });
      const ghostLabelled = await f.competition({
        title: `Compétition fantôme ${suffix}`,
        organizer: `Club Fantôme ${suffix}`,
        organizerClubId: owner.id,
      });

      for (const [user, comp] of [
        [legacyBeta, competition],
        [legacyGhost, ghostLabelled],
      ] as const) {
        await expect(
          access.assertCanManageCompetition(comp.id, clubActor(user.id)),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          access.assertCanManageCheckIn(comp.id, clubActor(user.id)),
        ).rejects.toThrow(ForbiddenException);
        expect(
          (await query.findOrganizedByClub(user.id)).map((c) => c.id),
        ).not.toContain(comp.id);
      }
    });

    it("grants a legacy account resolved to the one club its name designates", async () => {
      const club = await f.club({ name: `Club Gamma ${suffix}` });
      const competition = await f.competition({
        title: `Compétition Gamma ${suffix}`,
        organizer: "Ancien libellé",
        organizerClubId: club.id,
      });
      const { user: legacy } = await f.user(UserRole.CLUB, {
        clubName: `club gamma ${suffix}`,
      });

      await expect(
        access.assertCanManageCompetition(competition.id, clubActor(legacy.id)),
      ).resolves.toBeUndefined();
      expect(
        (await query.findOrganizedByClub(legacy.id)).map((c) => c.id),
      ).toContain(competition.id);
    });

    it("ignores a stale User.clubName of a linked account", async () => {
      const mine = await f.club({ name: `Club Delta ${suffix}` });
      const theirs = await f.club({ name: `Club Epsilon ${suffix}` });
      const { user: manager } = await f.user(UserRole.CLUB, {
        clubId: mine.id,
        // Copy left over from another club.
        clubName: theirs.name,
      });
      const ofTheirs = await f.competition({
        title: `Compétition Epsilon non reliée ${suffix}`,
        organizer: theirs.name,
      });

      await expect(
        access.assertCanManageCompetition(ofTheirs.id, clubActor(manager.id)),
      ).rejects.toThrow(ForbiddenException);
      expect(
        (await query.findOrganizedByClub(manager.id)).map((c) => c.id),
      ).not.toContain(ofTheirs.id);
    });
  });

  describe("club names are compared exactly, never as LIKE patterns (#625)", () => {
    it("does not let `_` or `%` in a name match another club", async () => {
      const target = await f.club({
        name: `ClubXWild ${suffix}`,
        ...credentials("wild"),
      });
      const competition = await f.competition({
        title: `Compétition Wild ${suffix}`,
        organizer: target.name,
        organizerClubId: target.id,
      });
      // Prisma renders `equals` + insensitive as ILIKE: unescaped, these
      // names would designate `target`.
      for (const pattern of [`Club_Wild ${suffix}`, `Club%Wild ${suffix}`]) {
        const { user } = await f.user(UserRole.CLUB, { clubName: pattern });
        await expect(
          access.assertCanManageCompetition(competition.id, clubActor(user.id)),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          access.organizerForNewCompetition(clubActor(user.id)),
        ).resolves.toEqual({ organizer: pattern, organizerClubId: null });
      }

      const unlinked = await f.competition({
        title: `Compétition joker ${suffix}`,
        organizer: `Club%${suffix}`,
      });
      await expect(
        helloAsso.getHelloAssoCredentialsForCompetition(unlinked.id),
      ).resolves.toBeNull();
    });

    it("still matches a club whose own name contains `_` or `%`", async () => {
      const club = await f.club({
        name: `Club_Réel 100% ${suffix}`,
        ...credentials("reel"),
      });
      const unlinked = await f.competition({
        title: `Compétition réelle ${suffix}`,
        organizer: `club_réel 100% ${suffix}`,
      });
      const { user: legacy } = await f.user(UserRole.CLUB, {
        clubName: club.name,
      });

      await expect(
        helloAsso.getHelloAssoCredentialsForCompetition(unlinked.id),
      ).resolves.toMatchObject({ organizationSlug: "reel" });
      await expect(
        access.assertCanManageCompetition(unlinked.id, clubActor(legacy.id)),
      ).resolves.toBeUndefined();
    });
  });

  it("backfills unlinked competitions, listing unmatched and ambiguous ones", async () => {
    const solo = await f.club({ name: `Club Seul ${suffix}` });
    await f.club({ name: `Club Double ${suffix}` });
    // Same name up to case (the suffix is lowercase on both).
    await f.club({ name: `CLUB DOUBLE ${suffix}` });
    const toLink = await f.competition({
      title: `Backfill seul ${suffix}`,
      organizer: `  club seul ${suffix} `,
    });
    const ambiguous = await f.competition({
      title: `Backfill double ${suffix}`,
      organizer: `Club Double ${suffix}`,
    });
    const unknown = await f.competition({
      title: `Backfill inconnu ${suffix}`,
      organizer: `Club Inconnu ${suffix}`,
    });

    const dry = await backfillCompetitionOrganizerClub(prisma, true);
    expect(
      (
        await prisma.competition.findUniqueOrThrow({
          where: { id: toLink.id },
          select: { organizerClubId: true },
        })
      ).organizerClubId,
    ).toBeNull();
    expect(dry.ambiguous.map((c) => c.id)).toContain(ambiguous.id);

    const report = await backfillCompetitionOrganizerClub(prisma, false);
    expect(report.unmatched.map((c) => c.id)).toContain(unknown.id);
    expect(report.ambiguous.map((c) => c.id)).toContain(ambiguous.id);
    const linked = await prisma.competition.findMany({
      where: { id: { in: [toLink.id, ambiguous.id, unknown.id] } },
      select: { id: true, organizerClubId: true },
      take: 3,
    });
    expect(
      Object.fromEntries(linked.map((c) => [c.id, c.organizerClubId])),
    ).toEqual({
      [toLink.id]: solo.id,
      [ambiguous.id]: null,
      [unknown.id]: null,
    });

    // Re-run: nothing left to link for these rows (idempotent).
    const again = await backfillCompetitionOrganizerClub(prisma, false);
    expect(again.unmatched.map((c) => c.id)).toContain(unknown.id);
    expect(
      [...again.unmatched, ...again.ambiguous].map((c) => c.id),
    ).not.toContain(toLink.id);
  });
});
