import { fireEvent, render } from "@testing-library/react-native";
import React from "react";

import { ThemeContext } from "../../../../context/ThemeContext";
import { LicenseExpiryBanner } from "../LicenseExpiryBanner";

const themeMock = {
  theme: {
    surface: "#ffffff",
    text: "#000000",
    textSecondary: "#666666",
    border: "#eeeeee",
    warning: "#F59E0B",
    danger: "#EF4444",
    colors: { ffdBlue: "#004fe3" },
    typography: {
      fontFamily: "System",
      body: { fontSize: 14, fontFamily: "System" },
      caption: { fontSize: 12, fontFamily: "System" },
    },
  },
  dark: false,
  toggleTheme: jest.fn(),
  isDark: false,
};

const renderBanner = async (
  props: React.ComponentProps<typeof LicenseExpiryBanner>,
) =>
  await render(
    <ThemeContext.Provider value={themeMock as never}>
      <LicenseExpiryBanner {...props} />
    </ThemeContext.Provider>,
  );

describe("LicenseExpiryBanner", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("renders nothing when the license is still valid (> 30 days)", async () => {
    const { queryByTestId } = await renderBanner({
      validUntil: "2026-06-01T00:00:00Z",
      now,
    });
    expect(queryByTestId("license-expiry-banner")).toBeNull();
  });

  it("renders nothing when there is no expiry date", async () => {
    const { queryByTestId } = await renderBanner({ validUntil: null, now });
    expect(queryByTestId("license-expiry-banner")).toBeNull();
  });

  it("shows a warning with days remaining when within 30 days", async () => {
    const { getByText } = await renderBanner({
      validUntil: "2026-01-21T00:00:00Z",
      now,
    });
    expect(getByText("Votre licence expire dans 20 jours")).toBeTruthy();
  });

  it("shows the urgent message when within 7 days", async () => {
    const { getByText } = await renderBanner({
      validUntil: "2026-01-04T00:00:00Z",
      now,
    });
    expect(getByText("Votre licence expire dans 3 jours")).toBeTruthy();
  });

  it("shows the expired message when past", async () => {
    const { getByText } = await renderBanner({
      validUntil: "2025-12-01T00:00:00Z",
      now,
    });
    expect(getByText("Votre licence a expiré")).toBeTruthy();
  });

  it("calls onPress when tapped", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await renderBanner({
      validUntil: "2026-01-04T00:00:00Z",
      now,
      onPress,
    });
    await fireEvent.press(getByTestId("license-expiry-banner"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
