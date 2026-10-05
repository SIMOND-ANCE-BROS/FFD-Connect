import React from "react";
import { renderHook } from "@testing-library/react-native";
import { AuthProvider, useAuthRepository } from "../AuthContext";

describe("AuthContext", () => {
  it("provides implementation via hook", async () => {
    const mockRepo = {
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

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider implementation={mockRepo}>{children}</AuthProvider>
    );

    const { result } = await renderHook(() => useAuthRepository(), { wrapper });
    expect(result.current).toBe(mockRepo);
  });

  it("returns AuthService as default when used outside provider", async () => {
    const { result } = await renderHook(() => useAuthRepository());
    expect(result.current).toBeDefined();
  });
});
