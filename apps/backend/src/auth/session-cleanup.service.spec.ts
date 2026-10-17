import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { ImpersonationLogRetentionService } from "./impersonation-log-retention.service";
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
    $executeRaw: jest.fn(),
    user: { count: jest.fn() },
  };
  const mockNotifications = {
    purgeExpiredDeviceTokens: jest.fn(),
  };
  const mockImpersonationRetention = {
    purge: jest.fn(),
  };

  beforeEach(async () => {
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$executeRaw.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(0);
    mockNotifications.purgeExpiredDeviceTokens.mockResolvedValue(0);
    mockImpersonationRetention.purge.mockResolvedValue({
      deleted: 0,
      ipTruncated: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        {
          provide: ImpersonationLogRetentionService,
          useValue: mockImpersonationRetention,
        },
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

    // #731: support-access journal retention, same hourly hook.
    describe("impersonation log retention", () => {
      it("runs the purge and logs its counts on every pass", async () => {
        mockImpersonationRetention.purge.mockResolvedValue({
          deleted: 3,
          ipTruncated: 2,
        });
        const log = jest.spyOn(Logger.prototype, "log").mockImplementation();

        await service.cleanupExpiredSessions();

        expect(mockImpersonationRetention.purge).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
          "Impersonation log retention: 3 row(s) deleted, 2 IP(s) truncated",
        );
        log.mockRestore();
      });

      it("runs even when the session cleanup and the device purge fail", async () => {
        mockPrisma.refreshToken.deleteMany.mockRejectedValue(
          new Error("DB error"),
        );
        mockNotifications.purgeExpiredDeviceTokens.mockRejectedValue(
          new Error("DB error"),
        );
        const error = jest
          .spyOn(Logger.prototype, "error")
          .mockImplementation();

        await service.cleanupExpiredSessions();

        expect(mockImpersonationRetention.purge).toHaveBeenCalledTimes(1);
        error.mockRestore();
      });

      it("never fails the cleanup nor masks the next steps", async () => {
        mockImpersonationRetention.purge.mockRejectedValue(
          new Error("DB error"),
        );
        const error = jest
          .spyOn(Logger.prototype, "error")
          .mockImplementation();

        await expect(service.cleanupExpiredSessions()).resolves.toBeUndefined();

        expect(error).toHaveBeenCalledWith(
          "Error during impersonation log retention purge",
          expect.any(Error),
        );
        expect(mockPrisma.$executeRaw).toHaveBeenCalled();
        error.mockRestore();
      });
    });

    // #526: lookup keys of rows written without one (rollback window)
    // converge on this existing hourly hook — no new schedule.
    describe("e-mail lookup keys", () => {
      let log: jest.SpyInstance;
      let warn: jest.SpyInstance;
      let error: jest.SpyInstance;

      beforeEach(() => {
        log = jest.spyOn(Logger.prototype, "log").mockImplementation();
        warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
        error = jest.spyOn(Logger.prototype, "error").mockImplementation();
      });

      afterEach(() => {
        log.mockRestore();
        warn.mockRestore();
        error.mockRestore();
      });

      it("fills missing keys and stays quiet when nothing is left", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(2);
        mockPrisma.user.count.mockResolvedValue(0);

        await service.cleanupExpiredSessions();

        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
          "E-mail lookup keys: 2 account(s) filled",
        );
        expect(warn).not.toHaveBeenCalled();
      });

      it("warns with a count only (no address) about case duplicates left without key", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(0);
        mockPrisma.user.count.mockResolvedValue(2);

        await service.cleanupExpiredSessions();

        expect(log).not.toHaveBeenCalledWith(expect.stringContaining("filled"));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("2 account(s)");
        expect(warn.mock.calls[0][0]).not.toContain("@");
      });

      it("never fails the cleanup nor masks the token purges", async () => {
        mockPrisma.$executeRaw.mockRejectedValue(new Error("DB error"));

        await expect(service.cleanupExpiredSessions()).resolves.not.toThrow();
        expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalled();
        expect(mockNotifications.purgeExpiredDeviceTokens).toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(
          "Error while filling e-mail lookup keys",
          expect.any(Error),
        );
      });

      it("runs even when the session cleanup fails", async () => {
        mockPrisma.refreshToken.deleteMany.mockRejectedValue(
          new Error("DB error"),
        );

        await service.cleanupExpiredSessions();

        expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      });
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
