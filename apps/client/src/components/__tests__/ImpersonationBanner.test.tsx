import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { ImpersonationBanner } from "../ImpersonationBanner";
import { AuthService } from "../../features/auth/services/AuthService";
import { useAuthStore } from "../../stores/auth.store";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: { text: "#000", textSecondary: "#666" },
    isDark: false,
  }),
}));

jest.mock("../../features/auth/services/AuthService", () => ({
  AuthService: { stopImpersonation: jest.fn().mockResolvedValue(undefined) },
}));

const mockRefresh = jest.fn().mockResolvedValue(undefined);

jest.mock("../../stores/auth.store", () => ({
  useAuthStore: jest.fn(),
}));

function setStore(state: Record<string, unknown>) {
  (useAuthStore as unknown as jest.Mock).mockImplementation(
    (sel: (s: unknown) => unknown) =>
      sel({ refreshAuth: mockRefresh, ...state }),
  );
}

beforeEach(() => jest.clearAllMocks());

describe("ImpersonationBanner", () => {
  it("ne rend rien hors impersonation", async () => {
    setStore({ impersonatedName: null });
    const { queryByTestId } = await render(
      <ImpersonationBanner visible={false} />,
    );
    expect(queryByTestId("impersonation-banner")).toBeNull();
  });

  it("affiche le nom de la cible et permet de quitter", async () => {
    setStore({ impersonatedName: "Test Club" });
    const { getByTestId, getByText } = await render(
      <ImpersonationBanner visible />,
    );

    expect(getByTestId("impersonation-banner")).toBeTruthy();
    expect(getByText(/Test Club/)).toBeTruthy();

    expect(getByTestId("impersonation-banner")).toHaveStyle({ paddingTop: 47 });

    await fireEvent.press(getByTestId("impersonation-stop"));
    await waitFor(() => {
      expect(AuthService.stopImpersonation).toHaveBeenCalled();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("absorbe la marge haute fournie par la mise en page", async () => {
    setStore({ impersonatedName: "Test Club" });
    const { getByTestId } = await render(
      <ImpersonationBanner visible topInset={0} />,
    );
    expect(getByTestId("impersonation-banner")).toHaveStyle({ paddingTop: 0 });
  });
});
