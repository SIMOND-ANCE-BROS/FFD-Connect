import { Logger } from "@nestjs/common";
import {
  LicenseRenewalStatus,
  NotificationType,
  UserRole,
} from "@prisma/client";
import { withActiveRole } from "../auth/roles";
import { NOTIFICATION_CATALOG } from "../notifications/notification-catalog";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  LICENSE_RENEWAL_PUSH_COPY,
  LicenseRenewalNotificationService,
  MAX_ADMINS_NOTIFIED,
} from "./license-renewal-notification.service";

describe("LicenseRenewalNotificationService", () => {
  const prisma = { user: { findMany: jest.fn() } };
  const notifications = { sendToUser: jest.fn(), sendToUsers: jest.fn() };
  const service = new LicenseRenewalNotificationService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    prisma.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
    notifications.sendToUsers.mockResolvedValue({ recipients: 1 });
    notifications.sendToUser.mockResolvedValue({ sent: 1 });
  });

  afterEach(() => warn.mockRestore());

  describe("notifyToReview", () => {
    it("reaches every active administrator, with a bounded read", async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: "admin-1" },
        { id: "admin-2" },
      ]);

      await service.notifyToReview("req-1");

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: withActiveRole(UserRole.ADMIN),
        select: { id: true },
        take: MAX_ADMINS_NOTIFIED,
      });
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        ["admin-1", "admin-2"],
        NotificationType.LICENSE_RENEWAL_TO_REVIEW,
        LICENSE_RENEWAL_PUSH_COPY.toReview.title,
        LICENSE_RENEWAL_PUSH_COPY.toReview.body,
        { type: "LICENSE_RENEWAL_TO_REVIEW", requestId: "req-1" },
      );
    });

    it.each([
      ["the administrators cannot be read", "findMany"],
      ["the notification service fails", "sendToUsers"],
    ])("never rejects when %s, and logs it", async (_label, failing) => {
      if (failing === "findMany") {
        prisma.user.findMany.mockRejectedValue(new Error("DB down"));
      } else {
        notifications.sendToUsers.mockRejectedValue(new Error("FCM down"));
      }

      await expect(service.notifyToReview("req-1")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Licence renewal req-1"),
      );
    });
  });

  describe("notifyDecision", () => {
    it("announces an approval with the granted end of validity", async () => {
      await service.notifyDecision("user-1", "req-1", {
        status: LicenseRenewalStatus.APPROVED,
        validUntil: new Date("2027-08-31T21:59:59.999Z"),
      });

      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "user-1",
        NotificationType.LICENSE_RENEWAL_DECISION,
        "Renouvellement de licence approuvé",
        "Votre licence est renouvelée jusqu'au 31/08/2027.",
        {
          type: "LICENSE_RENEWAL_DECISION",
          requestId: "req-1",
          status: "APPROVED",
        },
      );
    });

    it("announces a refusal without giving its reason", async () => {
      await service.notifyDecision("user-1", "req-1", {
        status: LicenseRenewalStatus.REJECTED,
      });

      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "user-1",
        NotificationType.LICENSE_RENEWAL_DECISION,
        LICENSE_RENEWAL_PUSH_COPY.rejected.title,
        LICENSE_RENEWAL_PUSH_COPY.rejected.body,
        {
          type: "LICENSE_RENEWAL_DECISION",
          requestId: "req-1",
          status: "REJECTED",
        },
      );
    });

    it("never rejects when the notification service fails, and logs it", async () => {
      notifications.sendToUser.mockRejectedValue(new Error("FCM down"));

      await expect(
        service.notifyDecision("user-1", "req-1", {
          status: LicenseRenewalStatus.REJECTED,
        }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Licence renewal req-1"),
      );
    });
  });

  /**
   * A push is shown on a lock screen and outlives the request: it must carry
   * no name and no health data (#269). The service is never even given a
   * name; this pins the copy itself.
   */
  describe("push copy carries no name and no health data", () => {
    const copy = [
      LICENSE_RENEWAL_PUSH_COPY.toReview.title,
      LICENSE_RENEWAL_PUSH_COPY.toReview.body,
      LICENSE_RENEWAL_PUSH_COPY.approved.title,
      LICENSE_RENEWAL_PUSH_COPY.approved.body(new Date("2027-08-31T12:00:00Z")),
      LICENSE_RENEWAL_PUSH_COPY.rejected.title,
      LICENSE_RENEWAL_PUSH_COPY.rejected.body,
    ];

    it.each([
      "médic",
      "medic",
      "santé",
      "certificat",
      "apte",
      "aptitude",
      "contre-indication",
      "restriction",
      "docteur",
      "dr ",
      "motif",
    ])("never mentions « %s »", (term) => {
      for (const text of copy) {
        expect(text.toLowerCase()).not.toContain(term);
      }
    });

    it("has no placeholder a name could be interpolated into", async () => {
      await service.notifyDecision("user-1", "req-1", {
        status: LicenseRenewalStatus.APPROVED,
        validUntil: new Date("2027-08-31T21:59:59.999Z"),
      });
      await service.notifyToReview("req-1");

      // Only identifiers and the status ride along; no user-supplied text.
      const [, , title, body, data] = notifications.sendToUser.mock
        .calls[0] as [string, string, string, string, Record<string, string>];
      expect(copy).toContain(title);
      expect(body).toBe(
        LICENSE_RENEWAL_PUSH_COPY.approved.body(
          new Date("2027-08-31T21:59:59.999Z"),
        ),
      );
      expect(Object.keys(data).sort()).toEqual(["requestId", "status", "type"]);
      const [, , , , adminData] = notifications.sendToUsers.mock.calls[0] as [
        string[],
        string,
        string,
        string,
        Record<string, string>,
      ];
      expect(Object.keys(adminData).sort()).toEqual(["requestId", "type"]);
    });
  });

  it("both types are declared and configurable in the catalogue", () => {
    for (const type of [
      NotificationType.LICENSE_RENEWAL_TO_REVIEW,
      NotificationType.LICENSE_RENEWAL_DECISION,
    ]) {
      expect(NOTIFICATION_CATALOG[type].configurable).toBe(true);
    }
  });
});
