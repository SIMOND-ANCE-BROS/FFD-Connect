import { randomUUID } from "crypto";
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
import { buildHttpApp } from "./integration-app.builder";

/**
 * One PENDING licence renewal per user (#271) on a real database: real
 * JwtStrategy, row lock and transactions. Starting while a request awaits a
 * decision hands that request back; concurrent starts open a single draft.
 */
describe("Licence renewal: one PENDING request per user (integration, real DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const userIds: string[] = [];

  const createLicensee = async () => {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@test.local`,
        password: "x",
        firstName: "Test",
        lastName: "Pending",
        role: UserRole.LICENSEE,
      },
      select: { id: true, email: true, role: true },
    });
    userIds.push(user.id);
    return user;
  };

  const bearer = (u: { id: string; email: string; role: string }) =>
    `Bearer ${jwt.sign({ sub: u.id, email: u.email, role: u.role })}`;

  const createRequest = (
    userId: string,
    status: LicenseRenewalStatus,
    createdAt = new Date(),
  ) =>
    prisma.licenseRenewalRequest.create({
      data: {
        userId,
        status,
        createdAt,
        submittedAt:
          status === LicenseRenewalStatus.DRAFT ? null : new Date(createdAt),
        documents: {
          create: [
            {
              type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
              filePath: `medical-${randomUUID()}.pdf`,
              ocrData: { isApte: true },
              purgeDueAt: new Date("2099-01-01T00:00:00Z"),
            },
            {
              type: LicenseRenewalDocumentType.LICENSE_CERTIFICATE,
              filePath: `licence-${randomUUID()}.png`,
              ocrData: { licenseNumber: "FFD-271" },
            },
          ],
        },
      },
      select: { id: true },
    });

  const requestsOf = (userId: string) =>
    prisma.licenseRenewalRequest.findMany({
      where: { userId },
      select: { id: true, status: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    });

  beforeAll(async () => {
    jest
      .spyOn(HealthDataRetentionService.prototype, "onModuleInit")
      .mockImplementation(() => undefined);
    ({ app, prisma, jwt } = await buildHttpApp());
  });

  afterEach(async () => {
    // Cascades to the requests and their documents.
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const start = (u: { id: string; email: string; role: string }) =>
    request(server())
      .post("/api/v1/licenses/renewal/start")
      .set("Authorization", bearer(u));

  it("hands back the PENDING request instead of opening a new draft", async () => {
    const licensee = await createLicensee();
    const pending = await createRequest(
      licensee.id,
      LicenseRenewalStatus.PENDING,
    );

    const res = await start(licensee).expect(201);

    expect(res.body).toMatchObject({
      id: pending.id,
      status: LicenseRenewalStatus.PENDING,
    });
    expect(await requestsOf(licensee.id)).toEqual([
      { id: pending.id, status: LicenseRenewalStatus.PENDING },
    ]);
  });

  it("prefers the oldest PENDING request over a draft left from before #271", async () => {
    const licensee = await createLicensee();
    const older = await createRequest(
      licensee.id,
      LicenseRenewalStatus.PENDING,
      new Date("2026-09-01T08:00:00Z"),
    );
    await createRequest(
      licensee.id,
      LicenseRenewalStatus.PENDING,
      new Date("2026-09-02T08:00:00Z"),
    );
    await createRequest(
      licensee.id,
      LicenseRenewalStatus.DRAFT,
      new Date("2026-09-03T08:00:00Z"),
    );

    const res = await start(licensee).expect(201);

    expect(res.body).toMatchObject({ id: older.id, status: "PENDING" });
    expect(await requestsOf(licensee.id)).toHaveLength(3);
  });

  it("opens a draft again once the previous request has been decided", async () => {
    const licensee = await createLicensee();
    const rejected = await createRequest(
      licensee.id,
      LicenseRenewalStatus.REJECTED,
    );

    const res = await start(licensee).expect(201);

    expect(res.body).toMatchObject({ status: LicenseRenewalStatus.DRAFT });
    expect((res.body as { id: string }).id).not.toBe(rejected.id);
  });

  it("concurrent starts open a single draft (row lock)", async () => {
    const licensee = await createLicensee();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => start(licensee)),
    );

    const ids = new Set(
      responses.map((r) => {
        expect(r.status).toBe(201);
        return (r.body as { id: string }).id;
      }),
    );
    expect(ids.size).toBe(1);
    expect(await requestsOf(licensee.id)).toEqual([
      { id: [...ids][0], status: LicenseRenewalStatus.DRAFT },
    ]);
  });

  it("refuses (409) to submit a draft while another request is PENDING", async () => {
    const licensee = await createLicensee();
    const pending = await createRequest(
      licensee.id,
      LicenseRenewalStatus.PENDING,
      new Date("2026-09-01T08:00:00Z"),
    );
    const draft = await createRequest(
      licensee.id,
      LicenseRenewalStatus.DRAFT,
      new Date("2026-09-02T08:00:00Z"),
    );

    await request(server())
      .post(`/api/v1/licenses/renewal/${draft.id}/submit`)
      .set("Authorization", bearer(licensee))
      .expect(409);

    expect(await requestsOf(licensee.id)).toEqual([
      { id: pending.id, status: LicenseRenewalStatus.PENDING },
      { id: draft.id, status: LicenseRenewalStatus.DRAFT },
    ]);
    expect(
      await prisma.license.findUnique({
        where: { userId: licensee.id },
        select: { id: true },
      }),
    ).toBeNull();
  });
});
