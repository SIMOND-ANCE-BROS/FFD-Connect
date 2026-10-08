import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { NotificationType, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NOTIFICATION_CATALOG } from "./notification-catalog";
import { NotificationPreferencesService } from "./notification-preferences.service";

describe("NotificationPreferencesService", () => {
  let service: NotificationPreferencesService;

  const mockPrisma = {
    notificationPreference: {
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferencesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(NotificationPreferencesService);
    jest.clearAllMocks();
  });

  describe("setPreference", () => {
    it("enregistre le choix sur la contrainte unique (userId, type)", async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        enabled: false,
      });

      await service.setPreference(
        "u1",
        [UserRole.LICENSEE],
        NotificationType.REGISTRATION_STATUS,
        false,
      );

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_type: {
            userId: "u1",
            type: NotificationType.REGISTRATION_STATUS,
          },
        },
        create: {
          userId: "u1",
          type: NotificationType.REGISTRATION_STATUS,
          enabled: false,
        },
        update: { enabled: false },
        select: { enabled: true },
      });
    });

    it("renvoie l'entrée de catalogue complète, libellés compris", async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        enabled: true,
      });

      const updated = await service.setPreference(
        "u1",
        [UserRole.LICENSEE],
        NotificationType.NEW_COMPETITION,
        true,
      );

      expect(updated).toEqual({
        type: NotificationType.NEW_COMPETITION,
        enabled: true,
        label: NOTIFICATION_CATALOG[NotificationType.NEW_COMPETITION].label,
        description:
          NOTIFICATION_CATALOG[NotificationType.NEW_COMPETITION].description,
      });
    });

    it("renvoie l'état réellement stocké, pas celui demandé", async () => {
      // L'upsert est la source de vérité : si la base renvoie autre chose, le
      // client doit afficher la base — sinon l'interrupteur mentirait jusqu'au
      // prochain rechargement.
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        enabled: false,
      });

      const updated = await service.setPreference(
        "u1",
        [UserRole.LICENSEE],
        NotificationType.NEW_COMPETITION,
        true,
      );

      expect(updated.enabled).toBe(false);
    });

    it("est idempotent : rejouer le même état ne fait qu'un upsert", async () => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        enabled: true,
      });

      await service.setPreference(
        "u1",
        [UserRole.ADMIN],
        NotificationType.TRACK_REPORT,
        true,
      );
      await service.setPreference(
        "u1",
        [UserRole.ADMIN],
        NotificationType.TRACK_REPORT,
        true,
      );

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.notificationPreference.upsert.mock.calls[0][0]).toEqual(
        mockPrisma.notificationPreference.upsert.mock.calls[1][0],
      );
    });

    it("refuse un type non réglable sans rien écrire", async () => {
      // `@IsEnum` laisse passer DIAGNOSTIC_TEST : la garde est ici. Écrire la
      // ligne serait pire que refuser — elle ne serait jamais relue.
      await expect(
        service.setPreference(
          "u1",
          [UserRole.ADMIN],
          NotificationType.DIAGNOSTIC_TEST,
          false,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it("refuse un type hors du périmètre du rôle, sans rien écrire", async () => {
      // Écrire une préférence que GET ne renverra jamais à cet appelant serait
      // incohérent : il ne pourrait plus ni la voir ni la corriger.
      await expect(
        service.setPreference(
          "u1",
          [UserRole.LICENSEE],
          NotificationType.TRACK_REPORT,
          true,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it.each([
      [UserRole.LICENSEE, NotificationType.CLUB_MEMBER_REGISTRATION],
      [UserRole.LICENSEE, NotificationType.CLUB_PARTNERSHIP],
      [UserRole.CLUB, NotificationType.TRACK_REPORT],
      [UserRole.CLUB, NotificationType.NEW_COMPETITION],
      [UserRole.STAFF, NotificationType.CLUB_MEMBER_REGISTRATION],
      [UserRole.ADMIN, NotificationType.CLUB_PARTNERSHIP],
    ])("refuse %s sur %s", async (role, type) => {
      await expect(
        service.setPreference("u1", [role], type, true),
      ).rejects.toThrow(ForbiddenException);
    });

    it.each([
      [UserRole.CLUB, NotificationType.CLUB_MEMBER_REGISTRATION],
      [UserRole.CLUB, NotificationType.CLUB_PARTNERSHIP],
      [UserRole.ADMIN, NotificationType.TRACK_REPORT],
      [UserRole.LICENSEE, NotificationType.NEW_COMPETITION],
      [UserRole.STAFF, NotificationType.REGISTRATION_STATUS],
    ])("accepte %s sur %s", async (role, type) => {
      mockPrisma.notificationPreference.upsert.mockResolvedValue({
        enabled: true,
      });

      await expect(
        service.setPreference("u1", [role], type, true),
      ).resolves.toMatchObject({ type, enabled: true });
    });

    it("refuse tout à un rôle inconnu (jeton d'une version antérieure)", async () => {
      await expect(
        service.setPreference(
          "u1",
          ["SUPERVISOR"],
          NotificationType.REGISTRATION_STATUS,
          true,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });
});
