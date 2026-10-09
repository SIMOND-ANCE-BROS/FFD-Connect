import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import * as crypto from "crypto";
import * as fs from "fs";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { RedisService } from "../redis/redis.service";
import { buildSsml, TtsService, voiceCapabilities } from "./tts.service";

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

  // Service construit avec une config surchargée et un seam `synthesize` mocké.
  const makeSvcWith = async (
    overrides: Record<string, string | undefined>,
  ): Promise<{ svc: TtsService; synth: jest.Mock }> => {
    const mod = await Test.createTestingModule({
      providers: [
        TtsService,
        { provide: RedisService, useValue: mockRedisService },
        { provide: ConfigService, useValue: configFor(overrides) },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService },
      ],
    }).compile();
    const svc = mod.get<TtsService>(TtsService);
    svc.onModuleInit();
    const synth = jest.fn().mockResolvedValue(Buffer.from("mock-audio"));
    (svc as unknown as TtsInternals).synthesize = synth;
    return { svc, synth };
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
        buildSsml(announcement, "fr-FR-DeniseNeural", "excited"),
      );
      // Seul l'appel Azure passe par le circuit breaker (plus de Gemini).
      expect(mockCircuitBreakerService.fire).toHaveBeenCalledTimes(1);
      expect(mockCircuitBreakerService.fire).toHaveBeenCalledWith(
        "azure-tts",
        expect.any(Function),
      );
    });

    it("keys the cache on the full SSML salted with azure-v3, so v2 audio is not re-served", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const text = "Finale, valse lente";
      const v3 = crypto
        .createHash("md5")
        .update(buildSsml(text, "fr-FR-DeniseNeural", "excited") + "azure-v3")
        .digest("hex");
      const v2 = crypto
        .createHash("md5")
        .update(text + "fr-FR-DeniseNeural" + "azure-v2")
        .digest("hex");

      const result = await service.getTtsAudio(text);

      expect(result).toContain(`${v3}.mp3`);
      expect(result).not.toContain(v2);
      expect(mockRedisService.get).toHaveBeenCalledWith(`tts:${v3}`);
    });

    it("changes the cache key when the style changes (style is part of the SSML)", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const cheerful = await makeSvcWith({ AZURE_SPEECH_STYLE: "cheerful" });

      const a = await service.getTtsAudio("Samba !");
      const b = await cheerful.svc.getTtsAudio("Samba !");

      expect(a).not.toBe(b);
      expect(cheerful.synth).toHaveBeenCalledWith(
        expect.stringContaining("<mstts:express-as style='cheerful'>"),
      );
    });

    it("applies no style when AZURE_SPEECH_STYLE is 'none'", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const { svc, synth } = await makeSvcWith({ AZURE_SPEECH_STYLE: "none" });

      await svc.getTtsAudio("Samba !");

      expect(synth).toHaveBeenCalledWith(
        buildSsml("Samba !", "fr-FR-DeniseNeural"),
      );
      expect(synth.mock.calls[0][0]).not.toContain("express-as");
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

      expect(synth).toHaveBeenCalledWith(
        buildSsml("Bonjour", "fr-FR-HenriNeural", "excited"),
      );
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
      // Défaut = voix multilingue (la plus naturelle servie en northeurope),
      // accent français forcé par <lang>.
      expect(synth).toHaveBeenCalledWith(
        buildSsml("test", "fr-FR-VivienneMultilingualNeural", "excited"),
      );
      expect(synth.mock.calls[0][0]).toContain(
        "<voice name='fr-FR-VivienneMultilingualNeural'><lang xml:lang='fr-FR'>",
      );
    });
  });

  describe("voice fallback (graceful degradation)", () => {
    const rejected400 = { isAxiosError: true, response: { status: 400 } };

    it("falls back to Denise when the configured voice is rejected (400), then skips it", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const { svc, synth } = await makeSvcWith({
        AZURE_SPEECH_VOICE: "fr-FR-Vivienne:DragonHDLatestNeural",
      });
      synth
        .mockRejectedValueOnce(rejected400)
        .mockResolvedValue(Buffer.from("mock-audio"));

      const first = await svc.getTtsAudio("Rumba !");
      expect(first).toContain("tts_cache");
      expect(synth).toHaveBeenCalledTimes(2);
      expect(synth.mock.calls[0][0]).toContain(
        "fr-FR-Vivienne:DragonHDLatestNeural",
      );
      expect(synth.mock.calls[1][0]).toBe(
        buildSsml("Rumba !", "fr-FR-DeniseNeural", "excited"),
      );

      // La voix refusée est mémorisée : plus de tentative inutile.
      await svc.getTtsAudio("Jive !");
      expect(synth).toHaveBeenCalledTimes(3);
      expect(synth.mock.calls[2][0]).toContain("fr-FR-DeniseNeural");
    });

    it("does not fall back on a non-400 error", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      const { svc, synth } = await makeSvcWith({
        AZURE_SPEECH_VOICE: "fr-FR-RemyMultilingualNeural",
      });
      synth.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 500 },
      });

      await expect(svc.getTtsAudio("Tango !")).rejects.toBeDefined();
      expect(synth).toHaveBeenCalledTimes(1);
    });

    it("rethrows when the fallback voice itself is rejected", async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      mockRedisService.get.mockResolvedValue(null);
      mockSynthesize.mockRejectedValueOnce(rejected400);

      // `service` est configuré avec Denise = la voix de repli.
      await expect(service.getTtsAudio("Valse !")).rejects.toBe(rejected400);
      expect(mockSynthesize).toHaveBeenCalledTimes(1);
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
      synthesize: (ssml: string) => Promise<Buffer>;
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
      (svc as unknown as SpeechInternals).synthesize(buildSsml(text, voice));

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

    it("wraps a styled neural voice in express-as (outside prosody)", () => {
      expect(buildSsml("Samba !", "fr-FR-DeniseNeural", "excited")).toContain(
        "<voice name='fr-FR-DeniseNeural'>" +
          "<mstts:express-as style='excited'>" +
          "<prosody rate='-5%'>Samba !</prosody>" +
          "</mstts:express-as></voice>",
      );
    });

    it("ignores a style the voice does not support", () => {
      const ssml = buildSsml("Samba !", "fr-FR-AlainNeural", "excited");
      expect(ssml).not.toContain("express-as");
      expect(ssml).toContain("<prosody rate='-5%'>Samba !</prosody>");
    });

    it("multilingual voice: forces French via <lang>, keeps prosody, no style", () => {
      expect(
        buildSsml("Quickstep !", "fr-FR-RemyMultilingualNeural", "excited"),
      ).toContain(
        "<voice name='fr-FR-RemyMultilingualNeural'>" +
          "<lang xml:lang='fr-FR'><prosody rate='-5%'>Quickstep !</prosody></lang>" +
          "</voice>",
      );
    });

    it("DragonHD voice: no prosody, no express-as (unsupported), <lang> kept", () => {
      const ssml = buildSsml(
        "Paso doble & cha-cha",
        "fr-FR-Vivienne:DragonHDLatestNeural",
        "excited",
      );
      expect(ssml).toContain(
        "<voice name='fr-FR-Vivienne:DragonHDLatestNeural'>" +
          "<lang xml:lang='fr-FR'>Paso doble &amp; cha-cha</lang></voice>",
      );
      expect(ssml).toContain("xml:lang='fr-FR'>");
      expect(ssml).not.toContain("prosody");
      expect(ssml).not.toContain("express-as");
    });

    it("MAI voice: express-as allowed, no prosody, no <lang>", () => {
      const ssml = buildSsml("Jive !", "fr-FR-Marc:MAI-Voice-2", "excited");
      expect(ssml).toContain(
        "<voice name='fr-FR-Marc:MAI-Voice-2'>" +
          "<mstts:express-as style='excited'>Jive !</mstts:express-as></voice>",
      );
      expect(ssml).not.toContain("prosody");
      expect(ssml).not.toContain("<lang");
    });
  });

  describe("voiceCapabilities", () => {
    it.each([
      ["fr-FR-DeniseNeural", "neural", true, true],
      ["fr-FR-HenriNeural", "neural", true, true],
      ["fr-FR-AlainNeural", "neural", true, false],
      ["fr-FR-VivienneMultilingualNeural", "multilingual", true, false],
      ["fr-FR-Remy:DragonHDLatestNeural", "dragon-hd", false, false],
      ["fr-FR-Denise:DragonHDOmniLatestNeural", "dragon-hd-omni", false, false],
      ["fr-FR-Soleil:MAI-Voice-2-Flash", "mai", false, true],
    ])(
      "%s → family %s, prosody %s, supports 'excited' %s",
      (voice, family, prosody, excited) => {
        const caps = voiceCapabilities(voice);
        expect(caps.family).toBe(family);
        expect(caps.prosody).toBe(prosody);
        expect(caps.styles.includes("excited")).toBe(excited);
      },
    );

    it("is case-insensitive on the voice name", () => {
      expect(voiceCapabilities("fr-fr-Remy:DragonHDLatestNeural").family).toBe(
        "dragon-hd",
      );
      expect(voiceCapabilities("FR-FR-DENISENEURAL").styles).toContain(
        "cheerful",
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
