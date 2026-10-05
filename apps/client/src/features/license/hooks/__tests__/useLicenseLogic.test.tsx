import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  mockAuthRepository,
  mockUserRole,
} from "../../../../__tests__/mocks/mockAuthRepository";
import { mockNavigation } from "../../../../__tests__/mocks/mockNavigation";
import { useLicenseLogic } from "../useLicenseLogic";

// Mock navigation
jest.mock("@react-navigation/native", () => {
  const actualNav = jest.requireActual("@react-navigation/native");
  const React = require("react");
  return {
    ...actualNav,
    // Comme le vrai useFocusEffect: exécute le callback via un effet (au focus =
    // au montage ici), PAS à chaque render. Un appel direct `callback()` relance
    // loadData à chaque re-render → boucle infinie que le rendu async de RNTL 14
    // (await render/renderHook) n'atteint jamais quiescent → timeout.
    useFocusEffect: jest.fn((callback) => {
      React.useEffect(() => callback(), [callback]);
    }),
    useNavigation: jest.fn(() => mockNavigation),
  };
});

// Mock AuthContext
jest.mock("../../../../features/auth/context/AuthContext", () => ({
  useAuthRepository: () => mockAuthRepository,
  UserRole: mockUserRole,
}));

// Mock external dependencies
jest.mock("../../../../utils/platform-adapters", () => ({
  PDFAdapter: {
    generatePDF: jest.fn(() => Promise.resolve({ filePath: "path/to/pdf" })),
  },
  ShareAdapter: {
    open: jest.fn(),
  },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(),
}));

jest.mock("react-native-reanimated", () => ({
  useSharedValue: jest.fn((v) => ({ value: v })),
  useAnimatedStyle: jest.fn(() => ({})),
  withTiming: jest.fn(),
  withSpring: jest.fn(),
  runOnJS: jest.fn((fn) => fn),
  Easing: {
    inOut: jest.fn(),
    quad: jest.fn(),
  },
  createAnimatedComponent: (c: React.ComponentType<object>) => c,
}));

jest.mock("react-native-gesture-handler", () => ({
  Gesture: {
    Pan: jest.fn().mockReturnThis(),
    enabled: jest.fn().mockReturnThis(),
    activeOffsetY: jest.fn().mockReturnThis(),
    failOffsetX: jest.fn().mockReturnThis(),
    onUpdate: jest.fn().mockReturnThis(),
    onEnd: jest.fn().mockReturnThis(),
  },
}));

import type { MockAlertButtons } from "../../../../__tests__/mocks/types";

// Mock Alert and Platform separately to avoid TurboModuleRegistry issues
jest.mock("react-native", () => {
  const mockAlert = jest.fn(
    (_title: string, _message?: string, buttons?: MockAlertButtons) => {
      // Execute the last button (destructive) by default for testing
      if (buttons && buttons.length > 0) {
        const lastButton = buttons[buttons.length - 1];
        if (lastButton.onPress) {
          lastButton.onPress();
        }
      }
    },
  );

  return {
    ...jest.requireActual("@react-native/jest-preset/jest/mock"),
    Alert: {
      alert: mockAlert,
    },
    Platform: {
      OS: "ios",
      Version: "17.0",
      select: (options: Record<string, unknown>) =>
        options.ios ?? options.default ?? options,
    },
  };
});

