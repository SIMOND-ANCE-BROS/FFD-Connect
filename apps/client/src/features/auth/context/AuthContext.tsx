import React, { createContext, ReactNode, useContext } from "react";
import {
  AuthConfig,
  RegistrationPolicy,
  UserProfile,
  UserRole,
  WdsfVerifyResponse,
  AuthService,
} from "../services/AuthService";

export type { UserRole };

export interface AuthRepository {
  getAuthConfig(): Promise<AuthConfig>;
  saveAuthConfig(config: AuthConfig): Promise<void>;
  login(username: string, password?: string): Promise<void>;
  register(
    email: string,
    password: string,
    licenseNumber: string,
    lastName: string,
    firstName: string,
  ): Promise<void>;
  loginAsGuest(): Promise<void>;
  logout(): Promise<void>;
  setBiometricsEnabled(enabled: boolean): Promise<void>;
  setLicensePhoto(uri: string | null): Promise<void>;
  setDefaultLibraryFilter(filter: "default" | "style" | "likes"): Promise<void>;
  setDefaultCompetitionScope(scope: "all" | "registrant"): Promise<void>;
  setDefaultCompetitionStatus(
    status: "UPCOMING" | "LIVE" | "PAST" | "ALL",
  ): Promise<void>;
  setAppTheme(theme: "light" | "dark" | "system"): Promise<void>;
  setAnimationsEnabled(enabled: boolean): Promise<void>;
  setDancerProfile(profile: {
    ageGroup?: string;
    level?: string;
    category?: string;
  }): Promise<void>;
  setWdsfLicenseEnabled(enabled: boolean): Promise<void>;
  setRegistrationPolicy(policy: RegistrationPolicy): Promise<void>;
  setClubLogo(uri: string | null): Promise<void>;
  getProfile(): Promise<UserProfile>;
  /** Applies the roles of a fetched `/users/me` profile (no request). */
  syncRolesFromProfile(
    profile: Pick<UserProfile, "email" | "role" | "roles" | "isStoreReview">,
  ): Promise<AuthConfig>;
  verifyWdsfLicense(min: string): Promise<WdsfVerifyResponse>;
  /** Enregistre la licence WDSF sur le profil backend (après vérification). */
  saveWdsfToBackend(
    wdsf: {
      min: string;
      nationality?: string | null;
      licenseType?: string | null;
      ageGroup?: string | null;
      expiresOn?: string | null;
    } | null,
  ): Promise<void>;
  /** Configuration du dashboard club (ordre + visibilité des widgets), stockée par utilisateur. */
  getClubDashboardConfig(): Promise<string | null>;
  setClubDashboardConfig(config: string): Promise<void>;
}

const AuthContext = createContext<AuthRepository | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  implementation: AuthRepository;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  implementation,
}) => {
  return (
    <AuthContext.Provider value={implementation}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthRepository = (): AuthRepository => {
  const context = useContext(AuthContext);
  if (!context) {
    return AuthService;
  }
  return context;
};
