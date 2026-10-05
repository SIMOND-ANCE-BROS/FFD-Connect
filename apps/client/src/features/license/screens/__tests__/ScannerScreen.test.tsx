import { fireEvent, render } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { Linking } from "react-native";
import { useTheme } from "../../../../context/ThemeContext";
import { createMockScreenProps } from "../../../../utils/testUtils";
import { useScannerLogic } from "../../hooks/useScannerLogic";
import { ScannerScreen } from "../ScannerScreen";

jest.mock("../../hooks/useScannerLogic");
jest.mock("../../../../context/ThemeContext", () => ({
  ThemeProvider: ({ children }: PropsWithChildren) => <>{children}</>,
  useTheme: jest.fn(),
}));

describe("ScannerScreen", () => {
  const mockTheme = {
    background: "#fff",
    surface: "#f2f2f2",
    text: "#111",
    textSecondary: "#666",
    primary: "#3b82f6",
    border: "#e5e7eb",
    danger: "#ef4444",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockReturnValue({ theme: mockTheme });
  });

  it("requests permission when denied but re-prompt is still allowed", async () => {
    const requestPermission = jest.fn().mockResolvedValue(undefined);
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: false,
        canAskAgain: true,
        torch: "off",
        isActive: false,
        isLoading: false,
        result: null,
        error: null,
      },
      actions: { requestPermission },
    });

    const { getByText } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    await fireEvent.press(getByText("Autoriser"));
    expect(requestPermission).toHaveBeenCalled();
  });

  it("opens Settings when permission is denied for good (canAskAgain false)", async () => {
    const requestPermission = jest.fn().mockResolvedValue(undefined);
    const openSettings = jest
      .spyOn(Linking, "openSettings")
      .mockResolvedValue(undefined);
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: false,
        canAskAgain: false,
        torch: "off",
        isActive: false,
        isLoading: false,
        result: null,
        error: null,
      },
      actions: { requestPermission },
    });

    const { getByText } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    await fireEvent.press(getByText("Ouvrir les Réglages"));
    expect(openSettings).toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it("renders the camera view when permission granted", async () => {
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: true,
        torch: "off",
        isActive: true,
        isLoading: false,
        result: null,
        error: null,
      },
      actions: {
        toggleTorch: jest.fn(),
        resetScan: jest.fn(),
        handleBarcodeScanned: jest.fn(),
      },
    });

    const { getByTestId } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    expect(getByTestId("scanner-camera-view")).toBeTruthy();
  });

  it("renders result overlay when scan is successful", async () => {
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: true,
        torch: "off",
        isActive: false,
        isLoading: false,
        result: {
          user: { firstName: "John", lastName: "Doe" },
          registrations: [
            { event: "Cha Cha", bibNumber: "123", status: "SUCCESS" },
          ],
        },
        error: null,
      },
      actions: {
        toggleTorch: jest.fn(),
        resetScan: jest.fn(),
        handleBarcodeScanned: jest.fn(),
      },
    });

    const { getByTestId, getByText } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    expect(getByTestId("scanner-result-overlay")).toBeTruthy();
    expect(getByText("John Doe")).toBeTruthy();
  });

  it("renders error overlay when scan fails", async () => {
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: true,
        torch: "off",
        isActive: false,
        isLoading: false,
        result: null,
        error: "QR Code invalide",
      },
      actions: {
        toggleTorch: jest.fn(),
        resetScan: jest.fn(),
        handleBarcodeScanned: jest.fn(),
      },
    });

    const { getByTestId, getByText } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    expect(getByTestId("scanner-result-overlay")).toBeTruthy();
    expect(getByText("QR Code invalide")).toBeTruthy();
  });

  it("toggles flashlight when button pressed", async () => {
    const toggleTorch = jest.fn();
    (useScannerLogic as jest.Mock).mockReturnValue({
      state: {
        hasPermission: true,
        torch: "off",
        isActive: true,
        isLoading: false,
        result: null,
        error: null,
      },
      actions: {
        toggleTorch,
        resetScan: jest.fn(),
        handleBarcodeScanned: jest.fn(),
      },
    });

    const { getByTestId } = await render(
      <ScannerScreen {...createMockScreenProps("Scanner", undefined)} />,
    );

    await fireEvent.press(getByTestId("scanner-torch-toggle"));
    expect(toggleTorch).toHaveBeenCalled();
  });
});
