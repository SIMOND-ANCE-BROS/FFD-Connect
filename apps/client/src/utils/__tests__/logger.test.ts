import { logger, LogLevel } from "../logger";

describe("logger", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    // Force logger to be enabled for testing
    logger.setEnabled(true);
    logger.setMinLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs info messages", () => {
    logger.info("Test info message");
    expect(warnSpy).toHaveBeenCalledWith("[App] Test info message");
  });

  it("logs debug messages in development", () => {
    // Note: __DEV__ is true in tests by default usually
    logger.debug("Test debug message");
    expect(warnSpy).toHaveBeenCalledWith("[App] Test debug message");
  });

  it("logs warn messages", () => {
    logger.warn("Test warning");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("logs error messages", () => {
    logger.error("Test error", new Error("Fail"));
    expect(errorSpy).toHaveBeenCalled();
  });

  it("respects min log level", () => {
    logger.setMinLevel(LogLevel.ERROR);
    logger.info("Should not log");
    expect(warnSpy).not.toHaveBeenCalled();

    logger.error("Should log");
    expect(errorSpy).toHaveBeenCalled();
  });
});
