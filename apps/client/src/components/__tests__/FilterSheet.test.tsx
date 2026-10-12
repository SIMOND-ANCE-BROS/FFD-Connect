import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { Text, TouchableOpacity } from "react-native";
import { expectSiblingBackdrop } from "../../__tests__/mocks/modalA11y";
import { useTheme } from "../../context/ThemeContext";
import { FilterSheet } from "../FilterSheet";

jest.mock("../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
}));

describe("FilterSheet", () => {
  const onClose = jest.fn();
  const onReset = jest.fn();
  const onFilter = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({
      theme: { surface: "#fff", text: "#111", border: "#ddd" },
      isDark: false,
    });
  });

  const renderSheet = (activeCount = 0) =>
    render(
      <FilterSheet
        visible
        onClose={onClose}
        onReset={onReset}
        activeCount={activeCount}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Filtre Latines"
          accessibilityHint="Active le filtre"
          onPress={onFilter}
        >
          <Text>Latines</Text>
        </TouchableOpacity>
      </FilterSheet>,
    );

  it("a11y (#356): backdrop is a sibling of the card, filters stay reachable", async () => {
    const { getByTestId, getByLabelText } = await renderSheet();

    expectSiblingBackdrop(
      getByTestId("filter-sheet-backdrop"),
      getByTestId("filter-sheet-card"),
    );

    await fireEvent.press(getByLabelText("Filtre Latines"));
    expect(onFilter).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the backdrop or the close button is tapped", async () => {
    const { getByTestId, getByLabelText } = await renderSheet();

    await fireEvent.press(getByTestId("filter-sheet-backdrop"));
    await fireEvent.press(getByLabelText("Fermer", { exact: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("resets the active filters", async () => {
    const { getByTestId, getByText } = await renderSheet(2);

    expect(getByText("Réinitialiser (2)")).toBeTruthy();
    await fireEvent.press(getByTestId("filter-reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
