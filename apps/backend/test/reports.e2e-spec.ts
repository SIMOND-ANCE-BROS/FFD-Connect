import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { RedisService } from "./../src/redis/redis.service";
import { ReportsService } from "./../src/reports/reports.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("ReportsController (e2e)", () => {
  let app: INestApplication;
  let reportsService: ReportsService;

  beforeAll(async () => {
    const mockReportsService = {
      create: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(ReportsService)
        .useValue(mockReportsService)
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
    reportsService = moduleFixture.get<ReportsService>(ReportsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/reports (POST) should create report with file", () => {
    (reportsService.create as jest.Mock).mockResolvedValue({
      id: "report-1",
      title: "Bug report",
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/reports")
      .field("type", "BUG")
      .field("title", "Bug report")
      .field("description", "Something broke")
      .attach("image", Buffer.from("test"), "test.png")
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe("report-1");
      });
  });

  it("/api/v1/reports (POST) should create report without file", () => {
    (reportsService.create as jest.Mock).mockResolvedValue({
      id: "report-2",
      title: "Feature request",
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/reports")
      .field("type", "FEATURE")
      .field("title", "Feature request")
      .field("description", "Add a new feature")
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe("report-2");
      });
  });
});
