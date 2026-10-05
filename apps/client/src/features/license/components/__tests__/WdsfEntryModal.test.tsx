import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ThemeContext } from "../../../../context/ThemeContext";
import { WdsfEntryModal } from "../WdsfEntryModal";

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

describe("WdsfEntryModal", () => {
  const mockOnClose = jest.fn();
  const mockOnVerify = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders correctly when visible", async () => {
    const { getByText, getByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <WdsfEntryModal
          visible={true}
          onClose={mockOnClose}
          onVerify={mockOnVerify}
          loading={false}
          error={null}
          theme={themeMock.theme as never}
          testID="wdsf-modal"
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("Ajouter une licence WDSF")).toBeTruthy();
    expect(getByTestId("wdsf-modal-input")).toBeTruthy();
  });

  it("calls onVerify with MIN value when verify button is pressed", async () => {
    const { getByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <WdsfEntryModal
          visible={true}
          onClose={mockOnClose}
          onVerify={mockOnVerify}
          loading={false}
          error={null}
          theme={themeMock.theme as never}
        />
      </ThemeContext.Provider>,
    );

    const input = getByTestId("wdsf-modal-input");
    await fireEvent.changeText(input, "12345678");
    await fireEvent.press(getByTestId("wdsf-modal-verify-button"));

    expect(mockOnVerify).toHaveBeenCalledWith("12345678");
  });

  it("calls onClose when cancel button is pressed", async () => {
    const { getByTestId } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <WdsfEntryModal
          visible={true}
          onClose={mockOnClose}
          onVerify={mockOnVerify}
          loading={false}
          error={null}
          theme={themeMock.theme as never}
        />
      </ThemeContext.Provider>,
    );

    await fireEvent.press(getByTestId("wdsf-modal-cancel-button"));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("displays error message when error prop is provided", async () => {
    const { getByText } = await render(
      <ThemeContext.Provider value={themeMock as never}>
        <WdsfEntryModal
          visible={true}
          onClose={mockOnClose}
          onVerify={mockOnVerify}
          loading={false}
          error="Invalid MIN number"
          theme={themeMock.theme as never}
        />
      </ThemeContext.Provider>,
    );

    expect(getByText("Invalid MIN number")).toBeTruthy();
  });
});
