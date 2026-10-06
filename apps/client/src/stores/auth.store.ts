import { create } from "zustand";
import { NotificationTarget } from "../features/settings/services/notificationTarget";
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
  /**
   * Destination à ouvrir dès que l'utilisateur est connecté (#84).
   *
   * Portait un simple nom d'écran, donc sans paramètres — impossible d'ouvrir
   * une compétition précise. Et surtout : RIEN ne l'alimentait, le seul écrit
   * du dépôt le remettait à `null`. Le tap sur une push système ouvrait donc
   * l'application sans aller nulle part.
   */
  pendingDeepLink: NotificationTarget | null;
  refreshAuth: () => Promise<void>;
  setPendingDeepLink: (link: NotificationTarget | null) => void;
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
