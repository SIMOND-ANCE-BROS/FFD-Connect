import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { withActiveRole } from "../../auth/roles";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CompetitionEventNotificationService,
  CompetitionWithEvents,
  MAX_PENDING_RESULTS_COMPETITIONS,
  NEW_COMPETITION_KIND,
  PENDING_RESULTS_WINDOW_MS,
  RESULTS_KIND,
  RESULTS_NOTIFICATION_GRACE_MS,
} from "./competition-event-notification.service";

describe("CompetitionEventNotificationService", () => {
  let service: CompetitionEventNotificationService;
  let prisma: DeepMockProxy<PrismaClient>;
  let notifications: jest.Mocked<
    Pick<NotificationsService, "createManyForUsers">
  >;

  const licensee = (
    id: string,
    category: string | null,
    competitionLevel: string | null,
    ageGroup: string | null,
  ) => ({ id, category, competitionLevel, ageGroup });

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    // Idempotence guard defaults to "not yet notified".
    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.createMany.mockResolvedValue({ count: 0 });
    // No imported result owner by default (#652).
    prisma.result.findMany.mockResolvedValue([]);

    notifications = {
      createManyForUsers: jest.fn().mockResolvedValue({ count: 0 }),
      sendToUser: jest.fn(),
      sendToUsers: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionEventNotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(CompetitionEventNotificationService);
  });

  const competition = (
    events: CompetitionWithEvents["events"],
  ): CompetitionWithEvents => ({
    id: "comp-1",
    title: "Open de Paris",
    location: "Paris",
    date: new Date("2026-06-01T00:00:00Z"),
    events,
  });

  describe("notifyNewCompetition — eligibility matching", () => {
    it("notifies a licensee whose profile matches an event exactly", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("u1", "Latin", "Avancé", "Adult"),
      ] as any);

      await service.notifyNewCompetition(
        competition([
          { category: "Latin", level: "Avancé", ageGroup: "Adult" },
        ]),
      );

      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
      const [userIds, type, title, body, data] =
        notifications.sendToUsers.mock.calls[0];
      expect(userIds).toEqual(["u1"]);
      expect(type).toBe(NotificationType.NEW_COMPETITION);
      expect(title).toBe("Nouvelle compétition");
      expect(body).toContain("«Open de Paris» est ouverte.");
      expect(data).toEqual({
        competitionId: "comp-1",
        kind: NEW_COMPETITION_KIND,
      });
    });

    it("treats empty profile fields as wildcards (matches any event)", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("wild", null, null, null),
      ] as any);

      await service.notifyNewCompetition(
        competition([
          { category: "Standard", level: "Débutant", ageGroup: "Senior" },
        ]),
      );

      const [userIds] = notifications.sendToUsers.mock.calls[0];
      expect(userIds).toEqual(["wild"]);
    });

    it("matches case-insensitively and trims", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("u1", "  latin ", null, "ADULT"),
      ] as any);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "adult" }]),
      );

      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
    });

    it("excludes a licensee whose category does not match any event", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("u1", "Standard", null, "Adult"),
      ] as any);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("matches if ANY of several events fits the profile", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("u1", "Latin", null, "Senior"),
      ] as any);

      await service.notifyNewCompetition(
        competition([
          { category: "Standard", level: null, ageGroup: "Adult" },
          { category: "Latin", level: null, ageGroup: "Senior" },
        ]),
      );

      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
    });

    describe("per-discipline level", () => {
      type Profile = Awaited<ReturnType<typeof prisma.user.findMany>>;
      const dancer = {
        id: "u1",
        category: "Ten Dance",
        competitionLevel: null,
        competitionLevelLatin: "International",
        competitionLevelStandard: "Débutant",
        ageGroup: "Adulte",
      };
      const notifiedFor = async (
        event: CompetitionWithEvents["events"][number],
        profile: Record<string, unknown> = dancer,
      ) => {
        prisma.user.findMany.mockResolvedValue([profile] as unknown as Profile);
        await service.notifyNewCompetition(competition([event]));
        return notifications.sendToUsers.mock.calls.length > 0;
      };

      it("matches the Latin level on a Latin épreuve", async () => {
        expect(
          await notifiedFor({
            category: "Latin",
            level: "International",
            ageGroup: "Adulte",
          }),
        ).toBe(true);
      });

      it("does not use the Latin level on a Standard épreuve", async () => {
        expect(
          await notifiedFor({
            category: "Standard",
            level: "International",
            ageGroup: "Adulte",
          }),
        ).toBe(false);
      });

      it("matches the Standard level on a Standard épreuve", async () => {
        expect(
          await notifiedFor({
            category: "Standard",
            level: "Débutant",
            ageGroup: "Adulte",
          }),
        ).toBe(true);
      });

      it("Ten Dance: notifies a dancer of both disciplines, level ignored", async () => {
        expect(
          await notifiedFor({
            category: "Ten Dance",
            level: "Avancé",
            ageGroup: "Adulte",
          }),
        ).toBe(true);
      });

      it("Ten Dance: skips a dancer of a single discipline", async () => {
        expect(
          await notifiedFor(
            { category: "Ten Dance", level: null, ageGroup: "Adulte" },
            { ...dancer, category: "Latin", competitionLevelStandard: null },
          ),
        ).toBe(false);
      });

      it("a Ten Dance dancer is notified for a Latin épreuve", async () => {
        expect(
          await notifiedFor(
            { category: "Latin", level: null, ageGroup: "Adulte" },
            {
              ...dancer,
              competitionLevelLatin: null,
              competitionLevelStandard: null,
            },
          ),
        ).toBe(true);
      });
    });

    it("only queries users with the LICENSEE role", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: withActiveRole(UserRole.LICENSEE),
        }),
      );
    });

    it("skips competitions with no events", async () => {
      await service.notifyNewCompetition(competition([]));
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("does not insert when no licensee is eligible", async () => {
      prisma.user.findMany.mockResolvedValue([
        licensee("u1", "Standard", null, "Adult"),
      ] as any);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });
  });

  describe("notifyNewCompetition — idempotence", () => {
    it("does nothing if a NEW_COMPETITION notification already exists", async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: "n1" } as any);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("guards on the competitionId + kind pair", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(prisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            data: { path: ["competitionId"], equals: "comp-1" },
          }),
        }),
      );
    });
  });

  describe("notifyNewCompetition — failure isolation", () => {
    it("does not throw when a prisma call fails", async () => {
      prisma.user.findMany.mockRejectedValue(new Error("db down"));

      await expect(
        service.notifyNewCompetition(
          competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyResultsPublished", () => {
    const openCompetition = (title = "X") =>
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        title,
        resultsNotifiedAt: null,
      } as any);

    beforeEach(() => {
      // The reservation is free unless a test says otherwise.
      prisma.competition.updateMany.mockResolvedValue({ count: 1 });
      // A result has survived the grace period unless a test says otherwise.
      prisma.result.findFirst.mockResolvedValue({ id: "r-old" } as never);
    });

    it("waits until a result has survived the grace period (#713)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([
        { userId: "u1" },
      ] as never);
      prisma.result.findFirst.mockResolvedValue(null);
      const now = new Date("2026-10-17T12:00:00Z");

      await service.notifyResultsPublished("comp-1", now);

      expect(prisma.result.findFirst).toHaveBeenCalledWith({
        where: {
          event: { competitionId: "comp-1" },
          createdAt: {
            lte: new Date(now.getTime() - RESULTS_NOTIFICATION_GRACE_MS),
          },
        },
        select: { id: true },
      });
      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("notifies distinct participants once", async () => {
      openCompetition("Open de Paris");
      prisma.registration.findMany.mockResolvedValue([
        { userId: "u1" },
        { userId: "u2" },
        { userId: "u1" }, // duplicate across events → deduped
      ] as any);

      await service.notifyResultsPublished("comp-1");

      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
      const [userIds, type, title, body, data] =
        notifications.sendToUsers.mock.calls[0];
      expect([...userIds].sort()).toEqual(["u1", "u2"]);
      expect(type).toBe(NotificationType.COMPETITION_RESULTS);
      expect(title).toBe("Résultats disponibles");
      expect(body).toContain(
        "Les résultats de «Open de Paris» sont disponibles.",
      );
      expect(data).toEqual({ competitionId: "comp-1", kind: RESULTS_KIND });
    });

    it("looks up participants via event.competitionId", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.registration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { event: { competitionId: "comp-1" } },
        }),
      );
    });

    it("also notifies the holders and second members linked to an imported result, never a tombstone or unlinked marker (#652)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);
      prisma.result.findMany.mockResolvedValue([
        { userId: "u1", partnerUserId: null },
        { userId: "u-imported", partnerUserId: "u-partner" },
        {
          userId: "00000000-0000-0000-0000-000000000000",
          partnerUserId: "u-survivor",
        },
        { userId: "unlinked-import", partnerUserId: null },
      ] as any);
      // Only real accounts come back from the lookup.
      prisma.user.findMany.mockResolvedValue([
        { id: "u1" },
        { id: "u-imported" },
        { id: "u-partner" },
        { id: "u-survivor" },
      ] as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.result.findMany).toHaveBeenCalledWith({
        where: { event: { competitionId: "comp-1" } },
        select: { userId: true, partnerUserId: true },
        take: 5000,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: {
              in: [
                "u1",
                "u-imported",
                "u-partner",
                "00000000-0000-0000-0000-000000000000",
                "u-survivor",
                "unlinked-import",
              ],
            },
          },
        }),
      );
      const [userIds] = notifications.sendToUsers.mock.calls[0];
      expect([...userIds].sort()).toEqual(
        ["u-imported", "u-partner", "u-survivor", "u1"].sort(),
      );
    });

    it("notifies result owners even when nobody registered in the app (#652)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([]);
      prisma.result.findMany.mockResolvedValue([
        { userId: "u9", partnerUserId: null },
      ] as any);
      prisma.user.findMany.mockResolvedValue([{ id: "u9" }] as any);

      await service.notifyResultsPublished("comp-1");

      expect(notifications.sendToUsers.mock.calls[0][0]).toEqual(["u9"]);
    });

    it("does not look accounts up when no result has an owner", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it("reserves the sending atomically before sending (L6)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.competition.updateMany).toHaveBeenCalledWith({
        where: { id: "comp-1", resultsNotifiedAt: null },
        data: { resultsNotifiedAt: expect.any(Date) },
      });
      expect(
        prisma.competition.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(notifications.sendToUsers.mock.invocationCallOrder[0]);
    });

    it("sends nothing when a concurrent import won the reservation (L6)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);
      prisma.competition.updateMany.mockResolvedValue({ count: 0 });

      await service.notifyResultsPublished("comp-1");

      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("sends nothing once the competition is marked notified", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        title: "X",
        resultsNotifiedAt: new Date(),
      } as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.registration.findMany).not.toHaveBeenCalled();
      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("frees the reservation when the sending fails, so a later import retries (L6)", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);
      notifications.sendToUsers.mockRejectedValue(new Error("feed down"));

      await expect(
        service.notifyResultsPublished("comp-1"),
      ).resolves.toBeUndefined();

      const [, release] = prisma.competition.updateMany.mock.calls;
      const claimedAt = (
        prisma.competition.updateMany.mock.calls[0][0] as {
          data: { resultsNotifiedAt: Date };
        }
      ).data.resultsNotifiedAt;
      expect(release[0]).toEqual({
        where: { id: "comp-1", resultsNotifiedAt: claimedAt },
        data: { resultsNotifiedAt: null },
      });
    });

    it("reserves nothing when there are no participants", async () => {
      openCompetition();
      prisma.registration.findMany.mockResolvedValue([]);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("does nothing when the competition does not exist", async () => {
      prisma.competition.findUnique.mockResolvedValue(null);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.registration.findMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("is idempotent — skips when a RESULTS notification already exists (sent before the reservation column)", async () => {
      prisma.notification.findFirst.mockResolvedValue({ id: "n1" } as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.competition.findUnique).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("does not throw when a prisma call fails", async () => {
      prisma.competition.findUnique.mockRejectedValue(new Error("db down"));

      await expect(
        service.notifyResultsPublished("comp-1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifySettledResults (#713)", () => {
    const now = new Date("2026-10-17T12:00:00Z");

    it("looks for unnotified competitions with a result past the grace period, bounded", async () => {
      prisma.competition.findMany.mockResolvedValue([]);

      await expect(service.notifySettledResults(now)).resolves.toBe(0);

      expect(prisma.competition.findMany).toHaveBeenCalledWith({
        where: {
          resultsNotifiedAt: null,
          events: {
            some: {
              results: {
                some: {
                  createdAt: {
                    gte: new Date(now.getTime() - PENDING_RESULTS_WINDOW_MS),
                    lte: new Date(
                      now.getTime() - RESULTS_NOTIFICATION_GRACE_MS,
                    ),
                  },
                },
              },
            },
          },
        },
        select: { id: true },
        orderBy: { date: "desc" },
        take: MAX_PENDING_RESULTS_COMPETITIONS,
      });
    });

    it("notifies each pending competition at the same instant", async () => {
      prisma.competition.findMany.mockResolvedValue([
        { id: "c1" },
        { id: "c2" },
      ] as never);
      const notify = jest
        .spyOn(service, "notifyResultsPublished")
        .mockResolvedValue(undefined);

      await expect(service.notifySettledResults(now)).resolves.toBe(2);

      expect(notify.mock.calls).toEqual([
        ["c1", now],
        ["c2", now],
      ]);
    });
  });
});
