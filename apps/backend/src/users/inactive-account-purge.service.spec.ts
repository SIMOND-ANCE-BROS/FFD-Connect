import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { EmailService } from "../auth/email.service";
import { HEALTH_DATA_ACCESS_ROUTES } from "../health-data-access/dto/health-data-access-log.dto";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AccountDeletionService } from "./account-deletion.service";
import {
  LastLoginAtRef,
  scheduledDeletionDate,
  warningDueWhere,
} from "./inactive-account.rules";
import {
  InactiveAccountPurgeService,
  MAX_CONSECUTIVE_SEND_FAILURES,
  MAX_DELETIONS_PER_PASS,
  MAX_WARNINGS_PER_PASS,
  PURGE_BOOT_DELAY_MS,
  PURGE_LAST_RUN_KEY,
  PURGE_MIN_INTERVAL_MS,
  PURGE_PAGE_SIZE,
} from "./inactive-account-purge.service";
import {
  InactiveAccountsQueryService,
  InactiveAccountWarningTarget,
} from "./inactive-accounts.query-service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

const REF = { name: "lastLoginAt" } as unknown as LastLoginAtRef;

const account = (
  id: string,
  overrides: Partial<InactiveAccountWarningTarget> = {},
): InactiveAccountWarningTarget => ({
  id,
  email: `${id}@example.test`,
  firstName: "Camille",
  createdAt: new Date("2020-01-01T00:00:00.000Z"),
  lastLoginAt: new Date("2021-01-01T00:00:00.000Z"),
  inactivityWarningSentAt: null,
  ...overrides,
});

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError("No record", {
    code: "P2025",
    clientVersion: "test",
  });

