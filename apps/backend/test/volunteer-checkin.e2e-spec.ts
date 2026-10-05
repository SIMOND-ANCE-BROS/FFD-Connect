import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test, TestingModule } from "@nestjs/testing";
import {
  CompetitionStatus,
  RegistrationStatus,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { RedisService } from "./../src/redis/redis.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("Volunteer Check-in (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let organizerToken: string;
  let userToken: string;
  let competitionId: string;
  let participantId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean DB (FK-safe order: children first)
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

    // Create Organizer
    const organizer = await prisma.user.create({
      data: {
        email: "organizer@ffd.com",
        password: "hash",
        firstName: "Org",
        lastName: "Anizer",
        role: UserRole.CLUB,
      },
    });
    organizerToken = jwtService.sign({
      sub: organizer.id,
      email: organizer.email,
      role: organizer.role,
    });

    // Create Normal User
    const user = await prisma.user.create({
      data: {
        email: "user@ffd.com",
        password: "hash",
        firstName: "Normal",
        lastName: "User",
        role: UserRole.LICENSEE,
      },
    });
    userToken = jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    // Create Participant
    const participant = await prisma.user.create({
      data: {
        email: "participant@ffd.com",
        password: "hash",
        firstName: "Parti",
        lastName: "Cipant",
        role: UserRole.LICENSEE,
      },
    });
    participantId = participant.id;

    // Create Competition and Event
    const comp = await prisma.competition.create({
      data: {
        title: "Volunteer Test Comp",
        date: new Date(),
        location: "Paris",
        status: CompetitionStatus.UPCOMING,
      },
    });
    competitionId = comp.id;

    const event = await prisma.event.create({
      data: {
        competitionId: comp.id,
        category: "Latin",
        ageGroup: "Adult",
        eventType: "COUPLE",
      },
    });

    // Register Participant
    await prisma.registration.create({
      data: {
        eventId: event.id,
        userId: participantId,
        partnerName: "Partenaire Test",
        status: RegistrationStatus.CONFIRMED,
        feePaid: true,
      },
    });
  });

  describe("Post /competitions/:id/volunteer/token", () => {
    it("should allow organizer to generate volunteer token", async () => {
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post(`/api/v1/competitions/${competitionId}/volunteer/token`)
        .set("Authorization", `Bearer ${organizerToken}`)
        .send({ name: "Bénévole 1" })
        .expect(201);

      expect(response.body.token).toBeDefined();
      expect(response.body.competitionId).toBe(competitionId);
      expect(response.body.name).toBe("Bénévole 1");
      expect(response.body.accessUrl).toContain(response.body.token);
    });

    it("should NOT allow normal user to generate volunteer token", async () => {
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post(`/api/v1/competitions/${competitionId}/volunteer/token`)
        .set("Authorization", `Bearer ${userToken}`)
        .send({ name: "Bénévole 1" });

      if (response.status !== 403) {
        console.warn("UNEXPECTED STATUS:", response.status, response.body);
      }
      expect(response.status).toBe(403);
    });
  });

  describe("Post /competitions/checkin/volunteer", () => {
    it("should allow check-in with a valid volunteer token", async () => {
      // 1. Generate token
      await prisma.volunteerToken.create({
        data: {
          token: "valid-token",
          competitionId,
          expiresAt: new Date(Date.now() + 3600000),
          name: "Bénévole",
        },
      });

      // 2. Perform check-in
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post("/api/v1/competitions/checkin/volunteer")
        .send({
          competitionId,
          token: "valid-token",
          qrData: participantId,
        })
        .expect(201);

      expect(response.body.user.firstName).toBe("Parti");
      expect(response.body.registrations[0].status).toBe("SUCCESS");

      // 3. Verify in DB
      const reg = await prisma.registration.findFirst({
        where: { userId: participantId },
      });
      expect(reg?.checkedIn).toBe(true);
    });

    it("should NOT allow check-in with an invalid token", async () => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/competitions/checkin/volunteer")
        .send({
          competitionId,
          token: "invalid-token",
          qrData: participantId,
        })
        .expect(401);
    });

    it("should NOT allow check-in with an expired token", async () => {
      await prisma.volunteerToken.create({
        data: {
          token: "expired-token",
          competitionId,
          expiresAt: new Date(Date.now() - 3600000),
          name: "Bénévole",
        },
      });

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/competitions/checkin/volunteer")
        .send({
          competitionId,
          token: "expired-token",
          qrData: participantId,
        })
        .expect(401);
    });
  });
});
