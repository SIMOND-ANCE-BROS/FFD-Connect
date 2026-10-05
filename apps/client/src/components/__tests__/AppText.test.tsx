import React from "react";
import { render } from "@testing-library/react-native";
import { AppText } from "../AppText";
import { useTheme } from "../../context/ThemeContext";

jest.mock("../../context/ThemeContext");

const mockUseTheme = useTheme as jest.MockedFunction<typeof useTheme>;

describe("AppText", () => {
  beforeEach(() => {
    mockUseTheme.mockReturnValue({
      theme: { text: "#111111", textSecondary: "#666666" },
    } as unknown as ReturnType<typeof useTheme>);
  });

  it("renders text with custom color and alignment", async () => {
    const { getByText } = await render(
      <AppText color="#ff0000" align="center">
        Bonjour
      </AppText>,
    );

    expect(getByText("Bonjour")).toHaveStyle({
      color: "#ff0000",
      textAlign: "center",
    });
  });
});
