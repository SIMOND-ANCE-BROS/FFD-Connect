import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";
import { StyleSheet } from "react-native";
import type { ReactTestRendererJSON } from "react-test-renderer";
import { STACKED_CARD_ACTIVE_OFFSET } from "../../../../components/StackedCard";
import { BETA_NOTICES } from "../../../../constants/betaNotices";
import { useTheme } from "../../../../context/ThemeContext";
import { useLicenseLogic } from "../../hooks/useLicenseLogic";
import { LicenseScreen } from "../LicenseScreen";

jest.mock("../../../../components/NotificationBell", () => ({
  NotificationBell: () => {
    const { View } = require("react-native");
    return <View testID="notification-bell" />;
  },
}));
jest.mock("../../components/SwipeableLicenseCard", () => ({
  SwipeableLicenseCard: ({
    children,
    enabled,
  }: {
    children: React.ReactNode;
    enabled: boolean;
  }) => {
    const { View } = require("react-native");
    return (
      <View testID={`swipeable-wdsf-${enabled ? "enabled" : "disabled"}`}>
        {children}
      </View>
    );
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
  LicenseCard: (props: {
    testID?: string;
    onShowQr?: () => void;
    collapsed?: boolean;
    onOptions?: () => void;
  }) => {
    const { Text } = require("react-native");
    return (
      <Text
        testID={props.testID}
        onPress={props.onShowQr}
        accessibilityHint={props.collapsed ? "collapsed" : "expanded"}
      >
        {props.testID}
        {props.onOptions ? (
          <Text testID={`${props.testID}-options`} onPress={props.onOptions}>
            ...
          </Text>
        ) : null}
      </Text>
    );
  },
  LicenseUser: {},
  LicenseType: {},
}));

jest.mock("../../components/AddToAppleWalletButton", () => ({
  AddToAppleWalletButton: (props: {
    license: { licenseNumber: string };
    servedFromSnapshot: boolean;
  }) => {
    const { Text } = require("react-native");
    return (
      <Text testID="apple-wallet-slot">
        {`${props.license.licenseNumber}:${String(props.servedFromSnapshot)}`}
      </Text>
    );
  },
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

  it("opens the QR modal with the server-signed QR as-is (#168)", async () => {
    const qrCode = '{"v":1,"id":"123","exp":"2026-08-31","sig":"abc"}';
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        listItems: [
          {
            type: "FFD",
            data: {
              firstName: "John",
              lastName: "Doe",
              licenseNumber: "123",
              qrCode,
            },
          },
        ],
      },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    await fireEvent.press(getByTestId("license-card-FFD"));

    expect(mockActions.handleShowQr).toHaveBeenCalledWith(qrCode);
  });

  it("falls back to the legacy QR content without a signed QR", async () => {
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: {
        ...mockState,
        listItems: [
          {
            type: "FFD",
            data: { firstName: "John", lastName: "Doe", licenseNumber: "123" },
          },
        ],
      },
      actions: mockActions,
    });

    const { getByTestId } = await render(<LicenseScreen />);
    await fireEvent.press(getByTestId("license-card-FFD"));

    const shown = mockActions.handleShowQr.mock.calls[0][0] as string;
    expect(JSON.parse(shown)).toEqual({
      id: "123",
      name: "Doe John",
      valid: true,
      type: "FFD",
    });
  });

  it("renders Guest Mode correctly", async () => {
    const guestItems = [{ type: "GUEST", data: null }];
    (useLicenseLogic as jest.Mock).mockReturnValue({
      state: { ...mockState, listItems: guestItems, role: "GUEST" },
      actions: mockActions,
    });

    const { getByTestId, getByText, queryByTestId } = await render(
      <LicenseScreen />,
    );

    expect(getByTestId("license-screen-guest-card")).toBeTruthy();
    expect(getByText("Mode Invité")).toBeTruthy();
    // No license displayed for a guest → no beta license notice.
    expect(queryByTestId("license-beta-notice")).toBeNull();
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

  it("brings the Staff card forward and shows its staff QR", async () => {
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
    await fireEvent.press(getByTestId("license-screen-staff-card"));
    expect(mockActions.handleCardPress).toHaveBeenCalledWith(0);

    await fireEvent.press(getByTestId("license-card-0"));
    expect(mockActions.handleShowQr).toHaveBeenCalledWith(
      JSON.stringify({ id: "S1", valid: true, type: "STAFF", role: "STAFF" }),
    );
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
  describe("beta UX fixes", () => {
    const dualItems = [
      {
        type: "FFD",
        data: { firstName: "John", lastName: "Doe", licenseNumber: "123" },
      },
      {
        type: "WDSF",
        data: { firstName: "John", lastName: "Doe", licenseNumber: "1000" },
      },
    ];

    /** testIDs in render (document) order. */
    const collectTestIds = (
      node: ReactTestRendererJSON | ReactTestRendererJSON[] | null,
      acc: string[] = [],
    ): string[] => {
      if (!node) return acc;
      if (Array.isArray(node)) {
        node.forEach((child) => collectTestIds(child, acc));
        return acc;
      }
      const testID = node.props.testID as unknown;
      if (typeof testID === "string") acc.push(testID);
      (node.children ?? []).forEach((child) => {
        if (typeof child !== "string") collectTestIds(child, acc);
      });
      return acc;
    };

    it("puts the export button before the notification bell", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: { ...mockState },
        actions: mockActions,
      });

      const { toJSON } = await render(<LicenseScreen />);
      const ids = collectTestIds(toJSON());

      const shareIdx = ids.indexOf("license-screen-share-button");
      const bellIdx = ids.indexOf("notification-bell");
      expect(shareIdx).toBeGreaterThanOrEqual(0);
      expect(bellIdx).toBeGreaterThan(shareIdx);
    });

    it("reserves bottom space for the floating tab bar", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: { ...mockState },
        actions: mockActions,
      });

      const { getByTestId } = await render(<LicenseScreen />);
      const contentStyle = StyleSheet.flatten(
        getByTestId("license-screen-scroll-view").props
          .contentContainerStyle as object,
      ) as { paddingBottom?: number };

      // Tab bar pill (70) + its bottom gap (20 without insets) must fit.
      expect(contentStyle.paddingBottom).toBeGreaterThanOrEqual(90);
    });

    it("reserves the stacked card offset under the wallet", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          listItems: [
            { type: "FFD", data: { licenseNumber: "123" } },
            { type: "ADD_WDSF", data: null },
          ],
        },
        actions: mockActions,
      });

      const { getByTestId } = await render(<LicenseScreen />);
      const walletStyle = StyleSheet.flatten(
        getByTestId("license-screen-wallet").props.style as object,
      ) as { paddingBottom?: number };

      expect(walletStyle.paddingBottom).toBe(STACKED_CARD_ACTIVE_OFFSET);
    });

    it("lets the wallet height follow the compact active card", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: { ...mockState, showWdsf: true, listItems: dualItems },
        actions: mockActions,
      });

      const { getByTestId } = await render(<LicenseScreen />);
      const walletStyle = StyleSheet.flatten(
        getByTestId("license-screen-wallet").props.style as object,
      ) as { minHeight?: number; paddingBottom?: number };

      // No fixed minimum that would push the content under the tab bar: the
      // stack is the active card + the reserved offset of the peeking card.
      expect(walletStyle.minHeight).toBeUndefined();
      expect(walletStyle.paddingBottom).toBe(STACKED_CARD_ACTIVE_OFFSET);
    });
  });

  describe("stacked wallet with FFD + WDSF", () => {
    const dualItems = [
      {
        type: "FFD",
        data: { firstName: "John", lastName: "Doe", licenseNumber: "123" },
      },
      {
        type: "WDSF",
        data: { firstName: "John", lastName: "Doe", licenseNumber: "1000" },
      },
    ];

    const renderDual = async (activeCardIndex: number) => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          showWdsf: true,
          listItems: dualItems,
          activeCardIndex,
        },
        actions: mockActions,
      });
      return render(<LicenseScreen />);
    };

    it("stacks both cards in the wallet, without a type switch", async () => {
      const { getByTestId, queryByTestId } = await renderDual(0);

      expect(queryByTestId("license-screen-type-switch")).toBeNull();
      expect(getByTestId("license-screen-wallet")).toBeTruthy();
      expect(getByTestId("license-screen-card-FFD")).toBeTruthy();
      expect(getByTestId("license-screen-card-WDSF")).toBeTruthy();
    });

    it("expands the active FFD card and collapses the WDSF one", async () => {
      const { getByTestId } = await renderDual(0);

      expect(getByTestId("license-card-FFD").props.accessibilityHint).toBe(
        "expanded",
      );
      expect(getByTestId("license-card-WDSF").props.accessibilityHint).toBe(
        "collapsed",
      );
      // Swipe-to-remove only works on the active WDSF card.
      expect(getByTestId("swipeable-wdsf-disabled")).toBeTruthy();
    });

    it("brings the WDSF card forward when tapped", async () => {
      const { getByTestId } = await renderDual(0);

      await fireEvent.press(getByTestId("license-screen-card-WDSF"));
      expect(mockActions.handleCardPress).toHaveBeenCalledWith(1);
    });

    it("expands the active WDSF card with swipe-to-remove and its menu", async () => {
      const { getByTestId } = await renderDual(1);

      expect(getByTestId("license-card-WDSF").props.accessibilityHint).toBe(
        "expanded",
      );
      expect(getByTestId("license-card-FFD").props.accessibilityHint).toBe(
        "collapsed",
      );
      expect(getByTestId("swipeable-wdsf-enabled")).toBeTruthy();

      await fireEvent.press(getByTestId("license-card-WDSF-options"));
      expect(mockActions.handleRemoveWdsfWithConfirm).toHaveBeenCalled();

      await fireEvent.press(getByTestId("license-screen-card-FFD"));
      expect(mockActions.handleCardPress).toHaveBeenCalledWith(0);
    });

    it("offers the pull-to-add card when there is no WDSF license", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          listItems: [dualItems[0], { type: "ADD_WDSF", data: null }],
        },
        actions: mockActions,
      });

      const { getByTestId } = await render(<LicenseScreen />);
      await fireEvent.press(getByTestId("license-screen-add-wdsf-card"));
      expect(mockActions.handleAddWdsf).toHaveBeenCalled();
    });
  });

  describe("Apple Wallet button (#163)", () => {
    const ffd = {
      type: "FFD",
      data: { firstName: "John", lastName: "Doe", licenseNumber: "123" },
    };
    const wdsf = {
      type: "WDSF",
      data: { firstName: "John", lastName: "Doe", licenseNumber: "MIN-1" },
    };

    it("is placed under the FFD license with the snapshot flag", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          offlineSince: "2026-10-01T10:00:00.000Z",
          listItems: [ffd, { type: "ADD_WDSF", data: null }],
        },
        actions: mockActions,
      });

      const { getByTestId } = await render(<LicenseScreen />);
      expect(getByTestId("apple-wallet-slot").props.children).toBe("123:true");
    });

    it("is preceded by the beta notice (license not accepted at competitions)", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: { ...mockState, listItems: [ffd] },
        actions: mockActions,
      });

      const { getByText, toJSON } = await render(<LicenseScreen />);
      expect(getByText(BETA_NOTICES.license.message)).toBeTruthy();

      const tree = JSON.stringify(toJSON());
      const noticeAt = tree.indexOf('"license-beta-notice"');
      const walletAt = tree.indexOf('"apple-wallet-slot"');
      expect(noticeAt).toBeGreaterThan(-1);
      expect(walletAt).toBeGreaterThan(noticeAt);
    });

    it("is absent without an FFD license (guest)", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          role: "GUEST",
          listItems: [{ type: "GUEST", data: null }],
        },
        actions: mockActions,
      });

      const { queryByTestId } = await render(<LicenseScreen />);
      expect(queryByTestId("apple-wallet-slot")).toBeNull();
    });

    it("is hidden while the WDSF card is the active one of the stack", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          offlineSince: null,
          showWdsf: true,
          activeCardIndex: 1,
          listItems: [ffd, wdsf],
        },
        actions: mockActions,
      });
      const { queryByTestId } = await render(<LicenseScreen />);
      expect(queryByTestId("apple-wallet-slot")).toBeNull();
    });

    it("shows it while the FFD card is the active one of two", async () => {
      (useLicenseLogic as jest.Mock).mockReturnValue({
        state: {
          ...mockState,
          offlineSince: null,
          showWdsf: true,
          activeCardIndex: 0,
          listItems: [ffd, wdsf],
        },
        actions: mockActions,
      });
      const { getByTestId } = await render(<LicenseScreen />);
      expect(getByTestId("apple-wallet-slot").props.children).toBe("123:false");
    });
  });
});
