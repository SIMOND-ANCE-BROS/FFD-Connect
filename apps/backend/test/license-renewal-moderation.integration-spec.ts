import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import * as path from "path";
import { Readable } from "stream";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { HealthDataRetentionService } from "../src/licenses/health-data-retention.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { BlobStorageService } from "../src/storage/blob-storage.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Human moderation of licence renewals (#266) end to end on a real database:
 * real JwtStrategy, guards, store-review interceptor, conditional claims and
 * transactions. Blob Storage is faked (no Azure in tests).
 */
describe("Licence renewal moderation (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const userIds: string[] = [];
  const fakeBlob = {
    isEnabled: () => true,
    getUploadsContainer: () => "uploads",
    getDefaultContainer: () => "tracks",
    downloadStream: jest.fn(() => Promise.resolve(Readable.from(["%PDF-1.7"]))),
    deleteFile: jest.fn(() => Promise.resolve(true)),
  };

  const createUser = async (role: UserRole, isStoreReview = false) => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Renewal",
        role,
        isStoreReview,
      },
      select: { id: true, email: true, role: true },
    });
    userIds.push(user.id);
    return user;
  };

  const bearer = (u: { id: string; email: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: u.id, email: u.email, role: u.role })}`;

  /** A PENDING request with its two documents (licence number read by OCR). */
  const pendingRequest = async (userId: string, ocrNumber?: string) => {
    const request = await prisma.licenseRenewalRequest.create({
      data: {
        userId,
        status: LicenseRenewalStatus.PENDING,
        submittedAt: new Date(),
        documents: {
          create: [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              filePath: `medical-${randomUUID()}.pdf`,
              ocrData: { isApte: true, doctorName: "Dr Secret" },
              purgeDueAt: new Date("2099-01-01T00:00:00Z"),
            },
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              filePath: `licence-${randomUUID()}.png`,
              ocrData: ocrNumber ? { licenseNumber: ocrNumber } : {},
            },
          ],
        },
      },
      select: { id: true, documents: { select: { id: true, type: true } } },
    });
    return request;
  };

  beforeAll(async () => {
    ({ app, prisma, jwt } = await buildHttpApp({
      extra: (builder) =>
        builder.overrideProvider(BlobStorageService).useValue(fakeBlob),
    }));
  });

  afterEach(async () => {
    const requests = await prisma.licenseRenewalRequest.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
      take: 100,
    });
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: { in: requests.map((r) => r.id) } },
    });
    await prisma.license.deleteMany({ where: { userId: { in: userIds } } });
    // Cascades to the requests and their documents.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  it("backfills submittedAt from updatedAt for submitted requests only (migration)", async () => {
    const licensee = await createUser(UserRole.LICENSEE);
    const updatedAt = new Date("2026-03-04T05:06:07.000Z");
    const [draft, pending] = await Promise.all(
      [LicenseRenewalStatus.DRAFT, LicenseRenewalStatus.PENDING].map((status) =>
        prisma.licenseRenewalRequest.create({
          data: { userId: licensee.id, status, updatedAt },
          select: { id: true },
        }),
      ),
    );
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../prisma/schema/migrations/20261011120000_license_renewal_moderation/migration.sql",
      ),
      "utf8",
    );
    const backfill = sql.slice(sql.indexOf('UPDATE "LicenseRenewalRequest"'));

    await prisma.$executeRawUnsafe(backfill);

    const rows = await prisma.licenseRenewalRequest.findMany({
      where: { id: { in: [draft.id, pending.id] } },
      select: { id: true, submittedAt: true },
      take: 2,
    });
    const byId = new Map(rows.map((r) => [r.id, r.submittedAt]));
    expect(byId.get(draft.id)).toBeNull();
    expect(byId.get(pending.id)).toEqual(updatedAt);
  });

  it("lists the queue oldest first and serves an audited detail", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const older = await pendingRequest(licensee.id, "FFD-1");
    await prisma.licenseRenewalRequest.update({
      where: { id: older.id },
      data: { submittedAt: new Date("2020-01-01T00:00:00Z") },
    });

    const list = await request(server())
      .get("/api/v1/admin/license-renewals?take=50")
      .set("Authorization", bearer(admin))
      .expect(200);
    expect(list.body.data[0].id).toBe(older.id);
    expect(JSON.stringify(list.body)).not.toContain("Dr Secret");

    await request(server())
      .get("/api/v1/admin/license-renewals?take=51")
      .set("Authorization", bearer(admin))
      .expect(400);

    const detail = await request(server())
      .get(`/api/v1/admin/license-renewals/${older.id}`)
      .set("Authorization", bearer(admin))
      .expect(200);
    expect(detail.body.documents).toHaveLength(2);
    const views = await prisma.adminAuditLog.findMany({
      where: { targetId: older.id, action: "LICENSE_RENEWAL_VIEW" },
      select: { actorId: true, before: true, after: true },
      take: 5,
    });
    expect(views).toEqual([{ actorId: admin.id, before: null, after: null }]);
  });

  it("serves a document with protective headers while PENDING, 410 after the decision", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id, "FFD-2");
    const medical = pending.documents.find(
      (d) => d.type === LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
    );
    const url = `/api/v1/admin/license-renewals/${pending.id}/documents/${medical?.id}/file`;

    const file = await request(server())
      .get(url)
      .set("Authorization", bearer(admin))
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(file.headers["cache-control"]).toBe("no-store");
    expect(file.headers["content-disposition"]).toBe("inline");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["content-security-policy"]).toBe("sandbox");
    expect((file.body as Buffer).toString()).toBe("%PDF-1.7");

    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({ reason: "ILLEGIBLE" })
      .expect(200);

    await request(server())
      .get(url)
      .set("Authorization", bearer(admin))
      .expect(410);
    const docViews = await prisma.adminAuditLog.count({
      where: { targetId: pending.id, action: "LICENSE_RENEWAL_DOCUMENT_VIEW" },
    });
    expect(docViews).toBe(1);
  });

  it("two concurrent approvals: one succeeds, the other gets 409, the licence is renewed once (#261)", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id, "FFD-CONC");

    const results = await Promise.all(
      [0, 1].map(() =>
        request(server())
          .post(`/api/v1/admin/license-renewals/${pending.id}/approve`)
          .set("Authorization", bearer(admin))
          .send({}),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const licences = await prisma.license.findMany({
      where: { userId: licensee.id },
      select: { number: true },
      take: 5,
    });
    expect(licences).toEqual([{ number: "FFD-CONC" }]);
    const approvals = await prisma.adminAuditLog.findMany({
      where: { targetId: pending.id, action: "LICENSE_RENEWAL_APPROVE" },
      select: { before: true, after: true },
      take: 5,
    });
    expect(approvals).toHaveLength(1);
    // Status and granted validity only: no health data.
    expect(Object.keys(approvals[0].after as object).sort()).toEqual([
      "status",
      "validUntil",
    ]);
    expect(JSON.stringify(approvals)).not.toContain("Dr Secret");
  });

  it("never invents a licence number: 400 without one, then approved with the admin's (#262)", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id);
    const approve = () =>
      request(server())
        .post(`/api/v1/admin/license-renewals/${pending.id}/approve`)
        .set("Authorization", bearer(admin));

    await approve().send({}).expect(400);
    expect(
      await prisma.licenseRenewalRequest.findUnique({
        where: { id: pending.id },
        select: { status: true },
      }),
    ).toEqual({ status: LicenseRenewalStatus.PENDING });

    const res = await approve()
      .send({ licenseNumber: `FFD-${randomUUID().slice(0, 8)}` })
      .expect(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.reviewedBy.id).toBe(admin.id);
  });

  it("rejects with a reason, brings the purge forward, and the purge erases the comment", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id, "FFD-3");

    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({ reason: "NOPE" })
      .expect(400);
    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({ reason: "OTHER", comment: "x".repeat(501) })
      .expect(400);

    const decidedAt = Date.now();
    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({ reason: "MEDICAL_RESTRICTION", comment: "Contre-indication" })
      .expect(200);

    const medical = await prisma.licenseRenewalDocument.findFirst({
      where: {
        requestId: pending.id,
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
      },
      select: { id: true, purgeDueAt: true },
    });
    expect(medical?.purgeDueAt?.getTime()).toBeLessThanOrEqual(
      decidedAt + 30 * 86_400_000 + 60_000,
    );
    const reject = await prisma.adminAuditLog.findFirst({
      where: { targetId: pending.id, action: "LICENSE_RENEWAL_REJECT" },
      select: { before: true, after: true },
    });
    expect(reject).toEqual({
      before: { status: "PENDING" },
      after: { status: "REJECTED" },
    });

    // 30 days later: the certificate is due.
    await prisma.licenseRenewalDocument.update({
      where: { id: medical?.id },
      data: { purgeDueAt: new Date(Date.now() - 1000) },
    });
    await app.get(HealthDataRetentionService).purgeExpiredHealthData();

    const after = await prisma.licenseRenewalRequest.findUnique({
      where: { id: pending.id },
      select: {
        status: true,
        rejectionReason: true,
        reviewComment: true,
        documents: { select: { type: true } },
      },
    });
    expect(after).toEqual({
      status: LicenseRenewalStatus.REJECTED,
      rejectionReason: "MEDICAL_RESTRICTION",
      reviewComment: null,
      documents: [{ type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE }],
    });
  });

  it("store-review account: empty reads, simulated decisions, no certificate", async () => {
    const reviewer = await createUser(UserRole.ADMIN, true);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id, "FFD-4");

    const list = await request(server())
      .get("/api/v1/admin/license-renewals")
      .set("Authorization", bearer(reviewer))
      .expect(200);
    expect(list.headers["x-demo-mode"]).toBe("simulated");
    expect(list.body.data).toEqual([]);

    const file = await request(server())
      .get(
        `/api/v1/admin/license-renewals/${pending.id}/documents/${pending.documents[0].id}/file`,
      )
      .set("Authorization", bearer(reviewer))
      .expect(200);
    expect(file.body).toEqual({});
    expect(fakeBlob.downloadStream).not.toHaveBeenCalled();

    const approve = await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/approve`)
      .set("Authorization", bearer(reviewer))
      .send({})
      .expect(200);
    expect(approve.headers["x-demo-mode"]).toBe("simulated");

    expect(
      await prisma.licenseRenewalRequest.findUnique({
        where: { id: pending.id },
        select: { status: true },
      }),
    ).toEqual({ status: LicenseRenewalStatus.PENDING });
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: pending.id } }),
    ).toBe(0);
  });

  it("refuses a non-admin with 403 (real guards)", async () => {
    const licensee = await createUser(UserRole.LICENSEE);
    await request(server())
      .get("/api/v1/admin/license-renewals")
      .set("Authorization", bearer(licensee))
      .expect(403);
  });
});
