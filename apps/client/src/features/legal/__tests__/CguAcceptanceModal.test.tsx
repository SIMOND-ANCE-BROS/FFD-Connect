/** Acceptation CGU au premier lancement (#424). */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CguAcceptanceModal } from "../CguAcceptanceModal";
import { CGU_VERSION, hasAcceptedCgu } from "../cguConsent";
import { preloadReactNative } from "../../../__tests__/mocks/preloadReactNative";

jest.mock("../../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      surface: "#fff",
      text: "#000",
      textSecondary: "#666",
      primary: "#007AFF",
    },
  }),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
});

// One-off react-native module loading, out of the first test's budget
// (flaky under load otherwise, #546).
preloadReactNative("Modal");

describe("CguAcceptanceModal", () => {
  it("s'affiche au premier lancement (CGU non acceptées)", async () => {
    const { findByTestId } = await render(<CguAcceptanceModal />);
    expect(await findByTestId("cgu-accept-button")).toBeTruthy();
  });

  it("ne rend rien si les CGU sont déjà acceptées", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", CGU_VERSION);

    const { queryByTestId } = await render(<CguAcceptanceModal />);
    await act(async () => {});

    expect(queryByTestId("cgu-accept-button")).toBeNull();
  });

  it("accepter ferme la modale et persiste le consentement", async () => {
    const { findByTestId, queryByTestId } = await render(
      <CguAcceptanceModal />,
    );

    await fireEvent.press(await findByTestId("cgu-accept-button"));

    await waitFor(async () => {
      expect(queryByTestId("cgu-accept-button")).toBeNull();
      expect(await hasAcceptedCgu()).toBe(true);
    });
  });

  it("lecteur d'écran (#22) : titre et sections en intitulés, bouton nommé", async () => {
    const { findByRole, getAllByRole } = await render(<CguAcceptanceModal />);
    expect(
      await findByRole("header", {
        name: "Conditions générales d'utilisation",
      }),
    ).toBeTruthy();
    expect(getAllByRole("header").length).toBeGreaterThan(1);
    const accept = await findByRole("button", {
      name: "Accepter les conditions générales d'utilisation",
    });
    expect(accept.props.testID).toBe("cgu-accept-button");
  });
});
