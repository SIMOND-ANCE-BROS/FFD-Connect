import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { render } from "@testing-library/react-native";
import React from "react";
import * as ReactNative from "react-native";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getTabItemMetrics, TabBarWithTransition } from "../tab-transition";

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

  // Beta feedback: "Bibliothèque" spilled past the selection capsule with 5
  // tabs on a phone.
  describe("label vs selection capsule", () => {
    it("keeps the label box strictly inside the capsule", () => {
      for (const itemWidth of [57.6, 68.6, 72.2, 96]) {
        const { indicatorWidth, labelWidth } = getTabItemMetrics(itemWidth);
        expect(indicatorWidth).toBeLessThan(itemWidth);
        expect(labelWidth).toBeLessThan(indicatorWidth);
        expect(labelWidth).toBeGreaterThan(0);
      }
    });

    it("never returns negative widths", () => {
      expect(getTabItemMetrics(0)).toEqual({
        indicatorWidth: 0,
        labelWidth: 0,
      });
    });

    it("bounds each label in a fixed-width, clipping, non-scaling box (5 tabs on a 375pt phone)", async () => {
      Platform.OS = "ios";
      const dims = jest
        .spyOn(ReactNative, "useWindowDimensions")
        .mockReturnValue({ width: 375, height: 812, scale: 3, fontScale: 1 });
      const keys = ["a", "b", "c", "d", "e"];
      const props = {
        state: {
          index: 3,
          routes: keys.map((key) => ({ key, name: key })),
        },
        descriptors: Object.fromEntries(
          keys.map((key) => [
            key,
            { options: { tabBarLabel: "Bibliothèque" } },
          ]),
        ),
        navigation: { emit: jest.fn(() => ({})), navigate: jest.fn() },
      } as unknown as BottomTabBarProps;

      try {
        const { getByTestId, getAllByText } = await render(
          <TabBarWithTransition {...props} onIndexChange={jest.fn()} />,
        );
        // pill = min(5 * 96 + 16, 375 - 32) = 343 → slot 68.6
        const { labelWidth } = getTabItemMetrics(343 / 5);
        const box = getByTestId("tab-label-box-d");
        expect(box).toHaveStyle({ width: labelWidth, overflow: "hidden" });
        const label = getAllByText("Bibliothèque")[3];
        expect(label.props.numberOfLines).toBe(1);
        expect(label.props.allowFontScaling).toBe(false);
      } finally {
        dims.mockRestore();
      }
    });
  });
});