describe("InactiveAccountPurgeService (#991)", () => {
  let env: Record<string, string | undefined>;
  const prisma = {
    user: {
      fields: { lastLoginAt: REF },
      updateMany: jest.fn(),
    },
  };
  const query = {
    findWarningDue: jest.fn(),
    findDeletionDueIds: jest.fn(),
    isDeletionDue: jest.fn(),
    countDue: jest.fn(),
  };
  const deletion = { deleteAccount: jest.fn() };
  const email = {
    canSend: jest.fn(),
    sendInactiveAccountWarning: jest.fn(),
  };
  const redis = { exists: jest.fn(), set: jest.fn() };
  const config = { get: jest.fn((key: string) => env[key]) };

  let service: InactiveAccountPurgeService;

  beforeEach(() => {
    jest.clearAllMocks();
    env = {};
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    query.findWarningDue.mockResolvedValue([]);
    query.findDeletionDueIds.mockResolvedValue([]);
    query.isDeletionDue.mockResolvedValue(true);
    query.countDue.mockResolvedValue({ warning: 0, deletion: 0 });
    deletion.deleteAccount.mockResolvedValue(undefined);
    email.canSend.mockReturnValue(true);
    email.sendInactiveAccountWarning.mockResolvedValue(undefined);
    redis.exists.mockResolvedValue(false);
    redis.set.mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    service = new InactiveAccountPurgeService(
      prisma as unknown as PrismaService,
      query as unknown as InactiveAccountsQueryService,
      deletion as unknown as AccountDeletionService,
      email as unknown as EmailService,
      redis as unknown as RedisService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("trigger", () => {
    it("runs once, delayed, after boot (never on the cold-start path)", async () => {
      jest.useFakeTimers();
      const run = jest.spyOn(service, "runPass").mockResolvedValue(null);

      service.onModuleInit();
      expect(run).not.toHaveBeenCalled();
      jest.advanceTimersByTime(PURGE_BOOT_DELAY_MS);

      expect(run).toHaveBeenCalledWith("boot");
    });

    it("schedules nothing when disabled", () => {
      jest.useFakeTimers();
      env.INACTIVE_ACCOUNT_PURGE_ENABLED = "false";
      const run = jest.spyOn(service, "runPass");

      service.onModuleInit();
      jest.advanceTimersByTime(PURGE_BOOT_DELAY_MS * 2);

      expect(run).not.toHaveBeenCalled();
    });

    it("cancels the boot pass on shutdown", () => {
      jest.useFakeTimers();
      const run = jest.spyOn(service, "runPass").mockResolvedValue(null);

      service.onModuleInit();
      service.onModuleDestroy();
      jest.advanceTimersByTime(PURGE_BOOT_DELAY_MS);

      expect(run).not.toHaveBeenCalled();
    });

    it("the hourly cron runs a pass", async () => {
      const run = jest.spyOn(service, "runPass").mockResolvedValue(null);
      await service.handleCron();
      expect(run).toHaveBeenCalledWith("cron");
    });
  });

  describe("runPass", () => {
    it("is enabled by default and not in dry run", () => {
      expect(service.isEnabled()).toBe(true);
      expect(service.isDryRun()).toBe(false);
    });

    it("does nothing when disabled", async () => {
      env.INACTIVE_ACCOUNT_PURGE_ENABLED = "false";
      await expect(service.runPass("cron")).resolves.toBeNull();
      expect(query.findWarningDue).not.toHaveBeenCalled();
      expect(redis.exists).not.toHaveBeenCalled();
    });

    it("dry run only counts: no e-mail, no write, no deletion, no marker", async () => {
      env.INACTIVE_ACCOUNT_PURGE_DRY_RUN = "true";
      query.countDue.mockResolvedValue({ warning: 3, deletion: 2 });

      const report = await service.runPass("boot");

      expect(report).toEqual({
        dryRun: true,
        warned: 3,
        warningFailures: 0,
        deleted: 2,
        deletionFailures: 0,
        deletionSkipped: 0,
      });
      expect(email.sendInactiveAccountWarning).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(deletion.deleteAccount).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        "Inactive-account purge (boot, DRY RUN): 3 account(s) would be warned, 2 would be deleted",
      );
    });

    it("skips a pass another replica ran recently (Redis marker)", async () => {
      redis.exists.mockResolvedValue(true);

      await expect(service.runPass("boot")).resolves.toBeNull();

      expect(redis.exists).toHaveBeenCalledWith(PURGE_LAST_RUN_KEY);
      expect(query.findWarningDue).not.toHaveBeenCalled();
      expect(query.findDeletionDueIds).not.toHaveBeenCalled();
    });

    it("sets the marker for 20 h, then debounces in memory", async () => {
      const report = await service.runPass("boot");

      expect(report).toEqual({
        dryRun: false,
        warned: 0,
        warningFailures: 0,
        deleted: 0,
        deletionFailures: 0,
        deletionSkipped: 0,
      });
      expect(redis.set).toHaveBeenCalledWith(
        PURGE_LAST_RUN_KEY,
        expect.any(String),
        PURGE_MIN_INTERVAL_MS / 1000,
      );
      // Logged even when there is nothing to do.
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.stringContaining("Inactive-account purge (boot): 0 warned"),
      );

      redis.exists.mockClear();
      await expect(service.runPass("cron")).resolves.toBeNull();
      expect(redis.exists).not.toHaveBeenCalled();
    });

    it("runs again once the debounce window is over", async () => {
      const now = jest.spyOn(Date, "now");
      now.mockReturnValue(1_000_000);
      await service.runPass("boot");
      now.mockReturnValue(1_000_000 + PURGE_MIN_INTERVAL_MS + 1);

      await expect(service.runPass("cron")).resolves.not.toBeNull();
    });

    it("never runs two passes at once on a replica", async () => {
      let release: () => void = () => undefined;
      redis.exists.mockReturnValue(
        new Promise<boolean>((resolve) => {
          release = () => resolve(false);
        }),
      );

      const first = service.runPass("boot");
      await expect(service.runPass("cron")).resolves.toBeNull();
      release();
      await expect(first).resolves.not.toBeNull();
    });

    it("never throws: a failure is logged and sent to Sentry, retried later", async () => {
      query.findWarningDue.mockRejectedValue(new Error("db down"));

      await expect(service.runPass("cron")).resolves.toBeNull();

      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Inactive-account purge pass failed: Error",
      );
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "Inactive-account purge pass failed",
        expect.objectContaining({
          tags: { rgpd: "inactive-account-purge-failed", trigger: "cron" },
        }),
      );
      // Not debounced after a failure.
      query.findWarningDue.mockResolvedValue([]);
      await expect(service.runPass("cron")).resolves.not.toBeNull();
    });

    it("reports a Prisma failure by its code only", async () => {
      query.findWarningDue.mockRejectedValue(notFound());
      await service.runPass("cron");
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Inactive-account purge pass failed: P2025",
      );
    });

    it("warns, then deletes, in the same pass", async () => {
      const now = new Date("2029-06-15T10:00:00.000Z");
      jest.useFakeTimers({ now, doNotFake: ["setTimeout"] });
      query.findWarningDue.mockResolvedValueOnce([account("w1")]);
      query.findDeletionDueIds.mockResolvedValueOnce(["d1"]);

      const report = await service.runPass("cron");

      expect(report).toEqual(
        expect.objectContaining({ warned: 1, deleted: 1 }),
      );
      expect(query.findWarningDue).toHaveBeenCalledWith(now, undefined, 50);
      expect(query.findDeletionDueIds).toHaveBeenCalledWith(now, undefined, 50);
    });
  });

  describe("warnDueAccounts", () => {
    const NOW = new Date("2029-06-15T10:00:00.000Z");

    it("claims the warning atomically, then sends it with the deletion date", async () => {
      const target = account("u1");
      query.findWarningDue.mockResolvedValueOnce([target]);

      await expect(service.warnDueAccounts(NOW)).resolves.toEqual({
        warned: 1,
        warningFailures: 0,
      });

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { AND: [{ id: "u1" }, warningDueWhere(NOW, REF)] },
        data: { inactivityWarningSentAt: NOW },
      });
      expect(email.sendInactiveAccountWarning).toHaveBeenCalledWith(
        "u1@example.test",
        "Camille",
        scheduledDeletionDate(target, NOW),
      );
      expect(prisma.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        email.sendInactiveAccountWarning.mock.invocationCallOrder[0],
      );
    });

    it("does not send when another replica claimed the account first", async () => {
      query.findWarningDue.mockResolvedValueOnce([account("u1")]);
      prisma.user.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.warnDueAccounts(NOW)).resolves.toEqual({
        warned: 0,
        warningFailures: 0,
      });
      expect(email.sendInactiveAccountWarning).not.toHaveBeenCalled();
    });

    it("releases the claim when the e-mail fails (no deletion without a warning)", async () => {
      const previous = new Date("2024-01-01T00:00:00.000Z");
      query.findWarningDue.mockResolvedValueOnce([
        account("u1", { inactivityWarningSentAt: previous }),
      ]);
      email.sendInactiveAccountWarning.mockRejectedValueOnce(
        new Error("resend down"),
      );

      await expect(service.warnDueAccounts(NOW)).resolves.toEqual({
        warned: 0,
        warningFailures: 1,
      });
      expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
        where: { id: "u1", inactivityWarningSentAt: NOW },
        data: { inactivityWarningSentAt: previous },
      });
    });

    it("stops warning after repeated failures (provider down)", async () => {
      query.findWarningDue.mockResolvedValueOnce(
        ["a", "b", "c", "d", "e"].map((id) => account(id)),
      );
      email.sendInactiveAccountWarning.mockRejectedValue(new Error("down"));

      const result = await service.warnDueAccounts(NOW);

      expect(result.warningFailures).toBe(MAX_CONSECUTIVE_SEND_FAILURES);
      expect(email.sendInactiveAccountWarning).toHaveBeenCalledTimes(
        MAX_CONSECUTIVE_SEND_FAILURES,
      );
    });

    it("a success resets the consecutive-failure count", async () => {
      query.findWarningDue.mockResolvedValueOnce(
        ["a", "b", "c", "d", "e"].map((id) => account(id)),
      );
      email.sendInactiveAccountWarning
        .mockRejectedValueOnce(new Error("x"))
        .mockRejectedValueOnce(new Error("x"))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("x"))
        .mockRejectedValueOnce(new Error("x"));

      await expect(service.warnDueAccounts(NOW)).resolves.toEqual({
        warned: 1,
        warningFailures: 4,
      });
    });

    it("warns nobody (hence deletes nobody) without an e-mail transport", async () => {
      email.canSend.mockReturnValue(false);

      await expect(service.warnDueAccounts(NOW)).resolves.toEqual({
        warned: 0,
        warningFailures: 0,
      });
      expect(query.findWarningDue).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it("pages by id and stops at the per-pass cap", async () => {
      query.findWarningDue.mockImplementation(
        (_now: Date, afterId: string | undefined, take: number) =>
          Promise.resolve(
            Array.from({ length: take }, (_, i) =>
              account(`${afterId ?? "p"}-${i}`),
            ),
          ),
      );

      const result = await service.warnDueAccounts(NOW);

      expect(result.warned).toBe(MAX_WARNINGS_PER_PASS);
      expect(query.findWarningDue).toHaveBeenCalledTimes(
        Math.ceil(MAX_WARNINGS_PER_PASS / PURGE_PAGE_SIZE),
      );
      expect(query.findWarningDue).toHaveBeenNthCalledWith(
        2,
        NOW,
        `p-${PURGE_PAGE_SIZE - 1}`,
        PURGE_PAGE_SIZE,
      );
    });
  });

  describe("deleteDueAccounts", () => {
    const NOW = new Date("2029-06-15T10:00:00.000Z");

    it("deletes through the shared account-deletion chain, as SYSTEM", async () => {
      query.findDeletionDueIds.mockResolvedValueOnce(["u1", "u2"]);

      await expect(service.deleteDueAccounts(NOW)).resolves.toEqual({
        deleted: 2,
        deletionFailures: 0,
        deletionSkipped: 0,
      });

      expect(deletion.deleteAccount).toHaveBeenCalledWith("u1", [], {
        actorUserId: null,
        actorRole: "SYSTEM",
        route: HEALTH_DATA_ACCESS_ROUTES.inactiveAccountPurge,
      });
      expect(deletion.deleteAccount).toHaveBeenCalledWith(
        "u2",
        [],
        expect.anything(),
      );
    });

    it("keeps an account that logged in since the page was read", async () => {
      query.findDeletionDueIds.mockResolvedValueOnce(["u1"]);
      query.isDeletionDue.mockResolvedValueOnce(false);

      await expect(service.deleteDueAccounts(NOW)).resolves.toEqual({
        deleted: 0,
        deletionFailures: 0,
        deletionSkipped: 1,
      });
      expect(query.isDeletionDue).toHaveBeenCalledWith("u1", NOW);
      expect(deletion.deleteAccount).not.toHaveBeenCalled();
    });

    it("treats an account already deleted elsewhere as skipped (idempotent)", async () => {
      query.findDeletionDueIds.mockResolvedValueOnce(["u1"]);
      deletion.deleteAccount.mockRejectedValueOnce(notFound());

      await expect(service.deleteDueAccounts(NOW)).resolves.toEqual({
        deleted: 0,
        deletionFailures: 0,
        deletionSkipped: 1,
      });
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("goes on after a failed deletion and reports it", async () => {
      query.findDeletionDueIds.mockResolvedValueOnce(["u1", "u2"]);
      deletion.deleteAccount.mockRejectedValueOnce(new TypeError("boom"));

      await expect(service.deleteDueAccounts(NOW)).resolves.toEqual({
        deleted: 1,
        deletionFailures: 1,
        deletionSkipped: 0,
      });
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Inactive-account deletion failed: TypeError",
      );
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "Inactive-account deletions failed",
        expect.objectContaining({ extra: { failures: 1 } }),
      );
    });

    it("pages by id and stops at the per-pass cap", async () => {
      query.findDeletionDueIds.mockImplementation(
        (_now: Date, afterId: string | undefined, take: number) =>
          Promise.resolve(
            Array.from({ length: take }, (_, i) => `${afterId ?? "p"}-${i}`),
          ),
      );

      const result = await service.deleteDueAccounts(NOW);

      expect(result.deleted).toBe(MAX_DELETIONS_PER_PASS);
      expect(query.findDeletionDueIds).toHaveBeenNthCalledWith(
        2,
        NOW,
        `p-${PURGE_PAGE_SIZE - 1}`,
        PURGE_PAGE_SIZE,
      );
    });
  });
});
