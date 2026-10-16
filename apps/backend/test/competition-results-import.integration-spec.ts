import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { TestingModule } from "@nestjs/testing";
import { NotificationType, UserRole } from "@prisma/client";
import { CareerService } from "../src/career/career.service";
import { RESULTS_KIND } from "../src/competitions/services/competition-event-notification.service";
import {
  CompetitionResultsImportService,
  UNLINKED_RESULT_USER_ID,
} from "../src/competitions/services/competition-results-import.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { DELETED_USER_ID } from "../src/users/account-deletion.core";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #652: results import → palmarès → « Résultats disponibles », on a real
 * database (unique index of the idempotence, JSON details, notification
 * guard read from the Notification table).
 */
describe("Competition results import (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let importService: CompetitionResultsImportService;
  let careerService: CareerService;

  const suffix = randomUUID().slice(0, 8);
  const licenceBravo = `IMP${suffix}B`;
  let competitionId: string;
  let eventId: string;
  let bravoId: string;
  let echoId: string;
  const sendToUsers = jest.fn();

  const csv = () =>
    readFileSync(
      join(__dirname, "fixtures/results-import/finale-latines.csv"),
      "utf8",
    )
      .split("ev-latin")
      .join(eventId)
      .split("100002")
      .join(licenceBravo);

  beforeAll(async () => {
    const built = await buildServiceModule({
      redis: true,
      extra: (builder) =>
        builder.overrideProvider(NotificationsService).useValue({
          createManyForUsers: jest.fn(),
          sendToUser: jest.fn(),
          // Writes the feed rows like the real service, so the « already
          // notified » guard reads real data.
          sendToUsers: sendToUsers.mockImplementation(
            async (
              userIds: readonly string[],
              type: NotificationType,
              title: string,
              body: string,
              data?: Record<string, string>,
            ) => {
              await prisma.notification.createMany({
                data: userIds.map((userId) => ({
                  userId,
                  type,
                  title,
                  body,
                  data,
                })),
              });
              return {
                recipients: userIds.length,
                sent: 0,
                failed: 0,
                pruned: 0,
              };
            },
          ),
        }),
    });
    moduleRef = built.module;
    prisma = built.prisma;
    importService = moduleRef.get(CompetitionResultsImportService);
    careerService = moduleRef.get(CareerService);

    const [bravo, echo] = await Promise.all(
      ["Bravo", "Echo"].map((firstName) =>
        prisma.user.create({
          data: {
            email: `results-import-${firstName}-${suffix}@test.local`,
            password: "x",
            firstName,
            lastName: `Import${suffix}`,
            role: UserRole.LICENSEE,
          },
        }),
      ),
    );
    bravoId = bravo.id;
    echoId = echo.id;
    await prisma.license.create({
      data: {
        number: licenceBravo,
        validUntil: new Date("2030-08-31"),
        category: "Compétiteur",
        clubName: "Club Fictif A",
        userId: bravoId,
      },
    });

    const competition = await prisma.competition.create({
      data: {
        title: `Import résultats ${suffix}`,
        date: new Date("2026-09-20"),
        location: "Lyon",
        status: "PAST",
      },
    });
    competitionId = competition.id;
    const event = await prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
      },
    });
    eventId = event.id;
    // Echo registered in the app with bib 31: linked through the bib.
    await prisma.registration.create({
      data: {
        eventId,
        userId: echoId,
        status: "CONFIRMED",
        bibNumber: 31,
      },
    });
  });

  afterAll(async () => {
    const userIds = [bravoId, echoId];
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.result.deleteMany({ where: { eventId } });
    await prisma.registration.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { competitionId } });
    await prisma.competition.deleteMany({ where: { id: competitionId } });
    await prisma.license.deleteMany({ where: { number: licenceBravo } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await moduleRef.close();
  });

  it("imports, fills the palmarès of a licensee who never registered in the app, and notifies once", async () => {
    const report = await importService.importCsv(competitionId, csv());
    expect(report).toEqual({
      created: 4,
      updated: 0,
      unchanged: 0,
      anonymisedKept: 0,
      linked: 2,
      unlinked: 2,
    });

    const rows = await prisma.result.findMany({
      where: { eventId },
      select: { userId: true, ranking: true, round: true, importKey: true },
      orderBy: [{ round: "asc" }, { ranking: "asc" }],
      take: 10,
    });
    expect(rows.map((r) => r.userId)).toEqual([
      UNLINKED_RESULT_USER_ID, // 1/2 finale, Golf / Hotel
      bravoId,
      UNLINKED_RESULT_USER_ID,
      echoId,
    ]);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.importKey ?? ""))).toBe(
      true,
    );

    // Bravo has no registration: the result is linked by licence.
    const career = await careerService.getMyCareer(bravoId);
    expect(career.registrations).toEqual([]);
    expect(career.results).toHaveLength(1);
    expect(career.results[0]).toMatchObject({
      ranking: 1,
      round: "Finale",
      totalParticipants: 6,
      participantLabel: "Alpha / Bravo",
      competition: { id: competitionId },
    });

    expect(sendToUsers).toHaveBeenCalledTimes(1);
    expect([...sendToUsers.mock.calls[0][0]].sort()).toEqual(
      [bravoId, echoId].sort(),
    );
    expect(sendToUsers.mock.calls[0][4]).toEqual({
      competitionId,
      kind: RESULTS_KIND,
    });
  });

  it("re-running the same file duplicates nothing and does not notify again", async () => {
    const report = await importService.importCsv(competitionId, csv());

    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(await prisma.result.count({ where: { eventId } })).toBe(4);
    expect(sendToUsers).toHaveBeenCalledTimes(1);
  });

  it("applies a corrected ranking in place and leaves an anonymised row untouched", async () => {
    // Echo deletes their account: the row is tombstoned (#382).
    await prisma.result.updateMany({
      where: { eventId, userId: echoId },
      data: { userId: DELETED_USER_ID, details: { totalParticipants: 6 } },
    });
    const corrected = csv().replace(
      "Finale;1;Alpha / Bravo",
      "Finale;2;Alpha / Bravo",
    );

    const report = await importService.importCsv(competitionId, corrected);

    expect(report).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 2,
      anonymisedKept: 1,
    });
    const tombstone = await prisma.result.findFirst({
      where: { eventId, userId: DELETED_USER_ID },
      select: { details: true },
    });
    expect(tombstone?.details).toEqual({ totalParticipants: 6 });
    const bravo = await prisma.result.findFirst({
      where: { eventId, userId: bravoId },
      select: { ranking: true },
    });
    expect(bravo?.ranking).toBe(2);
    expect(await prisma.result.count({ where: { eventId } })).toBe(4);
  });
});
