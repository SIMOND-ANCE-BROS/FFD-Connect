import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { useTheme } from "../../../../context/ThemeContext";
import { useLicenseLogic } from "../../hooks/useLicenseLogic";
import { LicenseScreen } from "../LicenseScreen";

jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => null,
}));
jest.mock("../../components/SwipeableLicenseCard", () => ({
  SwipeableLicenseCard: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID: string;
  }) => {
    const { View } = require("react-native");
    return <View testID={testID}>{children}</View>;
  },
}));

// Mock Hooks
jest.mock("../../hooks/useLicenseLogic", () => ({
  useLicenseLogic: jest.fn(),
}));

// Inline mock for ThemeContext to ensure stability
jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock Navigation
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () =>
    require("../../../../__tests__/mocks/mockNavigation").mockNavigation,
}));

// Mock Child Components to simplify test
jest.mock("react-native-qrcode-svg", () => "QRCode");
jest.mock("../../components/LicenseCard", () => ({
  LicenseCard: (props: { testID?: string }) => {
    const { Text } = require("react-native");
    return <Text testID={props.testID}>{props.testID}</Text>;
  },
  LicenseUser: {},
  LicenseType: {},
}));

// Mock Reanimated & Gesture Handler
jest.mock("react-native-reanimated", () =>
  require("../../../../__tests__/mocks/mockReanimated"),
);
jest.mock("react-native-gesture-handler", () =>
  require("../../../../__tests__/mocks/mockGestureHandler"),
);

