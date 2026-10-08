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
import { LicenseQrService } from "./../src/licenses/qr/license-qr.service";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * Signed license QR, end to end (#168): the QR exposed by GET /users/me is
 * accepted at check-in, a tampered or legacy QR is refused in `enforce` mode.
 */
describe("Signed license QR check-in (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let participantToken: string;
  let competitionId: string;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const checkIn = (qrData: string) =>
    request(server())
      .post("/api/v1/competitions/checkin/volunteer")
      .send({ competitionId, token: "qr-volunteer-token", qrData });

  beforeAll(async () => {
    const qrService = new LicenseQrService({
      get: (key: string) =>
        ({
          QR_SIGNING_SECRET: "e2e-only-qr-signing-secret-0123456789",
          QR_SIGNATURE_MODE: "enforce",
        })[key],
    } as unknown as ConfigService);

    const moduleFixture: TestingModule = await applyE2EOverrides(
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
    const jwtService = moduleFixture.get<JwtService>(JwtService);

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
        token: "qr-volunteer-token",
        competitionId,
        expiresAt: new Date(Date.now() + 3_600_000),
        name: "Bénévole",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function fetchSignedQr(): Promise<string> {
    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${participantToken}`)
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
});
