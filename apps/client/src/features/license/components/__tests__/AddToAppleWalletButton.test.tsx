import { fireEvent, render } from "@testing-library/react-native";
import React from "react";
import { ThemeContext } from "../../../../context/ThemeContext";
import { useAppleWalletPass } from "../../hooks/useAppleWalletPass";
import {
  ADD_TO_APPLE_WALLET_LABEL,
  AddToAppleWalletButton,
  APPLE_WALLET_OFFLINE_HINT,
} from "../AddToAppleWalletButton";
import type { LicenseUser } from "../LicenseCard";

jest.mock("../../hooks/useAppleWalletPass", () => ({
  useAppleWalletPass: jest.fn(),
}));
jest.mock("react-native-reanimated", () =>
  require("../../../../__tests__/mocks/mockReanimated"),
);

const mockHook = useAppleWalletPass as jest.Mock;
const addToWallet = jest.fn().mockResolvedValue(undefined);

const themeMock = {
  theme: {
    primary: "#004fe3",
    text: "#000000",
    textSecondary: "#666666",
    danger: "#EF4444",
  },
  isDark: false,
  toggleTheme: jest.fn(),
};

const license = { licenseNumber: "123456" } as LicenseUser;

const setHook = (state: Partial<Record<string, unknown>> = {}) =>
  mockHook.mockReturnValue({
    state: {
      visible: true,
      offline: false,
      loading: false,
      error: null,
      ...state,
    },
    addToWallet,
  });

const renderButton = async (servedFromSnapshot = false) =>
  await render(
    <ThemeContext.Provider value={themeMock as never}>
      <AddToAppleWalletButton
        license={license}
        servedFromSnapshot={servedFromSnapshot}
      />
    </ThemeContext.Provider>,
  );

beforeEach(() => jest.clearAllMocks());

describe("AddToAppleWalletButton", () => {
  it("renders nothing when the button does not apply", async () => {
    setHook({ visible: false });
    const { queryByTestId } = await renderButton();
    expect(queryByTestId("license-apple-wallet-button")).toBeNull();
  });

  it("shows an accessible button that starts the flow", async () => {
    setHook();
    const { getByTestId, getByText } = await renderButton();

    const button = getByTestId("license-apple-wallet-button");
    expect(getByText(ADD_TO_APPLE_WALLET_LABEL)).toBeTruthy();
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe(ADD_TO_APPLE_WALLET_LABEL);

    await fireEvent.press(button);
    expect(addToWallet).toHaveBeenCalledTimes(1);
  });

  it("passes the snapshot flag to the hook", async () => {
    setHook();
    await renderButton(true);
    expect(mockHook).toHaveBeenCalledWith(license, {
      servedFromSnapshot: true,
    });
  });

  it("is disabled and busy while loading", async () => {
    setHook({ loading: true });
    const { getByTestId } = await renderButton();

    const button = getByTestId("license-apple-wallet-button");
    expect(button.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await fireEvent.press(button);
    expect(addToWallet).not.toHaveBeenCalled();
  });

  it("is disabled offline, with a short explanation", async () => {
    setHook({ offline: true, error: "stale error" });
    const { getByTestId, getByText, queryByTestId } = await renderButton();

    const button = getByTestId("license-apple-wallet-button");
    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(getByText(APPLE_WALLET_OFFLINE_HINT)).toBeTruthy();
    expect(queryByTestId("license-apple-wallet-error")).toBeNull();
    await fireEvent.press(button);
    expect(addToWallet).not.toHaveBeenCalled();
  });

  it("announces the error message", async () => {
    setHook({ error: "Votre licence est expirée." });
    const { getByTestId } = await renderButton();

    const message = getByTestId("license-apple-wallet-error");
    expect(message.props.children).toBe("Votre licence est expirée.");
    expect(message.props.accessibilityRole).toBe("alert");
  });
});
