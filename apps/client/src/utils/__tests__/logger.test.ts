import * as Sentry from "@sentry/react-native";
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

  describe("HTTP error routing to Sentry (#585)", () => {
    const axiosError = (status: number | undefined): Error =>
      Object.assign(new Error("Request failed"), {
        name: "AxiosError",
        isAxiosError: true,
        response: status === undefined ? undefined : { status },
        config: { url: "/tracks/42?x=1", method: "get" },
      });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it.each([401, 404, 429])(
      "records an expected %i as a warning breadcrumb, not an exception",
      (status) => {
        logger.error("API Error", axiosError(status));

        expect(Sentry.captureException).not.toHaveBeenCalled();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
        expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
          expect.objectContaining({
            category: "http",
            level: "warning",
            data: { status, method: "GET", route: "/tracks/:id" },
          }),
        );
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
      },
    );

    it.each([500, 503, 400, 422])(
      "captures a %i with a status + route fingerprint",
      (status) => {
        const err = axiosError(status);
        logger.error("API Error", err);

        expect(Sentry.captureException).toHaveBeenCalledWith(
          err,
          expect.objectContaining({
            fingerprint: ["http-error", String(status), "GET", "/tracks/:id"],
            tags: { http_status: String(status), http_route: "/tracks/:id" },
          }),
        );
        expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
      },
    );

    it("captures a network error with a 'network' fingerprint", () => {
      logger.error("API Error", axiosError(undefined));

      expect(Sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          fingerprint: ["http-error", "network", "GET", "/tracks/:id"],
        }),
      );
    });

    it("captures non-HTTP errors without a custom fingerprint", () => {
      logger.error("boom", new Error("boom"));

      const ctx = (Sentry.captureException as jest.Mock).mock
        .calls[0][1] as Record<string, unknown>;
      expect(ctx.fingerprint).toBeUndefined();
      expect(ctx.extra).toEqual(
        expect.objectContaining({ message: "boom", context: "App" }),
      );
    });

    it("captures a message when no error object is given", () => {
      logger.error("no error object");
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        "[App] no error object",
        "error",
      );
    });
  });

  it("respects min log level", () => {
    logger.setMinLevel(LogLevel.ERROR);
    logger.info("Should not log");
    expect(warnSpy).not.toHaveBeenCalled();

    logger.error("Should log");
    expect(errorSpy).toHaveBeenCalled();
  });
});
