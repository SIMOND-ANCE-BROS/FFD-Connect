import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { FluidSegmentedTab } from "../FluidSegmentedTab";

// Screen-reader contract of the segmented filter (RGAA, issue #22).

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { surface: "#fff", textSecondary: "#666", dark: false },
    animationsEnabled: true,
  }),
}));

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

describe("FluidSegmentedTab accessibility", () => {
  const options = [
    { label: "À venir", value: "UPCOMING" },
    { label: "Passées", value: "PAST" },
  ];

  it("renders a tab list with the active segment selected", async () => {
    const { getByRole, getAllByRole, toJSON } = await render(
      <FluidSegmentedTab
        options={options}
        activeValue="PAST"
        onChange={jest.fn()}
        testID="status"
      />,
    );
    // The container is not itself focusable (each tab stays reachable).
    expect(hasRole(toJSON(), "tablist")).toBe(true);
    expect(getAllByRole("tab")).toHaveLength(2);
    expect(getByRole("tab", { name: "Passées", selected: true })).toBeTruthy();
    expect(getByRole("tab", { name: "À venir", selected: false })).toBeTruthy();
  });

  it("keeps per-segment testIDs and a 44pt touch area", async () => {
    const onChange = jest.fn();
    const { getByRole } = await render(
      <FluidSegmentedTab
        options={options}
        activeValue="PAST"
        onChange={onChange}
        testID="status"
      />,
    );
    const upcoming = getByRole("tab", { name: "À venir" });
    expect(upcoming.props.testID).toBe("status-UPCOMING");
    expect(upcoming.props.hitSlop).toEqual({ top: 4, bottom: 4 });

    await fireEvent.press(upcoming);
    expect(onChange).toHaveBeenCalledWith("UPCOMING");
  });
});
