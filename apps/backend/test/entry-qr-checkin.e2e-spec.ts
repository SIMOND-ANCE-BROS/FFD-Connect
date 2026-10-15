import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CompetitionStatus,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import {
  buildEntryQr,
  ENTRY_QR_STEP_SECONDS,
  entryQrStep,
  parseEntryQr,
  publicKeyFromRaw,
  signEntryQrStep,
  verifyEntryQr,
} from "./../src/licenses/qr/entry-qr";
import {
  ACTIVE_TEST_KEY_LABEL,
  testEntryQrPem,
  testEntryQrPrivateKey,
} from "./../src/licenses/qr/entry-qr-test-keys.mock";
import { EntryQrService } from "./../src/licenses/qr/entry-qr.service";
import { LicenseQrService } from "./../src/licenses/qr/license-qr.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { hashToken } from "./../src/utils/token-hash.util";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

const ENV: Record<string, string> = {
  QR_SIGNING_SECRET: "e2e-only-qr-signing-secret-0123456789",
  QR_SIGNATURE_MODE: "enforce",
  ENTRY_QR_SIGNING_KEY: testEntryQrPem(ACTIVE_TEST_KEY_LABEL),
};

interface BatchBody {
  version: number;
  keyId: string;
  licenseId: string;
  number: string;
  holderName: string;
  stepSeconds: number;
  firstStep: number;
  signatures: string[];
  coversUntil: string;
}

/**
 * Rotating entry QR, end to end (#24, ADR-0023): the licensee fetches a batch,
 * the QR of the current step is verified OFFLINE with the published public
 * key alone, accepted online at check-in, refused when replayed later, and an
 * offline scan synchronised afterwards is verified as of its scan time.
 */
