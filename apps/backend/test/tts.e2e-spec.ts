import { Readable } from "stream";

jest.mock("fs", () => {
  const actual = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actual,
    createReadStream: jest.fn(() => Readable.from(["audio"])),
  };
});

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

  it("/api/v1/tts (POST) should return 400 when text is missing", () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/tts")
      .send({})
      .expect(400);
  });

  it("/api/v1/tts (POST) should stream audio when text provided", () => {
    (ttsService.getTtsAudio as jest.Mock).mockResolvedValue("/tmp/audio.mp3");

    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .post("/api/v1/tts")
      .send({ text: "Hello" })
      .expect(201)
      .expect(() => {
        expect(ttsService.getTtsAudio as jest.Mock).toHaveBeenCalledWith(
          "Hello",
        );
      });
  });
});
