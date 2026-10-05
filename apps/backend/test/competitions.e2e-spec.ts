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

describe("CompetitionsController (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let authToken: string;
  let userId: string;

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
    try {
      jwtService = moduleFixture.get<JwtService>(JwtService);
    } catch (_e) {
      console.warn(
        "JwtService not found in testing module, token generation might fail",
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean DB (Respect FK constraints: child -> parent)
    await prisma.result.deleteMany();
    await prisma.scheduleItem.deleteMany();
    await prisma.registration.deleteMany();
    await prisma.event.deleteMany();
    await prisma.competition.deleteMany();
    // User related
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.license.deleteMany();
    await prisma.user.deleteMany();

    // Seed User
    const user = await prisma.user.create({
      data: {
        email: "test.e2e@ffd.com",
        password: "$2b$10$EpIxQi0q.7.a.b.c", // Dummy hash
        firstName: "Test",
        lastName: "User",
        role: UserRole.LICENSEE,
      },
    });
    userId = user.id;

    // Generate Token
    const payload = { sub: user.id, email: user.email, role: user.role };
    authToken = jwtService.sign(payload);
  });

  describe("/api/v1/competitions (GET)", () => {
    it("should return an array of competitions (Protected)", async () => {
      await prisma.competition.create({
        data: {
          title: "Comp 1",
          date: new Date(),
          location: "Paris",
          status: CompetitionStatus.UPCOMING,
        },
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/competitions")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          const items = Array.isArray(res.body) ? res.body : res.body.data;
          expect(Array.isArray(items)).toBe(true);
          expect(items.length).toBeGreaterThanOrEqual(1);
          expect(items[0].title).toBe("Comp 1");
        });
    });

    it("should succeed without token (public endpoint)", async () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/competitions")
        .expect(200);
    });
  });

  describe("/api/v1/competitions/:id (GET)", () => {
    it("should return competition details (Public)", async () => {
      const comp = await prisma.competition.create({
        data: {
          title: "Comp Detail",
          date: new Date(),
          location: "Lyon",
          status: CompetitionStatus.UPCOMING,
        },
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get(`/api/v1/competitions/${comp.id}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(comp.id);
          expect(res.body.title).toBe("Comp Detail");
        });
    });

    it("should return 404", async () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get(`/api/v1/competitions/non-existent-id`)
        .expect(404);
    });
  });

  describe("/api/v1/competitions/:id/checkin (POST)", () => {
    it("should successfully check in a user", async () => {
      const comp = await prisma.competition.create({
        data: {
          title: "C1",
          date: new Date(),
          location: "Loc",
          status: CompetitionStatus.UPCOMING,
        },
      });
      const event = await prisma.event.create({
        data: {
          competitionId: comp.id,
          category: "Latin",
          ageGroup: "Adult",
          eventType: "COUPLE",
        },
      });
      await prisma.registration.create({
        data: {
          eventId: event.id,
          userId: userId,
          partnerName: "Partenaire Test",
          status: RegistrationStatus.CONFIRMED,
          feePaid: true,
        },
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/v1/competitions/${comp.id}/checkin`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ qrData: userId })
        .expect(201)
        .expect((res) => {
          expect(res.body.registrations).toHaveLength(1);
          expect(res.body.registrations[0].status).toBe("SUCCESS");
          expect(res.body.registrations[0].bibNumber).toBeDefined();
        });
    });
  });

  describe("/api/v1/competitions/:id/register (POST)", () => {
    it("should register user", async () => {
      const comp = await prisma.competition.create({
        data: {
          title: "C1",
          date: new Date(),
          location: "Loc",
          status: CompetitionStatus.UPCOMING,
        },
      });
      const event = await prisma.event.create({
        data: {
          competitionId: comp.id,
          category: "Latin",
          ageGroup: "Adult",
          eventType: "COUPLE",
        },
      });

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .post(`/api/v1/competitions/${comp.id}/register`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ eventId: event.id, partnerName: "Partenaire Test" })
        .expect(201)
        .expect((res) => {
          expect(res.body.status).toBe("CONFIRMED");
          expect(res.body.userId).toBe(userId);
        });
    });
  });
});
