import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
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
  };

  const mockJwtAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };

  const makeRequest = (userId = "user-123"): RequestWithUser =>
    ({
      user: { userId, email: "user@test.com", role: "USER" },
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
      const [userId, title, body, data] =
        mockNotificationsService.sendToUser.mock.calls[0];
      expect(userId).toBe("user-abc");
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
});
