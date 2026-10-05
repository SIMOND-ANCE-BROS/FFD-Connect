import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { OcrService } from "./ocr.service";

// axios mocké pour tester le vrai `detectText` (appel REST Vision) sans réseau.
jest.mock("axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

// On mocke le seam `detectText` (image → texte brut) plutôt que le réseau Azure :
// la logique métier testée est le parsing regex, indépendant du fournisseur OCR.
type OcrInternals = {
  detectText: jest.Mock;
  endpoint?: string;
};

describe("OcrService", () => {
  let service: OcrService;
  let mockDetectText: jest.Mock;

  const mockConfig = {
    get: jest.fn(),
  };

  const mockCircuitBreakerService = {
    fire: jest
      .fn()
      .mockImplementation((_key: string, fn: () => unknown) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue(
      "https://vision.example.cognitiveservices.azure.com",
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OcrService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService },
      ],
    }).compile();

    service = module.get<OcrService>(OcrService);
    service.onModuleInit();
    mockDetectText = jest.fn();
    (service as unknown as OcrInternals).detectText = mockDetectText;
  });

  describe("Initialization", () => {
    it("should be active (not mock mode) when AZURE_VISION_ENDPOINT provided", () => {
      expect((service as unknown as OcrInternals).endpoint).toBeTruthy();
    });

    it("should stay in MOCK mode when endpoint missing", async () => {
      mockConfig.get.mockReturnValue(null);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrService,
          { provide: ConfigService, useValue: mockConfig },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const mockService = module.get<OcrService>(OcrService);
      mockService.onModuleInit();
      expect((mockService as unknown as OcrInternals).endpoint).toBeUndefined();
    });
  });

  describe("detectText (real Vision REST call, mocked axios)", () => {
    const mockedPost = (axios as unknown as { post: jest.Mock }).post;

    type VisionInternals = {
      credential: { getToken: jest.Mock };
      detectText: (image: string | Buffer) => Promise<string>;
    };

    const makeService = async (): Promise<OcrService> => {
      const mod = await Test.createTestingModule({
        providers: [
          OcrService,
          { provide: ConfigService, useValue: mockConfig },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = mod.get<OcrService>(OcrService);
      svc.onModuleInit();
      // On remplace le credential pour éviter toute acquisition de token réelle.
      (svc as unknown as VisionInternals).credential = {
        getToken: jest.fn().mockResolvedValue({ token: "TOK" }),
      };
      return svc;
    };

    const callDetect = (svc: OcrService, image: Buffer = Buffer.from("img")) =>
      (svc as unknown as VisionInternals).detectText(image);

    beforeEach(() => mockedPost.mockReset());

    it("posts image bytes with a plain bearer token to the analyze path and joins detected lines", async () => {
      const svc = await makeService();
      mockedPost.mockResolvedValueOnce({
        data: {
          readResult: {
            blocks: [
              {
                lines: [
                  { text: "Licence N° 12345678" },
                  { text: "Jean Dupont" },
                ],
              },
              { lines: [{ text: "valable jusqu'au 31/12/2026" }] },
            ],
          },
        },
      });

      const text = await callDetect(svc);

      expect(text).toBe(
        "Licence N° 12345678\nJean Dupont\nvalable jusqu'au 31/12/2026",
      );
      expect(mockedPost).toHaveBeenCalledTimes(1);
      const [url, body, cfg] = mockedPost.mock.calls[0];
      expect(url).toContain("/computervision/imageanalysis:analyze");
      expect(url).toContain("features=read");
      // Vision accepte le bearer AAD brut (contrairement à Speech).
      expect(cfg.headers.Authorization).toBe("Bearer TOK");
      expect(cfg.headers["Content-Type"]).toBe("application/octet-stream");
      expect(Buffer.isBuffer(body)).toBe(true);
    });

    it("returns an empty string when Vision reports no text blocks", async () => {
      const svc = await makeService();
      mockedPost.mockResolvedValueOnce({
        data: { readResult: { blocks: [] } },
      });

      expect(await callDetect(svc)).toBe("");
    });

    it("throws when no AAD token can be acquired", async () => {
      const svc = await makeService();
      (
        svc as unknown as VisionInternals
      ).credential.getToken.mockResolvedValueOnce(null);

      await expect(callDetect(svc)).rejects.toThrow(/token/i);
      expect(mockedPost).not.toHaveBeenCalled();
    });
  });

  describe("extractLicenseInfo", () => {
    it("should return mock data in mock mode", async () => {
      (service as unknown as OcrInternals).endpoint = undefined;
      const result = await service.extractLicenseInfo("path");
      expect(result.licenseNumber).toBe("12345678");
    });

    it("should return empty result if no text detected", async () => {
      mockDetectText.mockResolvedValue("");
      const result = await service.extractLicenseInfo("path");
      expect(result).toEqual({});
    });

    it("should parse text correctly if detected", async () => {
      mockDetectText.mockResolvedValue(
        "Licence N°: 98765432\nvalable jusqu'au: 31/08/2026",
      );

      const result = await service.extractLicenseInfo("path");

      expect(result.licenseNumber).toBe("98765432");
      expect(result.expiryDate).toBe("2026-08-31");
    });

    it("should handle partial matches", async () => {
      mockDetectText.mockResolvedValue(
        "Some random text N° 12345\nvalable jusqu'au: 01/01/2025",
      );

      const result = await service.extractLicenseInfo("path");

      expect(result.licenseNumber).toBeUndefined(); // Needs "Licence" prefix
      expect(result.expiryDate).toBe("2025-01-01");
    });

    it("should return empty on error", async () => {
      mockDetectText.mockRejectedValue(new Error("api fail"));
      const result = await service.extractLicenseInfo("path");
      expect(result).toEqual({});
    });

    it("should accept a Buffer and pass it to the OCR seam", async () => {
      const buffer = Buffer.from("image-bytes");
      mockDetectText.mockResolvedValue("Licence N°: 555");

      const result = await service.extractLicenseInfo(buffer);

      expect(mockDetectText).toHaveBeenCalledWith(buffer);
      expect(result.licenseNumber).toBe("555");
    });
  });

  describe("circuit breaker", () => {
    it("propagates ServiceUnavailableException from circuit breaker", async () => {
      const mockCircuitBreaker = {
        fire: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException("azure-vision unavailable"),
          ),
      };
      const svc = new OcrService(
        {
          get: jest
            .fn()
            .mockReturnValue("https://v.example.cognitiveservices.azure.com"),
        } as never,
        mockCircuitBreaker as never,
      );
      svc.onModuleInit();
      await expect(svc.extractLicenseInfo("/tmp/test.jpg")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe("timeout behavior", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("should return {} if OCR read hangs on extractLicenseInfo", async () => {
      const hangingPromise = new Promise<string>(() => {});
      (service as unknown as OcrInternals).detectText = jest
        .fn()
        .mockReturnValue(hangingPromise);

      const resultPromise = service
        .extractLicenseInfo("/fake/path.jpg")
        .catch((e) => e);
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toEqual({});
    }, 10000);

    it("should return {} if OCR read hangs on extractMedicalCertificateInfo", async () => {
      const hangingPromise = new Promise<string>(() => {});
      (service as unknown as OcrInternals).detectText = jest
        .fn()
        .mockReturnValue(hangingPromise);

      const resultPromise = service
        .extractMedicalCertificateInfo("/fake/path.jpg")
        .catch((e) => e);
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toEqual({});
    }, 10000);
  });

  describe("onModuleInit edge cases", () => {
    it("should stay in MOCK mode when AZURE_VISION_ENDPOINT is undefined", async () => {
      mockConfig.get.mockReturnValue(undefined);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OcrService,
          { provide: ConfigService, useValue: mockConfig },
          {
            provide: CircuitBreakerService,
            useValue: mockCircuitBreakerService,
          },
        ],
      }).compile();
      const svc = module.get<OcrService>(OcrService);
      svc.onModuleInit();

      // endpoint stays undefined → OCR runs in mock mode
      expect((svc as unknown as OcrInternals).endpoint).toBeUndefined();
    });
  });

  describe("extractMedicalCertificateInfo", () => {
    it("should return mock data in mock mode (no endpoint)", async () => {
      (service as unknown as OcrInternals).endpoint = undefined;
      const result = await service.extractMedicalCertificateInfo("path");
      expect(result.isApte).toBe(true);
      expect(result.doctorName).toBe("Dr. Mock");
      expect(result.rawText).toBe("Certificat médical - Apte - Danse");
      expect(result.date).toBeDefined();
    });

    it("should return empty rawText when no text detected", async () => {
      mockDetectText.mockResolvedValue("");
      const result = await service.extractMedicalCertificateInfo("path");
      expect(result).toEqual({ rawText: "" });
    });

    it("should parse a full medical certificate text", async () => {
      const fullText =
        "Certificat médical\nJe soussigné Dr. Martin, certifie que le patient est apte à la pratique sportive.\nDate: 15/03/2026";
      mockDetectText.mockResolvedValue(fullText);
      const result = await service.extractMedicalCertificateInfo("path");
      expect(result.isApte).toBe(true);
      expect(result.date).toBe("2026-03-15");
      expect(result.doctorName).toBe("Martin");
      expect(result.rawText).toBe(fullText);
    });

    it("should return empty on generic error", async () => {
      mockDetectText.mockRejectedValue(new Error("network error"));
      const result = await service.extractMedicalCertificateInfo("path");
      expect(result).toEqual({});
    });

    it("should propagate ServiceUnavailableException from circuit breaker", async () => {
      const mockCircuitBreaker = {
        fire: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException("azure-vision unavailable"),
          ),
      };
      const svc = new OcrService(
        {
          get: jest
            .fn()
            .mockReturnValue("https://v.example.cognitiveservices.azure.com"),
        } as never,
        mockCircuitBreaker as never,
      );
      svc.onModuleInit();
      await expect(
        svc.extractMedicalCertificateInfo("/tmp/cert.jpg"),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it("should handle non-Error thrown values", async () => {
      mockDetectText.mockRejectedValue("string error");
      const result = await service.extractMedicalCertificateInfo("path");
      expect(result).toEqual({});
    });
  });

  describe("parseMedicalCertificateText (via extractMedicalCertificateInfo)", () => {
    const parseViaOcr = async (text: string) => {
      mockDetectText.mockResolvedValue(text);
      return service.extractMedicalCertificateInfo("path");
    };

    describe("aptitude detection", () => {
      it("should detect 'apte' keyword", async () => {
        const result = await parseViaOcr(
          "Le patient est apte à la pratique sportive",
        );
        expect(result.isApte).toBe(true);
      });

      it("should detect 'ne présente pas de contre-indication'", async () => {
        const result = await parseViaOcr(
          "Le patient ne présente pas de contre-indication à la pratique",
        );
        expect(result.isApte).toBe(false);
      });

      it("should detect 'inapte' as not fit", async () => {
        const result = await parseViaOcr(
          "Le patient est déclaré inapte à la compétition",
        );
        expect(result.isApte).toBe(false);
      });

      it("should detect 'contre-indication' alone as inapte", async () => {
        const result = await parseViaOcr(
          "Présente une contre-indication à la pratique sportive",
        );
        expect(result.isApte).toBe(false);
      });

      it("should return undefined when neither apte nor inapte is found", async () => {
        const result = await parseViaOcr("Certificat médical du 15 mars 2026");
        expect(result.isApte).toBeUndefined();
      });
    });

    describe("date parsing", () => {
      it("should parse DD/MM/YYYY date format", async () => {
        const result = await parseViaOcr("Date: 25/12/2025");
        expect(result.date).toBe("2025-12-25");
      });

      it("should parse French month name date format", async () => {
        const result = await parseViaOcr("Fait le 5 janvier 2026");
        expect(result.date).toBe("2026-01-05");
      });

      it("should parse février", async () => {
        const result = await parseViaOcr("le 14 février 2025");
        expect(result.date).toBe("2025-02-14");
      });

      it("should parse fevrier (without accent)", async () => {
        const result = await parseViaOcr("le 14 fevrier 2025");
        expect(result.date).toBe("2025-02-14");
      });

      it("should parse mars", async () => {
        const result = await parseViaOcr("le 1 mars 2025");
        expect(result.date).toBe("2025-03-01");
      });

      it("should parse avril", async () => {
        const result = await parseViaOcr("le 10 avril 2025");
        expect(result.date).toBe("2025-04-10");
      });

      it("should parse mai", async () => {
        const result = await parseViaOcr("le 15 mai 2025");
        expect(result.date).toBe("2025-05-15");
      });

      it("should parse juin", async () => {
        const result = await parseViaOcr("le 20 juin 2025");
        expect(result.date).toBe("2025-06-20");
      });

      it("should parse juillet", async () => {
        const result = await parseViaOcr("le 4 juillet 2025");
        expect(result.date).toBe("2025-07-04");
      });

      it("should parse août", async () => {
        const result = await parseViaOcr("le 8 août 2025");
        expect(result.date).toBe("2025-08-08");
      });

      it("should parse aout (without accent)", async () => {
        const result = await parseViaOcr("le 8 aout 2025");
        expect(result.date).toBe("2025-08-08");
      });

      it("should parse septembre", async () => {
        const result = await parseViaOcr("le 30 septembre 2025");
        expect(result.date).toBe("2025-09-30");
      });

      it("should parse octobre", async () => {
        const result = await parseViaOcr("le 12 octobre 2025");
        expect(result.date).toBe("2025-10-12");
      });

      it("should parse novembre", async () => {
        const result = await parseViaOcr("le 22 novembre 2025");
        expect(result.date).toBe("2025-11-22");
      });

      it("should parse décembre", async () => {
        const result = await parseViaOcr("le 31 décembre 2025");
        expect(result.date).toBe("2025-12-31");
      });

      it("should parse decembre (without accent)", async () => {
        const result = await parseViaOcr("le 31 decembre 2025");
        expect(result.date).toBe("2025-12-31");
      });

      it("should prefer DD/MM/YYYY over French month format when both present", async () => {
        const result = await parseViaOcr("01/06/2025 fait le 5 janvier 2026");
        expect(result.date).toBe("2025-06-01");
      });

      it("should return undefined date when no date is found", async () => {
        const result = await parseViaOcr("Certificat médical sans date");
        expect(result.date).toBeUndefined();
      });
    });

    describe("doctor name extraction", () => {
      it("should extract doctor name with 'Dr.' prefix", async () => {
        const result = await parseViaOcr("Signé Dr. Dupont");
        expect(result.doctorName).toBe("Dupont");
      });

      it("should extract doctor name with 'Dr' prefix (no dot)", async () => {
        const result = await parseViaOcr("Signé Dr Martin");
        expect(result.doctorName).toBe("Martin");
      });

      it("should extract doctor name with 'Docteur' prefix", async () => {
        const result = await parseViaOcr("Signé Docteur Bernard");
        expect(result.doctorName).toBe("Bernard");
      });

      it("should extract multi-part doctor name", async () => {
        const result = await parseViaOcr("Dr. Jean-Pierre Lefèvre");
        expect(result.doctorName).toBe("Jean-Pierre Lefèvre");
      });

      it("should return undefined doctorName when no doctor pattern found", async () => {
        const result = await parseViaOcr("Certificat médical sans médecin");
        expect(result.doctorName).toBeUndefined();
      });
    });

    describe("rawText truncation", () => {
      it("should truncate rawText to 500 characters", async () => {
        const longText = "A".repeat(600);
        const result = await parseViaOcr(longText);
        expect(result.rawText).toHaveLength(500);
      });

      it("should return full rawText when under 500 characters", async () => {
        const shortText = "Certificat médical court";
        const result = await parseViaOcr(shortText);
        expect(result.rawText).toBe(shortText);
      });
    });

    describe("combined certificate parsing", () => {
      it("should parse a complete certificate with all fields", async () => {
        const text =
          "CERTIFICAT MEDICAL\nJe soussigné Docteur Durand, certifie que M. Dupont est apte à la pratique de la danse sportive.\nFait le 15/01/2026";
        const result = await parseViaOcr(text);
        expect(result.isApte).toBe(true);
        expect(result.date).toBe("2026-01-15");
        expect(result.doctorName).toBe("Durand");
        expect(result.rawText).toBeDefined();
      });
    });
  });
});
