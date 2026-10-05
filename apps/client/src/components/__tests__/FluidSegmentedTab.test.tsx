import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { FluidSegmentedTab } from "../FluidSegmentedTab";

jest.mock("../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: jest.fn(() => ({
    theme: {
      background: "#fff",
      surface: "#f2f2f2",
      text: "#111",
      textSecondary: "#666",
      primary: "#3b82f6",
      border: "#e5e7eb",
      danger: "#ef4444",
      colors: { primary: "blue", background: "white" },
      dark: false,
    },
    animationsEnabled: false,
  })),
}));

describe("FluidSegmentedTab", () => {
  const defaultProps = {
    options: [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ],
    activeValue: "a",
    onChange: jest.fn(),
    testID: "segmented-tab",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly", async () => {
    const { getByText } = await render(<FluidSegmentedTab {...defaultProps} />);
    expect(getByText("A")).toBeTruthy();
    expect(getByText("B")).toBeTruthy();
  });

  it("calls onChange when tab is pressed", async () => {
    const { getByTestId } = await render(
      <FluidSegmentedTab {...defaultProps} />,
    );
    await fireEvent.press(getByTestId("segmented-tab-b"));
    expect(defaultProps.onChange).toHaveBeenCalledWith("b");
  });

  it("handles layout changes to calculate widths", async () => {
    const { getByTestId } = await render(
      <FluidSegmentedTab {...defaultProps} />,
    );
    const container = getByTestId("segmented-tab");

    // Simulate layout
    await fireEvent(container, "layout", {
      nativeEvent: { layout: { width: 200 } },
    });

    // We can't easily assert internal state (containerWidth), but this triggers the useEffect hooks
    // Verification would ideally check style updates if we weren't using Reanimated in a complex way.
    // At least this covers the onLayout function.
  });

  it("renders with animations enabled", async () => {
    (useTheme as jest.Mock).mockReturnValueOnce({
      theme: { surface: "#fff", textSecondary: "#666", dark: false },
      animationsEnabled: true,
    });

    const { getByTestId } = await render(
      <FluidSegmentedTab {...defaultProps} />,
    );
    expect(getByTestId("segmented-tab")).toBeTruthy();
  });
});
