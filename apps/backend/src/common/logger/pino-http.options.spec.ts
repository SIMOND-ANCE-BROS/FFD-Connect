import type { IncomingMessage, ServerResponse } from "http";
import pino from "pino";
import { Writable } from "stream";
import { buildPinoHttpOptions } from "./pino-http.options";

const TOKEN = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";
const req = {
  id: 7,
  method: "GET",
  url: `/api/v1/licenses/wallet/apple/${TOKEN}`,
  headers: { host: "api.example.org", "user-agent": "Safari" },
  socket: { remoteAddress: "203.0.113.42", remotePort: 51234 },
} as unknown as IncomingMessage;
const res = (statusCode: number) => ({ statusCode }) as ServerResponse;

describe("buildPinoHttpOptions", () => {
  const options = buildPinoHttpOptions(false);

  it("never serialises a Wallet pass token from the URL", () => {
    const serialized = (
      options.serializers as { req: (r: IncomingMessage) => { url: string } }
    ).req(req);
    expect(serialized.url).toBe("/api/v1/licenses/wallet/apple/[REDACTED]");
    expect(JSON.stringify(serialized)).not.toContain(TOKEN);
  });

  it("redacts the token in success and error messages (e.g. 429/503)", () => {
    const success = options.customSuccessMessage?.(req, res(200), 3);
    const error = options.customErrorMessage?.(
      req,
      res(503),
      new Error("Unavailable"),
    );
    expect(success).toBe("GET /api/v1/licenses/wallet/apple/[REDACTED] 200");
    expect(error).toBe(
      "GET /api/v1/licenses/wallet/apple/[REDACTED] 503 - Unavailable",
    );
  });

  it("redacts a mixed-case URL and a token echoed in the error", () => {
    const mixed = {
      ...req,
      url: `/API/v1/Licenses/Wallet/Apple/${TOKEN}?x=1`,
    } as unknown as IncomingMessage;
    const err = new Error(`Cannot GET /api/v1/licenses/wallet/apple/${TOKEN}`);
    const serializers = options.serializers as {
      req: (r: IncomingMessage) => { url: string };
      err: (e: Error) => { message: string; stack?: string };
    };
    const logged = JSON.stringify([
      serializers.req(mixed),
      serializers.err(err),
      options.customErrorMessage?.(mixed, res(429), err),
    ]);
    expect(logged).not.toContain(TOKEN);
  });

  describe("client IP (RGPD, #529)", () => {
    /** A real pino logger built from these options, writing into `lines`. */
    const loggerWithOptions = () => {
      const lines: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      });
      const { transport: _transport, ...pinoOptions } = options;
      return { logger: pino(pinoOptions, stream), lines };
    };

    it("logs only the /24 network of the socket address, without its port", () => {
      const serialized = (
        options.serializers as { req: (r: IncomingMessage) => unknown }
      ).req(req);
      expect(serialized).toMatchObject({ remoteAddress: "203.0.113.0/24" });
      expect(serialized).not.toHaveProperty("remotePort");
      expect(JSON.stringify(serialized)).not.toContain("203.0.113.42");
      expect(JSON.stringify(serialized)).not.toContain("51234");
    });

    it("truncates the `ip` the request interceptor logs, at the pino level", () => {
      const { logger, lines } = loggerWithOptions();
      // What LoggingInterceptor writes for each request and response.
      logger.info(
        { method: "GET", url: "/api/v1/x", ip: "203.0.113.42" },
        "GET /api/v1/x 200",
      );
      logger
        .child({ context: "HTTP" })
        .warn({ ip: "2001:db8:abcd:12::1", clientIp: "198.51.100.7" }, "x");

      const output = lines.join("");
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        ip: "203.0.113.0/24",
      });
      expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
        ip: "2001:db8:abcd::/48",
        clientIp: "198.51.100.0/24",
      });
      expect(output).not.toContain("203.0.113.42");
      expect(output).not.toContain("198.51.100.7");
      expect(output).not.toContain(":12::1");
    });

    it("truncates an `ip` nested one level down and leaves other logs alone", () => {
      const { logger, lines } = loggerWithOptions();
      logger.info({ client: { ip: "203.0.113.42" } }, "nested");
      logger.info({ userId: "u1" }, "no ip");

      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        client: { ip: "203.0.113.0/24" },
      });
      expect(JSON.parse(lines[1] ?? "{}")).not.toHaveProperty("ip");
    });
  });

  it("handles a request without method or URL", () => {
    const bare = { headers: {} } as unknown as IncomingMessage;
    expect(options.customSuccessMessage?.(bare, res(200), 1)).toBe("  200");
  });

  it("serialises res and err", () => {
    const serializers = options.serializers as {
      res: (r: ServerResponse) => unknown;
      err: (e: Error) => { type: string; message: string };
    };
    expect(serializers.res(res(404))).toEqual({ statusCode: 404 });
    expect(serializers.err(new TypeError("x"))).toMatchObject({
      type: "TypeError",
      message: "x",
    });
  });

  it("maps status codes to log levels", () => {
    const level = (code: number, err?: Error) =>
      options.customLogLevel?.(req, res(code), err);
    expect(level(200)).toBe("info");
    expect(level(429)).toBe("warn");
    expect(level(503)).toBe("error");
    expect(level(200, new Error("x"))).toBe("error");
    expect(options.customProps?.(req, res(200))).toEqual({ context: "HTTP" });
  });

  it("pretty-prints and logs debug in development only", () => {
    expect(buildPinoHttpOptions(true)).toMatchObject({
      level: "debug",
      transport: { target: "pino-pretty" },
    });
    expect(options.level).toBe("info");
    expect(options.transport).toBeUndefined();
  });
});
