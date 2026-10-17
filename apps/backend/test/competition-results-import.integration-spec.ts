import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { ConfigService } from "@nestjs/config";
import { TestingModule } from "@nestjs/testing";
import { NotificationType, UserRole } from "@prisma/client";
import { CareerService } from "../src/career/career.service";
import {
  CompetitionEventNotificationService,
  RESULTS_KIND,
  RESULTS_NOTIFICATION_GRACE_MS,
} from "../src/competitions/services/competition-event-notification.service";
import {
  CompetitionResultsImportService,
  UNLINKED_RESULT_USER_ID,
} from "../src/competitions/services/competition-results-import.service";
import { CompetitionAccessService } from "../src/competitions/services/competition-access.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { DELETED_USER_ID } from "../src/users/account-deletion.core";
import { AccountDeletionService } from "../src/users/account-deletion.service";
import {
  erasedLicenceFingerprint,
  resultsPseudonymisationKey,
} from "../src/utils/results-pseudonym";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #652: results import → palmarès → « Résultats disponibles » (after the
 * grace period, #713), then the
 * right to erasure, on a real database (unique index of the idempotence,
 * JSON details, reservation of the notification, real account deletion).
 * Outside production the import and the deletion share the development
 * pseudonymisation key.
 */
describe("Competition results import (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let importService: CompetitionResultsImportService;
  let careerService: CareerService;
  let accountDeletion: AccountDeletionService;
  let accessService: CompetitionAccessService;
  let notificationService: CompetitionEventNotificationService;
  /** An instant once the rows written now have passed the grace (#713). */
  const afterGrace = () =>
    new Date(Date.now() + RESULTS_NOTIFICATION_GRACE_MS + 60_000);

  const suffix = randomUUID().slice(0, 8);
  const lastName = `Imp${suffix}`;
  const licenceAlpha = `IMP${suffix}A`;
  const licenceBravo = `IMP${suffix}B`;
  let competitionId: string;
  let eventId: string;
  let staffId: string;
  let alphaId: string;
  let bravoId: string;
  let echoId: string;
  let clubAccountId: string;
  let clubId: string;
  const sendToUsers = jest.fn();
  const staff = () => ({
    userId: staffId,
    role: "STAFF",
    roles: [UserRole.STAFF],
  });
  const clubActor = () => ({
    userId: clubAccountId,
    role: "CLUB",
    roles: [UserRole.CLUB],
  });

  const csv = () =>
    readFileSync(
      join(__dirname, "fixtures/results-import/finale-latines.csv"),
      "utf8",
    )
      .split("ev-latin")
      .join(eventId)
      .replace("Alpha / Bravo", `Alpha ${lastName} / Bravo ${lastName}`)
      .replace("100001|100002", `${licenceAlpha}|${licenceBravo}`);

  const resultsOf = () =>
    prisma.result.findMany({
      where: { eventId },
      select: {
        userId: true,
        partnerUserId: true,
        ranking: true,
        round: true,
        importKey: true,
        details: true,
      },
      orderBy: [{ round: "asc" }, { ranking: "asc" }],
      take: 20,
    });

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
    accountDeletion = moduleRef.get(AccountDeletionService);
    accessService = moduleRef.get(CompetitionAccessService);
    notificationService = moduleRef.get(CompetitionEventNotificationService);

    const [staff, alpha, bravo, echo] = await Promise.all(
      (["Staff", "Alpha", "Bravo", "Echo"] as const).map((firstName) =>
        prisma.user.create({
          data: {
            email: `results-import-${firstName}-${suffix}@test.local`,
            password: "x",
            firstName,
            lastName,
            role: firstName === "Staff" ? UserRole.STAFF : UserRole.LICENSEE,
          },
        }),
      ),
    );
    staffId = staff.id;
    alphaId = alpha.id;
    bravoId = bravo.id;
    echoId = echo.id;
    for (const [number, userId] of [
      [licenceAlpha, alphaId],
      [licenceBravo, bravoId],
    ]) {
      await prisma.license.create({
        data: {
          number,
          validUntil: new Date("2030-08-31"),
          category: "Compétiteur",
          clubName: "Club Fictif A",
          userId,
        },
      });
    }

    // The organising club (#690) and its CLUB account.
    const club = await prisma.club.create({
      data: { name: `Club Import ${suffix}` },
    });
    clubId = club.id;
    const clubAccount = await prisma.user.create({
      data: {
        email: `results-import-club-${suffix}@test.local`,
        password: "x",
        firstName: "Club",
        lastName,
        role: UserRole.CLUB,
        clubId,
      },
    });
    clubAccountId = clubAccount.id;

    const competition = await prisma.competition.create({
      data: {
        title: `Import résultats ${suffix}`,
        organizer: club.name,
        organizerClubId: clubId,
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
    const userIds = [staffId, alphaId, bravoId, echoId, clubAccountId];
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { targetType: "COMPETITION", targetId: competitionId },
    });
    await prisma.result.deleteMany({ where: { eventId } });
    await prisma.registration.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { competitionId } });
    await prisma.competition.deleteMany({ where: { id: competitionId } });
    await prisma.license.deleteMany({
      where: { number: { in: [licenceAlpha, licenceBravo] } },
    });
    const key = resultsPseudonymisationKey(moduleRef.get(ConfigService));
    if (key) {
      await prisma.erasedResultIdentity.deleteMany({
        where: {
          fingerprint: {
            in: [licenceAlpha, licenceBravo].map((n) =>
              erasedLicenceFingerprint(key, n),
            ),
          },
        },
      });
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.club.deleteMany({ where: { id: clubId } });
    await moduleRef.close();
  });

  it("a dry run validates and counts without writing anything (#690)", async () => {
    const report = await importService.importCsv(
      competitionId,
      csv(),
      clubActor(),
      { dryRun: true },
    );
    expect(report).toMatchObject({ dryRun: true, created: 4, linked: null });
    expect(await prisma.result.count({ where: { eventId } })).toBe(0);
    expect(
      await prisma.adminAuditLog.count({
        where: { targetType: "COMPETITION", targetId: competitionId },
      }),
    ).toBe(0);
    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it("the organising club may manage the results, another club may not (#690)", async () => {
    await expect(
      accessService.assertCanManageResults(competitionId, clubActor()),
    ).resolves.toBeUndefined();
    const other = await prisma.competition.create({
      data: {
        title: `Autre ${suffix}`,
        date: new Date("2026-09-21"),
        location: "Lyon",
        organizer: "Un autre club",
      },
    });
    try {
      await expect(
        accessService.assertCanManageResults(other.id, clubActor()),
      ).rejects.toThrow("Réservé aux organisateurs");
    } finally {
      await prisma.competition.delete({ where: { id: other.id } });
    }
  });

  it("an import deleted within the grace period notifies nobody (#713)", async () => {
    const other = await prisma.competition.create({
      data: {
        title: `Import annulé ${suffix}`,
        date: new Date("2026-09-22"),
        location: "Lyon",
        status: "PAST",
      },
    });
    const otherEvent = await prisma.event.create({
      data: {
        competitionId: other.id,
        category: "Latin",
        ageGroup: "Adulte",
        eventType: "COUPLE",
      },
    });
    try {
      // Echo is registered: there would be someone to notify.
      await prisma.registration.create({
        data: { eventId: otherEvent.id, userId: echoId, status: "CONFIRMED" },
      });
      const imported = await importService.importCsv(
        other.id,
        csv().split(eventId).join(otherEvent.id),
        staff(),
      );
      expect(imported.created).toBe(4);
      const undone = await importService.deleteEventResults(
        other.id,
        otherEvent.id,
        staff(),
      );
      // STAFF is told the erased-row count (null for a club, #713).
      expect(undone).toEqual({ deleted: 4, anonymisedKept: 0 });

      await notificationService.notifyResultsPublished(other.id, afterGrace());

      expect(sendToUsers).not.toHaveBeenCalled();
      const after = await prisma.competition.findUnique({
        where: { id: other.id },
        select: { resultsNotifiedAt: true },
      });
      expect(after?.resultsNotifiedAt).toBeNull();
    } finally {
      await prisma.adminAuditLog.deleteMany({
        where: { targetType: "COMPETITION", targetId: other.id },
      });
      await prisma.result.deleteMany({ where: { eventId: otherEvent.id } });
      await prisma.registration.deleteMany({
        where: { eventId: otherEvent.id },
      });
      await prisma.event.delete({ where: { id: otherEvent.id } });
      await prisma.competition.delete({ where: { id: other.id } });
    }
  });

  it("imports, links both members of a couple, fills the palmarès of a licensee who never registered in the app, notifies once after the grace period and audits", async () => {
    const report = await importService.importCsv(competitionId, csv(), staff());
    expect(report).toEqual({
      dryRun: false,
      created: 4,
      updated: 0,
      unchanged: 0,
      relinked: 0,
      anonymisedKept: 0,
      linked: 2,
      unlinked: 2,
    });

    const rows = await resultsOf();
    expect(rows.map((r) => [r.userId, r.partnerUserId])).toEqual([
      [UNLINKED_RESULT_USER_ID, null], // 1/2 finale, Golf / Hotel
      [alphaId, bravoId],
      [UNLINKED_RESULT_USER_ID, null],
      [echoId, null],
    ]);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.importKey ?? ""))).toBe(
      true,
    );

    // Bravo has no registration and is the second member: still in the palmarès.
    const career = await careerService.getMyCareer(bravoId);
    expect(career.registrations).toEqual([]);
    expect(career.results).toHaveLength(1);
    expect(career.results[0]).toMatchObject({
      ranking: 1,
      round: "Finale",
      totalParticipants: 6,
      competition: { id: competitionId },
    });

    // Not at import time (#713): once the rows survived the grace period.
    expect(sendToUsers).not.toHaveBeenCalled();
    await notificationService.notifyResultsPublished(competitionId);
    expect(sendToUsers).not.toHaveBeenCalled();
    await notificationService.notifyResultsPublished(
      competitionId,
      afterGrace(),
    );
    expect(sendToUsers).toHaveBeenCalledTimes(1);
    expect([...sendToUsers.mock.calls[0][0]].sort()).toEqual(
      [alphaId, bravoId, echoId].sort(),
    );
    expect(sendToUsers.mock.calls[0][4]).toEqual({
      competitionId,
      kind: RESULTS_KIND,
    });
    const competition = await prisma.competition.findUnique({
      where: { id: competitionId },
      select: { resultsNotifiedAt: true },
    });
    expect(competition?.resultsNotifiedAt).toBeInstanceOf(Date);

    const audit = await prisma.adminAuditLog.findMany({
      where: { targetType: "COMPETITION", targetId: competitionId },
      select: { actorId: true, action: true, after: true },
      take: 5,
    });
    const { dryRun: _dryRun, ...counts } = report;
    expect(audit).toEqual([
      {
        actorId: staffId,
        action: "COMPETITION_RESULTS_IMPORT",
        after: { ...counts, actorRole: "STAFF" },
      },
    ]);
  });

  it("re-running the same file duplicates nothing and does not notify again", async () => {
    const report = await importService.importCsv(competitionId, csv(), staff());

    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(await prisma.result.count({ where: { eventId } })).toBe(4);
    expect(sendToUsers).toHaveBeenCalledTimes(1);
  });

  it("a deleted second member gets « Partenaire supprimé », loses the link, and is never re-published (M1, M2)", async () => {
    await accountDeletion.deleteAccount(bravoId);

    const [, alphaRow] = await resultsOf();
    expect(alphaRow).toMatchObject({
      userId: alphaId,
      partnerUserId: null,
      details: expect.objectContaining({
        participant: `Alpha ${lastName} / Partenaire supprimé`,
      }),
    });
    // Only a fingerprint of the licence survives the account.
    const key = resultsPseudonymisationKey(moduleRef.get(ConfigService));
    expect(key).not.toBeNull();
    expect(
      await prisma.erasedResultIdentity.count({
        where: {
          fingerprint: erasedLicenceFingerprint(key ?? "", licenceBravo),
        },
      }),
    ).toBe(1);

    // Re-import of the same published ranking: the scrub stays.
    const report = await importService.importCsv(competitionId, csv(), staff());
    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    const [, again] = await resultsOf();
    expect(JSON.stringify(again.details)).not.toContain(`Bravo ${lastName}`);

    // A new line carrying the deleted licence is written anonymised.
    const quarter = await importService.importCsv(
      competitionId,
      `epreuve;tour;classement;couple;licences\n${eventId};1/4 finale;2;Bravo ${lastName} / Zulu;${licenceBravo}\n`,
      staff(),
    );
    expect(quarter).toMatchObject({ created: 1, anonymisedKept: 1 });
    const anonymised = await prisma.result.findFirst({
      where: { eventId, round: "1/4 finale" },
      select: { userId: true, details: true },
    });
    expect(anonymised).toEqual({ userId: DELETED_USER_ID, details: {} });
  });

  it("an anonymised couple is not recreated under another key: same round (normalised) and rank (M2)", async () => {
    await accountDeletion.deleteAccount(echoId);
    const before = await prisma.result.count({ where: { eventId } });

    // Label corrected and bib dropped: a different import key.
    const corrected = csv()
      .replace(
        "Finale;3;Echo / Foxtrot;31;",
        "FINALE;3;Echo / Foxtrot (corrigé);;",
      )
      .replace("Finale;1;Alpha", "Finale;2;Alpha");

    const report = await importService.importCsv(
      competitionId,
      corrected,
      staff(),
    );

    expect(report).toMatchObject({ created: 0, updated: 1, anonymisedKept: 1 });
    expect(await prisma.result.count({ where: { eventId } })).toBe(before);
    const tombstone = await prisma.result.findFirst({
      where: { eventId, userId: DELETED_USER_ID, ranking: 3 },
      select: { details: true },
    });
    expect(JSON.stringify(tombstone?.details)).not.toContain("Echo");
    expect(sendToUsers).toHaveBeenCalledTimes(1);
  });
  it("deleting the event's results keeps the erased rows, audits the club, and a re-import by event name restores the rest (#690)", async () => {
    const before = await resultsOf();
    const erased = before.filter(
      (r) =>
        r.userId === DELETED_USER_ID ||
        JSON.stringify(r.details).includes("Partenaire supprimé"),
    );
    expect(erased.length).toBeGreaterThan(0);

    const report = await importService.deleteEventResults(
      competitionId,
      eventId,
      clubActor(),
    );
    // The club is not told how many erased rows stay (#713)…
    expect(report).toEqual({
      deleted: before.length - erased.length,
      anonymisedKept: null,
    });
    const kept = await resultsOf();
    expect(kept).toHaveLength(erased.length);
    expect(
      kept.every(
        (r) =>
          r.userId === DELETED_USER_ID ||
          JSON.stringify(r.details).includes("Partenaire supprimé"),
      ),
    ).toBe(true);

    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        targetId: competitionId,
        action: "COMPETITION_RESULTS_DELETE",
      },
      select: { actorId: true, after: true },
    });
    // …the audit trail keeps the count.
    expect(audit).toEqual({
      actorId: clubAccountId,
      after: {
        eventId,
        candidates: before.length - erased.length,
        anonymisedKept: erased.length,
        actorRole: "CLUB",
      },
    });

    // The `epreuve` column names the event instead of its id.
    const byName = csv().split(eventId).join("Latines Adulte");
    const again = await importService.importCsv(
      competitionId,
      byName,
      clubActor(),
    );
    expect(again.created).toBeGreaterThan(0);
    const after = await resultsOf();
    // Erased couples are still never recreated with their names.
    expect(JSON.stringify(after)).not.toContain(`Bravo ${lastName}`);
    expect(JSON.stringify(after)).not.toContain("Echo /");
    // Notified once per competition, re-import included.
    await notificationService.notifyResultsPublished(
      competitionId,
      afterGrace(),
    );
    expect(sendToUsers).toHaveBeenCalledTimes(1);
  });
});
