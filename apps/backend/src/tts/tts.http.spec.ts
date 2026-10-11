import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import request from "supertest";
import { JwtStrategy } from "../auth/jwt.strategy";
import { StoreReviewInterceptor } from "../auth/store-review/store-review.interceptor";
import { GlobalThrottlerGuard } from "../common/guards/global-throttler.guard";
import { PrismaService } from "../prisma/prisma.service";
import { TTS_TEXT_MAX_LENGTH } from "./dto/tts-request.dto";
import { TTS_THROTTLE, TtsController } from "./tts.controller";
import { TtsService } from "./tts.service";

const JWT_SECRET = "tts-http-spec-secret";
const AUDIO = Buffer.from("ID3-fake-mp3-audio");

/**
 * POST /tts over HTTP with the real guard chain (JwtStrategy, global and
 * per-user throttlers, ValidationPipe as in main.ts, store-review
 * interceptor): only the synthesis itself and the account lookup are mocked.
 */
describe("POST /tts (HTTP)", () => {
  let app: INestApplication;
  let tmpDir: string;
  let audioPath: string;
  let tts: { getTtsAudio: jest.Mock };
  let prisma: { user: { findUnique: jest.Mock } };
  let jwt: JwtService;

  const tokenFor = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@test.fr`, role: "LICENSEE" });

  const post = (body: unknown, token?: string) => {
    const req = request(app.getHttpServer()).post("/tts");
    if (token) req.set("Authorization", `Bearer ${token}`);
    return req
      .send(body as object)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-http-"));
    audioPath = path.join(tmpDir, "clip.mp3");
    fs.writeFileSync(audioPath, AUDIO);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    tts = { getTtsAudio: jest.fn().mockResolvedValue(audioPath) };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: "LICENSEE",
          extraRoles: [],
          disabledAt: null,
          isStoreReview: false,
          club: null,
        }),
      },
    };
    jwt = new JwtService({ secret: JWT_SECRET });

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        // Same global default as AppModule.
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
      ],
      controllers: [TtsController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => JWT_SECRET },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: TtsService, useValue: tts },
        { provide: APP_GUARD, useClass: GlobalThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: StoreReviewInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 401 without a token, before any synthesis", async () => {
    const res = await post({ text: "Bonjour" });
    expect(res.status).toBe(401);
    expect(tts.getTtsAudio).not.toHaveBeenCalled();
  });

  it("returns 401 with an invalid token", async () => {
    const forged = new JwtService({ secret: "other" }).sign({ sub: "u1" });
    const res = await post({ text: "Bonjour" }, forged);
    expect(res.status).toBe(401);
    expect(tts.getTtsAudio).not.toHaveBeenCalled();
  });

  it("returns 401 for a disabled account", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: "LICENSEE",
      extraRoles: [],
      disabledAt: new Date(),
      isStoreReview: false,
      club: null,
    });
    const res = await post({ text: "Bonjour" }, tokenFor("u1"));
    expect(res.status).toBe(401);
    expect(tts.getTtsAudio).not.toHaveBeenCalled();
  });

  it("streams the audio with 200 for an authenticated user", async () => {
    const res = await post({ text: "Premier tour, Samba" }, tokenFor("u1"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(res.body).toEqual(AUDIO);
    expect(tts.getTtsAudio).toHaveBeenCalledWith("Premier tour, Samba");
  });

  it("accepts a text of exactly the maximum length", async () => {
    const text = "a".repeat(TTS_TEXT_MAX_LENGTH);
    const res = await post({ text }, tokenFor("u1"));
    expect(res.status).toBe(200);
  });

  it.each([
    ["a missing text", {}],
    ["an empty text", { text: "" }],
    ["a blank text", { text: "   " }],
    ["a text over 500 characters", { text: "a".repeat(501) }],
    ["a non-string text", { text: 42 }],
    ["a client-chosen voice", { text: "Bonjour", voice: "en-US-Ava" }],
    ["client-chosen options", { text: "Bonjour", style: "cheerful" }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await post(body, tokenFor("u1"));
    expect(res.status).toBe(400);
    expect(tts.getTtsAudio).not.toHaveBeenCalled();
  });

  it("really synthesizes for the store-review account (no simulated body)", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: "ADMIN",
      extraRoles: [],
      disabledAt: null,
      isStoreReview: true,
      club: null,
    });
    const res = await post({ text: "Bonjour" }, tokenFor("review"));
    expect(res.status).toBe(200);
    expect(res.headers["x-demo-mode"]).toBeUndefined();
    expect(res.body).toEqual(AUDIO);
  });

  it("limits each user to the dedicated per-minute budget (429 + Retry-After)", async () => {
    const token = tokenFor("u1");
    for (let i = 0; i < TTS_THROTTLE.limit; i++) {
      const ok = await post({ text: `Annonce ${i}` }, token);
      expect(ok.status).toBe(200);
    }
    const res = await post({ text: "Une de trop" }, token);
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  // #182: supertest sends every request from the same address, like several
  // users behind the ingress or a gym Wi-Fi. The 60/min budget is per user.
  it("does not let one user consume another user's budget from the same IP", async () => {
    const first = tokenFor("u1");
    for (let i = 0; i < TTS_THROTTLE.limit; i++) {
      expect((await post({ text: `Annonce ${i}` }, first)).status).toBe(200);
    }
    expect((await post({ text: "Une de trop" }, first)).status).toBe(429);

    const second = tokenFor("u2");
    for (let i = 0; i < TTS_THROTTLE.limit; i++) {
      expect((await post({ text: `Annonce ${i}` }, second)).status).toBe(200);
    }
  });
});
