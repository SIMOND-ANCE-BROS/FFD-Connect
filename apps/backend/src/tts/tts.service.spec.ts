import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { RedisService } from "../redis/redis.service";
import { buildSsml, TtsService } from "./tts.service";

// axios est mocké pour tester le vrai `synthesize` (appel REST Speech) sans réseau.
jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    isAxiosError: (e: unknown): boolean =>
      typeof e === "object" &&
      e !== null &&
      (e as { isAxiosError?: boolean }).isAxiosError === true,
  },
}));

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    promises: {
      writeFile: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// On mocke le seam `synthesize` (texte → MP3) : les tests ne touchent pas au
// réseau Azure ; ils valident le cache, le texte verbatim et le circuit breaker.
type TtsInternals = {
  synthesize: jest.Mock;
  speechEndpoint?: string;
  speechResourceId?: string;
  buildAuthValues: (aadToken: string) => string[];
};

describe("TtsService", () => {
  let service: TtsService;
  let mockSynthesize: jest.Mock;

  const mockRedisService = { get: jest.fn(), set: jest.fn() };
  const mockCircuitBreakerService = {
    fire: jest
      .fn()
      .mockImplementation((_key: string, fn: () => unknown) => fn()),
  };

  const configFor = (
    overrides: Record<string, string | undefined> = {},
  ): { get: jest.Mock } => {
    const base: Record<string, string | undefined> = {
      AZURE_SPEECH_ENDPOINT:
        "https://speech.example.cognitiveservices.azure.com",
      AZURE_SPEECH_VOICE: "fr-FR-DeniseNeural",
      ...overrides,
    };
    return { get: jest.fn((k: string) => base[k]) };
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TtsService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: configFor() },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService },
      ],
    }).compile();

    service = module.get<TtsService>(TtsService);
    service.onModuleInit();

    mockSynthesize = jest.fn().mockResolvedValue(Buffer.from("mock-audio"));
    (service as unknown as TtsInternals).synthesize = mockSynthesize;
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("circuit breaker", () => {
    it("propagates ServiceUnavailableException from circuit breaker", async () => {
      const mockCircuitBreaker = {
        fire: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException("azure-tts unavailable"),
          ),
      };
      const svc = new TtsService(
        configFor() as never,
        { get: jest.fn(), set: jest.fn() } as never,
        mockCircuitBreaker as never,
      );
      svc.onModuleInit();
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      await expect(svc.getTtsAudio("test")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("getTtsAudio", () => {
    afterEach(() => jest.useRealTimers());

    it("should return cached file if FS cache hit", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const result = await service.getTtsAudio("Hello World");
      expect(result).toContain("tts_cache");
      expect(result).toContain(".mp3");
      expect(mockRedisService.get).not.toHaveBeenCalled();
    });

    it("should return cached file if Redis cache hit", async () => {
      const cachedPath = "/cached/path.mp3";
      (fs.existsSync as jest.Mock)
        .mockReturnValueOnce(false) // FS cache check
        .mockReturnValueOnce(true); // Redis path exists
      mockRedisService.get.mockResolvedValue(cachedPath);

      const result = await service.getTtsAudio("Hello Redis");

      expect(result).toBe(cachedPath);
      expect(mockRedisService.get).toHaveBeenCalled();
    });

    it("should generate new audio if no cache", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.getTtsAudio("Generate New");

      expect(result).toContain("tts_cache");
      expect(mockSynthesize).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalled();
      expect(mockRedisService.set).toHaveBeenCalled();
    });

    it("synthesizes the text VERBATIM (no LLM rewrite) with the configured voice", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const announcement = "Premier tour… Cha-cha-cha !";

      await service.getTtsAudio(announcement);

      expect(mockSynthesize).toHaveBeenCalledTimes(1);
      expect(mockSynthesize).toHaveBeenCalledWith(
        announcement,
        "fr-FR-DeniseNeural",
      );
      // Seul l'appel Azure passe par le circuit breaker (plus de Gemini).
      expect(mockCircuitBreakerService.fire).toHaveBeenCalledTimes(1);
      expect(mockCircuitBreakerService.fire).toHaveBeenCalledWith(
        "azure-tts",
        expect.any(Function),
      );
    });

    it("uses a cache key salted with azure-v2 so old rewritten audio is not served", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const text = "Finale, valse lente";
      const v2 = crypto
        .createHash("md5")
        .update(text + "fr-FR-DeniseNeural" + "azure-v2")
        .digest("hex");
      const v1 = crypto
        .createHash("md5")
        .update(text + "fr-FR-DeniseNeural" + "azure-v1")
        .digest("hex");

      const result = await service.getTtsAudio(text);

      expect(result).toContain(`${v2}.mp3`);
      expect(result).not.toContain(v1);
      expect(mockRedisService.get).toHaveBeenCalledWith(`tts:${v2}`);
    });

    it("uses the voice from AZURE_SPEECH_VOICE when configured", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          TtsService,
          { provide: RedisService, useValue: mockRedisService },
          {
            provide: ConfigService,
            useValue: configFor({ AZURE_SPEECH_VOICE: "fr-FR-HenriNeural" }),
          },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = mod.get<TtsService>(TtsService);
      svc.onModuleInit();
      const synth = jest.fn().mockResolvedValue(Buffer.from("mock-audio"));
      (svc as unknown as TtsInternals).synthesize = synth;
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);

      await svc.getTtsAudio("Bonjour");

      expect(synth).toHaveBeenCalledWith("Bonjour", "fr-FR-HenriNeural");
    });

    it("should throw when synthesis returns no audio", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      mockSynthesize.mockResolvedValueOnce(Buffer.alloc(0));

      await expect(service.getTtsAudio("No Audio Content")).rejects.toThrow(
        "No audio content received from Azure TTS",
      );
    });

    it("should reject with timeout error when synthesis hangs", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);

      const hangingPromise = new Promise<Buffer>(() => {});
      mockSynthesize.mockReturnValueOnce(hangingPromise);

      jest.useFakeTimers();
      const resultPromise = service.getTtsAudio("test annonce").catch((e) => e);
      await jest.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/timed out/i);
    }, 15000);

    it("should use default voice if not configured", async () => {
      const moduleDefault = await Test.createTestingModule({
        providers: [
          TtsService,
          { provide: RedisService, useValue: mockRedisService },
          {
            provide: ConfigService,
            useValue: configFor({ AZURE_SPEECH_VOICE: undefined }),
          },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = moduleDefault.get<TtsService>(TtsService);
      svc.onModuleInit();
      const synth = jest.fn().mockResolvedValue(Buffer.from("mock-audio"));
      (svc as unknown as TtsInternals).synthesize = synth;
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);

      const result = await svc.getTtsAudio("test");
      expect(result).toBeDefined();
      expect(synth).toHaveBeenCalledWith("test", "fr-FR-DeniseNeural");
    });
  });

  describe("Speech auth (buildAuthValues)", () => {
    const RESOURCE_ID =
      "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/ffd-connect-staging-speech";

    it("wraps the token as aad#{resourceId}#{token} FIRST, plain token as fallback", async () => {
      const mod = await Test.createTestingModule({
        providers: [
          TtsService,
          { provide: RedisService, useValue: mockRedisService },
          {
            provide: ConfigService,
            useValue: configFor({ AZURE_SPEECH_RESOURCE_ID: RESOURCE_ID }),
          },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = mod.get<TtsService>(TtsService);
      svc.onModuleInit();

      const values = (svc as unknown as TtsInternals).buildAuthValues("TOK");
      // Speech exige la forme encapsulée (spécificité vs autres services Cognitive).
      expect(values).toEqual([`aad#${RESOURCE_ID}#TOK`, "TOK"]);
    });

    it("uses only the plain token when no resource id is configured", () => {
      // `service` (beforeEach) est construit sans AZURE_SPEECH_RESOURCE_ID.
      const values = (service as unknown as TtsInternals).buildAuthValues(
        "TOK",
      );
      expect(values).toEqual(["TOK"]);
    });
  });

  describe("synthesize (real REST call, mocked axios)", () => {
    const RESOURCE_ID =
      "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/ffd-connect-staging-speech";
    const mockedPost = (axios as unknown as { post: jest.Mock }).post;

    type SpeechInternals = {
      credential: { getToken: jest.Mock };
      synthesize: (text: string, voice: string) => Promise<Buffer>;
    };

    const makeService = async (
      overrides: Record<string, string | undefined> = {},
    ): Promise<TtsService> => {
      const mod = await Test.createTestingModule({
        providers: [
          TtsService,
          { provide: RedisService, useValue: mockRedisService },
          {
            provide: ConfigService,
            useValue: configFor({
              AZURE_SPEECH_RESOURCE_ID: RESOURCE_ID,
              ...overrides,
            }),
          },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = mod.get<TtsService>(TtsService);
      svc.onModuleInit();
      // On remplace le credential pour éviter toute acquisition de token réelle.
      (svc as unknown as SpeechInternals).credential = {
        getToken: jest.fn().mockResolvedValue({ token: "TOK" }),
      };
      return svc;
    };

    const callSynthesize = (
      svc: TtsService,
      text = "Chauffez la piste & <dansez> !",
      voice = "fr-FR-DeniseNeural",
    ): Promise<Buffer> =>
      (svc as unknown as SpeechInternals).synthesize(text, voice);

    beforeEach(() => mockedPost.mockReset());

    it("posts escaped SSML with the aad# auth form and returns an MP3 buffer", async () => {
      const svc = await makeService();
      mockedPost.mockResolvedValueOnce({ data: Buffer.from("MP3") });

      const buf = await callSynthesize(svc);

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(mockedPost).toHaveBeenCalledTimes(1);
      const [url, body, cfg] = mockedPost.mock.calls[0];
      expect(url).toContain("/tts/cognitiveservices/v1");
      expect(body).toContain("<speak");
      expect(body).toContain("&amp;"); // escapeXml a bien tourné sur "&"
      expect(body).toContain("&lt;dansez&gt;");
      expect(body).toContain("xmlns:mstts='https://www.w3.org/2001/mstts'");
      expect(body).toContain("<prosody rate='-5%'>");
      expect(cfg.headers.Authorization).toBe(`Bearer aad#${RESOURCE_ID}#TOK`);
      expect(cfg.headers["X-Microsoft-OutputFormat"]).toBe(
        "audio-24khz-48kbitrate-mono-mp3",
      );
    });

    it("falls back to the plain token on a 401 and then succeeds", async () => {
      const svc = await makeService();
      mockedPost
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 401 },
        })
        .mockResolvedValueOnce({ data: Buffer.from("MP3") });

      const buf = await callSynthesize(svc);

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(mockedPost).toHaveBeenCalledTimes(2);
      expect(mockedPost.mock.calls[0][2].headers.Authorization).toBe(
        `Bearer aad#${RESOURCE_ID}#TOK`,
      );
      expect(mockedPost.mock.calls[1][2].headers.Authorization).toBe(
        "Bearer TOK",
      );
    });

    it("rethrows a non-auth error (500) without retrying", async () => {
      const svc = await makeService();
      mockedPost.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 500 },
      });

      await expect(callSynthesize(svc)).rejects.toBeDefined();
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });

    it("throws when no AAD token can be acquired", async () => {
      const svc = await makeService();
      (
        svc as unknown as SpeechInternals
      ).credential.getToken.mockResolvedValueOnce(null);

      await expect(callSynthesize(svc)).rejects.toThrow(/token/i);
      expect(mockedPost).not.toHaveBeenCalled();
    });

    it("does not retry a 401 when no resource id is configured (single auth form)", async () => {
      const svc = await makeService({ AZURE_SPEECH_RESOURCE_ID: undefined });
      mockedPost.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 401 },
      });

      await expect(callSynthesize(svc)).rejects.toBeDefined();
      expect(mockedPost).toHaveBeenCalledTimes(1);
      expect(mockedPost.mock.calls[0][2].headers.Authorization).toBe(
        "Bearer TOK",
      );
    });
  });

  describe("buildSsml", () => {
    it("wraps the text in speak/voice/prosody with the mstts namespace", () => {
      const ssml = buildSsml(
        "Premier tour, valse lente.",
        "fr-FR-DeniseNeural",
      );
      expect(ssml).toBe(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
          "xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='fr-FR'>" +
          "<voice name='fr-FR-DeniseNeural'>" +
          "<prosody rate='-5%'>Premier tour, valse lente.</prosody>" +
          "</voice></speak>",
      );
    });

    it("keeps ellipses and punctuation intact (only XML chars are escaped)", () => {
      const ssml = buildSsml(
        "Mesdames et messieurs… place à la finale ! Prêts ? Rock & roll",
        "fr-FR-DeniseNeural",
      );
      expect(ssml).toContain(
        "Mesdames et messieurs… place à la finale ! Prêts ? Rock &amp; roll",
      );
    });

    it("escapes quotes so the text cannot break out of the SSML", () => {
      const ssml = buildSsml(`L'"annonce" <b>`, "fr-FR-DeniseNeural");
      expect(ssml).toContain("L&apos;&quot;annonce&quot; &lt;b&gt;");
      expect(ssml).not.toContain("<b>");
    });

    it("derives xml:lang from the voice name", () => {
      expect(buildSsml("Hi", "en-GB-SoniaNeural")).toContain(
        "xml:lang='en-GB'",
      );
      expect(buildSsml("Hi", "en-GB-SoniaNeural")).toContain(
        "<voice name='en-GB-SoniaNeural'>",
      );
    });
  });

  describe("onModuleInit", () => {
    it("sets the Speech endpoint when AZURE_SPEECH_ENDPOINT is set", () => {
      expect((service as unknown as TtsInternals).speechEndpoint).toBeTruthy();
    });

    it("leaves the Speech endpoint undefined when not configured", async () => {
      const moduleNoSpeech = await Test.createTestingModule({
        providers: [
          TtsService,
          { provide: RedisService, useValue: mockRedisService },
          {
            provide: ConfigService,
            useValue: configFor({ AZURE_SPEECH_ENDPOINT: undefined }),
          },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = moduleNoSpeech.get<TtsService>(TtsService);
      svc.onModuleInit();
      expect((svc as unknown as TtsInternals).speechEndpoint).toBeUndefined();
    });
  });
});
