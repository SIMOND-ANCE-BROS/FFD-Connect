import * as Sentry from "@sentry/react-native";

import { TokenStoreUnavailableError } from "../../api/tokenStoreErrors";
import { createLogger, logger, LogLevel } from "../logger";

describe("logger", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it("never reports an unreadable token store to Sentry (#582)", () => {
    logger.error(
      "Failed",
      new TokenStoreUnavailableError(
        new Error("User interaction is not allowed."),
      ),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
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
        { level: "error", extra: { context: "App", data: undefined } },
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

  describe("release builds (#589)", () => {
    const globals = globalThis as unknown as { __DEV__: boolean };
    const originalDev = globals.__DEV__;

    beforeEach(() => {
      jest.clearAllMocks();
      globals.__DEV__ = false;
    });

    afterEach(() => {
      globals.__DEV__ = originalDev;
    });

    it("is enabled with a WARN floor: debug and info are dropped", () => {
      const log = createLogger("Release");
      log.debug("debug");
      log.info("info");
      log.warn("warn");

      expect(log.getLogs().map((l) => l.message)).toEqual(["[Release] warn"]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("sends logger.error to Sentry as an exception", () => {
      const log = createLogger("Release");
      const err = new Error("broken");
      log.error("Something failed", err, { trackId: "t1" });

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err, {
        extra: {
          message: "Something failed",
          context: "Release",
          data: { trackId: "t1" },
        },
      });
      // No console in release: the Sentry console integration would turn
      // it into an unscrubbed breadcrumb.
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("turns logger.warn into a breadcrumb, never an event", () => {
      const log = createLogger("Release");
      log.warn("Degraded", new Error("slow"), { attempt: 2 });

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
        category: "logger",
        level: "warning",
        message: "[Release] Degraded",
        data: {
          context: "Release",
          error: { name: "Error", message: "slow" },
          data: { attempt: 2 },
        },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("still keeps expected 4xx and a locked token store out of events", () => {
      const log = createLogger("Release");
      log.error(
        "API",
        Object.assign(new Error("Request failed"), {
          isAxiosError: true,
          response: { status: 404 },
          config: { url: "/x", method: "get" },
        }),
      );
      log.error(
        "Locked",
        new TokenStoreUnavailableError(new Error("interaction not allowed")),
      );

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it("scrubs personal data from what reaches Sentry", () => {
      const log = createLogger("Release");
      log.error("Login failed for jane@doe.fr", new Error("x"), {
        email: "jane@doe.fr",
        firstName: "Jane",
        accessToken: "abc",
        url: "/users/search?q=Jane",
        status: 500,
      });

      const ctx = (Sentry.captureException as jest.Mock).mock.calls[0][1] as {
        extra: Record<string, unknown>;
      };
      expect(ctx.extra.message).toBe("Login failed for [email]");
      expect(ctx.extra.data).toEqual({
        email: "[redacted]",
        firstName: "[redacted]",
        accessToken: "[redacted]",
        url: "/users/search?[query]",
        status: 500,
      });
      expect(JSON.stringify(ctx)).not.toContain("Jane");
    });

    it("keeps a non-Error second argument as data", () => {
      const log = createLogger("Release");
      log.error("Playback", { code: "E_NETWORK" });

      expect(Sentry.captureMessage).toHaveBeenCalledWith("[Release] Playback", {
        level: "error",
        extra: { context: "Release", data: { code: "E_NETWORK" } },
      });
    });
  });
});
