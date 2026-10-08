import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { NotificationType, UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { NotificationPreferencesQueryService } from "./notification-preferences.query-service";
import { NotificationPreferencesService } from "./notification-preferences.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

describe("NotificationsController", () => {
  let controller: NotificationsController;

  const mockNotificationsService = {
    getAllForUser: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    registerDeviceToken: jest.fn(),
    unregisterDeviceToken: jest.fn(),
    sendToUser: jest.fn(),
    deleteForUser: jest.fn(),
    deleteAllForUser: jest.fn(),
  };

  const mockPreferencesQueryService = {
    getCatalogForUser: jest.fn(),
    isPushEnabled: jest.fn(),
  };

  const mockPreferencesService = {
    setPreference: jest.fn(),
  };

  const mockJwtAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const makeRequest = (
    userId = "user-123",
    role: string = UserRole.LICENSEE,
  ): RequestWithUser =>
    ({
      user: { userId, email: "user@test.com", role, roles: [role as UserRole] },
    }) as RequestWithUser;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      // POST /device-token est protégé par ThrottlerUserGuard (5 appels/min et
      // par utilisateur) : le guard doit pouvoir être instancié ici.
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
        {
          provide: NotificationPreferencesQueryService,
          useValue: mockPreferencesQueryService,
        },
        {
          provide: NotificationPreferencesService,
          useValue: mockPreferencesService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  // ─── getMyNotifications ──────────────────────────────────────────────────────

  describe("getMyNotifications", () => {
    it("returns the list from the service for the authenticated user", async () => {
      const notifications = [
        {
          id: "notif-1",
          userId: "user-123",
          title: "Compétition",
          body: "Inscription confirmée",
          isRead: false,
          createdAt: new Date("2026-01-01"),
        },
        {
          id: "notif-2",
          userId: null,
          title: "Global",
          body: "Nouvelle saison",
          isRead: true,
          createdAt: new Date("2026-01-02"),
        },
      ];
      mockNotificationsService.getAllForUser.mockResolvedValue(notifications);

      const result = await controller.getMyNotifications(
        makeRequest("user-123"),
      );

      expect(result).toEqual(notifications);
    });

    it("calls getAllForUser with the userId extracted from the request", async () => {
      mockNotificationsService.getAllForUser.mockResolvedValue([]);

      await controller.getMyNotifications(makeRequest("user-abc"));

      expect(mockNotificationsService.getAllForUser).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.getAllForUser).toHaveBeenCalledWith(
        "user-abc",
      );
    });

    it("returns an empty array when the user has no notifications", async () => {
      mockNotificationsService.getAllForUser.mockResolvedValue([]);

      const result = await controller.getMyNotifications(makeRequest());

      expect(result).toEqual([]);
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.getAllForUser.mockRejectedValue(
        new Error("DB connection failed"),
      );

      await expect(
        controller.getMyNotifications(makeRequest()),
      ).rejects.toThrow("DB connection failed");
    });
  });

  // ─── markAsRead ──────────────────────────────────────────────────────────────

  describe("markAsRead", () => {
    it("returns the service result when the notification is found", async () => {
      const updated = { count: 1 };
      mockNotificationsService.markAsRead.mockResolvedValue(updated);

      const result = await controller.markAsRead(
        "notif-1",
        makeRequest("user-123"),
      );

      expect(result).toEqual(updated);
    });

    it("calls markAsRead with the notification id and the authenticated userId", async () => {
      mockNotificationsService.markAsRead.mockResolvedValue({ count: 1 });

      await controller.markAsRead("notif-42", makeRequest("user-xyz"));

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
        "notif-42",
        "user-xyz",
      );
    });

    it("returns count: 0 when the notification does not belong to the user (ownership enforced by service)", async () => {
      mockNotificationsService.markAsRead.mockResolvedValue({ count: 0 });

      const result = await controller.markAsRead(
        "notif-other",
        makeRequest("user-123"),
      );

      expect(result).toEqual({ count: 0 });
    });

    it("propagates NotFoundException thrown by the service", async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(
        new NotFoundException("Notification not found"),
      );

      await expect(
        controller.markAsRead("notif-missing", makeRequest()),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates unexpected service errors", async () => {
      mockNotificationsService.markAsRead.mockRejectedValue(
        new Error("Unexpected error"),
      );

      await expect(
        controller.markAsRead("notif-1", makeRequest()),
      ).rejects.toThrow("Unexpected error");
    });
  });

  // ─── markAllAsRead ───────────────────────────────────────────────────────────

  describe("markAllAsRead", () => {
    it("returns the batch-update result from the service", async () => {
      const updated = { count: 5 };
      mockNotificationsService.markAllAsRead.mockResolvedValue(updated);

      const result = await controller.markAllAsRead(makeRequest("user-123"));

      expect(result).toEqual(updated);
    });

    it("calls markAllAsRead with the authenticated userId only", async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue({ count: 2 });

      await controller.markAllAsRead(makeRequest("user-456"));

      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(
        "user-456",
      );
    });

    it("returns count: 0 when there are no unread notifications", async () => {
      mockNotificationsService.markAllAsRead.mockResolvedValue({ count: 0 });

      const result = await controller.markAllAsRead(makeRequest());

      expect(result).toEqual({ count: 0 });
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.markAllAsRead.mockRejectedValue(
        new Error("DB timeout"),
      );

      await expect(controller.markAllAsRead(makeRequest())).rejects.toThrow(
        "DB timeout",
      );
    });
  });

  // ─── registerDeviceToken ─────────────────────────────────────────────────────

  // ─── Suppression ─────────────────────────────────────────────────────────────

  describe("deleteMyNotification", () => {
    it("transmet l'id et le userId du JWT, jamais un userId du corps", async () => {
      mockNotificationsService.deleteForUser.mockResolvedValue({ count: 1 });

      await controller.deleteMyNotification("notif-1", makeRequest("user-123"));

      expect(mockNotificationsService.deleteForUser).toHaveBeenCalledWith(
        "notif-1",
        "user-123",
      );
    });

    it("ne renvoie rien : le code de retour ne révèle pas si la ligne existait", async () => {
      mockNotificationsService.deleteForUser.mockResolvedValue({ count: 0 });

      await expect(
        controller.deleteMyNotification("inconnue", makeRequest()),
      ).resolves.toBeUndefined();
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.deleteForUser.mockRejectedValue(
        new Error("DB down"),
      );

      await expect(
        controller.deleteMyNotification("notif-1", makeRequest()),
      ).rejects.toThrow("DB down");
    });
  });

  describe("deleteAllMyNotifications", () => {
    it("renvoie le nombre supprimé pour l'utilisateur authentifié", async () => {
      mockNotificationsService.deleteAllForUser.mockResolvedValue({
        count: 12,
      });

      const res = await controller.deleteAllMyNotifications(
        makeRequest("user-123"),
      );

      expect(mockNotificationsService.deleteAllForUser).toHaveBeenCalledWith(
        "user-123",
      );
      expect(res).toEqual({ count: 12 });
    });

    it("renvoie count: 0 sur un feed déjà vide", async () => {
      mockNotificationsService.deleteAllForUser.mockResolvedValue({ count: 0 });

      await expect(
        controller.deleteAllMyNotifications(makeRequest()),
      ).resolves.toEqual({ count: 0 });
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.deleteAllForUser.mockRejectedValue(
        new Error("DB down"),
      );

      await expect(
        controller.deleteAllMyNotifications(makeRequest()),
      ).rejects.toThrow("DB down");
    });
  });

  describe("registerDeviceToken", () => {
    it("est limité à 5 appels par minute et par utilisateur", () => {
      // Le client légitime appelle une fois par ouverture de session et par
      // renouvellement du token FCM. Sans cette limite, un compte authentifié
      // pouvait écrire ~144 000 lignes/jour sous le seul throttle global.
      const handler = NotificationsController.prototype.registerDeviceToken;

      expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(5);
      expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60_000);
      // Le guard per-user doit être posé avec le JWT : ThrottlerUserGuard trace
      // l'utilisateur, pas seulement l'IP.
      const guards = Reflect.getMetadata("__guards__", handler) as unknown[];
      expect(guards).toContain(ThrottlerUserGuard);
    });

    it("upsert le token pour l'utilisateur authentifié (204, pas de corps)", async () => {
      mockNotificationsService.registerDeviceToken.mockResolvedValue(undefined);

      const result = await controller.registerDeviceToken(
        { token: "fcm-token", platform: "IOS" },
        makeRequest("user-123"),
      );

      expect(result).toBeUndefined();
      expect(
        mockNotificationsService.registerDeviceToken,
      ).toHaveBeenCalledTimes(1);
      expect(mockNotificationsService.registerDeviceToken).toHaveBeenCalledWith(
        "user-123",
        "fcm-token",
        "IOS",
      );
    });

    it("ré-attribue le token au porteur du JWT, jamais à un userId du corps", async () => {
      mockNotificationsService.registerDeviceToken.mockResolvedValue(undefined);

      // Même token, autre utilisateur connecté sur l'appareil : c'est l'identité
      // du JWT qui compte.
      await controller.registerDeviceToken(
        { token: "shared-token", platform: "ANDROID" },
        makeRequest("user-B"),
      );

      expect(mockNotificationsService.registerDeviceToken).toHaveBeenCalledWith(
        "user-B",
        "shared-token",
        "ANDROID",
      );
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.registerDeviceToken.mockRejectedValue(
        new Error("DB timeout"),
      );

      await expect(
        controller.registerDeviceToken(
          { token: "fcm-token", platform: "IOS" },
          makeRequest(),
        ),
      ).rejects.toThrow("DB timeout");
    });
  });

  // ─── unregisterDeviceToken ───────────────────────────────────────────────────

  describe("unregisterDeviceToken", () => {
    it("retire le token de l'utilisateur authentifié (204, pas de corps)", async () => {
      mockNotificationsService.unregisterDeviceToken.mockResolvedValue(1);

      const result = await controller.unregisterDeviceToken(
        { token: "fcm-token" },
        makeRequest("user-123"),
      );

      expect(result).toBeUndefined();
      expect(
        mockNotificationsService.unregisterDeviceToken,
      ).toHaveBeenCalledWith("user-123", "fcm-token");
    });

    it("idempotent : 204 même quand aucun token n'a été supprimé", async () => {
      mockNotificationsService.unregisterDeviceToken.mockResolvedValue(0);

      await expect(
        controller.unregisterDeviceToken(
          { token: "unknown-token" },
          makeRequest("user-123"),
        ),
      ).resolves.toBeUndefined();
    });

    it("ne peut pas retirer le token d'un autre utilisateur (scoping par le service)", async () => {
      mockNotificationsService.unregisterDeviceToken.mockResolvedValue(0);

      await controller.unregisterDeviceToken(
        { token: "victim-token" },
        makeRequest("attacker"),
      );

      // Le userId transmis est celui du JWT : le service scope le delete dessus.
      expect(
        mockNotificationsService.unregisterDeviceToken,
      ).toHaveBeenCalledWith("attacker", "victim-token");
    });

    it("propagates service errors to the caller", async () => {
      mockNotificationsService.unregisterDeviceToken.mockRejectedValue(
        new Error("DB timeout"),
      );

      await expect(
        controller.unregisterDeviceToken({ token: "t" }, makeRequest()),
      ).rejects.toThrow("DB timeout");
    });
  });

  // ─── sendTestNotification ────────────────────────────────────────────────────

  describe("sendTestNotification", () => {
    it("envoie a l'appelant et renvoie les compteurs", async () => {
      mockNotificationsService.sendToUser.mockResolvedValue({
        sent: 2,
        failed: 0,
        pruned: 0,
      });

      const result = await controller.sendTestNotification(
        makeRequest("user-abc"),
      );

      expect(result).toEqual({ sent: 2, failed: 0, pruned: 0 });
      expect(mockNotificationsService.sendToUser).toHaveBeenCalledTimes(1);
      const [userId, type, title, body, data] =
        mockNotificationsService.sendToUser.mock.calls[0];
      expect(userId).toBe("user-abc");
      expect(type).toBe(NotificationType.DIAGNOSTIC_TEST);
      expect(typeof title).toBe("string");
      expect(typeof body).toBe("string");
      expect(data).toEqual({ type: "test" });
    });

    it("ne prend aucun destinataire : l'envoi cible toujours l'appelant", () => {
      // Garde-fou de conception : si un jour un parametre de destinataire est
      // ajoute, ce test echoue et force a reflechir au vecteur d'abus.
      expect(controller.sendTestNotification.length).toBe(1);
    });

    it("remonte sent=0 quand aucun appareil n'est enregistre", async () => {
      // Le cas de diagnostic principal : build sans entitlement APNs, donc
      // aucun token produit, donc aucun appareil a atteindre.
      mockNotificationsService.sendToUser.mockResolvedValue({
        sent: 0,
        failed: 0,
        pruned: 0,
      });

      const result = await controller.sendTestNotification(makeRequest());

      expect(result).toEqual({ sent: 0, failed: 0, pruned: 0 });
    });
  });
  // ─── Préférences de notification (issue #37) ─────────────────────────────────

  describe("getMyPreferences", () => {
    const catalog = [
      {
        type: NotificationType.REGISTRATION_STATUS,
        enabled: true,
        label: "Mes inscriptions",
        description: "Quand votre inscription est validée.",
      },
    ];

    it("renvoie le catalogue de l'utilisateur authentifié", async () => {
      mockPreferencesQueryService.getCatalogForUser.mockResolvedValue(catalog);

      const result = await controller.getMyPreferences(
        makeRequest("user-77", UserRole.CLUB),
      );

      expect(result).toEqual(catalog);
      // Le rôle vient du JWT, jamais d'un paramètre : c'est lui qui décide du
      // périmètre renvoyé.
      expect(
        mockPreferencesQueryService.getCatalogForUser,
      ).toHaveBeenCalledWith("user-77", [UserRole.CLUB]);
    });

    it("ne prend aucun paramètre de destinataire", () => {
      // Les préférences sont des données personnelles : seule l'identité du JWT
      // les désigne. Si un paramètre apparaît un jour, ce test force à y penser.
      expect(controller.getMyPreferences.length).toBe(1);
    });

    it("renvoie libellés et descriptions, pour un écran piloté par le serveur", async () => {
      mockPreferencesQueryService.getCatalogForUser.mockResolvedValue(catalog);

      const [entry] = await controller.getMyPreferences(makeRequest());

      expect(entry.label).toBe("Mes inscriptions");
      expect(entry.description).toBe("Quand votre inscription est validée.");
    });

    it("propage les erreurs du service", async () => {
      mockPreferencesQueryService.getCatalogForUser.mockRejectedValue(
        new Error("db down"),
      );

      await expect(controller.getMyPreferences(makeRequest())).rejects.toThrow(
        "db down",
      );
    });
  });

  describe("updateMyPreference", () => {
    it("enregistre le choix pour l'utilisateur authentifié, jamais un userId du corps", async () => {
      const updated = {
        type: NotificationType.NEW_COMPETITION,
        enabled: true,
        label: "Nouvelles compétitions",
        description: "Quand une compétition est ouverte.",
      };
      mockPreferencesService.setPreference.mockResolvedValue(updated);

      const result = await controller.updateMyPreference(
        { type: NotificationType.NEW_COMPETITION, enabled: true },
        makeRequest("user-99", UserRole.LICENSEE),
      );

      expect(result).toEqual(updated);
      expect(mockPreferencesService.setPreference).toHaveBeenCalledWith(
        "user-99",
        [UserRole.LICENSEE],
        NotificationType.NEW_COMPETITION,
        true,
      );
    });

    it("est limité à 30 appels par minute et par utilisateur", () => {
      // Point d'écriture : le throttle global (100/min) couvre toute l'API, pas
      // cet endpoint en particulier.
      const handler = NotificationsController.prototype.updateMyPreference;

      expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(30);
      expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60_000);
      // Comme pour device-token : la limite doit être comptée par utilisateur,
      // pas par IP — plusieurs comptes partagent un réseau mobile.
      const guards = Reflect.getMetadata("__guards__", handler) as unknown[];
      expect(guards).toContain(ThrottlerUserGuard);
    });

    it("propage le refus d'un type non réglable", async () => {
      mockPreferencesService.setPreference.mockRejectedValue(
        new BadRequestException("non réglable"),
      );

      await expect(
        controller.updateMyPreference(
          { type: NotificationType.DIAGNOSTIC_TEST, enabled: false },
          makeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("transmet le rôle du JWT, pas celui que le corps pourrait prétendre", async () => {
      mockPreferencesService.setPreference.mockResolvedValue({
        type: NotificationType.TRACK_REPORT,
        enabled: true,
        label: "Signalements de musique",
        description: "Quand un utilisateur signale une musique.",
      });

      // Le DTO ne porte pas de `role` — et la ValidationPipe globale
      // (forbidNonWhitelisted) rejetterait le champ s'il était envoyé. Le rôle
      // transmis au service ne peut donc venir que du JWT.
      await controller.updateMyPreference(
        { type: NotificationType.TRACK_REPORT, enabled: true },
        makeRequest("user-1", UserRole.ADMIN),
      );

      expect(mockPreferencesService.setPreference).toHaveBeenCalledWith(
        "user-1",
        [UserRole.ADMIN],
        NotificationType.TRACK_REPORT,
        true,
      );
    });

    it("propage le refus d'un type hors du périmètre du rôle", async () => {
      mockPreferencesService.setPreference.mockRejectedValue(
        new ForbiddenException("ne concerne pas votre profil"),
      );

      await expect(
        controller.updateMyPreference(
          { type: NotificationType.TRACK_REPORT, enabled: true },
          makeRequest("user-1", UserRole.LICENSEE),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
