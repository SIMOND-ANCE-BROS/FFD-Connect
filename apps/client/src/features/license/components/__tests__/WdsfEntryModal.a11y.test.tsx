import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { announce } from "../../../../utils/announce";
import { WdsfEntryModal } from "../WdsfEntryModal";
import { preloadReactNative } from "../../../../__tests__/mocks/preloadReactNative";

// Screen-reader contract of the WDSF licence modal (RGAA, issue #22).

jest.mock("../../../../utils/announce", () => ({ announce: jest.fn() }));
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666" },
    isDark: false,
  }),
}));

const theme = {
  surface: "#ffffff",
  background: "#fafafa",
  text: "#000000",
  textSecondary: "#666666",
  border: "#eeeeee",
  dark: false,
  colors: { ffdBlue: "#004fe3", error: "#d00" },
} as never;

preloadReactNative("Modal", "TextInput");

describe("WdsfEntryModal accessibility", () => {
  const onClose = jest.fn();
  const onVerify = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  const renderModal = (
    props: Partial<React.ComponentProps<typeof WdsfEntryModal>> = {},
  ) =>
    render(
      <WdsfEntryModal
        visible
        onClose={onClose}
        onVerify={onVerify}
        loading={false}
        error={null}
        theme={theme}
        testID="wdsf-modal"
        {...props}
      />,
    );

  it("exposes the title as a heading", async () => {
    const { getByRole } = await renderModal();
    expect(
      getByRole("header", { name: "Ajouter une licence WDSF" }),
    ).toBeTruthy();
  });

  it("names both buttons and disables « Vérifier » until a MIN is typed", async () => {
    const { getByRole, getByLabelText } = await renderModal();
    expect(getByRole("button", { name: "Annuler" }).props.testID).toBe(
      "wdsf-modal-cancel-button",
    );
    const verify = getByRole("button", { name: "Vérifier" });
    expect(verify.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.changeText(getByLabelText("Numéro MIN WDSF"), "10117265");
    expect(
      getByRole("button", { name: "Vérifier" }).props.accessibilityState,
    ).toMatchObject({ disabled: false, busy: false });
  });

  it("reports the busy state while verifying", async () => {
    const { getByRole } = await renderModal({ loading: true });
    expect(
      getByRole("button", { name: "Vérifier" }).props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
  });

  it("voices the inline error", async () => {
    await renderModal({ error: "Numéro MIN introuvable" });
    expect(announce).toHaveBeenCalledWith("Numéro MIN introuvable");
  });

  it("closes with the screen-reader escape gesture", async () => {
    const { getByTestId } = await renderModal();
    await fireEvent(getByTestId("wdsf-modal"), "onAccessibilityEscape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
