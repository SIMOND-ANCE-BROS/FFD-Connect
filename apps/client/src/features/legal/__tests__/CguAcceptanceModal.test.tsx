/** Acceptation CGU au premier lancement (#424). */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CguAcceptanceModal } from "../CguAcceptanceModal";
import { hasAcceptedCgu } from "../cguConsent";

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

describe("CguAcceptanceModal", () => {
  it("s'affiche au premier lancement (CGU non acceptées)", async () => {
    const { findByTestId } = await render(<CguAcceptanceModal />);
    expect(await findByTestId("cgu-accept-button")).toBeTruthy();
  });

  it("ne rend rien si les CGU sont déjà acceptées", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", "1");

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
});
