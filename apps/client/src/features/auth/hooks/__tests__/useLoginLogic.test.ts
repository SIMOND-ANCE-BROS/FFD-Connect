import { act, renderHook, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import rnBiometrics from "../../../../utils/biometrics-adapter";
import * as AuthContext from "../../context/AuthContext";
import { useLoginLogic } from "../useLoginLogic";

// Mock Dependencies
jest.mock("../../../../utils/biometrics-adapter", () => ({
  isSensorAvailable: jest.fn().mockResolvedValue({ available: false }),
  simplePrompt: jest.fn().mockResolvedValue({ success: false }),
}));

jest.mock("../../context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));

jest.mock("react-native", () => ({
  Alert: {
    alert: jest.fn(),
  },
  Platform: {
    OS: "ios",
  },
}));

// Mock the Zustand auth store
const mockRefreshAuth = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../../stores/auth.store", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ refreshAuth: mockRefreshAuth }),
}));

describe("useLoginLogic", () => {
  const mockNavigation = {
    replace: jest.fn(),
    navigate: jest.fn(),
  } as unknown as NonNullable<
    Parameters<typeof useLoginLogic>[0]
  >["navigation"];

  const mockAuthRepository = {
    login: jest.fn(),
    loginAsGuest: jest.fn(),
    getAuthConfig: jest.fn().mockResolvedValue({
      biometricsEnabled: false,
      isLoggedIn: false,
    }),
    saveAuthConfig: jest.fn(),
    getProfile: jest.fn(),
    logout: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (AuthContext.useAuthRepository as jest.Mock).mockReturnValue(
      mockAuthRepository,
    );
  });

  describe("Initialization", () => {
    it("checks for biometric availability on mount", async () => {
      (rnBiometrics.isSensorAvailable as jest.Mock).mockResolvedValue({
        available: true,
      });
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        biometricsEnabled: true,
      });

      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await waitFor(() => {
        expect(result.current.state.isBiometricAvailable).toBe(true);
      });
    });

    it("auto-logins if biometrics enabled and user was logged in", async () => {
      (rnBiometrics.isSensorAvailable as jest.Mock).mockResolvedValue({
        available: true,
      });
      (rnBiometrics.simplePrompt as jest.Mock).mockResolvedValue({
        success: true,
      });
      mockAuthRepository.getAuthConfig.mockResolvedValue({
        biometricsEnabled: true,
        isLoggedIn: true,
      });
      mockAuthRepository.getProfile.mockResolvedValue({
        email: "test@test.com",
        role: "LICENSEE",
      });

      await renderHook(() => useLoginLogic({ navigation: mockNavigation }));

      await waitFor(() => {
        expect(rnBiometrics.simplePrompt).toHaveBeenCalled();
        expect(mockRefreshAuth).toHaveBeenCalled();
      });
    });
  });

  describe("handleLogin", () => {
    it("shows alert for invalid form", async () => {
      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        await result.current.actions.onLogin();
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        "Erreur de validation",
        expect.any(String),
      );
    });

    it("handles successful login", async () => {
      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.actions.setUsername("test@test.com");
        result.current.actions.setPassword("password123");
      });

      mockAuthRepository.login.mockResolvedValueOnce(undefined);
      mockAuthRepository.getAuthConfig.mockResolvedValueOnce({
        role: "LICENSEE",
      });

      await act(async () => {
        await result.current.actions.onLogin();
      });

      expect(mockAuthRepository.login).toHaveBeenCalledWith(
        "test@test.com",
        "password123",
      );
      expect(mockRefreshAuth).toHaveBeenCalled();
    });

    it("handles login failure", async () => {
      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.actions.setUsername("test@test.com");
        result.current.actions.setPassword("password123");
      });

      mockAuthRepository.login.mockRejectedValueOnce(
        new Error("Invalid credentials"),
      );

      await act(async () => {
        await result.current.actions.onLogin();
      });

      expect(Alert.alert).toHaveBeenCalledWith("Échec", "Invalid credentials");
      expect(result.current.state.loading).toBe(false);
    });
  });

  describe("handleGuestLogin", () => {
    it("handles successful guest login", async () => {
      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await act(async () => {
        await result.current.actions.onGuestLogin();
      });

      expect(mockAuthRepository.loginAsGuest).toHaveBeenCalled();
      expect(mockRefreshAuth).toHaveBeenCalled();
    });
  });

  describe("handleForgotPassword", () => {
    it("navigates to ForgotPassword", async () => {
      const { result } = await renderHook(() =>
        useLoginLogic({ navigation: mockNavigation }),
      );

      await act(() => {
        result.current.actions.onForgotPassword();
      });

      expect(mockNavigation.navigate).toHaveBeenCalledWith("ForgotPassword");
    });
  });
});
