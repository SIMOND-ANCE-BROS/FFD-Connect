import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import {
  HELLOASSO_SIGNATURE_HEADER,
  WebhookSignatureGuard,
} from "./webhook-signature.guard";

describe("WebhookSignatureGuard", () => {
  const key = "partner-signature-key-for-tests";
  let guard: WebhookSignatureGuard;
  let configService: ConfigService;

  function makeContext(
    rawBody: Buffer | undefined,
    headers: Record<string, string | undefined>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ rawBody, headers }),
      }),
    } as unknown as ExecutionContext;
  }

  function sign(body: string, signingKey: string): string {
    return createHmac("sha256", signingKey)
      .update(Buffer.from(body))
      .digest("hex");
  }

  const configure = (value: string | undefined) =>
    (configService.get as jest.Mock).mockImplementation((name: string) =>
      name === "HELLOASSO_SIGNATURE_KEY" ? value : undefined,
    );

  beforeEach(() => {
    configService = { get: jest.fn() } as unknown as ConfigService;
    guard = new WebhookSignatureGuard(configService);
  });

  it("reads the documented HelloAsso header name", () => {
    expect(HELLOASSO_SIGNATURE_HEADER).toBe("x-ha-signature");
  });

  describe("association mode (no partner signature key)", () => {
    it("accepts an unsigned notification: trust comes from the API re-read", () => {
      configure(undefined);

      expect(guard.canActivate(makeContext(Buffer.from("{}"), {}))).toBe(true);
    });

    it("ignores the obsolete HELLOASSO_WEBHOOK_SECRET", () => {
      (configService.get as jest.Mock).mockImplementation((name: string) =>
        name === "HELLOASSO_WEBHOOK_SECRET" ? "old-secret" : undefined,
      );

      expect(guard.canActivate(makeContext(Buffer.from("{}"), {}))).toBe(true);
    });
  });

  describe("partner mode (HELLOASSO_SIGNATURE_KEY set)", () => {
    beforeEach(() => configure(key));

    it("allows a request with a valid x-ha-signature", () => {
      const body = '{"eventType":"Order"}';

      expect(
        guard.canActivate(
          makeContext(Buffer.from(body), {
            "x-ha-signature": sign(body, key),
          }),
        ),
      ).toBe(true);
    });

    it("accepts an upper-case hex signature", () => {
      const body = '{"eventType":"Order"}';

      expect(
        guard.canActivate(
          makeContext(Buffer.from(body), {
            "x-ha-signature": sign(body, key).toUpperCase(),
          }),
        ),
      ).toBe(true);
    });

    it("rejects when the signature header is missing", () => {
      expect(() =>
        guard.canActivate(makeContext(Buffer.from("{}"), {})),
      ).toThrow(UnauthorizedException);
    });

    it("rejects a signature sent under the old, undocumented header", () => {
      const body = "{}";

      expect(() =>
        guard.canActivate(
          makeContext(Buffer.from(body), {
            "x-helloasso-signature": sign(body, key),
          }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it("rejects a malformed (non hex / wrong length) signature", () => {
      expect(() =>
        guard.canActivate(
          makeContext(Buffer.from("{}"), { "x-ha-signature": "abc" }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it("rejects when the raw body is not available", () => {
      expect(() =>
        guard.canActivate(
          makeContext(undefined, { "x-ha-signature": sign("{}", key) }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it("rejects a signature made with another key", () => {
      const body = '{"eventType":"Order"}';

      expect(() =>
        guard.canActivate(
          makeContext(Buffer.from(body), {
            "x-ha-signature": sign(body, "another-key"),
          }),
        ),
      ).toThrow(UnauthorizedException);
    });

    it("rejects a tampered body", () => {
      const original = '{"eventType":"Order","data":{}}';
      const tampered =
        '{"eventType":"Order","data":{"metadata":{"bookingId":"hacked"}}}';

      expect(() =>
        guard.canActivate(
          makeContext(Buffer.from(tampered), {
            "x-ha-signature": sign(original, key),
          }),
        ),
      ).toThrow(UnauthorizedException);
    });
  });
});
