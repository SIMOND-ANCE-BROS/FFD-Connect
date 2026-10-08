import { fireEvent, render, screen } from "@testing-library/react-native";
import React from "react";
import { SpaceSelector } from "../SpaceSelector";

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      border: "#eee",
      primary: "#3b82f6",
    },
    isDark: false,
  }),
}));

const SHEET_TITLE = "Changer d'espace";

describe("SpaceSelector pill", () => {
  it("renders nothing for a single-role account", async () => {
    await render(
      <SpaceSelector
        roles={["LICENSEE"]}
        space="LICENSEE"
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("settings-space-pill")).toBeNull();
  });

  it("ignores the guest role when counting spaces", async () => {
    await render(
      <SpaceSelector
        roles={["LICENSEE", "GUEST"]}
        space="LICENSEE"
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("settings-space-pill")).toBeNull();
  });

  it("shows the current space on the pill with 2 roles", async () => {
    await render(
      <SpaceSelector
        roles={["LICENSEE", "CLUB"]}
        space="LICENSEE"
        onChange={jest.fn()}
      />,
    );
    const pill = screen.getByTestId("settings-space-pill");
    expect(pill.props.accessibilityRole).toBe("button");
    expect(pill.props.accessibilityLabel).toBe("Espace : Danseur");
    expect(pill.props.accessibilityHint).toBeTruthy();
    expect(screen.getByText("Danseur")).toBeTruthy();
    expect(screen.queryByText(SHEET_TITLE)).toBeNull();
  });
});

describe("SpaceSelector sheet", () => {
  const open = async (onChange = jest.fn()) => {
    await render(
      <SpaceSelector
        roles={["ADMIN", "LICENSEE"]}
        space="ADMIN"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByTestId("settings-space-pill"));
    return onChange;
  };

  it("opens when the pill is tapped, with one row per space", async () => {
    await open();
    expect(screen.getByText(SHEET_TITLE)).toBeTruthy();
    expect(screen.getByTestId("settings-space-ADMIN")).toBeTruthy();
    expect(screen.getByTestId("settings-space-LICENSEE")).toBeTruthy();
  });

  it("marks the current space as selected", async () => {
    await open();
    expect(
      screen.getByTestId("settings-space-ADMIN").props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      screen.getByTestId("settings-space-LICENSEE").props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it("closes and reports the choice when another space is picked", async () => {
    const onChange = await open();
    await fireEvent.press(screen.getByTestId("settings-space-LICENSEE"));
    expect(onChange).toHaveBeenCalledWith("LICENSEE");
    expect(screen.queryByText(SHEET_TITLE)).toBeNull();
  });

  it("only closes when the current space is picked", async () => {
    const onChange = await open();
    await fireEvent.press(screen.getByTestId("settings-space-ADMIN"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(SHEET_TITLE)).toBeNull();
  });

  it("closes when the backdrop is tapped", async () => {
    const onChange = await open();
    await fireEvent.press(screen.getByTestId("settings-space-backdrop"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(SHEET_TITLE)).toBeNull();
  });
});
