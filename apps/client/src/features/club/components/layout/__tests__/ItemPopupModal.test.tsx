import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { expectSiblingBackdrop } from "../../../../../__tests__/mocks/modalA11y";
import type { AppTheme } from "../../../../../context/ThemeContext";
import type { LayoutItem } from "../../../hooks/useClubCompetitionEditorLogic";
import { ItemPopupModal } from "../ItemPopupModal";

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
  primary: "#004481",
  border: "#ddd",
} as unknown as AppTheme;

const item: LayoutItem = {
  id: "t1",
  type: "TABLE",
  label: "Table 1",
  capacity: 2,
  x: 10,
  y: 10,
  width: 10,
  height: 10,
};

describe("ItemPopupModal", () => {
  const onClose = jest.fn();
  const onToggleSeatLock = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it("a11y (#356): backdrop is a sibling of the card and closes the popup", async () => {
    const { getByTestId, getByLabelText } = await render(
      <ItemPopupModal
        item={item}
        theme={theme}
        onClose={onClose}
        onEditElement={jest.fn()}
        onToggleSeatLock={onToggleSeatLock}
        onCycleOrientation={jest.fn()}
      />,
    );

    expectSiblingBackdrop(
      getByTestId("item-popup-backdrop"),
      getByTestId("item-popup-card"),
    );

    // Seats inside the card are reachable and do not close the popup.
    await fireEvent.press(getByLabelText("Place 1"));
    expect(onToggleSeatLock).toHaveBeenCalledWith("t1", 0);
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("item-popup-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
