import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { SettingsClubSection } from "../SettingsClubSection";

const theme = {
  textSecondary: "#666",
  surface: "#fff",
  text: "#000",
  border: "#ddd",
  primary: "#00f",
} as never;

const status = {
  clubName: "Club Test",
  paymentProvider: "HELLOASSO" as const,
  configured: true,
  selectableProviders: ["HELLOASSO" as const],
};

type Props = React.ComponentProps<typeof SettingsClubSection>;
const renderSection = async (o: Partial<Props> = {}) =>
  render(
    <SettingsClubSection
      theme={theme}
      registrationPolicy="MEMBER_VALIDATION"
      handleSetRegistrationPolicy={jest.fn().mockResolvedValue(undefined)}
      helloAssoStatus={null}
      paymentProviderStatus={status}
      onSelectPaymentProvider={jest.fn().mockResolvedValue(undefined)}
      onOpenHelloAsso={jest.fn()}
      {...o}
    />,
  );

describe("SettingsClubSection — online payment (#665)", () => {
  it("shows a neutral section with the current connector, configured", async () => {
    const screen = await renderSection();
    expect(screen.getByText("Paiement en ligne")).toBeTruthy();
    expect(screen.getByText("HelloAsso")).toBeTruthy();
    expect(
      screen.getByTestId("settings-payment-provider-state").props.children,
    ).toBe("Configuré");
  });

  it("names the HelloAsso organisation when it is known", async () => {
    const screen = await renderSection({
      helloAssoStatus: {
        clubName: "Club Test",
        helloAssoConnected: true,
        organizationSlug: "mon-club",
      },
    });
    expect(
      screen.getByTestId("settings-payment-provider-state").props.children,
    ).toBe("Configuré (mon-club)");
  });

  it("says when the connector is not configured", async () => {
    const screen = await renderSection({
      paymentProviderStatus: { ...status, configured: false },
    });
    expect(
      screen.getByTestId("settings-payment-provider-state").props.children,
    ).toMatch(/^Non configuré/);
  });

  it("falls back to the HelloAsso status on a backend without connectors", async () => {
    const screen = await renderSection({
      paymentProviderStatus: null,
      helloAssoStatus: {
        clubName: "Club Test",
        helloAssoConnected: false,
        organizationSlug: null,
      },
    });
    expect(screen.getByText("HelloAsso")).toBeTruthy();
    expect(
      screen.getByTestId("settings-payment-provider-state").props.children,
    ).toMatch(/^Non configuré/);
  });

  it("opens the HelloAsso credentials form", async () => {
    const onOpenHelloAsso = jest.fn();
    const screen = await renderSection({ onOpenHelloAsso });
    await fireEvent.press(screen.getByTestId("settings-helloasso-button"));
    expect(onOpenHelloAsso).toHaveBeenCalled();
  });

  it("offers no choice while HelloAsso is the only connector", async () => {
    const screen = await renderSection();
    expect(
      screen.queryByTestId("settings-payment-provider-HELLOASSO"),
    ).toBeNull();
  });

  it("offers a choice once a second connector exists", async () => {
    const onSelectPaymentProvider = jest.fn().mockResolvedValue(undefined);
    const screen = await renderSection({
      onSelectPaymentProvider,
      paymentProviderStatus: {
        ...status,
        selectableProviders: ["HELLOASSO", "OTHER" as never],
      },
    });
    expect(
      screen.getByTestId("settings-payment-provider-HELLOASSO").props
        .accessibilityState,
    ).toMatchObject({ selected: true, checked: true });
    await fireEvent.press(
      screen.getByTestId("settings-payment-provider-OTHER"),
    );
    expect(onSelectPaymentProvider).toHaveBeenCalledWith("OTHER");
  });
});
