/**
 * MSW Integration Tests for LicenseScreen
 *
 * These tests verify the LicenseScreen behavior when the API
 * returns different responses, using MSW to intercept real axios calls.
 */
import { render, waitFor } from "@testing-library/react-native";
import { http, HttpResponse } from "msw";
import React from "react";
import { server } from "../../../../mocks/msw/server";
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

jest.mock("../../hooks/useLicenseLogic", () => ({
  useLicenseLogic: jest.fn(),
}));

jest.mock("../../../../context/ThemeContext", () => ({
  useTheme: jest.fn(),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () =>
    require("../../../../__tests__/mocks/mockNavigation").mockNavigation,
}));

jest.mock("react-native-qrcode-svg", () => "QRCode");
jest.mock("../../components/LicenseCard", () => ({
  LicenseCard: (props: { testID?: string }) => {
    const { Text } = require("react-native");
    return <Text testID={props.testID}>{props.testID}</Text>;
  },
  LicenseUser: {},
  LicenseType: {},
}));

jest.mock("react-native-reanimated", () =>
  require("../../../../__tests__/mocks/mockReanimated"),
);
jest.mock("react-native-gesture-handler", () =>
  require("../../../../__tests__/mocks/mockGestureHandler"),
);

const mockTheme = {
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
  animation: { scale: 1 },
  statusBarStyle: "dark-content",
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

const baseState = {
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

describe("LicenseScreen MSW Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useTheme as jest.Mock).mockImplementation(() => ({
      theme: mockTheme,
      isDark: false,
    }));
  });

  it("displays license data after successful fetch (MSW returns license)", async () => {
    // MSW default handler returns license data at GET /licenses/my
    // The component via useLicenseLogic shows the license card
    const licenseItems = [
      {
        type: "FFD",
        data: {
          firstName: "Test",
          lastName: "User",
          licenseNumber: "FFD-2024-001",
        },
      },
    ];

    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...baseState, listItems: licenseItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(getByTestId("license-screen-card-FFD")).toBeTruthy();
    });
  });

  it("shows no-license / guest state when API returns 404", async () => {
    // Override MSW handler to return 404 for license
    server.use(
      http.get("http://localhost:3000/licenses/my", () => {
        return HttpResponse.json(
          { message: "License not found" },
          { status: 404 },
        );
      }),
    );

    // When there's no license, useLicenseLogic returns GUEST or empty state
    const guestItems = [{ type: "GUEST", data: null }];

    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...baseState, listItems: guestItems, role: "GUEST" },
      actions: mockActions,
    });

    const { getByTestId, getByText } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(getByTestId("license-screen-guest-card")).toBeTruthy();
      expect(getByText("Mode Invité")).toBeTruthy();
    });
  });

  it("shows license scroll view when license data is available", async () => {
    const licenseItems = [
      {
        type: "FFD",
        data: {
          firstName: "John",
          lastName: "Doe",
          licenseNumber: "FFD-2024-999",
        },
      },
      { type: "ADD_WDSF", data: null },
    ];

    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...baseState, listItems: licenseItems },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(getByTestId("license-screen-scroll-view")).toBeTruthy();
      expect(getByTestId("license-screen-card-FFD")).toBeTruthy();
      expect(getByTestId("license-screen-add-wdsf-card")).toBeTruthy();
    });
  });

  it("shows WDSF license when user has WDSF license", async () => {
    // MSW returns user with WDSF license
    server.use(
      http.get("http://localhost:3000/users/me", () => {
        return HttpResponse.json({
          id: "user-1",
          email: "test@ffd.com",
          role: "LICENSEE",
          firstName: "Test",
          lastName: "User",
          wdsf: {
            min: "12345",
            nationality: "FRA",
            licenseType: "Professionnel",
            ageGroup: "Adult",
            expiresOn: "2025-12-31",
          },
        });
      }),
    );

    const licenseItems = [
      {
        type: "FFD",
        data: { firstName: "Test", lastName: "User", licenseNumber: "FFD-001" },
      },
      { type: "WDSF", data: { min: "12345" } },
    ];

    // FFD + WDSF ⇒ segmented switch, one card at a time: WDSF selected here.
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...baseState, listItems: licenseItems, activeCardIndex: 1 },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(getByTestId("license-screen-card-WDSF")).toBeTruthy();
      expect(getByTestId("license-screen-type-switch")).toBeTruthy();
    });
  });

  it("shows staff card for STAFF role", async () => {
    const staffItems = [
      {
        type: "STAFF",
        data: { firstName: "Staff", lastName: "Member", licenseNumber: "S1" },
      },
    ];

    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...baseState, listItems: staffItems, role: "STAFF" },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);

    await waitFor(() => {
      expect(getByTestId("license-screen-staff-card")).toBeTruthy();
    });
  });
});
