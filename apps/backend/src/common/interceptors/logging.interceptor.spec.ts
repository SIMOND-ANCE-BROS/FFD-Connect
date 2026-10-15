import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { of, throwError } from "rxjs";
import { LoggingInterceptor } from "./logging.interceptor";
import { CodedBadRequestException } from "../errors/coded-bad-request.exception";

describe("LoggingInterceptor", () => {
  let interceptor: LoggingInterceptor;
  let mockExecutionContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  const mockRequest = { method: "GET", url: "/test", headers: {} };
  const mockResponse = { statusCode: 200 };
  let mockLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    interceptor = new LoggingInterceptor(
      mockLogger as unknown as import("nestjs-pino").PinoLogger,
    );
    mockExecutionContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getClass: jest.fn(),
      getHandler: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      getType: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
    };
    mockCallHandler = {
      handle: jest.fn(),
    };
  });

  it("should be defined", () => {
    expect(interceptor).toBeDefined();
  });

  it("should log on successful request", (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of("data"));

    const result = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result.subscribe({
      next: (value) => {
        expect(value).toBe("data");
        done();
      },
    });
  });

  it("should log warning on 400 status", (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of("data"));
    mockResponse.statusCode = 400;

    const result = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result.subscribe({
      next: () => {
        expect(mockLogger.warn).toHaveBeenCalled();
        done();
      },
    });
  });

  it("should log error on 500 status", (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of("data"));
    mockResponse.statusCode = 500;

    const result = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result.subscribe({
      next: () => {
        expect(mockLogger.error).toHaveBeenCalled();
        done();
      },
    });
  });

  it('should use "unknown" if user-agent is missing', (done) => {
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of("data"));
    mockRequest.headers = {}; // Ensure no user-agent

    const result = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result.subscribe({
      next: () => {
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.objectContaining({ userAgent: "unknown" }),
          expect.any(String),
        );
        done();
      },
    });
  });

  it("should propagate errors and log them", (done) => {
    const err = new Error("Test error");
    (mockCallHandler.handle as jest.Mock).mockReturnValue(
      throwError(() => err),
    );

    const result = interceptor.intercept(mockExecutionContext, mockCallHandler);

    result.subscribe({
      error: (e) => {
        expect(e).toBe(err);
        expect(mockLogger.error).toHaveBeenCalled();
        done();
      },
    });
  });

  it("never logs a Wallet pass token from the URL", (done) => {
    const token = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
    const originalUrl = mockRequest.url;
    mockRequest.url = `/api/v1/licenses/wallet/apple/${token}`;
    mockResponse.statusCode = 429;
    (mockCallHandler.handle as jest.Mock).mockReturnValue(of("data"));

    interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
      next: () => {
        mockRequest.url = originalUrl;
        const logged = JSON.stringify([
          mockLogger.debug.mock.calls,
          mockLogger.warn.mock.calls,
        ]);
        expect(logged).not.toContain(token);
        expect(logged).toContain("/api/v1/licenses/wallet/apple/[REDACTED]");
        done();
      },
    });
  });

  describe("thrown exceptions (#571)", () => {
    // The filter has not written the response yet: statusCode is still 200.
    beforeEach(() => {
      mockResponse.statusCode = 200;
    });

    function runError(err: unknown): Promise<void> {
      (mockCallHandler.handle as jest.Mock).mockReturnValue(
        throwError(() => err),
      );
      return new Promise((resolve) => {
        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
          error: (e) => {
            expect(e).toBe(err);
            resolve();
          },
        });
      });
    }

    it("logs a NotFoundException at warn with statusCode 404, no stack", async () => {
      await runError(new NotFoundException("Track abc not found"));

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const [data, text] = mockLogger.warn.mock.calls[0] as [
        { statusCode: number; error: { stack?: string; message: string } },
        string,
      ];
      expect(data.statusCode).toBe(404);
      expect(data.error.stack).toBeUndefined();
      expect(data.error.message).toBe("Track abc not found");
      expect(text).toContain(" 404 ");
      expect(text).not.toContain(" 200 ");
    });

    it.each([
      [new BadRequestException("bad"), 400],
      [new ForbiddenException(), 403],
    ])("logs %p at warn with its own status", async (err, status) => {
      await runError(err);

      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: status }),
        expect.stringContaining(` ${status} `),
      );
    });

    it("logs a non-HTTP error at error with statusCode 500 and its stack", async () => {
      await runError(new Error("boom"));

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          error: expect.objectContaining({
            message: "boom",
            stack: expect.stringContaining("boom"),
          }) as unknown,
        }),
        expect.stringContaining(" 500 "),
      );
    });

    it("logs a non-Error throw at error with statusCode 500", async () => {
      await runError("plain string");

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 500 }),
        expect.stringContaining("plain string"),
      );
    });

    it("logs an HTTP 5xx at error with its own status", async () => {
      await runError(new ServiceUnavailableException("down"));

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 503 }),
        expect.stringContaining(" 503 "),
      );
    });

    it("logs only the code of a coded 400, never its user text", async () => {
      await runError(
        new CodedBadRequestException(
          "MEDICAL_CERTIFICATE_EXPIRED",
          "Votre certificat médical a expiré",
          "LICENSE_RENEWAL_REFUSED",
        ),
      );

      const logged = JSON.stringify(mockLogger.warn.mock.calls);
      expect(logged).toContain("LICENSE_RENEWAL_REFUSED");
      expect(logged).not.toContain("certificat");
      expect(logged).not.toContain("MEDICAL_CERTIFICATE_EXPIRED");
    });

    it("drops the stack header of a coded 5xx", async () => {
      const err = new CodedBadRequestException("X_CODE", "secret text");
      jest.spyOn(err, "getStatus").mockReturnValue(500);
      await runError(err);

      const logged = JSON.stringify(mockLogger.error.mock.calls);
      expect(logged).toContain("X_CODE");
      expect(logged).not.toContain("secret text");
    });
  });
});
