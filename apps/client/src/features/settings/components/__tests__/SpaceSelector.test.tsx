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

describe("SpaceSelector", () => {
  it("renders nothing for a single-role account", async () => {
    await render(
      <SpaceSelector
        roles={["LICENSEE"]}
        space="LICENSEE"
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByText("Espace")).toBeNull();
  });

  it("lists one option per role and reports the choice", async () => {
    const onChange = jest.fn();
    await render(
      <SpaceSelector
        roles={["ADMIN", "LICENSEE"]}
        space="ADMIN"
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Espace")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Danseur" }));
    expect(onChange).toHaveBeenCalledWith("LICENSEE");
  });

  it("marks the active space as selected", async () => {
    await render(
      <SpaceSelector
        roles={["ADMIN", "LICENSEE"]}
        space="ADMIN"
        onChange={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Admin" }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      screen.getByRole("button", { name: "Danseur" }).props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it("exposes a testID per space", async () => {
    await render(
      <SpaceSelector
        roles={["ADMIN", "STAFF"]}
        space="STAFF"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("settings-space-STAFF")).toBeTruthy();
  });
});
