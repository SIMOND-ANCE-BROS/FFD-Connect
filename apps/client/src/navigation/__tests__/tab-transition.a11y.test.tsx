import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { TabBarWithTransition } from "../tab-transition";

// Screen-reader contract of the floating tab bar (RGAA, issue #22).

jest.mock("expo-glass-effect", () => ({
  GlassView: "GlassView",
  isLiquidGlassAvailable: () => false,
}));

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { primary: "#0077cc", textSecondary: "#999999", surface: "#0f172a" },
    isDark: true,
    animationsEnabled: false,
  }),
}));

const navigation = { emit: jest.fn(() => ({})), navigate: jest.fn() };

const buildProps = (index = 0): BottomTabBarProps =>
  ({
    state: {
      index,
      routes: [
        { key: "a", name: "Competitions" },
        { key: "b", name: "License" },
        { key: "c", name: "Settings" },
      ],
    },
    descriptors: {
      a: {
        options: { tabBarLabel: "Compétitions", tabBarTestID: "tab-comp" },
      },
      // Icon-only tab: no visible label, an explicit accessibility label.
      b: {
        options: {
          tabBarLabel: "",
          tabBarAccessibilityLabel: "Licence",
          tabBarTestID: "tab-license",
        },
      },
      c: { options: { tabBarLabel: "Réglages" } },
    },
    navigation,
  }) as unknown as BottomTabBarProps;

type JsonNode = {
  props?: Record<string, unknown>;
  children?: (JsonNode | string)[] | null;
};

/** True when a host view in the rendered tree carries the given role. */
const hasRole = (node: unknown, role: string): boolean => {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => hasRole(n, role));
  const { props, children } = node as JsonNode;
  if (props?.accessibilityRole === role) return true;
  return (children ?? []).some((child) => hasRole(child, role));
};

describe("FloatingGlassTabBar accessibility", () => {
  beforeEach(() => jest.clearAllMocks());

  it("exposes a tab list whose tabs are named and report selection", async () => {
    const { getByRole, getAllByRole, toJSON } = await render(
      <TabBarWithTransition {...buildProps(0)} onIndexChange={jest.fn()} />,
    );

    // The container is not itself focusable (each tab stays reachable).
    expect(hasRole(toJSON(), "tablist")).toBe(true);
    expect(getAllByRole("tab")).toHaveLength(3);
    expect(getByRole("tab", { name: "Compétitions", selected: true })).toBe(
      getByRole("tab", { name: "Compétitions" }),
    );
    expect(
      getByRole("tab", { name: "Réglages", selected: false }),
    ).toBeTruthy();
  });

  it("uses tabBarAccessibilityLabel for an icon-only tab, keeping its testID", async () => {
    const { getByRole } = await render(
      <TabBarWithTransition {...buildProps(0)} onIndexChange={jest.fn()} />,
    );
    const license = getByRole("tab", { name: "Licence" });
    expect(license.props.testID).toBe("tab-license");
    expect(license.props.accessibilityHint).toBe("Affiche l'onglet Licence");

    await fireEvent.press(license);
    expect(navigation.navigate).toHaveBeenCalledWith("License");
  });

  it("falls back to the route name when there is no label at all", async () => {
    const props = buildProps(2);
    (
      props.descriptors as unknown as Record<
        string,
        { options: Record<string, unknown> }
      >
    ).c.options = {};
    const { getByRole } = await render(
      <TabBarWithTransition {...props} onIndexChange={jest.fn()} />,
    );
    const settings = getByRole("tab", { name: "Settings", selected: true });
    expect(settings.props.accessibilityHint).toBe("Onglet affiché");
  });
});
