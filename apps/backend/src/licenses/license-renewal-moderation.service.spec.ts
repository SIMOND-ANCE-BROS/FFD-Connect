import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import { AdminAuditService } from "../admin/admin-audit.service";
import type { AuditEntry } from "../admin/dto/admin-audit.dto";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";
import {
  LicenseRenewalModerationService,
  REJECTED_CERTIFICATE_RETENTION_DAYS,
} from "./license-renewal-moderation.service";
import { LicenseRenewalNotificationService } from "./license-renewal-notification.service";

const NOW = new Date("2027-03-15T10:00:00.000Z");
const DETAIL = { id: "req-1", status: "APPROVED" };

describe("LicenseRenewalModerationService", () => {
  const prisma = {
    $transaction: jest.fn(),
    licenseRenewalRequest: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    licenseRenewalDocument: { updateMany: jest.fn(), count: jest.fn() },
    license: { upsert: jest.fn() },
    retiredLicenseNumber: { upsert: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const query = { detailAfterDecision: jest.fn() };
  const notifications = { sendToUser: jest.fn(), sendToUsers: jest.fn() };
  // The real notifier over a mocked NotificationsService: the
  // fire-and-forget contract is part of what is tested here.
  const notifier = new LicenseRenewalNotificationService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService,
  );
  const service = new LicenseRenewalModerationService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
    query as unknown as LicenseRenewalModerationQueryService,
    notifier,
  );

  /** Lets the fire-and-forget notification settle. */
  const flushNotifications = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  const approvalTarget = {
    status: LicenseRenewalStatus.PENDING,
    userId: "user-1",
    documents: [
      {
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        ocrData: { isApte: false, doctorName: "Dr X", date: "2027-01-02" },
      },
      {
        type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
        ocrData: { licenseNumber: "FFD-1" },
      },
    ],
    user: { category: null, clubName: null, license: null },
  };

  const auditEntry = (): AuditEntry =>
    (audit.record.mock.calls[0] as [unknown, AuditEntry])[1];

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    prisma.licenseRenewalRequest.findUnique.mockResolvedValue(approvalTarget);
    prisma.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.licenseRenewalDocument.updateMany.mockResolvedValue({ count: 1 });
    prisma.licenseRenewalDocument.count.mockResolvedValue(1);
    prisma.license.upsert.mockResolvedValue({ id: "L1" });
    audit.record.mockResolvedValue(undefined);
    query.detailAfterDecision.mockResolvedValue(DETAIL);
    notifications.sendToUser.mockResolvedValue({
      sent: 1,
      failed: 0,
      pruned: 0,
    });
  });

  afterEach(() => jest.useRealTimers());

  describe("an administrator never decides their own request (#271)", () => {
    beforeEach(() => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.PENDING,
        userId: "admin-1",
      });
    });

    it("403 on approve, nothing written nor notified", async () => {
      await expect(service.approve("admin-1", "req-1", {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("403 on reject, nothing written nor notified", async () => {
      await expect(
        service.reject("admin-1", "req-1", { reason: "OTHER" }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("another administrator may decide it", async () => {
      await expect(
        service.reject("admin-2", "req-1", { reason: "OTHER" }),
      ).resolves.toBe(DETAIL);
    });
  });

  describe("approve", () => {
    it("404 for an unknown request", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(null);
      await expect(service.approve("admin-1", "req-1", {})).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("409 for a request no longer PENDING", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.REJECTED,
      });
      await expect(service.approve("admin-1", "req-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("claims, renews and audits in ONE transaction, audit last", async () => {
      const result = await service.approve("admin-1", "req-1", {
        licenseNumber: "FFD-9",
      });

      expect(result).toBe(DETAIL);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(prisma, expect.anything());
      expect(prisma.license.upsert.mock.invocationCallOrder[0]).toBeLessThan(
        audit.record.mock.invocationCallOrder[0],
      );
      expect(prisma.license.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ number: "FFD-9" }) as unknown,
        }),
      );
    });

    it("audits status and granted validity only — no health data", async () => {
      await service.approve("admin-1", "req-1", {});

      expect(auditEntry()).toEqual({
        actorId: "admin-1",
        action: "LICENSE_RENEWAL_APPROVE",
        targetType: "LICENSE_RENEWAL",
        targetId: "req-1",
        before: { status: "PENDING" },
        after: {
          status: "APPROVED",
          validUntil: "2027-08-31T21:59:59.999Z",
        },
      });
      const serialized = JSON.stringify(auditEntry());
      for (const leak of ["isApte", "Dr X", "2027-01-02", "doctor"]) {
        expect(serialized).not.toContain(leak);
      }
    });

    it("retires a replaced licence number and audits old -> new (#466)", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        ...approvalTarget,
        user: {
          ...approvalTarget.user,
          license: {
            id: "L1",
            number: "FFD-OLD",
            validUntil: new Date("2026-08-31T21:59:59.999Z"),
          },
        },
      });

      await service.approve("admin-1", "req-1", { licenseNumber: "FFD-9" });

      expect(prisma.retiredLicenseNumber.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { number: "FFD-OLD" },
          create: { number: "FFD-OLD", licenseId: "L1" },
        }),
      );
      expect(auditEntry().before).toEqual({
        status: "PENDING",
        licenseNumber: "FFD-OLD",
      });
      expect(auditEntry().after).toEqual({
        status: "APPROVED",
        validUntil: "2027-08-31T21:59:59.999Z",
        licenseNumber: "FFD-9",
      });
    });

    it("no audit row when the concurrent claim lost (409)", async () => {
      prisma.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve("admin-1", "req-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(prisma.license.upsert).not.toHaveBeenCalled();
    });

    describe("licensee notification (#269)", () => {
      it("tells the licensee, once the transaction committed", async () => {
        let committed = false;
        prisma.$transaction.mockImplementation(
          async (fn: (tx: typeof prisma) => Promise<unknown>) => {
            const result = await fn(prisma);
            committed = true;
            return result;
          },
        );
        notifications.sendToUser.mockImplementation(() => {
          expect(committed).toBe(true);
          return Promise.resolve({ sent: 1, failed: 0, pruned: 0 });
        });

        await service.approve("admin-1", "req-1", {});
        await flushNotifications();

        expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
        expect(notifications.sendToUser).toHaveBeenCalledWith(
          "user-1",
          "LICENSE_RENEWAL_DECISION",
          "Renouvellement de licence approuvé",
          "Votre licence est renouvelée jusqu'au 31/08/2027.",
          {
            type: "LICENSE_RENEWAL_DECISION",
            requestId: "req-1",
            status: "APPROVED",
          },
        );
      });

      it("a notification failure never fails the decision", async () => {
        notifications.sendToUser.mockRejectedValue(new Error("FCM down"));

        await expect(service.approve("admin-1", "req-1", {})).resolves.toBe(
          DETAIL,
        );
        await flushNotifications();
        expect(notifications.sendToUser).toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalled();
      });

      it("a notifier that throws synchronously never fails the decision", async () => {
        notifications.sendToUser.mockImplementation(() => {
          throw new Error("boom");
        });

        await expect(service.approve("admin-1", "req-1", {})).resolves.toBe(
          DETAIL,
        );
      });

      it("nobody is notified when the decision did not happen (409)", async () => {
        prisma.licenseRenewalRequest.updateMany.mockResolvedValue({
          count: 0,
        });
        await expect(service.approve("admin-1", "req-1", {})).rejects.toThrow(
          ConflictException,
        );
        await flushNotifications();
        expect(notifications.sendToUser).not.toHaveBeenCalled();
      });
    });
  });

  describe("reject", () => {
    beforeEach(() => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue({
        status: LicenseRenewalStatus.PENDING,
        userId: "user-1",
      });
    });

    it("stores the decision with a conditional claim", async () => {
      await service.reject("admin-1", "req-1", {
        reason: "MEDICAL_RESTRICTION",
        comment: "Contre-indication à la compétition",
      });

      expect(prisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: "req-1", status: LicenseRenewalStatus.PENDING },
        data: {
          status: LicenseRenewalStatus.REJECTED,
          reviewedById: "admin-1",
          reviewedAt: NOW,
          rejectionReason: "MEDICAL_RESTRICTION",
          reviewComment: "Contre-indication à la compétition",
        },
      });
    });

    it("an empty comment is stored as null", async () => {
      await service.reject("admin-1", "req-1", {
        reason: "ILLEGIBLE",
        comment: "",
      });
      expect(prisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewComment: null }) as unknown,
        }),
      );
    });

    it("brings the certificate purge forward to decision + 30 days, never later", async () => {
      await service.reject("admin-1", "req-1", { reason: "ILLEGIBLE" });

      const deadline = new Date(
        NOW.getTime() + REJECTED_CERTIFICATE_RETENTION_DAYS * 86_400_000,
      );
      expect(REJECTED_CERTIFICATE_RETENTION_DAYS).toBe(30);
      expect(prisma.licenseRenewalDocument.updateMany).toHaveBeenCalledWith({
        where: {
          requestId: "req-1",
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          // min(existing, deadline): an earlier deadline is left untouched.
          OR: [{ purgeDueAt: null }, { purgeDueAt: { gt: deadline } }],
        },
        data: { purgeDueAt: deadline },
      });
    });

    it("audits the status only — never the reason nor the comment", async () => {
      await service.reject("admin-1", "req-1", {
        reason: "MEDICAL_RESTRICTION",
        comment: "Contre-indication",
      });

      expect(auditEntry()).toEqual({
        actorId: "admin-1",
        action: "LICENSE_RENEWAL_REJECT",
        targetType: "LICENSE_RENEWAL",
        targetId: "req-1",
        before: { status: "PENDING" },
        after: { status: "REJECTED" },
      });
    });

    it.each([
      [{ reason: "OTHER" as const, comment: "Illisible" }],
      [{ reason: "MEDICAL_RESTRICTION" as const }],
    ])(
      "400 for %j when no medical certificate row remains: nothing would ever purge it",
      async (dto) => {
        prisma.licenseRenewalDocument.count.mockResolvedValue(0);

        await expect(service.reject("admin-1", "req-1", dto)).rejects.toThrow(
          BadRequestException,
        );
        expect(prisma.licenseRenewalRequest.updateMany).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      },
    );

    it("a plain refusal needs no certificate row", async () => {
      prisma.licenseRenewalDocument.count.mockResolvedValue(0);

      await service.reject("admin-1", "req-1", { reason: "INCOMPLETE" });

      expect(prisma.licenseRenewalDocument.count).not.toHaveBeenCalled();
      expect(prisma.licenseRenewalRequest.updateMany).toHaveBeenCalled();
    });

    it("409 and nothing else written when the claim lost", async () => {
      prisma.licenseRenewalRequest.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reject("admin-1", "req-1", { reason: "OTHER" }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.licenseRenewalDocument.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    describe("licensee notification (#269)", () => {
      it("tells the licensee without the reason nor the comment (health data)", async () => {
        await service.reject("admin-1", "req-1", {
          reason: "MEDICAL_RESTRICTION",
          comment: "Contre-indication cardiaque",
        });
        await flushNotifications();

        expect(notifications.sendToUser).toHaveBeenCalledWith(
          "user-1",
          "LICENSE_RENEWAL_DECISION",
          "Renouvellement de licence refusé",
          expect.any(String),
          {
            type: "LICENSE_RENEWAL_DECISION",
            requestId: "req-1",
            status: "REJECTED",
          },
        );
        const serialized = JSON.stringify(notifications.sendToUser.mock.calls);
        for (const leak of [
          "MEDICAL_RESTRICTION",
          "Contre-indication",
          "cardiaque",
          "médical",
        ]) {
          expect(serialized).not.toContain(leak);
        }
      });

      it("a notification failure never fails the decision", async () => {
        notifications.sendToUser.mockRejectedValue(new Error("FCM down"));

        await expect(
          service.reject("admin-1", "req-1", { reason: "OTHER" }),
        ).resolves.toBe(DETAIL);
        await flushNotifications();
        expect(notifications.sendToUser).toHaveBeenCalled();
      });

      it("nobody is notified when the decision was refused (400)", async () => {
        prisma.licenseRenewalDocument.count.mockResolvedValue(0);

        await expect(
          service.reject("admin-1", "req-1", { reason: "MEDICAL_RESTRICTION" }),
        ).rejects.toThrow(BadRequestException);
        await flushNotifications();
        expect(notifications.sendToUser).not.toHaveBeenCalled();
      });
    });
  });
});
