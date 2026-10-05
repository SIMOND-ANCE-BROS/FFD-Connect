import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { AuthProvider } from "../../features/auth/context/AuthContext";
import { ThemeProvider, useTheme } from "../ThemeContext";

jest.mock("react-native", (): Record<string, unknown> => {
  const actual: Record<string, unknown> = jest.requireActual(
    "@react-native/jest-preset/jest/mock",
  );
  return {
    ...actual,
    Platform: { OS: "ios", select: (obj: Record<string, unknown>) => obj.ios },
    useColorScheme: jest.fn(() => "dark"),
  };
});

describe("ThemeContext", () => {
  const mockAuth = {
    getAuthConfig: jest.fn(),
    saveAuthConfig: jest.fn(),
    login: jest.fn(),
    loginAsGuest: jest.fn(),
    logout: jest.fn(),
    setBiometricsEnabled: jest.fn(),
    setLicensePhoto: jest.fn(),
    setDefaultLibraryFilter: jest.fn(),
    setDefaultCompetitionScope: jest.fn(),
    setDefaultCompetitionStatus: jest.fn(),
    setAppTheme: jest.fn(),
    setAnimationsEnabled: jest.fn(),
    setDancerProfile: jest.fn(),
    setWdsfLicenseEnabled: jest.fn(),
    setRegistrationPolicy: jest.fn(),
    getProfile: jest.fn(),
    verifyWdsfLicense: jest.fn(),
    setClubLogo: jest.fn(),
    saveWdsfToBackend: jest.fn(),
    getClubDashboardConfig: jest.fn(),
    setClubDashboardConfig: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.getAuthConfig.mockResolvedValue({
      appTheme: "system",
      animationsEnabled: true,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider implementation={mockAuth}>
      <ThemeProvider>{children}</ThemeProvider>
    </AuthProvider>
  );

  it("loads theme preference and toggles settings", async () => {
    const { result } = await renderHook(() => useTheme(), { wrapper });

    await act(async () => {
      await waitFor(() => {
        expect(result.current.preference).toBe("system");
      });
    });

    await act(async () => {
      await result.current.setPreference("dark");
    });
    expect(mockAuth.setAppTheme).toHaveBeenCalledWith("dark");

    await act(async () => {
      await result.current.toggleAnimations();
    });
    expect(mockAuth.setAnimationsEnabled).toHaveBeenCalled();
  });
});
