import { screenshotIntegration } from "@sentry/react-native";
import {
  sentryBeforeSend,
  sentryIntegrations,
  sentryPrivacyOptions,
} from "../sentryOptions";
import { beforeScreenshot } from "../sentryPrivacy";

jest.mock("@sentry/react-native", () => ({
  screenshotIntegration: jest.fn(() => ({ name: "Screenshot" })),
}));

type Integration = ReturnType<typeof screenshotIntegration>;
const integration = (name: string): Integration => ({ name });

describe("sentryPrivacyOptions (#242)", () => {
  it("keeps native screenshots and view hierarchy off", () => {
    // attachScreenshot is forwarded to the native SDKs, which would screenshot
    // native crashes without asking beforeScreenshot.
    expect(sentryPrivacyOptions.attachScreenshot).toBe(false);
    expect(sentryPrivacyOptions.attachViewHierarchy).toBe(false);
  });

  it("routes screenshots through our beforeScreenshot", () => {
    expect(sentryPrivacyOptions.beforeScreenshot).toBe(beforeScreenshot);
  });
});

describe("sentryIntegrations", () => {
  it("adds the JS screenshot integration and drops the replay ones", () => {
    const names = sentryIntegrations([
      integration("InboundFilters"),
      integration("MobileReplay"),
      integration("Replay"),
      integration("ReactNativeReplay"),
    ]).map((i) => i.name);

    expect(names).toEqual(["InboundFilters", "Screenshot"]);
  });

  it("does not add a second screenshot integration", () => {
    const names = sentryIntegrations([integration("Screenshot")]).map(
      (i) => i.name,
    );

    expect(names).toEqual(["Screenshot"]);
  });
});

describe("sentryBeforeSend (#585)", () => {
  const axiosError = (status: number | undefined, url = "/tracks/42"): Error =>
    Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: status === undefined ? undefined : { status },
      config: { url, method: "get" },
    });

  it("fingerprints HTTP errors by status + route and tags them", () => {
    const event = sentryBeforeSend(
      { type: undefined, tags: { git_sha: "abc" } },
      { originalException: axiosError(500) },
    );
    expect(event.fingerprint).toEqual([
      "http-error",
      "500",
      "GET",
      "/tracks/:id",
    ]);
    expect(event.tags).toEqual({
      git_sha: "abc",
      http_status: "500",
      http_route: "/tracks/:id",
    });
    expect(event.level).toBeUndefined();
  });

  it("gives a 401 and a 429 on the same route different fingerprints", () => {
    const a = sentryBeforeSend(
      { type: undefined },
      { originalException: axiosError(401) },
    );
    const b = sentryBeforeSend(
      { type: undefined },
      { originalException: axiosError(429) },
    );
    expect(a.fingerprint).not.toEqual(b.fingerprint);
  });

  it("downgrades expected 4xx to warning", () => {
    const event = sentryBeforeSend(
      { type: undefined, level: "error" },
      { originalException: axiosError(429) },
    );
    expect(event.level).toBe("warning");
  });

  it("keeps network errors as errors, tagged 'network'", () => {
    const event = sentryBeforeSend(
      { type: undefined, level: "error" },
      { originalException: axiosError(undefined) },
    );
    expect(event.level).toBe("error");
    expect(event.tags?.http_status).toBe("network");
  });

  it("keeps a fingerprint set by the caller", () => {
    const event = sentryBeforeSend(
      { type: undefined, fingerprint: ["custom"] },
      { originalException: axiosError(500) },
    );
    expect(event.fingerprint).toEqual(["custom"]);
  });

  it("leaves non-HTTP events untouched", () => {
    const event = sentryBeforeSend(
      { type: undefined, level: "error" },
      { originalException: new Error("boom") },
    );
    expect(event).toEqual({ type: undefined, level: "error" });
  });
});
