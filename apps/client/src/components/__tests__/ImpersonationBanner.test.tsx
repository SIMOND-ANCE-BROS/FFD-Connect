import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React, { useContext } from "react";
import { Text } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import {
  ImpersonationBanner,
  ImpersonationLayout,
} from "../ImpersonationBanner";
import { AuthService } from "../../features/auth/services/AuthService";
import { useAuthStore } from "../../stores/auth.store";

jest.mock("react-native-safe-area-context", () => {
  const { createContext } = jest.requireActual<typeof import("react")>("react");
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  return {
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});

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
    setStore({ impersonating: false, impersonatedName: null });
    const { queryByTestId } = await render(<ImpersonationBanner />);
    expect(queryByTestId("impersonation-banner")).toBeNull();
  });

  it("affiche le nom de la cible et permet de quitter", async () => {
    setStore({ impersonating: true, impersonatedName: "Test Club" });
    const { getByTestId, getByText } = await render(<ImpersonationBanner />);

    expect(getByTestId("impersonation-banner")).toBeTruthy();
    expect(getByText(/Test Club/)).toBeTruthy();

    await fireEvent.press(getByTestId("impersonation-stop"));
    await waitFor(() => {
      expect(AuthService.stopImpersonation).toHaveBeenCalled();
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});

/** Prints the insets the app below the banner receives from the context. */
const InsetsProbe = () => {
  const insets = useContext(SafeAreaInsetsContext);
  return <Text testID="probe">{`${insets?.top}/${insets?.bottom}`}</Text>;
};

describe("ImpersonationLayout", () => {
  it("leaves the app insets untouched outside impersonation", async () => {
    setStore({ impersonating: false, impersonatedName: null });
    const { getByTestId, queryByTestId } = await render(
      <ImpersonationLayout>
        <InsetsProbe />
      </ImpersonationLayout>,
    );
    expect(queryByTestId("impersonation-banner")).toBeNull();
    expect(getByTestId("probe")).toHaveTextContent("47/34");
  });

  it("renders the banner in the layout flow and zeroes the app's top inset", async () => {
    setStore({ impersonating: true, impersonatedName: "Test Club" });
    const { getByTestId } = await render(
      <ImpersonationLayout>
        <InsetsProbe />
      </ImpersonationLayout>,
    );
    const banner = getByTestId("impersonation-banner");
    // Not an overlay: no absolute positioning over the screens' headers.
    expect(banner).not.toHaveStyle({ position: "absolute" });
    expect(banner).toHaveStyle({ paddingTop: 47 });
    // The banner absorbs the status-bar inset; headers below start at 0.
    expect(getByTestId("probe")).toHaveTextContent("0/34");
  });
});
