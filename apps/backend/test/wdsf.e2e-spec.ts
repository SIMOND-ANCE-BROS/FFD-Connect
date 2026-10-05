import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { JwtAuthGuard } from "./../src/auth/jwt-auth.guard";
import { WdsfService } from "./../src/wdsf/wdsf.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("WdsfController (e2e)", () => {
  let app: INestApplication;
  let wdsfService: WdsfService;

  beforeEach(async () => {
    const mockWdsfService = {
      getAthleteByMin: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(WdsfService)
        .useValue(mockWdsfService)
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true }),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    wdsfService = moduleFixture.get<WdsfService>(WdsfService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("/api/v1/wdsf/athlete/:min (GET) should return athlete data", () => {
    (wdsfService.getAthleteByMin as jest.Mock).mockResolvedValue({
      firstName: "John",
      lastName: "Doe",
      licenseNumber: "12345",
    });

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get("/api/v1/wdsf/athlete/12345")
      .expect(200)
      .expect((res: { body: { licenseNumber: string } }) => {
        expect(res.body.licenseNumber).toBe("12345");
      });
  });
});
