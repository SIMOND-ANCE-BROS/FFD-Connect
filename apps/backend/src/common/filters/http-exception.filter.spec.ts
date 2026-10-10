import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { CodedBadRequestException } from "../errors/coded-bad-request.exception";
import { HttpExceptionFilter } from "./http-exception.filter";

jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }));

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockRequest: Record<string, unknown>;
  let mockLogger: {
    error: jest.Mock;
    warn: jest.Mock;
    info: jest.Mock;
    debug: jest.Mock;
  };
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };
    filter = new HttpExceptionFilter(
      mockLogger as unknown as import("nestjs-pino").PinoLogger,
    );
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockRequest = {
      url: "/test",
      method: "GET",
    };
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
      getArgByIndex: jest.fn(),
      getArgs: jest.fn(),
      getType: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    };
  });

  it("should be defined", () => {
    expect(filter).toBeDefined();
  });

  it("should handle HttpException correctly", () => {
    const exception = new HttpException("Test error", HttpStatus.BAD_REQUEST);

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      timestamp: expect.any(String),
      path: "/test",
      method: "GET",
      message: "Test error",
    });
  });

  it("never logs nor echoes a Wallet pass token from the URL", () => {
    const token = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
    mockRequest.url = `/api/v1/licenses/wallet/apple/${token}`;

    filter.catch(
      new HttpException("Too Many Requests", HttpStatus.TOO_MANY_REQUESTS),
      mockArgumentsHost,
    );
    filter.catch(
      new HttpException("Unavailable", HttpStatus.SERVICE_UNAVAILABLE),
      mockArgumentsHost,
    );

    const everything = JSON.stringify([
      mockLogger.warn.mock.calls,
      mockLogger.error.mock.calls,
      mockResponse.json.mock.calls,
    ]);
    expect(everything).not.toContain(token);
    expect(everything).toContain("/api/v1/licenses/wallet/apple/[REDACTED]");
  });

  it("redacts a mixed-case token URL and Nest's 'Cannot GET' echo", () => {
    const token = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
    mockRequest.url = `/api/v1/Licenses/Wallet/APPLE/${token}/extra`;

    filter.catch(
      new HttpException(
        `Cannot GET /api/v1/Licenses/Wallet/APPLE/${token}/extra`,
        HttpStatus.NOT_FOUND,
      ),
      mockArgumentsHost,
    );
    filter.catch(
      new Error(`boom at /licenses/wallet/apple/${token}`),
      mockArgumentsHost,
    );

    const everything = JSON.stringify([
      mockLogger.warn.mock.calls,
      mockLogger.error.mock.calls,
      mockResponse.json.mock.calls,
    ]);
    expect(everything).not.toContain(token);
  });

  it("should handle generic Error correctly", () => {
    const exception = new Error("Generic error");

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: expect.any(String),
      path: "/test",
      method: "GET",
      message: "Generic error",
    });
  });

  it("should handle unknown exceptions correctly", () => {
    const exception = "String error";

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: expect.any(String),
      path: "/test",
      method: "GET",
      message: "Internal server error",
    });
  });

  it("should handle HttpException with object response correctly", () => {
    const exception = new HttpException(
      { error: "Bad Request", message: "Custom message" },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, mockArgumentsHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Custom message" }),
    );
  });

  it("carries existingClubId through a 409 body", () => {
    const exception = new HttpException(
      { message: "Un club porte déjà ce nom", existingClubId: "c1" },
      HttpStatus.CONFLICT,
    );
    filter.catch(exception, mockArgumentsHost);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Un club porte déjà ce nom",
        existingClubId: "c1",
      }),
    );
  });

  it("should handle 500 errors and log them", () => {
    const exception = new Error("Server error");
    filter.catch(exception, mockArgumentsHost);
    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should report 500 errors to Sentry", () => {
    (Sentry.captureException as jest.Mock).mockClear();
    filter.catch(new Error("Server error"), mockArgumentsHost);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("should NOT report 503 (service unavailable) to Sentry but still log it", () => {
    // Regression: an unconfigured optional integration (e.g. WDSF) throws a 503
    // on every call. Those are operational, not code defects — logging yes,
    // Sentry no. See wdsf.service.ts getAuthConfig().
    (Sentry.captureException as jest.Mock).mockClear();
    const exception = new ServiceUnavailableException(
      "Vérification WDSF indisponible. Contacter l’administrateur.",
    );

    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("carries the club-usage counts through a 409, and nothing else", () => {
    const exception = new HttpException(
      {
        message: "Ce club n'est pas vide : désactivez-le plutôt.",
        memberCount: 2,
        clubAccountCount: 1,
        competitionCount: 0,
        partnershipCount: 0,
        soloTeamCount: 0,
        internal: "x",
      },
      HttpStatus.CONFLICT,
    );
    filter.catch(exception, mockArgumentsHost);
    const [body] = mockResponse.json.mock.lastCall as [Record<string, unknown>];
    expect(body).toMatchObject({
      memberCount: 2,
      clubAccountCount: 1,
      competitionCount: 0,
      partnershipCount: 0,
      soloTeamCount: 0,
    });
    expect(body).not.toHaveProperty("internal");
  });

  it("carries the track 409 details (duplicate import, pending corrections)", () => {
    filter.catch(
      new HttpException(
        {
          message: "Cette musique est déjà dans la bibliothèque.",
          existingTrackId: "t1",
        },
        HttpStatus.CONFLICT,
      ),
      mockArgumentsHost,
    );
    expect(mockResponse.json.mock.lastCall?.[0]).toMatchObject({
      existingTrackId: "t1",
    });

    filter.catch(
      new HttpException(
        {
          message: "Des propositions de correction sont en attente",
          pendingCorrections: 2,
        },
        HttpStatus.CONFLICT,
      ),
      mockArgumentsHost,
    );
    expect(mockResponse.json.mock.lastCall?.[0]).toMatchObject({
      pendingCorrections: 2,
    });
  });

  it("does not copy those details on other statuses", () => {
    const exception = new HttpException(
      { message: "x", memberCount: 2, existingClubId: "c1" },
      HttpStatus.BAD_REQUEST,
    );
    filter.catch(exception, mockArgumentsHost);
    const [body] = mockResponse.json.mock.lastCall as [Record<string, unknown>];
    expect(body).not.toHaveProperty("memberCount");
    expect(body).not.toHaveProperty("existingClubId");
  });

  // #225: some 4xx messages are health data (medical unfitness). The user still
  // reads them; the logs only see the stable code.
  describe("coded errors (#225)", () => {
    const HEALTH_TEXT =
      "Le certificat médical indique que vous n'êtes pas apte (SENTINEL-225)";

    it("logs the code, never the message, and still answers the message", () => {
      mockRequest.url = "/api/v1/licenses/renewal/req-1/documents";
      mockRequest.method = "POST";

      filter.catch(
        new CodedBadRequestException("MEDICAL_UNFIT", HEALTH_TEXT),
        mockArgumentsHost,
      );

      const logged = JSON.stringify([
        mockLogger.warn.mock.calls,
        mockLogger.error.mock.calls,
      ]);
      expect(logged).toContain("MEDICAL_UNFIT");
      expect(logged).not.toContain("SENTINEL-225");
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: HEALTH_TEXT,
          code: "MEDICAL_UNFIT",
        }),
      );
    });

    it("logs the neutral logCode, answers the fine code", () => {
      filter.catch(
        new CodedBadRequestException(
          "MEDICAL_UNFIT",
          HEALTH_TEXT,
          "RENEWAL_DOCUMENT_REJECTED",
        ),
        mockArgumentsHost,
      );

      const logged = JSON.stringify(mockLogger.warn.mock.calls);
      expect(logged).toContain("RENEWAL_DOCUMENT_REJECTED");
      expect(logged).not.toContain("MEDICAL_UNFIT");
      expect(logged).not.toContain("SENTINEL-225");
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: HEALTH_TEXT,
          code: "MEDICAL_UNFIT",
        }),
      );
    });

    it("also keeps the text out of 5xx logs and Sentry when a code is set", () => {
      filter.catch(
        new HttpException(
          { message: HEALTH_TEXT, code: "SOME_CODE" },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
        mockArgumentsHost,
      );

      const [payload, line] = mockLogger.error.mock.lastCall as [
        Record<string, unknown>,
        string,
      ];
      expect(payload.message).toBe("SOME_CODE");
      // Message, error.message and the stack header: nothing carries the text.
      expect(JSON.stringify(payload)).not.toContain("SENTINEL-225");
      expect(line).not.toContain("SENTINEL-225");
      expect(
        JSON.stringify((Sentry.captureException as jest.Mock).mock.lastCall),
      ).not.toContain("SENTINEL-225");
    });

    it("answers and logs the code of a plain HttpException body (WDSF_NAME_MISMATCH)", () => {
      const text = "Cette licence WDSF n'est pas à votre nom (SENTINEL-WDSF)";
      filter.catch(
        new HttpException(
          { message: text, code: "WDSF_NAME_MISMATCH" },
          HttpStatus.BAD_REQUEST,
        ),
        mockArgumentsHost,
      );

      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: text, code: "WDSF_NAME_MISMATCH" }),
      );
      const logged = JSON.stringify(mockLogger.warn.mock.calls);
      expect(logged).toContain("WDSF_NAME_MISMATCH");
      expect(logged).not.toContain("SENTINEL-WDSF");
    });

    it("keeps logging the message of uncoded errors", () => {
      filter.catch(
        new HttpException("Plain error", HttpStatus.BAD_REQUEST),
        mockArgumentsHost,
      );
      const [payload] = mockLogger.warn.mock.lastCall as [
        Record<string, unknown>,
      ];
      expect(payload.message).toBe("Plain error");
      const [body] = mockResponse.json.mock.lastCall as [
        Record<string, unknown>,
      ];
      expect(body).not.toHaveProperty("code");
    });
  });
});
