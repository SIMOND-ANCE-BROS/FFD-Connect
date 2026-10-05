import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AuthRole = "LICENSEE" | "ADMIN" | "GUEST" | "CLUB" | "STAFF";

const KNOWN_ROLES: AuthRole[] = ["LICENSEE", "ADMIN", "GUEST", "CLUB", "STAFF"];

interface AuthState {
  isLoggedIn: boolean | null;
  role: AuthRole | null;
  isGuest: boolean;
  /** Session d'impersonation en cours (#545). */
  impersonating: boolean;
  impersonatedName: string | null;
  pendingDeepLink: string | null;
  refreshAuth: () => Promise<void>;
  setPendingDeepLink: (link: string | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: null,
  role: null,
  isGuest: false,
  impersonating: false,
  impersonatedName: null,
  pendingDeepLink: null,
  refreshAuth: async () => {
    try {
      const json = await AsyncStorage.getItem("auth_config");
      if (json) {
        const config = JSON.parse(json) as {
          isLoggedIn?: boolean;
          role?: string;
          isGuest?: boolean;
          impersonating?: boolean;
          impersonatedName?: string;
        };
        const isGuest = config.isGuest ?? false;
        const role: AuthRole | null =
          config.role && KNOWN_ROLES.includes(config.role as AuthRole)
            ? (config.role as AuthRole)
            : isGuest
              ? "GUEST"
              : null;
        set({
          isLoggedIn: config.isLoggedIn ?? false,
          role,
          isGuest,
          impersonating: config.impersonating ?? false,
          impersonatedName: config.impersonatedName ?? null,
        });
      } else {
        set({
          isLoggedIn: false,
          role: null,
          isGuest: false,
          impersonating: false,
          impersonatedName: null,
        });
      }
    } catch {
      set({
        isLoggedIn: false,
        role: null,
        isGuest: false,
        impersonating: false,
        impersonatedName: null,
      });
    }
  },
  setPendingDeepLink: (link) => set({ pendingDeepLink: link }),
}));
