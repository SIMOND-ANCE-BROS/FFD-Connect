import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
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
});
