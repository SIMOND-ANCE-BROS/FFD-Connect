import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "crypto";
import { WebhookSignatureGuard } from "./webhook-signature.guard";

describe("WebhookSignatureGuard", () => {
  const secret = "test-webhook-secret-32chars-long!";
  let guard: WebhookSignatureGuard;
  let configService: ConfigService;

  function makeContext(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          rawBody,
          headers: {
            "x-helloasso-signature": signature,
          },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function sign(body: string, key: string): string {
    return createHmac("sha256", key).update(Buffer.from(body)).digest("hex");
  }

  beforeEach(() => {
    configService = { get: jest.fn() } as unknown as ConfigService;
    guard = new WebhookSignatureGuard(configService);
  });

  it("allows request with valid signature", () => {
    (configService.get as jest.Mock).mockReturnValue(secret);
    const body = '{"eventType":"Order"}';
    const rawBody = Buffer.from(body);
    const signature = sign(body, secret);

    expect(guard.canActivate(makeContext(rawBody, signature))).toBe(true);
  });

  it("rejects when HELLOASSO_WEBHOOK_SECRET is not configured", () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);

    expect(() =>
      guard.canActivate(makeContext(Buffer.from("{}"), "abc")),
    ).toThrow(UnauthorizedException);
  });

  it("rejects when signature header is missing", () => {
    (configService.get as jest.Mock).mockReturnValue(secret);

    expect(() =>
      guard.canActivate(makeContext(Buffer.from("{}"), undefined)),
    ).toThrow(UnauthorizedException);
  });

  it("rejects when raw body is not available", () => {
    (configService.get as jest.Mock).mockReturnValue(secret);

    expect(() => guard.canActivate(makeContext(undefined, "abc"))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects when signature does not match", () => {
    (configService.get as jest.Mock).mockReturnValue(secret);
    const body = '{"eventType":"Order"}';
    const rawBody = Buffer.from(body);
    const wrongSignature = sign(body, "wrong-secret-that-is-32chars!!");

    expect(() =>
      guard.canActivate(makeContext(rawBody, wrongSignature)),
    ).toThrow(UnauthorizedException);
  });

  it("rejects tampered body with valid-format signature", () => {
    (configService.get as jest.Mock).mockReturnValue(secret);
    const originalBody = '{"eventType":"Order","data":{}}';
    const tamperedBody =
      '{"eventType":"Order","data":{"metadata":{"bookingId":"hacked"}}}';
    const signature = sign(originalBody, secret);

    expect(() =>
      guard.canActivate(makeContext(Buffer.from(tamperedBody), signature)),
    ).toThrow(UnauthorizedException);
  });
});
