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
import { STATIC_QR_REFUSED_MESSAGE } from "./../src/competitions/services/competition-results.service";
import { ROTATING_QR_UNAVAILABLE_MESSAGE } from "./../src/competitions/services/competition-management.service";
import {
  buildEntryQr,
  entryQrStep,
  signEntryQrStep,
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

// `warn`: the static QR is otherwise ACCEPTED (with a warning) — only the
// competition setting can refuse it here.
const ENV: Record<string, string> = {
  QR_SIGNING_SECRET: "e2e-only-qr-signing-secret-0123456789",
  QR_SIGNATURE_MODE: "warn",
  ENTRY_QR_SIGNING_KEY: testEntryQrPem(ACTIVE_TEST_KEY_LABEL),
};

const VOLUNTEER_TOKEN = "require-rotating-qr-volunteer-token";
const ORGANIZER_CLUB = "Club Organisateur RQR";
const OTHER_CLUB = "Autre Club RQR";

interface BatchBody {
  keyId: string;
  licenseId: string;
  number: string;
  holderName: string;
}

/**
 * Rotating entry QR mandatory per competition (#668, ADR-0024): the
 * organiser turns it on (PATCH, CompetitionAccessService), then a static QR
 * (v2, as in the Wallet pass) is refused at check-in — staff and volunteer,
 * online and offline replay — while the rotating QR goes through.
 */
describe("Rotating QR mandatory per competition (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let participantToken: string;
  let organizerToken: string;
  let otherClubToken: string;
  let staffToken: string;
  let competitionId: string;
  let staticQr: string;
  let batch: BatchBody;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  const staffCheckIn = (qrData: string) =>
    request(server())
      .post(`/api/v1/competitions/${competitionId}/checkin`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ qrData });

  const volunteerCheckIn = (qrData: string, scannedAt?: string) =>
    request(server())
      .post("/api/v1/competitions/checkin/volunteer")
      .send({
        competitionId,
        token: VOLUNTEER_TOKEN,
        qrData,
        ...(scannedAt ? { scannedAt } : {}),
      });

  const setRequirement = (token: string, requireRotatingQr: unknown) =>
    request(server())
      .patch(`/api/v1/competitions/${competitionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ requireRotatingQr });

  /** Token of the step of `instant`, as the licensee's batch holds it. */
  const rotatingQrAt = (instant: Date): string => {
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

  const checkedIn = async () =>
    (
      await prisma.registration.findFirst({
        where: { event: { competitionId } },
        select: { checkedIn: true },
      })
    )?.checkedIn;

  const sign = (user: { id: string; email: string; role: UserRole }) =>
    jwtService.sign({ sub: user.id, email: user.email, role: user.role });

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
    await prisma.club.deleteMany({
      where: { name: { in: [ORGANIZER_CLUB, OTHER_CLUB] } },
    });

    const [organizerClub, otherClub] = await Promise.all([
      prisma.club.create({ data: { name: ORGANIZER_CLUB } }),
      prisma.club.create({ data: { name: OTHER_CLUB } }),
    ]);
    const select = { id: true, email: true, role: true } as const;
    const [participant, organizer, other, staff] = await Promise.all([
      prisma.user.create({
        data: {
          email: "rqr-participant@ffd.com",
          password: "hash",
          firstName: "Jeanne",
          lastName: "Statique",
          role: UserRole.LICENSEE,
          license: {
            create: {
              number: "FFD-RQR-0001",
              validUntil: new Date(Date.now() + 120 * 86_400_000),
              category: "Standard",
              clubName: ORGANIZER_CLUB,
            },
          },
        },
        select,
      }),
      prisma.user.create({
        data: {
          email: "rqr-organizer@ffd.com",
          password: "hash",
          firstName: "Orga",
          lastName: "Nisateur",
          role: UserRole.CLUB,
          clubId: organizerClub.id,
          clubName: ORGANIZER_CLUB,
        },
        select,
      }),
      prisma.user.create({
        data: {
          email: "rqr-other-club@ffd.com",
          password: "hash",
          firstName: "Autre",
          lastName: "Club",
          role: UserRole.CLUB,
          clubId: otherClub.id,
          clubName: OTHER_CLUB,
        },
        select,
      }),
      prisma.user.create({
        data: {
          email: "rqr-staff@ffd.com",
          password: "hash",
          firstName: "Sta",
          lastName: "Ff",
          role: UserRole.STAFF,
        },
        select,
      }),
    ]);
    participantToken = sign(participant);
    organizerToken = sign(organizer);
    otherClubToken = sign(other);
    staffToken = sign(staff);

    const comp = await prisma.competition.create({
      data: {
        title: "Rotating QR Required Comp",
        // Yesterday to tomorrow: offline scans stay inside the event days.
        date: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        location: "Paris",
        status: CompetitionStatus.UPCOMING,
        organizer: ORGANIZER_CLUB,
        organizerClubId: organizerClub.id,
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
        token: hashToken(VOLUNTEER_TOKEN),
        competitionId,
        expiresAt: new Date(Date.now() + 3_600_000),
        name: "Bénévole",
      },
    });

    // The static QR the Wallet pass and older apps carry (v2).
    const me = await request(server())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${participantToken}`)
      .expect(200);
    staticQr = (me.body as { license: { qrCode: string } }).license.qrCode;
    batch = (
      await request(server())
        .get("/api/v1/licenses/my/entry-qr")
        .set("Authorization", `Bearer ${participantToken}`)
        .expect(200)
    ).body as BatchBody;
  });

  afterAll(async () => {
    await app.close();
  });

  it("is off by default and exposed on the competition", async () => {
    const res = await request(server())
      .get(`/api/v1/competitions/${competitionId}`)
      .expect(200);
    expect(res.body.requireRotatingQr).toBe(false);
  });

  it("can only be changed by the organising club, staff or admin", async () => {
    await setRequirement(otherClubToken, true).expect(403);
    await setRequirement(participantToken, true).expect(403);
    await setRequirement(organizerToken, "yes").expect(400);
    const res = await setRequirement(organizerToken, true).expect(200);
    expect(res.body.requireRotatingQr).toBe(true);
    const stored = await prisma.competition.findUnique({
      where: { id: competitionId },
      select: { requireRotatingQr: true },
    });
    expect(stored?.requireRotatingQr).toBe(true);
  });

  it("refuses the static QR at the staff and volunteer check-in", async () => {
    const staffRes = await staffCheckIn(staticQr).expect(400);
    expect(staffRes.body.message).toBe(STATIC_QR_REFUSED_MESSAGE);
    const volunteerRes = await volunteerCheckIn(staticQr).expect(400);
    expect(volunteerRes.body.message).toBe(STATIC_QR_REFUSED_MESSAGE);
    // A static QR never carries a claimed offline scan time either.
    await volunteerCheckIn(staticQr, new Date().toISOString()).expect(400);
    expect(await checkedIn()).toBe(false);
  });

  it("refuses a forged rotating QR (v3 shape, junk signature) although the mode is warn", async () => {
    const forged = JSON.stringify({
      v: 3,
      k: batch.keyId,
      id: batch.number,
      lid: batch.licenseId,
      nm: batch.holderName,
      t: entryQrStep(new Date()),
      sig: "A".repeat(86),
    });
    await staffCheckIn(forged).expect(400);
    await volunteerCheckIn(forged).expect(400);
    expect(await checkedIn()).toBe(false);
  });

  it("keeps the scanners scoped to the competition (no IDOR)", async () => {
    // A CLUB account of another club cannot scan here, nor a licensee.
    for (const token of [otherClubToken, participantToken]) {
      await request(server())
        .post(`/api/v1/competitions/${competitionId}/checkin`)
        .set("Authorization", `Bearer ${token}`)
        .send({ qrData: rotatingQrAt(new Date()) })
        .expect(403);
    }
    // A volunteer link of another competition is refused here.
    const other = await prisma.competition.create({
      data: { title: "Other", date: new Date(), location: "Lyon" },
    });
    await prisma.volunteerToken.create({
      data: {
        token: hashToken("rqr-other-competition-token"),
        competitionId: other.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        name: "Bénévole",
      },
    });
    await request(server())
      .post("/api/v1/competitions/checkin/volunteer")
      .send({
        competitionId,
        token: "rqr-other-competition-token",
        qrData: rotatingQrAt(new Date()),
      })
      .expect(401);
    expect(await checkedIn()).toBe(false);
  });

  it("checks in an offline scan of the rotating QR replayed later", async () => {
    const pastScan = new Date(Date.now() - 30 * 60_000);
    const res = await volunteerCheckIn(
      rotatingQrAt(pastScan),
      pastScan.toISOString(),
    ).expect(201);
    expect(res.body.registrations[0].status).toBe("SUCCESS");
    expect(await checkedIn()).toBe(true);
  });

  it("accepts the current rotating QR at the staff check-in", async () => {
    const res = await staffCheckIn(rotatingQrAt(new Date())).expect(201);
    expect(res.body.qrVerification.status).toBe("VALID");
    expect(res.body.registrations[0].status).toBe("ALREADY_CHECKED_IN");
  });

  it("accepts the static QR again once the organiser turns it off", async () => {
    await setRequirement(organizerToken, false).expect(200);
    const res = await staffCheckIn(staticQr).expect(201);
    expect(res.body.user.firstName).toBe("Jeanne");
  });

  it("is refused to the organiser account once its club is disabled", async () => {
    await prisma.club.update({
      where: { name: ORGANIZER_CLUB },
      data: { disabledAt: new Date() },
    });
    try {
      await setRequirement(organizerToken, true).expect(401);
    } finally {
      await prisma.club.update({
        where: { name: ORGANIZER_CLUB },
        data: { disabledAt: null },
      });
    }
    const stored = await prisma.competition.findUnique({
      where: { id: competitionId },
      select: { requireRotatingQr: true },
    });
    expect(stored?.requireRotatingQr).toBe(false);
  });

  it("cannot be turned on while the server issues no rotating QR", async () => {
    const entryQr = app.get(EntryQrService);
    const spy = jest.spyOn(entryQr, "canIssue").mockReturnValue(false);
    try {
      const res = await setRequirement(staffToken, true).expect(400);
      expect(res.body.message).toBe(ROTATING_QR_UNAVAILABLE_MESSAGE);
      // Turning it off stays possible.
      await setRequirement(staffToken, false).expect(200);
    } finally {
      spy.mockRestore();
    }
  });
});
