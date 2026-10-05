import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { FilterChip, SegmentedTab } from "../FilterUI";

// Standardized Inline ThemeContext Mock
jest.mock("../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("FilterUI", () => {
  const mockTheme = {
    theme: {
      surface: "#ffffff",
      text: "#111111",
      textSecondary: "#666666",
    },
    isDark: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
  });

  it("renders FilterChip and handles press", async () => {
    const onPress = jest.fn();

    const { getByText } = await render(
      <FilterChip label="Tous" isActive={false} onPress={onPress} />,
    );

    await fireEvent.press(getByText("Tous"));
    expect(onPress).toHaveBeenCalled();
  });

  it("renders SegmentedTab and handles change", async () => {
    const onChange = jest.fn();

    const { getByText } = await render(
      <SegmentedTab
        options={[
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ]}
        activeValue="a"
        onChange={onChange}
      />,
    );

    await fireEvent.press(getByText("B"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
