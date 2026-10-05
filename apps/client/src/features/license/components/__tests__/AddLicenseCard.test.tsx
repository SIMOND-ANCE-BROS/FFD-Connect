import { render } from "@testing-library/react-native";
import React from "react";
import { ThemeContext } from "../../../../context/ThemeContext";
import { AddLicenseCard } from "../AddLicenseCard";

const themeMock = {
  theme: {
    surface: "#ffffff",
    text: "#000000",
    textSecondary: "#666666",
    border: "#eeeeee",
    colors: { ffdBlue: "#004fe3" },
  },
  dark: false,
  toggleTheme: jest.fn(),
  isDark: false,
};

describe("AddLicenseCard", () => {
  const pullYMock = {
    value: 0,
  };

  it("renders correctly", async () => {
    const { getByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <AddLicenseCard
          theme={themeMock.theme as never}
          pullY={pullYMock as never}
        />
      </ThemeContext.Provider>,
    );
    expect(getByText("Ajouter la licence WDSF")).toBeTruthy();
  });
});
