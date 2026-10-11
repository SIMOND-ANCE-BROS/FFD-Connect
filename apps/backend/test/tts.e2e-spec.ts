import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { TtsService } from "./../src/tts/tts.service";
import { applyE2EOverrides, configureTestApp } from "./test-app.factory";

describe("TtsController (e2e)", () => {
  let app: INestApplication;
  let ttsService: TtsService;

  beforeEach(async () => {
    const mockTtsService = {
      getTtsAudio: jest.fn(),
    };

    const moduleFixture: TestingModule = await applyE2EOverrides(
      Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(TtsService)
        .useValue(mockTtsService),
    ).compile();

    app = moduleFixture.createNestApplication();
    await configureTestApp(app);
    await app.init();
    ttsService = moduleFixture.get<TtsService>(TtsService);
  });

  afterAll(async () => {
    await app.close();
  });

  // Auth, validation and throttling are covered over HTTP with the real guard
  // chain in src/tts/tts.http.spec.ts; here: the route is guarded in AppModule.
  it.each([{}, { text: "Hello" }])(
    "/api/v1/tts (POST) returns 401 without a token (%j)",
    async (body) => {
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post("/api/v1/tts")
        .send(body)
        .expect(401);
      expect(ttsService.getTtsAudio as jest.Mock).not.toHaveBeenCalled();
    },
  );
});
