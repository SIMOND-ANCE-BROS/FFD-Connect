import { BadRequestException, StreamableFile } from "@nestjs/common";
import { Request as ExpressRequest } from "express";
import { AppleWalletController, publicOrigin } from "./apple-wallet.controller";
import { AppleWalletPassService } from "./apple-wallet-pass.service";

function fakeRequest(
  headers: Record<string, string | string[] | undefined>,
  protocol = "http",
): ExpressRequest {
  return {
    headers,
    protocol,
    get: (name: string) => headers[name.toLowerCase()] as string | undefined,
  } as unknown as ExpressRequest;
}

describe("publicOrigin", () => {
  it("trusts the first X-Forwarded-Proto behind the ingress", () => {
    expect(
      publicOrigin(
        fakeRequest({
          host: "api.example.org",
          "x-forwarded-proto": "HTTPS, http",
        }),
      ),
    ).toBe("https://api.example.org");
  });

  it("reads an array header", () => {
    expect(
      publicOrigin(
        fakeRequest({ host: "h:3000", "x-forwarded-proto": ["https"] }),
      ),
    ).toBe("https://h:3000");
  });

  it("falls back to the socket protocol for unknown values", () => {
    expect(
      publicOrigin(
        fakeRequest({ host: "localhost:3000", "x-forwarded-proto": "ftp" }),
      ),
    ).toBe("http://localhost:3000");
    expect(publicOrigin(fakeRequest({ host: "localhost:3000" }, ""))).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects a malformed or missing Host", () => {
    expect(() =>
      publicOrigin(fakeRequest({ host: "evil.com/path?x=" })),
    ).toThrow(BadRequestException);
    expect(() => publicOrigin(fakeRequest({}))).toThrow(BadRequestException);
    expect(() => publicOrigin(fakeRequest({ host: "[::1" }))).toThrow(
      BadRequestException,
    );
  });

  it("accepts a bracketed IPv6 host", () => {
    expect(publicOrigin(fakeRequest({ host: "[::1]:3000" }))).toBe(
      "http://[::1]:3000",
    );
  });
});

describe("AppleWalletController", () => {
  const service = {
    issueDownloadToken: jest.fn(),
    consumeAndGeneratePass: jest.fn(),
    checkDownloadToken: jest.fn(),
  };
  const controller = new AppleWalletController(
    service as unknown as AppleWalletPassService,
  );

  it("returns an absolute download URL for the caller's own license", async () => {
    const token = "t".repeat(43);
    service.issueDownloadToken.mockResolvedValue({
      token,
      expiresAt: new Date("2026-10-08T10:05:00.000Z"),
    });
    const req = Object.assign(
      fakeRequest({ host: "api.example.org", "x-forwarded-proto": "https" }),
      { user: { userId: "u1" } },
    );

    await expect(controller.createDownloadLink(req)).resolves.toEqual({
      url: `https://api.example.org/api/v1/licenses/wallet/apple/${token}`,
      path: `licenses/wallet/apple/${token}`,
      expiresAt: "2026-10-08T10:05:00.000Z",
    });
    expect(service.issueDownloadToken).toHaveBeenCalledWith("u1");
  });

  it("rejects a bad Host before issuing any token", async () => {
    service.issueDownloadToken.mockClear();
    const req = Object.assign(fakeRequest({ host: "bad host" }), {
      user: { userId: "u1" },
    });
    await expect(controller.createDownloadLink(req)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.issueDownloadToken).not.toHaveBeenCalled();
  });

  it("streams the pass with the Wallet MIME type", async () => {
    service.consumeAndGeneratePass.mockResolvedValue(Buffer.from("zip"));
    const file = await controller.downloadPass({ token: "abc" });
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: "application/vnd.apple.pkpass",
      disposition: 'attachment; filename="ffd-connect-licence.pkpass"',
      length: 3,
    });
    expect(service.consumeAndGeneratePass).toHaveBeenCalledWith("abc");
  });

  it("answers HEAD without spending a download or signing a pass", async () => {
    service.consumeAndGeneratePass.mockClear();
    service.checkDownloadToken.mockResolvedValue(undefined);
    await expect(
      controller.checkPassLink({ token: "abc" }),
    ).resolves.toBeUndefined();
    expect(service.checkDownloadToken).toHaveBeenCalledWith("abc");
    expect(service.consumeAndGeneratePass).not.toHaveBeenCalled();
  });

  it("declares the HEAD route before GET (Express would route HEAD to GET)", () => {
    const methods = Object.getOwnPropertyNames(AppleWalletController.prototype);
    expect(methods.indexOf("checkPassLink")).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf("checkPassLink")).toBeLessThan(
      methods.indexOf("downloadPass"),
    );
  });
});
