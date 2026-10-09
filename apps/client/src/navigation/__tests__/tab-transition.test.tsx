import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { render } from "@testing-library/react-native";
import React from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabBarWithTransition } from "../tab-transition";

jest.mock("expo-glass-effect", () => ({
  GlassView: "GlassView",
  isLiquidGlassAvailable: () => false,
}));

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { primary: "#0077cc", textSecondary: "#999999", surface: "#0f172a" },
    isDark: true,
  }),
}));

const buildProps = (): BottomTabBarProps =>
  ({
    state: {
      index: 0,
      routes: [
        { key: "a", name: "Competitions" },
        { key: "b", name: "Settings" },
      ],
    },
    descriptors: {
      a: { options: { tabBarLabel: "Compétitions" } },
      b: { options: { tabBarLabel: "Réglages" } },
    },
    navigation: { emit: jest.fn(() => ({})), navigate: jest.fn() },
  }) as unknown as BottomTabBarProps;

const renderBar = () =>
  render(<TabBarWithTransition {...buildProps()} onIndexChange={jest.fn()} />);

describe("FloatingGlassTabBar", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("sits above the Android navigation bar with an opaque themed surface", async () => {
    Platform.OS = "android";
    (useSafeAreaInsets as jest.Mock).mockReturnValue({
      top: 0,
      right: 0,
      bottom: 48,
      left: 0,
    });
    const { getByTestId, queryByTestId } = await renderBar();

    expect(getByTestId("floating-tab-bar")).toHaveStyle({ bottom: 60 });
    expect(getByTestId("tab-bar-surface")).toHaveStyle({
      backgroundColor: "#0f172a",
    });
    expect(queryByTestId("tab-bar-blur")).toBeNull();
  });

  it("keeps the fixed offset and blur on iOS", async () => {
    Platform.OS = "ios";
    const { getByTestId, queryByTestId } = await renderBar();

    expect(getByTestId("floating-tab-bar")).toHaveStyle({ bottom: 24 });
    expect(getByTestId("tab-bar-blur")).toBeTruthy();
    expect(queryByTestId("tab-bar-surface")).toBeNull();
  });
});
