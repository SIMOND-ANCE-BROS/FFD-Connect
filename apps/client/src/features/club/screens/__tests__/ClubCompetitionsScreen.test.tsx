import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import type { MockFluidSegmentedTabProps } from "../../../../__tests__/mocks/types";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { ClubCompetitionsScreen } from "../ClubCompetitionsScreen";

jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

jest.mock("../../../../components/FluidSegmentedTab", () => {
  const { TouchableOpacity, Text } = require("react-native");
  return {
    FluidSegmentedTab: ({ options, onChange }: MockFluidSegmentedTabProps) => (
      <>
        {options.map((opt) => (
          <TouchableOpacity
            accessibilityRole="button"
            key={opt.value}
            onPress={() => onChange(opt.value)}
          >
            <Text>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </>
    ),
  };
});

describe("ClubCompetitionsScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
  });

  const createTestProps = () =>
    createMockScreenProps("ClubCompetitions", undefined);

  it("renders competitions and navigates to editor", async () => {
    const props = createTestProps();
    const { getByText } = await render(<ClubCompetitionsScreen {...props} />);

    expect(getByText("Grand Prix de Paris")).toBeTruthy();

    await fireEvent.press(getByText("Grand Prix de Paris"));
    expect(props.navigation.navigate).toHaveBeenCalledWith(
      "ClubCompetitionEditor",
      {
        competition: expect.objectContaining({ id: "1" }),
      },
    );
  });
});
