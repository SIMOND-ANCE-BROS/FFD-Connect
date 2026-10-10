import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { SettingsPrivacySection } from "../SettingsPrivacySection";

const theme = {
  textSecondary: "#666",
  surface: "#fff",
  text: "#000",
  border: "#ddd",
  primary: "#00f",
} as never;

type Props = React.ComponentProps<typeof SettingsPrivacySection>;
const renderSection = async (o: Partial<Props> = {}) =>
  render(
    <SettingsPrivacySection
      theme={theme}
      isGuest={false}
      exporting={false}
      onExportData={jest.fn()}
      onDeleteAccount={jest.fn()}
      onOpenLegal={jest.fn()}
      usageEnabled
      onToggleUsage={jest.fn()}
      {...o}
    />,
  );

describe("SettingsPrivacySection — usage measurement", () => {
  it("shows the switch with its explanation, also for guests", async () => {
    const screen = await renderSection({ isGuest: true });
    expect(screen.getByText("Mesure d'audience anonyme")).toBeTruthy();
    expect(
      screen.getByText(
        "Statistiques d'usage anonymes, sans lien avec votre compte.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("settings-usage-switch").props.value).toBe(true);
  });

  it("toggling calls the handler with the new value", async () => {
    const onToggleUsage = jest.fn();
    const screen = await renderSection({ onToggleUsage });
    await fireEvent(
      screen.getByTestId("settings-usage-switch"),
      "valueChange",
      false,
    );
    expect(onToggleUsage).toHaveBeenCalledWith(false);
  });

  it("hides the switch while the preference loads", async () => {
    const screen = await renderSection({ usageEnabled: null });
    expect(screen.queryByTestId("settings-usage-switch")).toBeNull();
  });
});
