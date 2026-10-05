import { Test, TestingModule } from "@nestjs/testing";
import { PinoLogger } from "nestjs-pino";
import { LoggerService } from "./logger.service";

describe("LoggerService", () => {
  let service: LoggerService;
  let mockPinoLogger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(async () => {
    mockPinoLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoggerService,
        { provide: PinoLogger, useValue: mockPinoLogger },
      ],
    }).compile();

    service = module.get<LoggerService>(LoggerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should log debug", () => {
    service.debug("test", "context", { foo: "bar" });
    expect(mockPinoLogger.debug).toHaveBeenCalledWith(
      { context: "context", foo: "bar" },
      "test",
    );
  });

  it("should log info", () => {
    service.info("test", "context");
    expect(mockPinoLogger.info).toHaveBeenCalledWith(
      { context: "context" },
      "test",
    );
  });

  it("should log warn", () => {
    service.warn("test");
    expect(mockPinoLogger.warn).toHaveBeenCalledWith(
      { context: undefined },
      "test",
    );
  });

  it("should log error with Error object", () => {
    const error = new Error("fail");
    service.error("test", error, "context");
    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "context",
        error: expect.objectContaining({ message: "fail" }),
      }),
      "test",
    );
  });

  it("should log error with unknown error", () => {
    service.error("test", "string error");
    expect(mockPinoLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: "string error" }),
      "test",
    );
  });

  it("should log HTTP requests with appropriate levels", () => {
    service.logHttpRequest("GET", "/test", 200, 10);
    expect(mockPinoLogger.info).toHaveBeenCalled();

    service.logHttpRequest("POST", "/test", 400, 20);
    expect(mockPinoLogger.warn).toHaveBeenCalled();

    service.logHttpRequest("DELETE", "/test", 500, 30);
    expect(mockPinoLogger.error).toHaveBeenCalled();
  });
});
