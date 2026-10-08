import { CallHandler, ExecutionContext } from "@nestjs/common";
import { of, throwError } from "rxjs";
import { LoggingInterceptor } from "./logging.interceptor";

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
});