describe("useLicenseLogic", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default implementation to update config when set
    mockAuthRepository.setWdsfLicenseEnabled.mockImplementation(
      (enabled: boolean) => {
        mockAuthRepository.getAuthConfig.mockResolvedValue({
          role: "LICENSEE",
          hasWdsfLicense: enabled,
          licensePhotoUri: "test-uri",
        });
        return Promise.resolve();
      },
    );
  });

  it("should load initial configuration on mount", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      licensePhotoUri: "test-uri",
      hasWdsfLicense: true,
      role: "LICENSEE",
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(result.current.state.photoUri).toBe("test-uri");
    });

    expect(result.current.state.photoUri).toBe("test-uri");
    expect(result.current.state.showWdsf).toBe(true);
    expect(result.current.state.role).toBe("LICENSEE");
  });

  it("should handle WDSF verification success", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.verifyWdsfLicense.mockResolvedValue({});

    const { result } = await renderHook(() => useLicenseLogic());

    // Wait for initial load
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );

    await act(async () => {
      await result.current.actions.handleVerifyWdsf("123456");
    });

    await waitFor(() => {
      expect(mockAuthRepository.verifyWdsfLicense).toHaveBeenCalledWith(
        "123456",
      );
    });

    await waitFor(() => {
      expect(result.current.state.showWdsf).toBe(true);
    });

    expect(result.current.state.activeCardIndex).toBe(1);
    expect(result.current.state.wdsfError).toBeNull();
  });

  it("should handle WDSF verification failure", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      authToken: "token",
      isLoggedIn: true,
    });
    mockAuthRepository.verifyWdsfLicense.mockRejectedValue(
      new Error("Invalid MIN"),
    );

    const { result } = await renderHook(() => useLicenseLogic());

    // Wait for initial load
    await waitFor(() =>
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled(),
    );

    // Call the action without awaiting inside act to avoid hanging
    result.current.actions.handleVerifyWdsf("bad-min").catch(() => {});

    await waitFor(
      () => {
        expect(result.current.state.wdsfError).toBe("Invalid MIN");
      },
      { timeout: 5000 },
    );
    expect(result.current.state.showWdsf).toBe(false);
  });

  it("should return correct list items for STAFF role", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "STAFF" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("STAFF");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("STAFF");
  });

  it("should return guest item when role is GUEST", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "GUEST",
      hasWdsfLicense: false,
      licensePhotoUri: null,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("GUEST");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("GUEST");
  });

  it("should return organizer staff card when role is CLUB", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "CLUB",
      hasWdsfLicense: false,
      licensePhotoUri: null,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.role).toBe("CLUB");
    });

    const items = result.current.state.listItems;
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("STAFF");
  });

  it("should handle card press", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleCardPress(1);
    });

    expect(result.current.state.activeCardIndex).toBe(1);
  });

  it("should handle show QR with valid JSON", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleShowQr('{"key": "value"}');
    });

    expect(result.current.state.showQr).toBe(true);
    expect(result.current.state.activeQrData).toEqual({ key: "value" });
  });

  it("should handle show QR with invalid JSON", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleShowQr("invalid json");
    });

    expect(result.current.state.showQr).toBe(true);
    expect(result.current.state.activeQrData).toBe("invalid json");
  });

  it("should remove WDSF license via confirmation", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.state.showWdsf).toBe(true);
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm();
    });

    await waitFor(() => {
      expect(mockAuthRepository.setWdsfLicenseEnabled).toHaveBeenCalledWith(
        false,
      );
    });
  });

  it("should handle add WDSF", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({ role: "LICENSEE" });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleAddWdsf();
    });

    expect(result.current.state.wdsfModalVisible).toBe(true);
  });

  it("should handle load data error gracefully", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    mockAuthRepository.getAuthConfig.mockRejectedValue(
      new Error("Config error"),
    );

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    expect(result.current.state).toBeDefined();
    expect(result.current.state.role).toBe("LICENSEE");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("should handle remove WDSF with confirmation", async () => {
    const Alert = require("react-native").Alert;
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm();
    });

    expect(Alert.alert).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockAuthRepository.setWdsfLicenseEnabled).toHaveBeenCalledWith(
        false,
      );
    });
  });

  it("should handle remove WDSF with confirmation and reset callback", async () => {
    const Alert = require("react-native").Alert;
    const resetCallback = jest.fn();

    Alert.alert.mockImplementationOnce(
      (_title: string, _message?: string, buttons?: MockAlertButtons) => {
        if (buttons?.[0]?.onPress) {
          buttons[0].onPress();
        }
      },
    );

    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: true,
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getAuthConfig).toHaveBeenCalled();
    });

    await act(async () => {
      result.current.actions.handleRemoveWdsfWithConfirm(resetCallback);
    });

    expect(Alert.alert).toHaveBeenCalled();
    expect(resetCallback).toHaveBeenCalled();
  });

  it("should load profile and set ffdUser when isLoggedIn and role is LICENSEE", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      role: "LICENSEE",
      hasWdsfLicense: false,
      licensePhotoUri: null,
      isLoggedIn: true,
    });
    mockAuthRepository.getProfile.mockResolvedValue({
      firstName: "Jean",
      lastName: "Dupont",
      license: { number: "12345", validUntil: "2026-08-31" },
      clubName: "Club FFD",
      birthDate: "1990-05-15",
      role: "LICENSEE",
    });

    const { result } = await renderHook(() => useLicenseLogic());

    await waitFor(() => {
      expect(mockAuthRepository.getProfile).toHaveBeenCalled();
    });

    await waitFor(() => {
      const items = result.current.state.listItems;
      expect(items.length).toBeGreaterThanOrEqual(1);
      const ffdItem = items.find((i) => i.type === "FFD");
      expect(ffdItem).toBeDefined();
      expect(ffdItem?.data?.firstName).toBe("Jean");
      expect(ffdItem?.data?.lastName).toBe("Dupont");
      expect(ffdItem?.data?.licenseNumber).toBe("12345");
    });
  });
});
