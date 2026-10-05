import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { SessionCleanupService } from "./session-cleanup.service";

describe("SessionCleanupService", () => {
  let service: SessionCleanupService;
  const mockPrisma = {
    refreshToken: {
      deleteMany: jest.fn(),
    },
    passwordResetToken: {
      deleteMany: jest.fn(),
    },
  };
  const mockNotifications = {
    purgeExpiredDeviceTokens: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
    mockNotifications.purgeExpiredDeviceTokens.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<SessionCleanupService>(SessionCleanupService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("cleanupExpiredSessions", () => {
    it("should delete expired, revoked, inactive refresh tokens and password reset tokens", async () => {
      mockPrisma.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 3 });
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 1 });

      await service.cleanupExpiredSessions();

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledTimes(1);
    });

    it("should handle errors during cleanup", async () => {
      mockPrisma.refreshToken.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.cleanupExpiredSessions()).resolves.not.toThrow();
    });

    // Rétention des tokens d'appareil (RGPD art. 5.1.e) accrochée à ce cron
    // horaire déjà existant : pas de planification supplémentaire, donc aucun
    // réveil du conteneur scale-to-zero.
    it("purge aussi les tokens d'appareil hors durée de conservation", async () => {
      mockNotifications.purgeExpiredDeviceTokens.mockResolvedValue(4);

      await service.cleanupExpiredSessions();

      expect(mockNotifications.purgeExpiredDeviceTokens).toHaveBeenCalledTimes(
        1,
      );
    });

    it("purge les tokens d'appareil même si le nettoyage des sessions échoue", async () => {
      mockPrisma.refreshToken.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.cleanupExpiredSessions()).resolves.not.toThrow();
      expect(mockNotifications.purgeExpiredDeviceTokens).toHaveBeenCalledTimes(
        1,
      );
    });

    it("n'échoue pas quand la purge des tokens d'appareil lève", async () => {
      mockNotifications.purgeExpiredDeviceTokens.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(service.cleanupExpiredSessions()).resolves.not.toThrow();
    });
  });

  describe("cleanupUserSessions", () => {
    it("should delete user refresh tokens", async () => {
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      await service.cleanupUserSessions("user-id-123");

      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "user-id-123",
          OR: expect.any(Array),
        },
      });
    });
  });

  describe("manualCleanup", () => {
    it("should return counts of deleted tokens including password reset tokens", async () => {
      mockPrisma.refreshToken.deleteMany
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 1 });
      mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 4 });

      const result = await service.manualCleanup();

      expect(result).toEqual({
        expired: 10,
        revoked: 5,
        inactive: 1,
        passwordResetTokens: 4,
      });
      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledTimes(3);
      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
