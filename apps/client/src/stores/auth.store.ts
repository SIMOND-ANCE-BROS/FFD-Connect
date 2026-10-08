import { create } from "zustand";
import { NotificationTarget } from "../features/settings/services/notificationTarget";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AuthRole = "LICENSEE" | "ADMIN" | "GUEST" | "CLUB" | "STAFF";

const KNOWN_ROLES: AuthRole[] = ["LICENSEE", "ADMIN", "GUEST", "CLUB", "STAFF"];

interface AuthState {
  isLoggedIn: boolean | null;
  /** Active space: drives the tabs and each screen's variant. */
  role: AuthRole | null;
  /** Every role the account holds (the actions follow these). */
  roles: AuthRole[];
  /** Main role of the account, the default space. */
  mainRole: AuthRole | null;
  hasRole: (role: AuthRole) => boolean;
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

export const useAuthStore = create<AuthState>((set, get) => ({
  isLoggedIn: null,
  role: null,
  roles: [],
  mainRole: null,
  hasRole: (r) => get().roles.includes(r),
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
          roles?: string[];
          mainRole?: string;
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
        const parsedRoles = (config.roles ?? []).filter((r): r is AuthRole =>
          KNOWN_ROLES.includes(r as AuthRole),
        );
        const roles: AuthRole[] = parsedRoles.length
          ? parsedRoles
          : role
            ? [role]
            : [];
        const mainRole: AuthRole | null =
          config.mainRole && KNOWN_ROLES.includes(config.mainRole as AuthRole)
            ? (config.mainRole as AuthRole)
            : role;
        // A space the account no longer holds falls back to the main role.
        const space: AuthRole | null =
          role && roles.includes(role) ? role : mainRole;
        set({
          isLoggedIn: config.isLoggedIn ?? false,
          role: space,
          roles,
          mainRole,
          isGuest,
          impersonating: config.impersonating ?? false,
          impersonatedName: config.impersonatedName ?? null,
        });
      } else {
        set({
          isLoggedIn: false,
          role: null,
          roles: [],
          mainRole: null,
          isGuest: false,
          impersonating: false,
          impersonatedName: null,
        });
      }
    } catch {
      set({
        isLoggedIn: false,
        role: null,
        roles: [],
        mainRole: null,
        isGuest: false,
        impersonating: false,
        impersonatedName: null,
      });
    }
  },
  setPendingDeepLink: (link) => set({ pendingDeepLink: link }),
}));
