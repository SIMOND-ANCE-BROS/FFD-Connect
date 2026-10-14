import { screenshotIntegration } from "@sentry/react-native";
import { sentryIntegrations, sentryPrivacyOptions } from "../sentryOptions";
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
