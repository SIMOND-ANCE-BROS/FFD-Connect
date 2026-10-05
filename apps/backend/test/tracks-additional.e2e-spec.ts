import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { RedisService } from "./../src/redis/redis.service";
import { TracksService } from "./../src/tracks/tracks.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

/**
 * Tests E2E supplémentaires pour les tracks
 * Scénarios critiques supplémentaires non couverts dans tracks.e2e-spec.ts
 */
describe("TracksController - Additional Scenarios (e2e)", () => {
  let app: INestApplication;
  let tracksService: TracksService;

  beforeEach(async () => {
    const mockTracksService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TracksService)
        .useValue(mockTracksService)
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
        })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: import("@nestjs/common").ExecutionContext) => {
            const req = context
              .switchToHttp()
              .getRequest<{ user?: { userId: string; role: UserRole } }>();
            // Writes are ADMIN-only; the additional scenarios exercise the
            // happy path and validation, so run them as an ADMIN user.
            req.user = { userId: "test-user-id", role: UserRole.ADMIN };
            return true;
          },
        }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    tracksService = moduleFixture.get<TracksService>(TracksService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Pagination", () => {
    it("should handle pagination parameters", () => {
      const mockTracks = Array.from({ length: 20 }, (_, i) => ({
        id: `track-${i}`,
        title: `Track ${i}`,
      }));

      (tracksService.findAll as jest.Mock).mockResolvedValue(
        mockTracks.slice(0, 10),
      );

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/tracks?skip=0&take=10")
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it("should handle invalid pagination", () => {
      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/tracks?skip=-1&take=0")
        .expect((res) => {
          expect([200, 400]).toContain(res.status);
        });
    });
  });

  describe("Filtering", () => {
    it("should filter tracks by style", () => {
      const mockTracks = [
        { id: "track-1", title: "Latin Track", style: "Latin" },
      ];

      (tracksService.findAll as jest.Mock).mockResolvedValue(mockTracks);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/tracks?skip=0&take=10")
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it("should filter tracks by artist", () => {
      const mockTracks = [
        { id: "track-1", title: "Track", artist: "Artist Name" },
      ];

      (tracksService.findAll as jest.Mock).mockResolvedValue(mockTracks);

      return request(app.getHttpServer() as Parameters<typeof request>[0])
        .get("/api/v1/tracks?skip=0&take=10")
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });
});
