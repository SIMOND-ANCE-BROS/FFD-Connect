import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, PrismaClient, UserRole } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { NotificationsService } from "../../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CompetitionEventNotificationService,
  CompetitionWithEvents,
  NEW_COMPETITION_KIND,
  RESULTS_KIND,
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

    it("only queries users with the LICENSEE role", async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.notifyNewCompetition(
        competition([{ category: "Latin", level: null, ageGroup: "Adult" }]),
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: UserRole.LICENSEE },
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
    it("notifies distinct participants once", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        title: "Open de Paris",
      } as any);
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
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        title: "X",
      } as any);
      prisma.registration.findMany.mockResolvedValue([{ userId: "u1" }] as any);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.registration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { event: { competitionId: "comp-1" } },
        }),
      );
    });

    it("does nothing when there are no participants", async () => {
      prisma.competition.findUnique.mockResolvedValue({
        id: "comp-1",
        title: "X",
      } as any);
      prisma.registration.findMany.mockResolvedValue([]);

      await service.notifyResultsPublished("comp-1");

      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("does nothing when the competition does not exist", async () => {
      prisma.competition.findUnique.mockResolvedValue(null);

      await service.notifyResultsPublished("comp-1");

      expect(prisma.registration.findMany).not.toHaveBeenCalled();
      expect(notifications.sendToUsers).not.toHaveBeenCalled();
    });

    it("is idempotent — skips when a RESULTS notification already exists", async () => {
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
});
