import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { AppTheme } from "../../../../context/ThemeContext";
import { SettingsNotificationsSection } from "../SettingsNotificationsSection";

jest.mock("lucide-react-native", () => ({ BellRing: () => null }));

const theme = {
  background: "#fff",
  surface: "#f7f7f7",
  text: "#111",
  textSecondary: "#666",
  border: "#e0e0e0",
  primary: "#e30613",
  danger: "#e74c3c",
} as unknown as AppTheme;

const preferences = [
  {
    type: "registration_validated",
    label: "Inscription validée",
    description: "Quand votre club valide une inscription.",
    enabled: true,
  },
  {
    type: "results_published",
    label: "Résultats publiés",
    description: "Quand les résultats sortent.",
    enabled: false,
  },
];

const renderSection = async (overrides = {}) =>
  await render(
    <SettingsNotificationsSection
      theme={theme}
      preferences={preferences}
      loading={false}
      pending={[]}
      error={null}
      onToggle={jest.fn()}
      {...overrides}
    />,
  );

describe("SettingsNotificationsSection", () => {
  it("renders one switch per preference served by the backend", async () => {
    const { getByTestId } = await renderSection();

    expect(
      getByTestId("notification-preference-registration_validated").props.value,
    ).toBe(true);
    expect(
      getByTestId("notification-preference-results_published").props.value,
    ).toBe(false);
  });

  it("reports the type and the new value when toggled", async () => {
    const onToggle = jest.fn();
    const { getByTestId } = await renderSection({ onToggle });

    await fireEvent(
      getByTestId("notification-preference-registration_validated"),
      "valueChange",
      false,
    );

    expect(onToggle).toHaveBeenCalledWith("registration_validated", false);
  });

  it("freezes only the switch whose request is in flight", async () => {
    const { getByTestId } = await renderSection({
      pending: ["registration_validated"],
    });

    expect(
      getByTestId("notification-preference-registration_validated").props
        .disabled,
    ).toBe(true);
    expect(
      getByTestId("notification-preference-results_published").props.disabled,
    ).toBe(false);
  });

  it("falls back to the raw type so a missing label never yields a blank row", async () => {
    const { getByText } = await renderSection({
      preferences: [
        { type: "some_new_type", label: "", description: "", enabled: true },
      ],
    });

    expect(getByText("some_new_type")).toBeTruthy();
  });

  it("tells the user that muting a type keeps the in-app feed", async () => {
    const { getByText } = await renderSection();

    expect(getByText(/reste consultable dans la cloche/i)).toBeTruthy();
  });

  it("shows the error returned by the store", async () => {
    const { getByText } = await renderSection({
      error: "Échec de l'enregistrement.",
    });

    expect(getByText("Échec de l'enregistrement.")).toBeTruthy();
  });
});