describe("Rotating entry QR check-in (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let participantToken: string;
  let participantId: string;
  let licenseId: string;
  let competitionId: string;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const checkIn = (qrData: string, scannedAt?: string) =>
    request(server())
      .post("/api/v1/competitions/checkin/volunteer")
      .send({
        competitionId,
        token: "entry-qr-volunteer-token",
        qrData,
        ...(scannedAt ? { scannedAt } : {}),
      });

  const fetchBatch = async (token = participantToken): Promise<BatchBody> => {
    const res = await request(server())
      .get("/api/v1/licenses/my/entry-qr")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    return res.body as BatchBody;
  };

  const qrOf = (batch: BatchBody, step: number): string =>
    buildEntryQr(
      batch.keyId,
      {
        licenseId: batch.licenseId,
        number: batch.number,
        holderName: batch.holderName,
      },
      step,
      batch.signatures[step - batch.firstStep],
    );

  beforeAll(async () => {
    const config = {
      get: (key: string) => ENV[key],
    } as unknown as ConfigService;
    const entryQrService = new EntryQrService(config);
    const licenseQrService = new LicenseQrService(config, entryQrService);

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(EntryQrService)
        .useValue(entryQrService)
        .overrideProvider(LicenseQrService)
        .useValue(licenseQrService)
        .overrideProvider(RedisService)
        .useValue({
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
          deleteByPattern: jest.fn().mockResolvedValue(undefined),
          keys: jest.fn().mockResolvedValue([]),
          exists: jest.fn().mockResolvedValue(false),
          isAvailable: jest.fn().mockReturnValue(false),
          getClient: jest.fn().mockReturnValue(null),
          onModuleDestroy: jest.fn(),
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    await prisma.volunteerToken.deleteMany();
    await prisma.result.deleteMany();
    await prisma.scheduleItem.deleteMany();
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.competition.deleteMany();
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.license.deleteMany();
    await prisma.retiredLicenseNumber.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.user.deleteMany();

    const participant = await prisma.user.create({
      data: {
        email: "entry-qr-participant@ffd.com",
        password: "hash",
        firstName: "Jeanne",
        lastName: "Rotative",
        role: UserRole.LICENSEE,
        license: {
          create: {
            number: "FFD-EQR-0001",
            validUntil: new Date(Date.now() + 120 * 86_400_000),
            category: "Standard",
            clubName: "Club QR",
          },
        },
      },
      select: { id: true, email: true, role: true, license: true },
    });
    participantId = participant.id;
    licenseId = participant.license?.id ?? "";
    participantToken = jwtService.sign({
      sub: participant.id,
      email: participant.email,
      role: participant.role,
    });

    const comp = await prisma.competition.create({
      data: {
        title: "Entry QR Comp",
        // Spans yesterday to tomorrow: offline scans stay inside the event
        // days whatever the hour the suite runs at.
        date: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        location: "Paris",
        status: CompetitionStatus.UPCOMING,
      },
    });
    competitionId = comp.id;
    const event = await prisma.event.create({
      data: {
        competitionId,
        category: "Latin",
        ageGroup: "Adult",
        eventType: "COUPLE",
      },
    });
    await prisma.registration.create({
      data: {
        eventId: event.id,
        userId: participant.id,
        status: RegistrationStatus.CONFIRMED,
        feePaid: true,
      },
    });
    await prisma.volunteerToken.create({
      data: {
        token: hashToken("entry-qr-volunteer-token"),
        competitionId,
        expiresAt: new Date(Date.now() + 3_600_000),
        name: "Bénévole",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes the public key without authentication", async () => {
    const res = await request(server())
      .get("/api/v1/licenses/entry-qr/keys")
      .expect(200);
    expect(res.body).toMatchObject({
      version: 3,
      stepSeconds: ENTRY_QR_STEP_SECONDS,
      toleranceSteps: 1,
    });
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0]).toMatchObject({ active: true });
  });

  it("refuses the batch without a token, or under an impersonation", async () => {
    await request(server()).get("/api/v1/licenses/my/entry-qr").expect(401);
    const admin = await prisma.user.create({
      data: {
        email: "entry-qr-admin@ffd.com",
        password: "hash",
        firstName: "Ad",
        lastName: "Min",
        role: UserRole.ADMIN,
      },
    });
    const impersonation = jwtService.sign({
      sub: participantId,
      email: "entry-qr-participant@ffd.com",
      role: UserRole.LICENSEE,
      impersonatedBy: admin.id,
    });
    await request(server())
      .get("/api/v1/licenses/my/entry-qr")
      .set("Authorization", `Bearer ${impersonation}`)
      .expect(403);
  });

  it("issues a batch for the requester's licence that a scanner verifies offline", async () => {
    const batch = await fetchBatch();
    expect(batch).toMatchObject({
      version: 3,
      licenseId,
      number: "FFD-EQR-0001",
      holderName: "ROTATIVE Jeanne",
    });
    expect(batch.signatures.length).toBeGreaterThanOrEqual(1440);

    // Offline: only what GET /licenses/entry-qr/keys published.
    const keys = await request(server())
      .get("/api/v1/licenses/entry-qr/keys")
      .expect(200);
    const published = keys.body.keys[0] as { kid: string; publicKey: string };
    const parsed = parseEntryQr(qrOf(batch, entryQrStep(new Date())));
    expect(parsed.kind).toBe("entry");
    if (parsed.kind !== "entry") return;
    const offlineKeys = new Map([
      [published.kid, publicKeyFromRaw(published.publicKey)!],
    ]);
    expect(verifyEntryQr(parsed.payload, offlineKeys)).toBe("VALID");
  });

  /** Token of a past step, as the batch fetched back then held it. */
  const pastQr = (batch: BatchBody, instant: Date): string => {
    const step = entryQrStep(instant);
    const subject = {
      licenseId: batch.licenseId,
      number: batch.number,
      holderName: batch.holderName,
    };
    return buildEntryQr(
      batch.keyId,
      subject,
      step,
      signEntryQrStep(
        testEntryQrPrivateKey(ACTIVE_TEST_KEY_LABEL),
        batch.keyId,
        subject,
        step,
      ),
    );
  };

  it("refuses a screenshot replayed minutes later (enforce)", async () => {
    const batch = await fetchBatch();
    const captured = pastQr(batch, new Date(Date.now() - 5 * 60_000));
    const res = await checkIn(captured).expect(400);
    expect(String(res.body.message)).toContain("QR tournant périmé");
    const registration = await prisma.registration.findFirst({
      where: { userId: participantId },
      select: { checkedIn: true },
    });
    expect(registration?.checkedIn).toBe(false);
  });

  it("refuses a scan time in the future", async () => {
    const batch = await fetchBatch();
    await checkIn(
      qrOf(batch, entryQrStep(new Date())),
      new Date(Date.now() + 3_600_000).toISOString(),
    ).expect(400);
  });

  it("refuses a backdated replay of a captured token (security review)", async () => {
    const batch = await fetchBatch();
    // Token captured 3 h ago, replayed with a scan time that does not match
    // its step, then with a scan time beyond the 12 h sync window.
    const captured = pastQr(batch, new Date(Date.now() - 3 * 3_600_000));
    const wrongClaim = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const refused = await checkIn(captured, wrongClaim).expect(400);
    expect(String(refused.body.message)).toContain("QR d'entrée tournant");
    const tooOld = new Date(Date.now() - 13 * 3_600_000);
    await checkIn(pastQr(batch, tooOld), tooOld.toISOString()).expect(400);
    // A static QR can never carry a claimed scan time.
    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${participantToken}`)
      .expect(200);
    await checkIn(
      (me.body as { license: { qrCode: string } }).license.qrCode,
      new Date().toISOString(),
    ).expect(400);
    const registration = await prisma.registration.findFirst({
      where: { userId: participantId },
      select: { checkedIn: true },
    });
    expect(registration?.checkedIn).toBe(false);
  });

  it("checks in an offline scan synchronised later, keeping the claimed time apart", async () => {
    const batch = await fetchBatch();
    // Scanned offline two hours ago, synchronised now.
    const pastScan = new Date(Date.now() - 2 * 3_600_000);
    const qr = pastQr(batch, pastScan);
    await checkIn(qr).expect(400);
    const receivedFrom = Date.now();
    const res = await checkIn(qr, pastScan.toISOString()).expect(201);
    expect(res.body.qrVerification).toEqual({
      mode: "enforce",
      status: "VALID",
      warning: null,
    });
    expect(res.body.registrations[0].status).toBe("SUCCESS");
    const registration = await prisma.registration.findFirst({
      where: { userId: participantId },
      select: {
        checkedIn: true,
        checkInTime: true,
        checkInClaimedScanAt: true,
      },
    });
    expect(registration?.checkedIn).toBe(true);
    // Authoritative time = server receipt; the claim is stored apart.
    expect(registration?.checkInTime?.getTime()).toBeGreaterThanOrEqual(
      receivedFrom,
    );
    expect(registration?.checkInClaimedScanAt?.toISOString()).toBe(
      pastScan.toISOString(),
    );
    // Replaying the same token again: single use per licence.
    const again = await checkIn(qr, pastScan.toISOString()).expect(201);
    expect(again.body.registrations[0].status).toBe("ALREADY_CHECKED_IN");
  });

  it("checks in the QR of the current step (already checked in now)", async () => {
    const batch = await fetchBatch();
    const res = await checkIn(qrOf(batch, entryQrStep(new Date()))).expect(201);
    expect(res.body.qrVerification.status).toBe("VALID");
    expect(res.body.user.firstName).toBe("Jeanne");
    expect(res.body.registrations[0].status).toBe("ALREADY_CHECKED_IN");
  });

  it("answers 404 for an account without licence", async () => {
    const other = await prisma.user.create({
      data: {
        email: "entry-qr-nolicence@ffd.com",
        password: "hash",
        firstName: "No",
        lastName: "Licence",
        role: UserRole.LICENSEE,
      },
    });
    const token = jwtService.sign({
      sub: other.id,
      email: other.email,
      role: other.role,
    });
    await request(server())
      .get("/api/v1/licenses/my/entry-qr")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});
