import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import {
  NotificationType,
  PartnershipManagementMode,
  PartnershipStatus,
} from "@prisma/client";
import {
  clubMemberNotificationBody,
  coupleNotificationLabel,
} from "../src/notifications/member-name-copy";
import { PrismaService } from "../src/prisma/prisma.service";
import { AccountDeletionService } from "../src/users/account-deletion.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #423: after an account deletion, the notifications sent to OTHER users
 * (club organisers) no longer carry the person's name. They stay in the
 * recipient's feed, the name replaced by a neutral label; rows are found by
 * a structural link (registration, partnership, member ids), never by the
 * name. Fictitious names only.
 */
describe("Account deletion — names in other users' notifications (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let deletion: AccountDeletionService;
  const userIds: string[] = [];
  const clubIds: string[] = [];
  const competitionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    deletion = moduleRef.get(AccountDeletionService);
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.partnership.deleteMany({
      where: { clubId: { in: clubIds } },
    });
    const events = await prisma.event.findMany({
      where: { competitionId: { in: competitionIds } },
      select: { id: true },
      take: 100,
    });
    const eventIds = events.map((e) => e.id);
    await prisma.registration.deleteMany({
      where: { eventId: { in: eventIds } },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
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
    await moduleRef.close();
  });

  const user = async (firstName: string, lastName: string) => {
    const u = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName,
        lastName,
      },
    });
    userIds.push(u.id);
    return u;
  };

  const club = async () => {
    const c = await prisma.club.create({
      data: { name: `Club ${randomUUID()}` },
    });
    clubIds.push(c.id);
    return c;
  };

  const event = async () => {
    const competition = await prisma.competition.create({
      data: {
        title: "Open de Test",
        date: new Date("2027-03-15"),
        location: "Paris",
      },
    });
    competitionIds.push(competition.id);
    return prisma.event.create({
      data: {
        competitionId: competition.id,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
      },
    });
  };

  const notify = (
    recipientId: string,
    type: NotificationType,
    body: string,
    data: Record<string, string>,
  ) =>
    prisma.notification.create({
      data: { userId: recipientId, type, title: "Titre", body, data },
    });

  it("rewrites the organiser's registration notification and leaves another member's untouched", async () => {
    const alex = await user("Alex", "MARTIN");
    const sam = await user("Sam", "PETIT");
    const organiser = await user("Org", "ANISATEUR");
    const e = await event();
    const alexReg = await prisma.registration.create({
      data: { eventId: e.id, userId: alex.id, status: "CONFIRMED" },
    });
    const samReg = await prisma.registration.create({
      data: { eventId: e.id, userId: sam.id, status: "CONFIRMED" },
    });
    const body = (name: string) =>
      clubMemberNotificationBody(
        "club_member_auto_registered",
        name,
        "Open de Test",
        "Latines Adulte",
      );
    const alexNotif = await notify(
      organiser.id,
      NotificationType.CLUB_MEMBER_REGISTRATION,
      body("Alex MARTIN"),
      {
        type: "club_member_auto_registered",
        registrationId: alexReg.id,
      },
    );
    const samNotif = await notify(
      organiser.id,
      NotificationType.CLUB_MEMBER_REGISTRATION,
      body("Sam PETIT"),
      { type: "club_member_auto_registered", registrationId: samReg.id },
    );

    await deletion.deleteAccount(alex.id);

    const scrubbed = await prisma.notification.findUniqueOrThrow({
      where: { id: alexNotif.id },
    });
    expect(scrubbed.body).toBe(body("Membre supprimé"));
    expect(scrubbed.body).not.toContain("MARTIN");
    expect(scrubbed.userId).toBe(organiser.id);
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: samNotif.id },
        })
      ).body,
    ).toBe(body("Sam PETIT"));
  });

  it("scrubs both halves of a couple notification across the two deletions", async () => {
    const primary = await club();
    const secondary = await club();
    const alex = await user("Alex", "MARTIN");
    const sam = await user("Sam", "PETIT");
    const organiser = await user("Org", "ANISATEUR");
    const partnership = await prisma.partnership.create({
      data: {
        clubId: primary.id,
        secondaryClubId: secondary.id,
        user1Id: alex.id,
        user2Id: sam.id,
        startDate: new Date("2026-01-01"),
        status: PartnershipStatus.ACTIVE,
        managementMode: PartnershipManagementMode.BOTH,
      },
    });
    const label = coupleNotificationLabel(alex, sam);
    // Written as PartnershipService does since #423: with the member ids.
    const withIds = await notify(
      organiser.id,
      NotificationType.CLUB_PARTNERSHIP,
      `${label} : le couple inter-club a été clôturé par l'autre club.`,
      {
        type: "partnership_interclub_ended",
        partnershipId: partnership.id,
        member1UserId: alex.id,
        member2UserId: sam.id,
      },
    );
    // Written before #423: partnershipId only.
    const legacy = await notify(
      organiser.id,
      NotificationType.CLUB_PARTNERSHIP,
      `${label} : le club X a validé le couple inter-club.`,
      { type: "partnership_interclub_accepted", partnershipId: partnership.id },
    );

    await deletion.deleteAccount(alex.id);

    const afterFirst = await prisma.notification.findUniqueOrThrow({
      where: { id: withIds.id },
    });
    expect(afterFirst.body).toBe(
      "Partenaire supprimé & Sam PETIT : le couple inter-club a été clôturé par l'autre club.",
    );
    // The deleted user's id leaves the payload; the partner's stays.
    expect(afterFirst.data).toEqual({
      type: "partnership_interclub_ended",
      partnershipId: partnership.id,
      member2UserId: sam.id,
    });
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).body,
    ).toBe(
      "Partenaire supprimé & Sam PETIT : le club X a validé le couple inter-club.",
    );

    // The Partnership row went with Alex's account: Sam's half is found
    // through the member id only.
    expect(
      await prisma.partnership.findUnique({ where: { id: partnership.id } }),
    ).toBeNull();
    await deletion.deleteAccount(sam.id);

    const afterSecond = await prisma.notification.findUniqueOrThrow({
      where: { id: withIds.id },
    });
    expect(afterSecond.body).toBe(
      "Partenaire supprimé & Partenaire supprimé : le couple inter-club a été clôturé par l'autre club.",
    );
    expect(afterSecond.data).toEqual({
      type: "partnership_interclub_ended",
      partnershipId: partnership.id,
    });
    // Documented limit: a pre-#423 notification has no link left once the
    // partnership is gone, so the second member's name stays.
    expect(
      (
        await prisma.notification.findUniqueOrThrow({
          where: { id: legacy.id },
        })
      ).body,
    ).toContain("Sam PETIT");
  });
});
