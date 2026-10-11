import { randomUUID } from "crypto";
import { Readable } from "stream";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  NotificationType,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { HealthDataRetentionService } from "../src/licenses/health-data-retention.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { BlobStorageService } from "../src/storage/blob-storage.service";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Licence renewal notifications (#269) on a real database: the REAL
 * NotificationsService (feed rows, preference reads; Firebase is not
 * configured, so no push leaves) behind the real submission and moderation
 * endpoints. This is also what proves the two enum values exist in the
 * migrated schema: every write below goes through the Postgres enum.
 */
describe("Licence renewal notifications (integration, real DB)", () => {
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

  /** Names that must never reach a notification. */
  const FIRST_NAME = "Zephyrine";
  const LAST_NAME = "Confidentielle";

  const createUser = async (role: UserRole) => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: FIRST_NAME,
        lastName: LAST_NAME,
        role,
      },
      select: { id: true, email: true, role: true },
    });
    userIds.push(user.id);
    return user;
  };

  const bearer = (u: { id: string; email: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: u.id, email: u.email, role: u.role })}`;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  /** Notifications are fire-and-forget: wait for the row to land. */
  const waitForNotification = async (
    userId: string,
    type: NotificationType,
  ) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = await prisma.notification.findFirst({
        where: { userId, type },
        select: { title: true, body: true, data: true },
      });
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No ${type} notification for ${userId}`);
  };

  const pendingRequest = (userId: string) =>
    prisma.licenseRenewalRequest.create({
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
              ocrData: {
                licenseNumber: `FFD-${randomUUID().slice(0, 8)}`,
              },
            },
          ],
        },
      },
      select: { id: true },
    });

  const expectNoPersonalData = (row: {
    title: string;
    body: string;
    data: unknown;
  }) => {
    const serialized = JSON.stringify(row);
    for (const leak of [
      FIRST_NAME,
      LAST_NAME,
      "Dr Secret",
      "MEDICAL_RESTRICTION",
      "Contre-indication",
      "médical",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  };

  beforeAll(async () => {
    jest
      .spyOn(HealthDataRetentionService.prototype, "onModuleInit")
      .mockImplementation(() => undefined);
    ({ app, prisma, jwt } = await buildHttpApp({
      extra: (builder) =>
        builder
          .overrideProvider(BlobStorageService)
          .useValue(fakeBlob)
          // The shared builder mocks notifications; this suite needs the
          // real feed writes and preference reads.
          .overrideProvider(NotificationsService)
          .useClass(NotificationsService),
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
    await prisma.notification.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.license.deleteMany({ where: { userId: { in: userIds } } });
    // Cascades to the requests, their documents and the preferences.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it("a submission left for human review notifies the administrators", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    // The number read on the certificate is already another account's: the
    // automatic approval steps aside and the request stays PENDING.
    const holder = await createUser(UserRole.LICENSEE);
    const takenNumber = `FFD-${randomUUID().slice(0, 8)}`;
    await prisma.license.create({
      data: {
        userId: holder.id,
        number: takenNumber,
        validUntil: new Date("2020-08-31T00:00:00Z"),
        category: "Standard",
        clubName: "Club",
      },
      select: { id: true },
    });
    const draft = await prisma.licenseRenewalRequest.create({
      data: {
        userId: licensee.id,
        status: LicenseRenewalStatus.DRAFT,
        documents: {
          create: [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              filePath: `medical-${randomUUID()}.pdf`,
              ocrData: {
                isApte: true,
                date: new Date().toISOString().slice(0, 10),
              },
              purgeDueAt: new Date("2099-01-01T00:00:00Z"),
            },
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              filePath: `licence-${randomUUID()}.png`,
              ocrData: { licenseNumber: takenNumber },
            },
          ],
        },
      },
      select: { id: true },
    });

    const res = await request(server())
      .post(`/api/v1/licenses/renewal/${draft.id}/submit`)
      .set("Authorization", bearer(licensee))
      .expect(201);
    expect(res.body.status).toBe(LicenseRenewalStatus.PENDING);

    const row = await waitForNotification(
      admin.id,
      NotificationType.LICENSE_RENEWAL_TO_REVIEW,
    );
    expect(row.data).toEqual({
      type: "LICENSE_RENEWAL_TO_REVIEW",
      requestId: draft.id,
    });
    expectNoPersonalData(row);
    // The licensee is not told anything yet: no decision was taken.
    expect(
      await prisma.notification.count({
        where: { userId: licensee.id },
      }),
    ).toBe(0);
  });

  it("an approval notifies the licensee with the granted validity", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id);

    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/approve`)
      .set("Authorization", bearer(admin))
      .send({})
      .expect(200);

    const row = await waitForNotification(
      licensee.id,
      NotificationType.LICENSE_RENEWAL_DECISION,
    );
    expect(row.title).toBe("Renouvellement de licence approuvé");
    expect(row.body).toMatch(
      /^Votre licence est renouvelée jusqu'au \d{2}\/\d{2}\/\d{4}\.$/,
    );
    expect(row.data).toEqual({
      type: "LICENSE_RENEWAL_DECISION",
      requestId: pending.id,
      status: "APPROVED",
    });
    expectNoPersonalData(row);
  });

  it("a rejection notifies the licensee without the reason nor the comment", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    const pending = await pendingRequest(licensee.id);

    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({
        reason: "MEDICAL_RESTRICTION",
        comment: "Contre-indication temporaire",
      })
      .expect(200);

    const row = await waitForNotification(
      licensee.id,
      NotificationType.LICENSE_RENEWAL_DECISION,
    );
    expect(row.title).toBe("Renouvellement de licence refusé");
    expect(row.data).toEqual({
      type: "LICENSE_RENEWAL_DECISION",
      requestId: pending.id,
      status: "REJECTED",
    });
    expectNoPersonalData(row);
  });

  it("offers each type to its audience only, and stores a switch for it", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);

    const typesOf = async (user: typeof admin) =>
      (
        (
          await request(server())
            .get("/api/v1/notifications/preferences")
            .set("Authorization", bearer(user))
            .expect(200)
        ).body as { type: string }[]
      ).map((entry) => entry.type);

    expect(await typesOf(admin)).toEqual(
      expect.arrayContaining([
        "LICENSE_RENEWAL_TO_REVIEW",
        "LICENSE_RENEWAL_DECISION",
      ]),
    );
    const licenseeTypes = await typesOf(licensee);
    expect(licenseeTypes).toContain("LICENSE_RENEWAL_DECISION");
    expect(licenseeTypes).not.toContain("LICENSE_RENEWAL_TO_REVIEW");

    await request(server())
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", bearer(licensee))
      .send({ type: "LICENSE_RENEWAL_DECISION", enabled: false })
      .expect(200);
    expect(
      await prisma.notificationPreference.findUnique({
        where: {
          userId_type: {
            userId: licensee.id,
            type: NotificationType.LICENSE_RENEWAL_DECISION,
          },
        },
        select: { enabled: true },
      }),
    ).toEqual({ enabled: false });
    // A licensee cannot switch the administrators' type.
    await request(server())
      .patch("/api/v1/notifications/preferences")
      .set("Authorization", bearer(licensee))
      .send({ type: "LICENSE_RENEWAL_TO_REVIEW", enabled: false })
      .expect(403);
  });

  it("a switched-off push still writes the in-app feed", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const licensee = await createUser(UserRole.LICENSEE);
    await prisma.notificationPreference.create({
      data: {
        userId: licensee.id,
        type: NotificationType.LICENSE_RENEWAL_DECISION,
        enabled: false,
      },
      select: { id: true },
    });
    const pending = await pendingRequest(licensee.id);

    await request(server())
      .post(`/api/v1/admin/license-renewals/${pending.id}/reject`)
      .set("Authorization", bearer(admin))
      .send({ reason: "OTHER" })
      .expect(200);

    // Preferences govern the push only; the bell keeps the history.
    await waitForNotification(
      licensee.id,
      NotificationType.LICENSE_RENEWAL_DECISION,
    );
  });
});
