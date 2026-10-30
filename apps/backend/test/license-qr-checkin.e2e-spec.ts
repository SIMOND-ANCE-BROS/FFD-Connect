import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CompetitionStatus,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import { createHmac } from "crypto";
import request from "supertest";
import { purgeTestUser } from "./../scripts/purge-test-accounts.utils";
import { AdminUserIdentifiersService } from "./../src/admin/admin-user-identifiers.service";
import { AppModule } from "./../src/app.module";
import { toLicenseQrExpiry } from "./../src/licenses/qr/license-qr";
import {
  LicenseQrService,
  STALE_LICENSE_QR_MESSAGE,
} from "./../src/licenses/qr/license-qr.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { hashToken } from "./../src/utils/token-hash.util";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

const QR_SECRET = "e2e-only-qr-signing-secret-0123456789";

/**
 * Signed license QR, end to end (#168): the QR exposed by GET /users/me is
 * accepted at check-in, a tampered or legacy QR is refused in `enforce` mode.
 * #466: a QR issued before an admin renames the licence number never
 * designates whoever holds that number afterwards.
 */
describe("Signed license QR check-in (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleFixture: TestingModule;
  let jwtService: JwtService;
  let participantId: string;
  let participantToken: string;
  let competitionId: string;
  let eventId: string;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const checkIn = (qrData: string) =>
    request(server())
      .post("/api/v1/competitions/checkin/volunteer")
      .send({ competitionId, token: "qr-volunteer-token", qrData });

  beforeAll(async () => {
    const qrService = new LicenseQrService({
      get: (key: string) =>
        ({
          QR_SIGNING_SECRET: QR_SECRET,
          QR_SIGNATURE_MODE: "enforce",
        })[key],
    } as unknown as ConfigService);

    moduleFixture = await applyE2EOverrides(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(LicenseQrService)
        .useValue(qrService)
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
        email: "qr-participant@ffd.com",
        password: "hash",
        firstName: "Qr",
        lastName: "Participant",
        role: UserRole.LICENSEE,
        license: {
          create: {
            number: "FFD-QR-0001",
            validUntil: new Date(Date.now() + 120 * 86_400_000),
            category: "Standard",
            clubName: "Club QR",
          },
        },
      },
    });
    participantId = participant.id;
    participantToken = jwtService.sign({
      sub: participant.id,
      email: participant.email,
      role: participant.role,
    });

    const comp = await prisma.competition.create({
      data: {
        title: "QR Test Comp",
        date: new Date(),
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
    eventId = event.id;
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
        token: hashToken("qr-volunteer-token"),
        competitionId,
        expiresAt: new Date(Date.now() + 3_600_000),
        name: "Bénévole",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function fetchSignedQr(token = participantToken): Promise<string> {
    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const qrCode = (me.body as { license: { qrCode: string | null } }).license
      .qrCode;
    expect(typeof qrCode).toBe("string");
    return qrCode as string;
  }

  it("refuses a QR whose license number was changed", async () => {
    const qrCode = await fetchSignedQr();
    const tampered = qrCode.replace("FFD-QR-0001", "FFD-QR-9999");

    const response = await checkIn(tampered).expect(400);
    expect(String(response.body.message)).toContain("signature invalide");
  });

  it("refuses a legacy unsigned QR", async () => {
    await checkIn(JSON.stringify({ id: "FFD-QR-0001", valid: true })).expect(
      400,
    );
  });

  it("checks in with the signed QR exposed by the API", async () => {
    const qrCode = await fetchSignedQr();

    const response = await checkIn(qrCode).expect(201);
    expect(response.body.user.firstName).toBe("Qr");
    expect(response.body.registrations[0].status).toBe("SUCCESS");
    expect(response.body.qrVerification).toEqual({
      mode: "enforce",
      status: "VALID",
      warning: null,
    });
  });

  it("never lets a QR issued before a licence number change designate the number's next holder (#466)", async () => {
    const issuedQr = await fetchSignedQr();
    expect(JSON.parse(issuedQr)).toMatchObject({ v: 2, id: "FFD-QR-0001" });
    const exp = toLicenseQrExpiry(new Date(Date.now() + 120 * 86_400_000));
    const v1Qr = JSON.stringify({
      v: 1,
      id: "FFD-QR-0001",
      exp,
      sig: createHmac("sha256", QR_SECRET)
        .update(JSON.stringify(["ffd-license-qr", 1, "FFD-QR-0001", exp]))
        .digest("base64url"),
    });

    // An administrator renames the licence (#448).
    const admin = await prisma.user.create({
      data: {
        email: "qr-admin@ffd.com",
        password: "hash",
        firstName: "Qr",
        lastName: "Admin",
        role: UserRole.ADMIN,
      },
    });
    await moduleFixture
      .get(AdminUserIdentifiersService)
      .update(admin.id, participantId, { licenseNumber: "FFD-QR-0002" });
    await expect(
      prisma.retiredLicenseNumber.findUnique({
        where: { number: "FFD-QR-0001" },
      }),
    ).resolves.toMatchObject({ number: "FFD-QR-0001" });

    // The old number goes to someone else, registered for the same event.
    const nextHolder = await prisma.user.create({
      data: {
        email: "qr-next-holder@ffd.com",
        password: "hash",
        firstName: "Next",
        lastName: "Holder",
        role: UserRole.LICENSEE,
        license: {
          create: {
            number: "FFD-QR-0001",
            validUntil: new Date(Date.now() + 120 * 86_400_000),
            category: "Standard",
            clubName: "Club QR",
          },
        },
      },
    });
    await prisma.registration.create({
      data: {
        eventId,
        userId: nextHolder.id,
        status: RegistrationStatus.CONFIRMED,
        feePaid: true,
      },
    });

    // Earlier QR codes (v2 and number-only v1) are refused, nobody checked in.
    const stale = await checkIn(issuedQr).expect(400);
    expect(String(stale.body.message)).toBe(STALE_LICENSE_QR_MESSAGE);
    await checkIn(v1Qr).expect(400);
    const nextHolderRegistration = await prisma.registration.findFirst({
      where: { userId: nextHolder.id },
      select: { checkedIn: true },
    });
    expect(nextHolderRegistration?.checkedIn).toBe(false);

    // Each holder's current QR works and designates the right person.
    const nextHolderToken = jwtService.sign({
      sub: nextHolder.id,
      email: nextHolder.email,
      role: nextHolder.role,
    });
    const nextHolderQr = await fetchSignedQr(nextHolderToken);
    const ok = await checkIn(nextHolderQr).expect(201);
    expect(ok.body.user.firstName).toBe("Next");
    expect(ok.body.qrVerification.status).toBe("VALID");

    const renamedQr = await fetchSignedQr();
    expect(JSON.parse(renamedQr)).toMatchObject({ id: "FFD-QR-0002" });
    const own = await checkIn(renamedQr).expect(201);
    expect(own.body.user.firstName).toBe("Qr");
  });

  it("never lets a QR issued before a licence deletion designate a licence recreated with the number (#491)", async () => {
    const number = "SCAN-TEST-4910";
    const validUntil = new Date(Date.now() + 120 * 86_400_000);
    // A seeded staging account holding a seeded licence (purged at boot).
    const seeded = await prisma.user.create({
      data: {
        email: "qr-seeded-scan@test.com",
        password: "hash",
        firstName: "Seeded",
        lastName: "Scan",
        role: UserRole.LICENSEE,
        license: {
          create: { number, validUntil, category: "Standard", clubName: "C" },
        },
      },
    });
    const exp = toLicenseQrExpiry(validUntil);
    const v1Qr = JSON.stringify({
      v: 1,
      id: number,
      exp,
      sig: createHmac("sha256", QR_SECRET)
        .update(JSON.stringify(["ffd-license-qr", 1, number, exp]))
        .digest("base64url"),
    });

    // The purge deletes the licence: its number is retired.
    await purgeTestUser(
      {
        prisma,
        files: { deleteFiles: jest.fn().mockResolvedValue(new Set()) },
        warn: jest.fn(),
      },
      seeded.id,
    );
    await expect(
      prisma.retiredLicenseNumber.findUnique({ where: { number } }),
    ).resolves.toMatchObject({ number });

    // A new licence is created later with the same number.
    const newHolder = await prisma.user.create({
      data: {
        email: "qr-new-holder@ffd.com",
        password: "hash",
        firstName: "New",
        lastName: "Holder",
        role: UserRole.LICENSEE,
        license: {
          create: { number, validUntil, category: "Standard", clubName: "C" },
        },
      },
    });
    await prisma.registration.create({
      data: {
        eventId,
        userId: newHolder.id,
        status: RegistrationStatus.CONFIRMED,
        feePaid: true,
      },
    });

    // The old number-only QR is refused; nobody is checked in.
    const stale = await checkIn(v1Qr).expect(400);
    expect(String(stale.body.message)).toBe(STALE_LICENSE_QR_MESSAGE);
    const registration = await prisma.registration.findFirst({
      where: { userId: newHolder.id },
      select: { checkedIn: true },
    });
    expect(registration?.checkedIn).toBe(false);

    // The new holder's own QR (v2, bound to the licence id) still works.
    const newHolderQr = await fetchSignedQr(
      jwtService.sign({
        sub: newHolder.id,
        email: newHolder.email,
        role: newHolder.role,
      }),
    );
    const ok = await checkIn(newHolderQr).expect(201);
    expect(ok.body.user.firstName).toBe("New");
  });
});
