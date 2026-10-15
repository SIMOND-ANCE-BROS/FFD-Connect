import {
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
} from "@prisma/client";
import { Readable } from "stream";
import { AdminAuditService } from "../admin/admin-audit.service";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { HealthDataAccessLogService } from "../health-data-access/health-data-access-log.service";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { LicenseRenewalModerationQueryService } from "./license-renewal-moderation.query-service";

const NOW = new Date("2027-03-15T10:00:00.000Z");

describe("LicenseRenewalModerationQueryService", () => {
  const prisma = {
    licenseRenewalRequest: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    licenseRenewalDocument: { findFirst: jest.fn() },
    adminAuditLog: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { recordOp: jest.fn() };
  const healthAccess = { recordOp: jest.fn() };
  const blob = {
    isEnabled: jest.fn(),
    downloadStream: jest.fn(),
    getUploadsContainer: jest.fn(),
  };
  const breaker = { fire: jest.fn() };
  const service = new LicenseRenewalModerationQueryService(
    prisma as unknown as PrismaService,
    audit as unknown as AdminAuditService,
    healthAccess as unknown as HealthDataAccessLogService,
    blob as unknown as BlobStorageService,
    breaker as unknown as CircuitBreakerService,
  );

  const row = (status: LicenseRenewalStatus) => ({
    id: "req-1",
    userId: "user-1",
    status,
    createdAt: NOW,
    submittedAt: NOW,
    reviewedAt: null,
    rejectionReason: null,
    reviewComment: null,
    user: {
      id: "user-1",
      firstName: "Ada",
      lastName: "L",
      license: null,
    },
    reviewedBy: null,
    documents: [
      {
        id: "doc-1",
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        createdAt: NOW,
        ocrData: { isApte: true, rawText: "secret", date: "2027-01-01" },
      },
    ],
  });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers({ now: NOW });
    prisma.licenseRenewalRequest.count.mockResolvedValue(0);
    prisma.licenseRenewalRequest.findMany.mockResolvedValue([]);
    prisma.adminAuditLog.findMany.mockResolvedValue([]);
    audit.recordOp.mockResolvedValue({ id: "a1" });
    healthAccess.recordOp.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    blob.isEnabled.mockReturnValue(true);
    blob.getUploadsContainer.mockReturnValue("uploads");
    breaker.fire.mockImplementation(
      (_key: string, fn: () => Promise<unknown>) => fn(),
    );
  });

  afterEach(() => jest.useRealTimers());

  describe("list", () => {
    it("defaults to PENDING, oldest submission first, bounded page", async () => {
      await service.list({});

      expect(prisma.licenseRenewalRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: LicenseRenewalStatus.PENDING },
          orderBy: [
            { submittedAt: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
            { id: "asc" },
          ],
          skip: 0,
          take: 20,
        }),
      );
    });

    it.each([
      [
        "name",
        "asc",
        [
          { user: { lastName: "asc" } },
          { user: { firstName: "asc" } },
          { id: "asc" },
        ],
      ],
      [
        "licenseNumber",
        "desc",
        [{ user: { license: { number: "desc" } } }, { id: "desc" }],
      ],
      [
        "validUntil",
        "asc",
        [{ user: { license: { validUntil: "asc" } } }, { id: "asc" }],
      ],
      [
        "submittedAt",
        "desc",
        [{ submittedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      ],
      [
        "reviewedAt",
        "asc",
        [{ reviewedAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      ],
    ] as const)(
      "sorts the whole queue on %s %s",
      async (sortBy, sortOrder, orderBy) => {
        await service.list({ sortBy, sortOrder });
        expect(
          prisma.licenseRenewalRequest.findMany.mock.calls[0][0]?.orderBy,
        ).toEqual(orderBy);
      },
    );

    it("filters by the requested status and paginates", async () => {
      prisma.licenseRenewalRequest.count.mockResolvedValue(3);
      prisma.licenseRenewalRequest.findMany.mockResolvedValue([
        row(LicenseRenewalStatus.REJECTED),
      ]);

      const page = await service.list({
        status: LicenseRenewalStatus.REJECTED,
        skip: 1,
        take: 1,
      });

      expect(prisma.licenseRenewalRequest.count).toHaveBeenCalledWith({
        where: { status: LicenseRenewalStatus.REJECTED },
      });
      expect(page.meta).toEqual({ total: 3, skip: 1, take: 1, hasMore: true });
      expect(page.data[0].user).toEqual({
        id: "user-1",
        firstName: "Ada",
        lastName: "L",
        license: null,
      });
      // The queue is not audited: no reason code (MEDICAL_RESTRICTION is
      // health data), no comment.
      expect(page.data[0]).not.toHaveProperty("rejectionReason");
      expect(page.data[0]).not.toHaveProperty("reviewComment");
    });

    it("writes no audit row", async () => {
      await service.list({});
      expect(audit.recordOp).not.toHaveBeenCalled();
    });
  });

  describe("detail", () => {
    it("404 for an unknown request, no audit", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(null);
      await expect(service.detail("admin-1", "req-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(audit.recordOp).not.toHaveBeenCalled();
    });

    it("audits the view, shows whitelisted OCR hints and the validity an approval would grant", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(
        row(LicenseRenewalStatus.PENDING),
      );
      prisma.licenseRenewalRequest.findMany.mockResolvedValue([
        { id: "old", status: "APPROVED" },
      ]);

      const detail = await service.detail("admin-1", "req-1");

      expect(audit.recordOp).toHaveBeenCalledWith({
        actorId: "admin-1",
        action: "LICENSE_RENEWAL_VIEW",
        targetType: "LICENSE_RENEWAL",
        targetId: "req-1",
      });
      // Health-data access journal (#63): subject, ids, route — no content.
      expect(healthAccess.recordOp).toHaveBeenCalledWith([
        {
          subjectUserId: "user-1",
          actorUserId: "admin-1",
          actorRole: "ADMIN",
          action: "READ",
          resourceType: "LICENSE_RENEWAL_REQUEST",
          resourceId: "req-1",
          route: "GET /admin/license-renewals/:id",
        },
      ]);
      // Both traces in one transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(detail.documents[0].ocr).toEqual({
        isApte: true,
        date: "2027-01-01",
      });
      expect(detail.renewsUntil).toEqual(new Date("2027-08-31T21:59:59.999Z"));
      expect(detail.history).toEqual([{ id: "old", status: "APPROVED" }]);
      expect(detail).toHaveProperty("rejectionReason", null);
      expect(prisma.licenseRenewalRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1", id: { not: "req-1" } },
          take: 20,
        }),
      );
    });

    it("hides OCR hints and the validity preview once decided", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(
        row(LicenseRenewalStatus.REJECTED),
      );

      const detail = await service.detailAfterDecision("req-1");

      expect(detail.documents[0].ocr).toBeNull();
      expect(detail.renewsUntil).toBeNull();
      expect(audit.recordOp).not.toHaveBeenCalled();
      expect(healthAccess.recordOp).not.toHaveBeenCalled();
    });

    it("shows nothing when the health-data access row cannot be written", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(
        row(LicenseRenewalStatus.PENDING),
      );
      healthAccess.recordOp.mockRejectedValue(new Error("db down"));
      await expect(service.detail("admin-1", "req-1")).rejects.toThrow(
        "db down",
      );
      // The detail (and its OCR hints) is never assembled.
      expect(prisma.licenseRenewalRequest.findMany).not.toHaveBeenCalled();
    });
  });

  describe("decidedAutomatically (#524)", () => {
    const admin = { id: "admin-1", firstName: "Gabin", lastName: "S" };
    const decided = (
      id: string,
      status: LicenseRenewalStatus,
      reviewedBy: typeof admin | null,
    ) => ({ ...row(status), id, reviewedAt: NOW, reviewedBy });

    it("is true only for an approval without reviewer nor decision audit row", async () => {
      prisma.licenseRenewalRequest.findMany.mockResolvedValue([
        decided("legacy-auto", LicenseRenewalStatus.APPROVED, null),
        decided("deleted-admin", LicenseRenewalStatus.APPROVED, null),
        decided("by-admin", LicenseRenewalStatus.APPROVED, admin),
      ]);
      prisma.adminAuditLog.findMany.mockResolvedValue([
        { targetId: "deleted-admin" },
      ]);

      const page = await service.list({
        status: LicenseRenewalStatus.APPROVED,
      });

      expect(
        page.data.map((r) => [r.id, r.decidedAutomatically, r.reviewedBy]),
      ).toEqual([
        ["legacy-auto", true, null],
        ["deleted-admin", false, null],
        ["by-admin", false, admin],
      ]);
      // Only the ambiguous rows are looked up, in one bounded query.
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith({
        where: {
          targetType: "LICENSE_RENEWAL",
          targetId: { in: ["legacy-auto", "deleted-admin"] },
          action: {
            in: ["LICENSE_RENEWAL_APPROVE", "LICENSE_RENEWAL_REJECT"],
          },
        },
        select: { targetId: true },
        distinct: ["targetId"],
        take: 2,
      });
    });

    it("a refusal without reviewer is never automatic, without any lookup", async () => {
      prisma.licenseRenewalRequest.findMany.mockResolvedValue([
        decided("rejected", LicenseRenewalStatus.REJECTED, null),
      ]);

      const page = await service.list({
        status: LicenseRenewalStatus.REJECTED,
      });

      expect(page.data[0].decidedAutomatically).toBe(false);
      expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled();
    });

    it("a pending request is not decided: false, no lookup", async () => {
      prisma.licenseRenewalRequest.findMany.mockResolvedValue([
        row(LicenseRenewalStatus.PENDING),
      ]);

      const page = await service.list({});

      expect(page.data[0].decidedAutomatically).toBe(false);
      expect(prisma.adminAuditLog.findMany).not.toHaveBeenCalled();
    });

    it("is computed in the detail too", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(
        decided("req-1", LicenseRenewalStatus.APPROVED, null),
      );

      const detail = await service.detail("admin-1", "req-1");

      expect(detail.decidedAutomatically).toBe(true);
      expect(prisma.adminAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetId: { in: ["req-1"] } }),
        }),
      );
    });

    it("the detail of a deleted admin's approval is not automatic", async () => {
      prisma.licenseRenewalRequest.findUnique.mockResolvedValue(
        decided("req-1", LicenseRenewalStatus.APPROVED, null),
      );
      prisma.adminAuditLog.findMany.mockResolvedValue([{ targetId: "req-1" }]);

      const detail = await service.detail("admin-1", "req-1");

      expect(detail.decidedAutomatically).toBe(false);
    });
  });

  describe("openDocument", () => {
    const doc = (o: {
      status?: LicenseRenewalStatus;
      filePath?: string;
      type?: LicenseRenewalDocumentType;
    }) => ({
      type: o.type ?? LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      filePath: o.filePath ?? "document-1.PDF",
      request: {
        status: o.status ?? LicenseRenewalStatus.PENDING,
        userId: "user-1",
      },
    });

    it("404 for a document of another request", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(null);
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.licenseRenewalDocument.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "doc-1", requestId: "req-1" } }),
      );
    });

    it.each([LicenseRenewalStatus.APPROVED, LicenseRenewalStatus.REJECTED])(
      "410 once the request is %s, nothing read nor audited",
      async (status) => {
        prisma.licenseRenewalDocument.findFirst.mockResolvedValue(
          doc({ status }),
        );
        await expect(
          service.openDocument("admin-1", "req-1", "doc-1"),
        ).rejects.toThrow(GoneException);
        expect(blob.downloadStream).not.toHaveBeenCalled();
        expect(audit.recordOp).not.toHaveBeenCalled();
      },
    );

    it("404 for a legacy disk path or without blob storage", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(
        doc({ filePath: "uploads/renewal/x.jpg" }),
      );
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow(NotFoundException);

      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      blob.isEnabled.mockReturnValue(false);
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow(NotFoundException);
      expect(blob.downloadStream).not.toHaveBeenCalled();
    });

    it("audits the access BEFORE reading the file, behind the azure-blob breaker", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      const stream = Readable.from(["%PDF"]);
      blob.downloadStream.mockResolvedValue(stream);

      const file = await service.openDocument("admin-1", "req-1", "doc-1");

      expect(file).toEqual({ stream, contentType: "application/pdf" });
      expect(audit.recordOp).toHaveBeenCalledWith({
        actorId: "admin-1",
        action: "LICENSE_RENEWAL_DOCUMENT_VIEW",
        targetType: "LICENSE_RENEWAL",
        targetId: "req-1",
        after: {
          documentId: "doc-1",
          documentType: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        },
      });
      expect(breaker.fire).toHaveBeenCalledWith(
        "azure-blob",
        expect.any(Function),
      );
      expect(blob.downloadStream).toHaveBeenCalledWith(
        "document-1.PDF",
        "uploads",
      );
      expect(audit.recordOp.mock.invocationCallOrder[0]).toBeLessThan(
        blob.downloadStream.mock.invocationCallOrder[0],
      );
      expect(healthAccess.recordOp).toHaveBeenCalledWith([
        {
          subjectUserId: "user-1",
          actorUserId: "admin-1",
          actorRole: "ADMIN",
          action: "DOWNLOAD",
          resourceType: "MEDICAL_CERTIFICATE",
          resourceId: "doc-1",
          route: "GET /admin/license-renewals/:id/documents/:docId/file",
        },
      ]);
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        blob.downloadStream.mock.invocationCallOrder[0],
      );
    });

    it("a licence certificate is not health data: audit row only", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(
        doc({ type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE }),
      );
      blob.downloadStream.mockResolvedValue(Readable.from([]));

      await service.openDocument("admin-1", "req-1", "doc-1");

      expect(audit.recordOp).toHaveBeenCalledTimes(1);
      expect(healthAccess.recordOp).not.toHaveBeenCalled();
    });

    it("no file served when the health-data access row cannot be written", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      healthAccess.recordOp.mockRejectedValue(new Error("db down"));
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow("db down");
      expect(blob.downloadStream).not.toHaveBeenCalled();
    });

    it("unknown extension → application/octet-stream", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(
        doc({ filePath: "document-1" }),
      );
      blob.downloadStream.mockResolvedValue(Readable.from([]));
      const file = await service.openDocument("admin-1", "req-1", "doc-1");
      expect(file.contentType).toBe("application/octet-stream");
    });

    it("no file served when the audit row cannot be written", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      audit.recordOp.mockRejectedValue(new Error("db down"));
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow("db down");
      expect(blob.downloadStream).not.toHaveBeenCalled();
    });

    it("a missing blob is a 404 that does NOT count as a breaker failure", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      blob.downloadStream.mockRejectedValueOnce({ statusCode: 404 });
      let insideBreaker: Promise<unknown> | undefined;
      breaker.fire.mockImplementation(
        (_key: string, fn: () => Promise<unknown>) => {
          insideBreaker = fn();
          return insideBreaker;
        },
      );

      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow(NotFoundException);
      // The breaker's callback resolved: opossum records a success.
      await expect(insideBreaker).resolves.toBeNull();
    });

    it("503 when storage fails", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      blob.downloadStream.mockRejectedValueOnce(new Error("boom"));
      await expect(
        service.openDocument("admin-1", "req-1", "doc-1"),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it("destroys a stream that arrives after the timeout", async () => {
      prisma.licenseRenewalDocument.findFirst.mockResolvedValue(doc({}));
      let deliver: (stream: Readable) => void = () => undefined;
      blob.downloadStream.mockReturnValue(
        new Promise<Readable>((resolve) => {
          deliver = resolve;
        }),
      );
      const late = Readable.from(["%PDF"]);
      const destroy = jest.spyOn(late, "destroy");

      const opening = service.openDocument("admin-1", "req-1", "doc-1");
      const assertion = expect(opening).rejects.toThrow(
        ServiceUnavailableException,
      );
      await jest.advanceTimersByTimeAsync(10_001);
      await assertion;
      deliver(late);
      await jest.advanceTimersByTimeAsync(0);

      expect(destroy).toHaveBeenCalled();
    });
  });
});
