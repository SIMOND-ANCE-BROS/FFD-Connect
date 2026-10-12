import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { backfillRegistrationPartnerUsers } from "../scripts/backfill-registration-partner-user.utils";
import { PrismaService } from "../src/prisma/prisma.service";
import { AccountDeletionService } from "../src/users/account-deletion.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #395: after an account deletion, no copy of the person's NAME survives in
 * another user's rows that carry no id link — the partner's registration
 * created by the historical import (partnerName without partnerUserId) and
 * the couple's result attached to the partner. Fictitious names only.
 */
describe("Account deletion — partner name copies (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let deletion: AccountDeletionService;
  const userIds: string[] = [];
  const competitionIds: string[] = [];

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    deletion = moduleRef.get(AccountDeletionService);
  });

  afterEach(async () => {
    const events = await prisma.event.findMany({
      where: { competitionId: { in: competitionIds } },
      select: { id: true },
      take: 100,
    });
    const eventIds = events.map((e) => e.id);
    await prisma.result.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.registration.deleteMany({
      where: { eventId: { in: eventIds } },
    });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.competition.deleteMany({
      where: { id: { in: competitionIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
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

  const coupleEvent = async () => {
    const competition = await prisma.competition.create({
      data: {
        title: `Partner names ${randomUUID()}`,
        date: new Date("2024-03-15"),
        location: "Paris",
        status: "PAST",
      },
    });
    competitionIds.push(competition.id);
    return prisma.event.create({
      data: {
        competitionId: competition.id,
        category: "Latin",
        ageGroup: "Adult",
        eventType: "COUPLE",
      },
    });
  };

  /** What the compete import used to write: names only, no partnerUserId. */
  const legacyCouple = async () => {
    const sam = await user("Sam", "PETIT");
    const alex = await user("Alex", "MARTIN");
    const other = await user("Lou", "BLANC");
    const event = await coupleEvent();
    const samReg = await prisma.registration.create({
      data: {
        eventId: event.id,
        userId: sam.id,
        partnerName: "Alex MARTIN",
        bibNumber: 12,
        status: "CONFIRMED",
      },
    });
    const alexReg = await prisma.registration.create({
      data: {
        eventId: event.id,
        userId: alex.id,
        partnerName: "Sam PETIT",
        bibNumber: 12,
        status: "CONFIRMED",
      },
    });
    // Another couple of the same event, whose label must stay as is.
    const otherReg = await prisma.registration.create({
      data: {
        eventId: event.id,
        userId: other.id,
        partnerName: "Noa ROUX",
        bibNumber: 13,
        status: "CONFIRMED",
      },
    });
    const coupleResult = await prisma.result.create({
      data: {
        eventId: event.id,
        userId: sam.id,
        round: "Final",
        ranking: 2,
        details: { participant: "Sam PETIT / Alex MARTIN", bib: "12" },
      },
    });
    const otherResult = await prisma.result.create({
      data: {
        eventId: event.id,
        userId: other.id,
        round: "Final",
        ranking: 1,
        details: { participant: "Lou BLANC / Noa ROUX", bib: "13" },
      },
    });
    return {
      sam,
      alex,
      samReg,
      alexReg,
      otherReg,
      coupleResult,
      otherResult,
    };
  };

  it("scrubs the legacy partner registration and the partner's couple result, keeping the ranking", async () => {
    const c = await legacyCouple();

    await deletion.deleteAccount(c.alex.id);

    const samReg = await prisma.registration.findUniqueOrThrow({
      where: { id: c.samReg.id },
    });
    expect(samReg.partnerName).toBeNull();
    expect(samReg.partnerUserId).toBeNull();

    const result = await prisma.result.findUniqueOrThrow({
      where: { id: c.coupleResult.id },
    });
    expect(result.userId).toBe(c.sam.id);
    expect(result.ranking).toBe(2);
    expect(result.details).toEqual({
      participant: "Sam PETIT / Partenaire supprimé",
      bib: "12",
    });

    // The other couple of the event is untouched.
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: c.otherReg.id },
        })
      ).partnerName,
    ).toBe("Noa ROUX");
    expect(
      (
        await prisma.result.findUniqueOrThrow({
          where: { id: c.otherResult.id },
        })
      ).details,
    ).toEqual({ participant: "Lou BLANC / Noa ROUX", bib: "13" });
  });

  it("backfill links the couple (idempotent), then deletion scrubs through partnerUserId", async () => {
    const c = await legacyCouple();
    const prismaClient = prisma as unknown as PrismaClient;

    const dry = await backfillRegistrationPartnerUsers(prismaClient, true);
    expect(dry.linked).toBeGreaterThanOrEqual(2);
    expect(
      (
        await prisma.registration.findUniqueOrThrow({
          where: { id: c.samReg.id },
        })
      ).partnerUserId,
    ).toBeNull();

    await backfillRegistrationPartnerUsers(prismaClient, false);
    const linked = await prisma.registration.findMany({
      where: { id: { in: [c.samReg.id, c.alexReg.id, c.otherReg.id] } },
      select: { id: true, partnerUserId: true },
      take: 3,
    });
    const byId = new Map(linked.map((r) => [r.id, r.partnerUserId]));
    expect(byId.get(c.samReg.id)).toBe(c.alex.id);
    expect(byId.get(c.alexReg.id)).toBe(c.sam.id);
    // Partner not a user (no mirror registration): never linked by name.
    expect(byId.get(c.otherReg.id)).toBeNull();

    // Second run: the linked rows are no longer candidates.
    const again = await backfillRegistrationPartnerUsers(prismaClient, false);
    expect(
      await prisma.registration.count({
        where: { id: { in: [c.samReg.id, c.alexReg.id] }, partnerUserId: null },
      }),
    ).toBe(0);
    expect(again.linked).toBe(0);

    await deletion.deleteAccount(c.alex.id);

    const samReg = await prisma.registration.findUniqueOrThrow({
      where: { id: c.samReg.id },
    });
    expect(samReg).toMatchObject({ partnerName: null, partnerUserId: null });
    const result = await prisma.result.findUniqueOrThrow({
      where: { id: c.coupleResult.id },
    });
    expect(result.details).toMatchObject({
      participant: "Sam PETIT / Partenaire supprimé",
    });
  });
});