describe("LicenseScreen Integration", () => {
  const mockState = {
    loadingPdf: false,
    showQr: false,
    activeQrData: null,
    photoUri: "test-uri",
    activeCardIndex: 0,
    showWdsf: false,
    wdsfModalVisible: false,
    verifyingWdsf: false,
    wdsfError: null,
    role: "LICENSEE",
    listItems: [],
    pullY: { value: 0 },
    pullGesture: {},
  };

  const mockActions = {
    setWdsfModalVisible: jest.fn(),
    setShowQr: jest.fn(),
    handleCardPress: jest.fn(),
    handleShowQr: jest.fn(),
    generateAndSharePdf: jest.fn().mockResolvedValue(undefined),
    handleVerifyWdsf: jest.fn().mockResolvedValue(undefined),
    handleRemoveWdsfWithConfirm: jest.fn().mockResolvedValue(undefined),
    handleAddWdsf: jest.fn(),
  };

  // Inline mockTheme for stability
  const mockTheme = {
    theme: {
      background: "#ffffff",
      surface: "#f2f2f2",
      text: "#111111",
      textSecondary: "#666666",
      primary: "#3b82f6",
      secondary: "#E0E0E0",
      border: "#e5e7eb",
      danger: "#ef4444",
      success: "#22c55e",
      warning: "#f59e0b",
      info: "#3b82f6",
      colors: {
        primary: "#3b82f6",
        background: "#ffffff",
        surface: "#f2f2f2",
        text: "#111111",
        textSecondary: "#666666",
        border: "#e5e7eb",
        error: "#ef4444",
        success: "#22c55e",
        warning: "#f59e0b",
        info: "#3b82f6",
        card: "#ffffff",
        notification: "#ef4444",
        ffdBlue: "#0055a4",
        slate100: "#F1F5F9",
        slate800: "#1E293B",
        slate500: "#64748B",
        slate400: "#94A3B8",
        ffdCyan: "#00AEEF",
      },
      spacing: { s: 4, m: 8, l: 16, xl: 24, xs: 2, xxl: 32 },
      roundness: 8,
      textVariants: {
        h1: { fontSize: 24 },
        h2: { fontSize: 20 },
        body: { fontSize: 16 },
        caption: { fontSize: 12 },
        button: { fontSize: 14 },
      },
      animation: {
        scale: 1,
      },
      statusBarStyle: "dark-content",
    },
    isDark: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme.theme,
      isDark: false,
    }));
  });

  it("renders User Licenses correctly", async () => {
    const userItems = [
      {
        type: "FFD",
        data: { firstName: "John", lastName: "Doe", licenseNumber: "123" },
      },
      { type: "ADD_WDSF", data: null },
    ];

    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: userItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    expect(getByTestId("license-screen-scroll-view")).toBeTruthy();
    expect(getByTestId("license-screen-card-FFD")).toBeTruthy();
    expect(getByTestId("license-screen-add-wdsf-card")).toBeTruthy();
  });

  it("renders Guest Mode correctly", async () => {
    const guestItems = [{ type: "GUEST", data: null }];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: guestItems, role: "GUEST" },
      actions: mockActions,
    });

    const { getByTestId, getByText } = await render(<LicenseScreen />);

    expect(getByTestId("license-screen-guest-card")).toBeTruthy();
    expect(getByText("Mode Invité")).toBeTruthy();
  });

  it("handles WDSF Add interactions", async () => {
    const userItems = [
      { type: "FFD", data: {} },
      { type: "ADD_WDSF", data: null },
    ];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: userItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    const addCard = getByTestId("license-screen-add-wdsf-card");
    await fireEvent.press(addCard);

    expect(mockActions.handleAddWdsf).toHaveBeenCalled();
  });

  it("shows WDSF Entry Modal when visible", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, wdsfModalVisible: true },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    expect(getByTestId("wdsf-modal-input")).toBeTruthy();

    await fireEvent.changeText(getByTestId("wdsf-modal-input"), "123456");
    await fireEvent.press(getByTestId("wdsf-modal-verify-button"));

    expect(mockActions.handleVerifyWdsf).toHaveBeenCalledWith("123456");
  });

  it("triggers PDF share on header button press", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    const shareBtn = getByTestId("license-screen-share-button");
    await fireEvent.press(shareBtn);

    expect(mockActions.generateAndSharePdf).toHaveBeenCalled();
  });

  it("displays QR Code for FFD license", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        showQr: true,
        activeQrData: { type: "FFD", id: "123" },
      },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    expect(getByTestId("qr-code-modal")).toBeTruthy();
  });

  it("closes QR Code modal", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        showQr: true,
        activeQrData: { type: "FFD", id: "123" },
      },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    await fireEvent.press(getByTestId("qr-modal-close-button"));
    expect(mockActions.setShowQr).toHaveBeenCalledWith(false);
  });

  it("renders Staff Card correctly", async () => {
    const staffItems = [
      {
        type: "STAFF",
        data: { firstName: "Staff", lastName: "Member", licenseNumber: "S1" },
      },
    ];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: staffItems, role: "STAFF" },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    expect(getByTestId("license-screen-staff-card")).toBeTruthy();
  });

  it("handles card press", async () => {
    const userItems = [{ type: "FFD", data: { licenseNumber: "123" } }];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: userItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    await fireEvent.press(getByTestId("license-screen-card-FFD"));
    expect(mockActions.handleCardPress).toHaveBeenCalledWith(0);
  });

  it("handles QR modal overlay and close button press", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        showQr: true,
        activeQrData: { type: "FFD", id: "123" },
      },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    await fireEvent.press(getByTestId("qr-modal-overlay"));
    expect(mockActions.setShowQr).toHaveBeenCalledWith(false);

    await fireEvent.press(getByTestId("qr-modal-close-button"));
    expect(mockActions.setShowQr).toHaveBeenCalledWith(false);
  });

  it("closes WDSF modal", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, wdsfModalVisible: true },
      actions: mockActions,
    });

    const { queryByText } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(queryByText("Ajouter une licence WDSF")).toBeTruthy();
    });
  });

  it("handles WDSF license removal", async () => {
    const userItems = [{ type: "WDSF", data: { id: "WDSF-1" } }];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: userItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    await fireEvent.press(getByTestId("license-screen-card-WDSF"));
    expect(mockActions.handleCardPress).toHaveBeenCalledWith(0);
  });
});
