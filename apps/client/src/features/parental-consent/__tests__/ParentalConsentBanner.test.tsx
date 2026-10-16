import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ParentalConsentBanner } from "../ParentalConsentBanner";
import { useParentalConsent } from "../useParentalConsent";

jest.mock("../useParentalConsent");
jest.mock("lucide-react-native", () => ({ ShieldAlert: () => null }));
jest.mock("../../../context/ThemeContext", () => ({
  useTheme: () =>
    (
      require("../../../__tests__/mocks/mockTheme") as typeof import("../../../__tests__/mocks/mockTheme")
    ).mockUseTheme(),
}));

const mockHook = useParentalConsent as jest.Mock;

describe("ParentalConsentBanner (#61)", () => {
  it.each([undefined, { state: "NOT_REQUIRED" }, { state: "GRANTED" }])(
    "renders nothing for %p",
    async (consent) => {
      mockHook.mockReturnValue({ consent });
      const { queryByTestId } = await render(
        <ParentalConsentBanner onPress={jest.fn()} />,
      );
      expect(queryByTestId("parental-consent-banner")).toBeNull();
    },
  );

  it("asks a minor to give a parent's address, and opens the screen", async () => {
    mockHook.mockReturnValue({ consent: { state: "REQUIRED" } });
    const onPress = jest.fn();
    const { getByTestId, getByText } = await render(
      <ParentalConsentBanner onPress={onPress} />,
    );
    expect(getByText("Accord parental nécessaire")).toBeTruthy();
    expect(
      getByText("Appuyez pour indiquer l'e-mail d'un parent"),
    ).toBeTruthy();
    await fireEvent.press(getByTestId("parental-consent-banner"));
    expect(onPress).toHaveBeenCalled();
  });

  it("says the request is pending", async () => {
    mockHook.mockReturnValue({ consent: { state: "PENDING" } });
    const { getByText } = await render(
      <ParentalConsentBanner onPress={jest.fn()} />,
    );
    expect(
      getByText("En attente de l'accord de votre représentant légal"),
    ).toBeTruthy();
    expect(
      getByText("Appuyez pour voir la demande ou la renvoyer"),
    ).toBeTruthy();
  });
});
