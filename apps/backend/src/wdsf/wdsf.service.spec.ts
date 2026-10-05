import { HttpService } from "@nestjs/axios";
import { HttpException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { of, throwError } from "rxjs";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { WdsfService } from "./wdsf.service";

describe("WdsfService", () => {
  let service: WdsfService;
  const mockHttpService = {
    get: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockCircuitBreakerService = {
    fire: jest
      .fn()
      .mockImplementation((_key: string, fn: () => unknown) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCircuitBreakerService.fire.mockImplementation(
      (_key: string, fn: () => unknown) => fn(),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WdsfService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CircuitBreakerService, useValue: mockCircuitBreakerService },
      ],
    }).compile();

    service = module.get<WdsfService>(WdsfService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getAthleteByMin", () => {
    it("should throw ServiceUnavailableException if credentials are missing", async () => {
      mockConfigService.get.mockReturnValue(undefined);

      await expect(service.getAthleteByMin("12345")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should use API v2 with X-WDSF-API-KEY when WDSF_API_KEY is set", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_API_KEY") return "my-wdsf-token";
        return undefined;
      });

      const mockAthlete = {
        min: "99999",
        firstName: "Jane",
        lastName: "Smith",
        birthDate: "1995-05-05",
        country: { name: "Germany" },
        status: "Active",
        memberBody: { name: "WDSF" },
        ageGroup: "Adult",
        gender: "Female",
      };
      mockHttpService.get.mockReturnValue(of({ data: [mockAthlete] }));

      await service.getAthleteByMin("99999");

      expect(mockHttpService.get).toHaveBeenCalledWith(
        "https://api.wdsf.org/api/2/person?min=99999",
        {
          headers: {
            "X-WDSF-API-KEY": "my-wdsf-token",
            Accept:
              "application/vnd.worlddancesport.persons+json, application/vnd.worlddancesport.person+json",
          },
        },
      );
    });

    it("should return athlete data on success (Basic Auth v1)", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      const mockAthlete = {
        min: "12345",
        firstName: "John",
        lastName: "Doe",
        birthDate: "1990-01-01",
        country: { name: "France" },
        status: "Active",
        memberBody: { name: "FFD" },
        ageGroup: "Adult",
        gender: "Male",
      };

      mockHttpService.get.mockReturnValue(of({ data: [mockAthlete] }));

      const result = await service.getAthleteByMin("12345");

      expect(mockHttpService.get).toHaveBeenCalledWith(
        "https://services.worlddancesport.org/api/1/person?min=12345",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic "),
            Accept: "application/json",
          }),
        }),
      );
      expect(result).toEqual({
        firstName: "John",
        lastName: "Doe",
        licenseNumber: "12345",
        birthDate: "1990-01-01",
        country: "France",
        status: "Active",
        type: "Athlete's License",
        structure: "FFD - Fédération Française de Danse",
        validUntil: "Active",
        ageGroup: "Adult",
        gender: "Male",
      });
    });

    it("should throw HttpException 404 with message when athlete not found", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      mockHttpService.get.mockReturnValue(of({ data: [] }));

      const err = await service
        .getAthleteByMin("unknown")
        .catch((e: unknown) => e);
      expect(err.getResponse()).toEqual({
        message: "Numéro MIN invalide ou introuvable.",
        code: "WDSF_ATHLETE_NOT_FOUND",
      });
      expect(err.getStatus()).toBe(404);
    });

    it("propagates ServiceUnavailableException from circuit breaker", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });
      mockCircuitBreakerService.fire.mockRejectedValueOnce(
        new ServiceUnavailableException("wdsf unavailable"),
      );
      await expect(service.getAthleteByMin("12345")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("should handle API errors", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      mockHttpService.get.mockReturnValue(
        throwError(() => ({
          response: { data: "Server Error", status: 500 },
          message: "Request failed",
        })),
      );

      await expect(service.getAthleteByMin("12345")).rejects.toThrow(
        HttpException,
      );
    });

    it("should throw HttpException 401 on unauthorized error", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      mockHttpService.get.mockReturnValue(
        throwError(() => ({
          response: {
            data: {
              error: "Unauthorized",
              message: "Invalid API key",
              statusCode: 401,
            },
            status: 401,
          },
          message: "Request failed with status code 401",
        })),
      );

      const err = await service
        .getAthleteByMin("12345")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(401);
    });

    it("should throw HttpException 500 on server error", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_API_KEY") return "api-key";
        return undefined;
      });

      mockHttpService.get.mockReturnValue(
        throwError(() => ({
          response: { data: { error: "Internal Server Error" }, status: 500 },
          message: "Request failed with status code 500",
        })),
      );

      const err = await service
        .getAthleteByMin("12345")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(500);
    });

    it("should throw on network timeout (ECONNABORTED)", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      const timeoutError = Object.assign(
        new Error("timeout of 5000ms exceeded"),
        {
          code: "ECONNABORTED",
        },
      );
      mockHttpService.get.mockReturnValue(throwError(() => timeoutError));

      await expect(service.getAthleteByMin("12345")).rejects.toThrow();
    });

    it("should throw on network connection refused (ECONNREFUSED)", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      const networkError = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
      mockHttpService.get.mockReturnValue(throwError(() => networkError));

      await expect(service.getAthleteByMin("12345")).rejects.toThrow();
    });
  });

  describe("getAthleteByMin — erreurs HTTP", () => {
    beforeEach(() => {
      // Config with v1 credentials (username + password) so the service proceeds to HTTP
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });
    });

    it("throws HttpException with WDSF_ATHLETE_NOT_FOUND when API returns 404", async () => {
      const axiosError = {
        response: {
          status: 404,
          data: { message: "Not found" },
        },
        message: "Request failed with status code 404",
      };
      mockHttpService.get.mockReturnValue(throwError(() => axiosError));

      await expect(service.getAthleteByMin("00000")).rejects.toMatchObject({
        response: { code: "WDSF_ATHLETE_NOT_FOUND" },
      });
    });

    it("throws HttpException with status 401 when API returns 401", async () => {
      const axiosError = {
        response: {
          status: 401,
          data: { error: "Unauthorized" },
        },
        message: "Request failed with status code 401",
      };
      mockHttpService.get.mockReturnValue(throwError(() => axiosError));

      await expect(service.getAthleteByMin("12345")).rejects.toMatchObject({
        status: 401,
      });
    });

    it("rethrows network error when no response object is present", async () => {
      const networkError = new Error("connect ECONNABORTED");
      mockHttpService.get.mockReturnValue(throwError(() => networkError));

      await expect(service.getAthleteByMin("12345")).rejects.toThrow(
        "connect ECONNABORTED",
      );
    });
  });

  describe("getAthleteByMin — v1→v2 fallback", () => {
    const mockAthleteData = [
      {
        min: "55555",
        firstName: "Marie",
        lastName: "Dupont",
        birthDate: "1992-03-15",
        country: { name: "France" },
        status: "Active",
        memberBody: { name: "FFD" },
        ageGroup: "Adult",
        gender: "Female",
      },
    ];

    it("falls back to v2 when v1 returns 404 and WDSF_API_KEY is set", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      // First call (v1) fails with 404, second call (v2 fallback) succeeds
      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(of({ data: mockAthleteData }));

      const result = await service.getAthleteByMin("55555");

      expect(result).toEqual(
        expect.objectContaining({
          firstName: "Marie",
          lastName: "Dupont",
          licenseNumber: "55555",
        }),
      );
      // Verify second call used v2 headers
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        "https://api.wdsf.org/api/2/person?min=55555",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-WDSF-API-KEY": "my-api-key",
          }),
        }),
      );
    });

    it("falls back to v2 with custom WDSF_API_V2_URL when configured", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_API_V2_URL") return "https://sandbox.wdsf.org/api/2";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(of({ data: mockAthleteData }));

      await service.getAthleteByMin("55555");

      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        "https://sandbox.wdsf.org/api/2/person?min=55555",
        expect.any(Object),
      );
    });

    it("logs fallback error and rethrows original error when v2 fallback also fails with non-401", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v2Error = {
        response: { status: 500, data: { error: "Internal Server Error" } },
        message: "Request failed with status code 500",
        code: "ERR_BAD_RESPONSE",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v2Error));

      // Should throw the original 404 error (re-thrown from the main catch block)
      await expect(service.getAthleteByMin("55555")).rejects.toThrow(
        HttpException,
      );
    });

    it("logs specific warning when v2 fallback fails with 401 Unauthorized", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v2Error401 = {
        response: { status: 401, data: { error: "Unauthorized" } },
        message: "Request failed with status code 401",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v2Error401));

      // Falls through to the main error handling after fallback fails
      await expect(service.getAthleteByMin("55555")).rejects.toThrow(
        HttpException,
      );
    });

    it("handles v2 fallback error with string data in response", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v2ErrorWithStringData = {
        response: { status: 503, data: "Service Unavailable" },
        message: "Request failed with status code 503",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v2ErrorWithStringData));

      await expect(service.getAthleteByMin("55555")).rejects.toThrow(
        HttpException,
      );
    });

    it("handles v2 fallback error with no response object", async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        if (key === "WDSF_API_KEY") return "my-api-key";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const networkError = new Error("connect ECONNREFUSED");

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => networkError));

      await expect(service.getAthleteByMin("55555")).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe("getAthleteByMin — v2→v1 fallback", () => {
    const mockAthleteData = [
      {
        min: "66666",
        firstName: "Pierre",
        lastName: "Martin",
        birthDate: "1988-07-20",
        country: { name: "France" },
        status: "Active",
        memberBody: { name: "FFD" },
        ageGroup: "Adult",
        gender: "Male",
      },
    ];

    it("falls back to v1 when v2 returns 404 and v1 credentials are set", async () => {
      // Configure v2-only as primary (no username/password initially for getAuthConfig),
      // but provide them for fallback lookup
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") return "user";
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      // Since hasV1 is checked first in getAuthConfig, we need to make v2 the primary.
      // But getAuthConfig prioritizes v1 when both are set.
      // So we need only WDSF_API_KEY set for getAuthConfig, but username/password available for fallback.
      // The trick: getAuthConfig checks username?.trim() && password?.trim().
      // In getAthleteByMin catch, it re-reads config. We need getAuthConfig to pick v2,
      // but the fallback section to find v1 creds.

      // Reset and use a more nuanced approach: make getAuthConfig pick v2 (no v1 creds)
      // but then in catch block, make v1 creds available.
      let callCount = 0;
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_API_KEY") return "my-api-key";
        // For the first getAuthConfig call, no v1 creds. For fallback check, provide them.
        if (key === "WDSF_USERNAME") {
          callCount++;
          // First two calls are from getAuthConfig; third+ from the catch block
          return callCount > 2 ? "user" : undefined;
        }
        if (key === "WDSF_PASSWORD") return "pass";
        return undefined;
      });

      // Actually, let's re-think. getAuthConfig reads WDSF_USERNAME; if undefined, hasV1=false.
      // Then in catch, it reads WDSF_USERNAME again. We need it to return a value in the catch.
      // Simplest: use mockReturnValueOnce chain.
      mockConfigService.get.mockReset();
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "WDSF_API_KEY") return "my-api-key";
        // Return undefined for WDSF_USERNAME in getAuthConfig (first call),
        // but return "user" in the catch block (second call).
        return undefined;
      });

      // Track calls to differentiate getAuthConfig vs catch block
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        // getAuthConfig reads WDSF_USERNAME first, then WDSF_PASSWORD, then WDSF_API_KEY.
        // The catch block also reads WDSF_USERNAME, WDSF_PASSWORD, WDSF_API_KEY.
        // We want WDSF_USERNAME to be undefined during getAuthConfig but "user" during catch.
        // Count how many times WDSF_USERNAME is requested:
        const usernameCount = configCalls.filter(
          (k) => k === "WDSF_USERNAME",
        ).length;
        if (key === "WDSF_USERNAME") {
          // First call is from getAuthConfig, second from catch block
          return usernameCount <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const pwCount = configCalls.filter(
            (k) => k === "WDSF_PASSWORD",
          ).length;
          return pwCount <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(of({ data: mockAthleteData }));

      const result = await service.getAthleteByMin("66666");

      expect(result).toEqual(
        expect.objectContaining({
          firstName: "Pierre",
          lastName: "Martin",
          licenseNumber: "66666",
        }),
      );
      // Verify second call used v1 Basic Auth headers
      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        expect.stringContaining("person?min=66666"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic "),
            Accept: "application/json",
          }),
        }),
      );
    });

    it("falls back to v1 with custom WDSF_API_V1_URL when configured", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        if (key === "WDSF_API_V1_URL")
          return "https://sandbox.worlddancesport.org/api/1";
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const mockAthleteData = [
        {
          min: "77777",
          firstName: "Test",
          lastName: "User",
          birthDate: "1990-01-01",
          country: { name: "France" },
          status: "Active",
          memberBody: { name: "FFD" },
          ageGroup: "Adult",
          gender: "Male",
        },
      ];

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(of({ data: mockAthleteData }));

      await service.getAthleteByMin("77777");

      expect(mockHttpService.get).toHaveBeenLastCalledWith(
        "https://sandbox.worlddancesport.org/api/1/person?min=77777",
        expect.any(Object),
      );
    });

    it("logs fallback error and rethrows when v1 fallback also fails with non-401", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v1Error = {
        response: { status: 500, data: { error: "Internal Server Error" } },
        message: "Request failed with status code 500",
        code: "ERR_BAD_RESPONSE",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v1Error));

      await expect(service.getAthleteByMin("66666")).rejects.toThrow(
        HttpException,
      );
    });

    it("logs specific warning when v1 fallback fails with 401 Unauthorized", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v1Error401 = {
        response: {
          status: 401,
          data: { error: "Unauthorized" },
        },
        message: "Request failed with status code 401",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v1Error401));

      await expect(service.getAthleteByMin("66666")).rejects.toThrow(
        HttpException,
      );
    });

    it("handles v1 fallback error with string data in response", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const v1ErrorStringData = {
        response: { status: 502, data: "Bad Gateway" },
        message: "Request failed with status code 502",
      };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => v1ErrorStringData));

      await expect(service.getAthleteByMin("66666")).rejects.toThrow(
        HttpException,
      );
    });

    it("handles v1 fallback error with no response object (network error)", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      const networkError = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => networkError));

      await expect(service.getAthleteByMin("66666")).rejects.toThrow(
        HttpException,
      );
    });

    it("handles v1 fallback error that is not an Error instance", async () => {
      const configCalls: string[] = [];
      mockConfigService.get.mockImplementation((key: string) => {
        configCalls.push(key);
        if (key === "WDSF_API_KEY") return "my-api-key";
        if (key === "WDSF_USERNAME") {
          const count = configCalls.filter((k) => k === "WDSF_USERNAME").length;
          return count <= 1 ? undefined : "user";
        }
        if (key === "WDSF_PASSWORD") {
          const count = configCalls.filter((k) => k === "WDSF_PASSWORD").length;
          return count <= 1 ? undefined : "pass";
        }
        return undefined;
      });

      const axiosError404 = {
        response: { status: 404, data: { message: "Not found" } },
        message: "Request failed with status code 404",
      };

      // Non-Error object thrown as fallback error
      const weirdError = { response: { status: 503, data: null } };

      mockHttpService.get
        .mockReturnValueOnce(throwError(() => axiosError404))
        .mockReturnValueOnce(throwError(() => weirdError));

      await expect(service.getAthleteByMin("66666")).rejects.toThrow(
        HttpException,
      );
    });
  });
});
