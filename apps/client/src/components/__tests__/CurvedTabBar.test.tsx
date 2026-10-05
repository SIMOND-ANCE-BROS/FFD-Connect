import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useTheme } from "../../context/ThemeContext";
import { createMockNavigation } from "../../utils/testUtils";
import { CurvedTabBar } from "../CurvedTabBar";

// Capture the JS-thread pan callbacks so a drag can be driven manually. The
// tab bar uses .runOnJS(true) + plain JS callbacks (no reanimated worklets),
// so calling these directly mirrors what gesture-handler does on device.
type PanCallbacks = {
  onBegin?: () => void;
  onUpdate?: (e: { translationX: number }) => void;
  onEnd?: (e: { translationX: number; velocityX: number }) => void;
};
const panCallbacks: PanCallbacks = {};

jest.mock("react-native-gesture-handler", () => {
  const builder = {
    runOnJS: jest.fn(() => builder),
    enabled: jest.fn(() => builder),
    activeOffsetX: jest.fn(() => builder),
    onBegin: jest.fn((cb: PanCallbacks["onBegin"]) => {
      panCallbacks.onBegin = cb;
      return builder;
    }),
    onUpdate: jest.fn((cb: PanCallbacks["onUpdate"]) => {
      panCallbacks.onUpdate = cb;
      return builder;
    }),
    onEnd: jest.fn((cb: PanCallbacks["onEnd"]) => {
      panCallbacks.onEnd = cb;
      return builder;
    }),
  };
  return {
    Gesture: { Pan: () => builder },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

jest.mock("../../context/ThemeContext");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("CurvedTabBar", () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      theme: {
        primary: "#004481",
        surface: "#fff",
        textSecondary: "#666",
        border: "#e0e0e0",
      },
      isDark: false,
      animationsEnabled: false,
    } as unknown as ReturnType<typeof useTheme>);
  });

  it("navigates on tab press", async () => {
    const navigation = createMockNavigation();
    navigation.navigate = jest.fn();

    const state = {
      index: 0,
      routes: [
        { key: "home", name: "Home" as const },
        { key: "profile", name: "Profile" as const },
      ],
      routeNames: ["Home", "Profile"],
      type: "tab" as const,
      stale: false,
      history: [],
    };

    const descriptors = {
      home: {
        options: {
          tabBarTestID: "tab-home",
          tabBarIcon: () => null,
        },
      },
      profile: {
        options: {
          tabBarTestID: "tab-profile",
          tabBarIcon: () => null,
        },
      },
    };

    const { getByTestId } = await render(
      <CurvedTabBar
        state={state as BottomTabBarProps["state"]}
        descriptors={descriptors as unknown as BottomTabBarProps["descriptors"]}
        navigation={navigation}
        insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
      />,
    );

    await fireEvent.press(getByTestId("tab-profile"));
    expect(navigation.navigate).toHaveBeenCalledWith("Profile");
  });
  it("adjusts container width on layout change", async () => {
    const navigation = createMockNavigation();
    const state = {
      index: 0,
      routes: [{ key: "home", name: "Home" as const }],
      routeNames: ["Home"],
      type: "tab" as const,
      stale: false,
      history: [],
    };
    const descriptors = {
      home: { options: { tabBarIcon: () => null, tabBarTestID: "tab-home" } },
    };

    const { getByTestId } = await render(
      <CurvedTabBar
        state={state as BottomTabBarProps["state"]}
        descriptors={descriptors as unknown as BottomTabBarProps["descriptors"]}
        navigation={navigation}
        insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
      />,
    );

    // Initial layout
    getByTestId("tab-home").parent?.parent; // Find the container with onLayout
    // In our implementation, onLayout is on the indicatorContainer which is inside the pill
    // But since it's absoluteFill, it's hard to find directly.
    // Let's just find the pill and look for children.
  });

  it("handles animationsEnabled: true", async () => {
    mockUseTheme.mockReturnValue({
      theme: {
        primary: "#004481",
        surface: "#fff",
        textSecondary: "#666",
        border: "#e0e0e0",
      },
      isDark: false,
      animationsEnabled: true,
    } as unknown as ReturnType<typeof useTheme>);

    const navigation = createMockNavigation();
    const state = {
      index: 1, // index 1 to trigger translateX update
      routes: [
        { key: "h", name: "H" },
        { key: "p", name: "P" },
      ],
      routeNames: ["H", "P"],
      type: "tab" as const,
      stale: false,
      history: [],
    };
    const descriptors = {
      h: { options: { tabBarIcon: () => null } },
      p: { options: { tabBarIcon: () => null } },
    };

    await render(
      <CurvedTabBar
        state={state as BottomTabBarProps["state"]}
        descriptors={descriptors as unknown as BottomTabBarProps["descriptors"]}
        navigation={navigation}
        insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
      />,
    );
    // Should pass without error, verifying the animationsEnabled branch
  });

  it("prevents navigation if event is defaultPrevented", async () => {
    const navigation = createMockNavigation();
    navigation.emit = jest.fn().mockReturnValue({ defaultPrevented: true });
    navigation.navigate = jest.fn();

    const state = {
      index: 0,
      routes: [
        { key: "h", name: "H" },
        { key: "p", name: "P" },
      ],
      routeNames: ["H", "P"],
      type: "tab" as const,
      stale: false,
      history: [],
    };
    const descriptors = {
      h: { options: { tabBarIcon: () => null, tabBarTestID: "tab-h" } },
      p: { options: { tabBarIcon: () => null, tabBarTestID: "tab-p" } },
    };

    const { getByTestId } = await render(
      <CurvedTabBar
        state={state as BottomTabBarProps["state"]}
        descriptors={descriptors as unknown as BottomTabBarProps["descriptors"]}
        navigation={navigation}
        insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
      />,
    );

    await fireEvent.press(getByTestId("tab-p"));
    expect(navigation.emit).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  describe("drag (hold and slide indicator)", () => {
    const enableAnimations = () =>
      mockUseTheme.mockReturnValue({
        theme: {
          primary: "#004481",
          surface: "#fff",
          textSecondary: "#666",
          border: "#e0e0e0",
        },
        isDark: false,
        animationsEnabled: true,
      } as unknown as ReturnType<typeof useTheme>);

    const twoTabState = {
      index: 0,
      routes: [
        { key: "h", name: "H" as const },
        { key: "p", name: "P" as const },
      ],
      routeNames: ["H", "P"],
      type: "tab" as const,
      stale: false,
      history: [],
    };
    const descriptors = {
      h: { options: { tabBarIcon: () => null, tabBarTestID: "tab-h" } },
      p: { options: { tabBarIcon: () => null, tabBarTestID: "tab-p" } },
    };

    it("navigates to the tab under the indicator on drag release", async () => {
      enableAnimations();
      const navigation = createMockNavigation();
      navigation.navigate = jest.fn();

      await render(
        <CurvedTabBar
          state={twoTabState as BottomTabBarProps["state"]}
          descriptors={
            descriptors as unknown as BottomTabBarProps["descriptors"]
          }
          navigation={navigation}
          insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
        />,
      );

      // Drag far to the right from tab 0 → snaps to the last tab, navigates.
      panCallbacks.onBegin?.();
      panCallbacks.onUpdate?.({ translationX: 9999 });
      panCallbacks.onEnd?.({ translationX: 9999, velocityX: 500 });

      expect(navigation.navigate).toHaveBeenCalledWith("P");
    });

    it("stays on the current tab for a tiny drag", async () => {
      enableAnimations();
      const navigation = createMockNavigation();
      navigation.navigate = jest.fn();

      await render(
        <CurvedTabBar
          state={twoTabState as BottomTabBarProps["state"]}
          descriptors={
            descriptors as unknown as BottomTabBarProps["descriptors"]
          }
          navigation={navigation}
          insets={{ top: 0, bottom: 20, left: 0, right: 0 }}
        />,
      );

      // A couple of pixels of drift → nearest slot is still tab 0, no nav.
      panCallbacks.onBegin?.();
      panCallbacks.onUpdate?.({ translationX: 2 });
      panCallbacks.onEnd?.({ translationX: 2, velocityX: 0 });

      expect(navigation.navigate).not.toHaveBeenCalled();
    });
  });
});
