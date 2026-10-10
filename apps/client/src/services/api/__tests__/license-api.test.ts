import { appleWalletControllerCreateDownloadLink } from "../../../api/generated";
import {
  APPLE_WALLET_GENERIC_ERROR,
  APPLE_WALLET_NETWORK_ERROR,
  AppleWalletLinkError,
  buildAppleWalletPassUrl,
  LicenseApi,
} from "../license-api";
import { HttpError } from "../../../utils/httpInterceptor";

jest.mock("../../../api/generated", () => ({
  appleWalletControllerCreateDownloadLink: jest.fn(),
}));
jest.mock("../../../config", () => ({
  BACKEND_URL: "https://api.example.test/api/v1",
}));

const TOKEN = "a".repeat(20) + "B-_9" + "c".repeat(19); // 43 chars, base64url
const mockCreate = appleWalletControllerCreateDownloadLink as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("buildAppleWalletPassUrl", () => {
  it("rebuilds the URL from the app's API URL and the relative path", () => {
    expect(
      buildAppleWalletPassUrl(
        `licenses/wallet/apple/${TOKEN}`,
        "https://api.example.test/api/v1",
      ),
    ).toBe(`https://api.example.test/api/v1/licenses/wallet/apple/${TOKEN}`);
  });

  it("accepts a leading slash and a trailing slash on the API URL", () => {
    expect(
      buildAppleWalletPassUrl(
        `/licenses/wallet/apple/${TOKEN}`,
        "https://api.example.test/api/v1/",
      ),
    ).toBe(`https://api.example.test/api/v1/licenses/wallet/apple/${TOKEN}`);
  });

  it.each([
    ["another route", `licenses/my/${TOKEN}`],
    ["an absolute URL", `https://evil.test/licenses/wallet/apple/${TOKEN}`],
    ["a protocol-relative URL", `//evil.test/licenses/wallet/apple/${TOKEN}`],
    ["path traversal", `licenses/wallet/apple/../../users/${TOKEN}`],
    ["a query string", `licenses/wallet/apple/${TOKEN}?next=evil`],
    ["a too short token", "licenses/wallet/apple/abc"],
  ])("rejects %s", (_label, path) => {
    expect(() =>
      buildAppleWalletPassUrl(path, "https://api.example.test/api/v1"),
    ).toThrow(AppleWalletLinkError);
  });

  it("rejects an empty API URL (unconfigured build)", () => {
    expect(() =>
      buildAppleWalletPassUrl(`licenses/wallet/apple/${TOKEN}`, ""),
    ).toThrow(APPLE_WALLET_GENERIC_ERROR);
  });
});

describe("LicenseApi.createAppleWalletPassUrl", () => {
  it("ignores the absolute url and recomposes it from path + API URL", async () => {
    mockCreate.mockResolvedValue({
      data: {
        url: `https://evil.test/api/v1/licenses/wallet/apple/${TOKEN}`,
        path: `licenses/wallet/apple/${TOKEN}`,
        expiresAt: "2026-10-09T10:05:00.000Z",
      },
      error: undefined,
      response: { status: 201 },
    });

    await expect(LicenseApi.createAppleWalletPassUrl()).resolves.toBe(
      `https://api.example.test/api/v1/licenses/wallet/apple/${TOKEN}`,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, "Aucune licence"],
    [422, "expirée"],
    [429, "Trop de tentatives"],
    [503, "momentanément indisponible"],
    [500, "a échoué"],
  ])("translates a %i into a French message", async (status, fragment) => {
    mockCreate.mockResolvedValue({
      data: undefined,
      error: { message: "boom" },
      response: { status },
    });

    const error = await LicenseApi.createAppleWalletPassUrl().catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppleWalletLinkError);
    expect((error as AppleWalletLinkError).status).toBe(status);
    expect((error as Error).message).toContain(fragment);
  });

  it("reports a network error when no response came back", async () => {
    mockCreate.mockResolvedValue({
      data: undefined,
      error: new TypeError("Network request failed"),
      response: undefined,
    });
    await expect(LicenseApi.createAppleWalletPassUrl()).rejects.toThrow(
      APPLE_WALLET_NETWORK_ERROR,
    );
  });

  it("reports a network error when the SDK call throws", async () => {
    mockCreate.mockRejectedValue(new TypeError("Network request failed"));
    await expect(LicenseApi.createAppleWalletPassUrl()).rejects.toThrow(
      APPLE_WALLET_NETWORK_ERROR,
    );
  });

  it("fails cleanly when the server returns an unexpected path", async () => {
    mockCreate.mockResolvedValue({
      data: {
        url: "https://evil.test/x",
        path: "https://evil.test/x",
        expiresAt: "2026-10-09T10:05:00.000Z",
      },
      error: undefined,
      response: { status: 201 },
    });
    await expect(LicenseApi.createAppleWalletPassUrl()).rejects.toThrow(
      APPLE_WALLET_GENERIC_ERROR,
    );
  });
});

// #225: a refused upload can be medical. Its text is for the user only.
describe("LicenseApi.uploadRenewalDocument — refusal", () => {
  const MEDICAL_TEXT = "Certificat : pas apte (SENTINEL-225)";

  it("keeps a coded refusal's text out of the error message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: jest
        .fn()
        .mockResolvedValue({ message: MEDICAL_TEXT, code: "MEDICAL_UNFIT" }),
    });

    const err = (await LicenseApi.uploadRenewalDocument(
      "tok",
      "req-1",
      "MEDICAL_CERTIFICATE",
      "file:///doc.jpg",
    ).catch((e: unknown) => e)) as HttpError;

    expect(err).toBeInstanceOf(HttpError);
    expect(err.message).toBe("Upload failed 400");
    expect(err.userMessage).toBe(MEDICAL_TEXT);
    expect(err.code).toBe("MEDICAL_UNFIT");
  });

  it("falls back on a generic message when the body is unreadable", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Error",
      json: jest.fn().mockRejectedValue(new Error("not json")),
    });

    await expect(
      LicenseApi.uploadRenewalDocument(
        "tok",
        "req-1",
        "LICENSE_CERTIFICATE",
        "file:///doc.jpg",
      ),
    ).rejects.toThrow("Upload failed 500");
  });
});
