import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { expectSiblingBackdrop } from "../../../../../__tests__/mocks/modalA11y";
import { PartnerInputModal } from "../PartnerInputModal";

// AppText / AppButton read the theme from the context.
jest.mock("../../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      background: "#fafafa",
      text: "#111",
      textSecondary: "#666",
      border: "#ddd",
      primary: "#004481",
    },
    isDark: false,
  }),
}));

const theme = {
  surface: "#fff",
  text: "#111",
  textSecondary: "#666",
  border: "#ddd",
  primary: "#004481",
};

describe("PartnerInputModal", () => {
  const onClose = jest.fn();
  const onConfirm = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it("a11y (#356): backdrop is a sibling of the card, the field stays reachable", async () => {
    const { getByTestId, getByLabelText, getByText } = await render(
      <PartnerInputModal
        visible
        eventLabel="Adultes C Latines"
        onConfirm={onConfirm}
        onClose={onClose}
        theme={theme}
      />,
    );

    expectSiblingBackdrop(
      getByTestId("partner-input-backdrop"),
      getByTestId("partner-input-card"),
    );

    await fireEvent.changeText(
      getByLabelText("Nom du partenaire"),
      "  Jeanne  ",
    );
    await fireEvent.press(getByText("Valider"));
    expect(onConfirm).toHaveBeenCalledWith("Jeanne");
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("partner-input-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
