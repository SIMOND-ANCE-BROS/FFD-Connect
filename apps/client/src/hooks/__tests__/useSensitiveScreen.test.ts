import { renderHook } from "@testing-library/react-native";
import {
  beforeScreenshot,
  isSensitiveScreenShown,
} from "../../utils/sentryPrivacy";
import { useSensitiveScreen } from "../useSensitiveScreen";

describe("useSensitiveScreen (#242)", () => {
  it("blocks Sentry screenshots while mounted and releases on unmount", async () => {
    expect(isSensitiveScreenShown()).toBe(false);

    const { unmount } = await renderHook(() => useSensitiveScreen());
    expect(isSensitiveScreenShown()).toBe(true);
    expect(beforeScreenshot({}, {})).toBe(false);

    await unmount();
    expect(isSensitiveScreenShown()).toBe(false);
    expect(beforeScreenshot({}, {})).toBe(true);
  });

  it("keeps blocking while another sensitive screen is still mounted", async () => {
    const first = await renderHook(() => useSensitiveScreen());
    const second = await renderHook(() => useSensitiveScreen());

    await first.unmount();
    expect(isSensitiveScreenShown()).toBe(true);

    await second.unmount();
    expect(isSensitiveScreenShown()).toBe(false);
  });
});
