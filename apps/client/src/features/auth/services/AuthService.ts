import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import api from "../../../services/api";
import { clearTokens, getTokens, setTokens } from "../../../api/tokenStore";
import { clearLicenseSnapshot } from "../../license/utils/licenseSnapshot";
import { runSessionEndCleanups } from "../../../services/sessionCleanup";
import {
  registerDeviceTokenForPush,
  unregisterDeviceTokenForPush,
} from "../../settings/services/pushRegistration";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("AuthService");

const AUTH_KEY = "auth_config";
/** Sauvegarde de la session admin pendant une impersonation (#545). */
const IMPERSONATION_BACKUP_KEY = "impersonation_backup";

/**
 * Rôles utilisateur côté client.
 *
 * Correspondance métier (voir docs/regles-metier/roles.md) :
 * - Licencié (pratiquant avec licence FFD) → LICENSEE
 * - Structure / Club (représentant d’un club) → CLUB
 * - Staff (membre FFD, peut organiser des événements) → STAFF
 *
 * Backend (Prisma UserRole) : LICENSEE, CLUB, STAFF, ADMIN
 * Côté client uniquement : GUEST (invité), STAFF (UX scanner / organisateur FFD)
 */
export type UserRole = "LICENSEE" | "CLUB" | "STAFF" | "ADMIN" | "GUEST";

// ... (keep imports)

export type RegistrationPolicy =
  | "CLUB_ONLY"
  | "MEMBER_VALIDATION"
  | "MEMBER_AUTO";

export interface AuthConfig {
  isLoggedIn: boolean;
  authToken?: string;
  /** Refresh token (30 j) pour le refresh silencieux de l'access token. */
  refreshToken?: string;
  /** Active space (lot 1c): drives the tabs and each screen's variant. */
  role: UserRole;
  /** Every role of the account. Missing on old configs: falls back to [role]. */
  roles?: UserRole[];
  /** Main role of the account, the default space. */
  mainRole?: UserRole;
  /** Account of the last session, kept across logout (space memory). */
  lastUser?: string;
  /** Space of the last session, reopened at the next login of `lastUser`. */
  lastSpace?: UserRole;
  isGuest?: boolean;
  username?: string;
  clubName?: string;
  biometricsEnabled?: boolean;
  licensePhotoUri?: string;

  // Preferences
  animationsEnabled?: boolean;
  appTheme?: "light" | "dark" | "system";

  // Library
  defaultLibraryFilter?: "default" | "style" | "likes";

  // Competitions
  defaultCompetitionScope?: "all" | "registrant";
  defaultCompetitionStatus?: "UPCOMING" | "LIVE" | "PAST" | "ALL";

  // Dancer Profile
  ageGroup?: string;
  level?: string;
  category?: string;
  passportLevelLatin?: string | null;
  passportLevelStandard?: string | null;
  hasWdsfLicense?: boolean;

  // Organizer Specific
  registrationPolicy?: RegistrationPolicy;
  clubLogoUri?: string;

  // Club dashboard preferences (per user, JSON stringified config)
  clubDashboardConfig?: string;

  lastLoginDate?: string;

  /** Session d'impersonation en cours (#545) : on agit « en tant que » un tiers. */
  impersonating?: boolean;
  /** Nom affiché de la cible impersonnée (pour le bandeau). */
  impersonatedName?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** Every role of the account; absent on an older backend. */
  roles?: UserRole[];
  clubName?: string;
  birthDate?: string;
  category?: string | null;
  ageGroup?: string | null;
  passportLevelLatin?: string | null;
  passportLevelStandard?: string | null;
  license?: {
    number: string;
    validUntil: string;
    type?: string;
    /** QR signé par le serveur (#168) — absent/null si backend ancien ou signature désactivée. */
    qrCode?: string | null;
  } | null;
  wdsf?: {
    min: string;
    nationality?: string | null;
    licenseType?: string | null;
    ageGroup?: string | null;
    expiresOn?: string | null;
  } | null;
}

export interface WdsfVerifyResponse {
  firstName: string;
  lastName: string;
  licenseNumber: string;
  type: string;
  structure: string;
  validUntil: string;
  birthDate: string;
  country?: string;
  status: string;
  ageGroup?: string;
  partnerName?: string;
  partnerAgeGroup?: string;
  photoUrl?: string;
}

interface ApiErrorData {
  message?: string;
  errors?: string[];
}

interface LoginResponseUser {
  role: UserRole;
  roles?: UserRole[];
  clubName?: string;
  category?: string;
  ageGroup?: string;
  passportLevelLatin?: string | null;
  passportLevelStandard?: string | null;
  email: string;
}

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: LoginResponseUser;
}

/** Which space to open: the previous one of the same account if still held, else the main role. */
export function resolveSpace(o: {
  previousSpace?: UserRole;
  previousUser?: string;
  user: string;
  mainRole: UserRole;
  roles: UserRole[];
}): UserRole {
  return o.previousUser === o.user &&
    o.previousSpace &&
    o.roles.includes(o.previousSpace)
    ? o.previousSpace
    : o.mainRole;
}

const rolesFrom = (u: { role: UserRole; roles?: UserRole[] }): UserRole[] =>
  u.roles?.length ? u.roles : [u.role];

/**
 * The session `resolveSpace` compares with: the current one while logged in,
 * else the one logout kept in `lastUser` / `lastSpace`.
 */
export function previousSession(c: AuthConfig): {
  previousUser?: string;
  previousSpace?: UserRole;
} {
  return c.username
    ? { previousUser: c.username, previousSpace: c.role }
    : { previousUser: c.lastUser, previousSpace: c.lastSpace };
}

const sameRoles = (a: readonly UserRole[] | undefined, b: UserRole[]) =>
  !!a && a.length === b.length && a.every((r, i) => r === b[i]);

export const DEFAULT_CONFIG: AuthConfig = {
  isLoggedIn: false,
  role: "LICENSEE",
  isGuest: false,
  biometricsEnabled: false,
  animationsEnabled: true,
  hasWdsfLicense: false,
  registrationPolicy: "MEMBER_VALIDATION",
  appTheme: "system",
};

export const AuthService = {
  getAuthConfig: async (): Promise<AuthConfig> => {
    try {
      const [json, tokens] = await Promise.all([
        AsyncStorage.getItem(AUTH_KEY),
        getTokens(),
      ]);
      const prefs = json
        ? (JSON.parse(json) as Partial<AuthConfig>)
        : undefined;
      return {
        ...DEFAULT_CONFIG,
        ...prefs,
        // Tokens live in SecureStore, not the AsyncStorage prefs blob.
        authToken: tokens.authToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      logger.error("Failed to load auth config", error);
    }
    return DEFAULT_CONFIG;
  },

  saveAuthConfig: async (config: AuthConfig): Promise<void> => {
    try {
      // Split secrets (SecureStore) from preferences (AsyncStorage). setTokens
      // never deletes on undefined → a plain preference update can't wipe the
      // session. Explicit logout/refresh-failure call clearTokens().
      const { authToken, refreshToken, ...prefs } = config;
      await Promise.all([
        AsyncStorage.setItem(AUTH_KEY, JSON.stringify(prefs)),
        setTokens({ authToken, refreshToken }),
      ]);
    } catch (error) {
      logger.error("Failed to save auth config", error);
    }
  },

  /**
   * Log in the user via Backend API.
   */
  login: async (username: string, password?: string): Promise<void> => {
    try {
      const response = await api.post<LoginResponse>("/auth/login", {
        username,
        password,
      });

      const { access_token, refresh_token, user } = response.data;
      // ... (rest of logic)

      const currentConfig = await AuthService.getAuthConfig();
      const roles = rolesFrom(user);

      const newConfig: AuthConfig = {
        ...currentConfig,
        isLoggedIn: true,
        authToken: access_token,
        refreshToken: refresh_token,
        role: resolveSpace({
          ...previousSession(currentConfig),
          user: user.email,
          mainRole: user.role,
          roles,
        }),
        roles,
        mainRole: user.role,
        clubName: user.clubName, // Save clubName
        category: user.category ?? undefined,
        ageGroup: user.ageGroup ?? undefined,
        passportLevelLatin: user.passportLevelLatin ?? undefined,
        passportLevelStandard: user.passportLevelStandard ?? undefined,
        isGuest: false,
        username: user.email,
        lastLoginDate: new Date().toISOString(),
      };
      await AuthService.saveAuthConfig(newConfig);
      logger.info(`User logged in: ${username} (Role: ${user.role})`);
      // Fire-and-forget: a push registration must never delay or fail a
      // login. The module swallows its own errors and is a no-op on builds
      // without Firebase (plugins are gated per variant in app.config.js).
      void registerDeviceTokenForPush();
    } catch (error: unknown) {
      let message = "Unknown error";
      let status: number | undefined;

      if (axios.isAxiosError(error)) {
        status = error.response?.status;
        const data = error.response?.data as { message?: string } | undefined;
        message = data?.message ?? error.message;
      } else if (error instanceof Error) {
        message = error.message;
      }

      if (status === 401) {
        message = "Identifiant ou mot de passe incorrect";
      }

      logger.info("Login attempt", { email: username });
      throw new Error(message); // Propagate to UI with friendly message
    }
  },

  /**
   * Register a new user with license verification.
   */
  register: async (
    email: string,
    password: string,
    licenseNumber: string,
    lastName: string,
    firstName: string,
  ): Promise<void> => {
    try {
      const response = await api.post<LoginResponse>("/auth/register", {
        email,
        password,
        licenseNumber,
        lastName,
        firstName,
      });

      const { access_token, refresh_token, user } = response.data;

      const currentConfig = await AuthService.getAuthConfig();
      const roles = rolesFrom(user);

      const newConfig: AuthConfig = {
        ...currentConfig,
        isLoggedIn: true,
        authToken: access_token,
        refreshToken: refresh_token,
        role: resolveSpace({
          ...previousSession(currentConfig),
          user: user.email,
          mainRole: user.role,
          roles,
        }),
        roles,
        mainRole: user.role,
        clubName: user.clubName,
        category: user.category ?? undefined,
        ageGroup: user.ageGroup ?? undefined,
        isGuest: false,
        username: user.email,
        lastLoginDate: new Date().toISOString(),
      };
      await AuthService.saveAuthConfig(newConfig);
      // Même raison qu'au login : un nouvel inscrit est connecté dès ici, sans
      // repasser par login(), donc sans cet appel il n'enregistrerait son
      // appareil qu'à sa deuxième session.
      void registerDeviceTokenForPush();
      logger.info(`User registered: ${email} (Role: ${user.role})`);
    } catch (error: unknown) {
      let message = "Erreur lors de l'inscription";

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data as
          | { message?: string; errors?: string[] }
          | undefined;

        if (status === 404) {
          message = "Numéro de licence introuvable. Vérifiez votre numéro FFD.";
        } else if (status === 409) {
          message = data?.message ?? "Email ou licence déjà utilisé";
        } else if (status === 400) {
          message =
            data?.errors?.join("\n") ?? data?.message ?? "Données invalides";
        } else {
          message = data?.message ?? error.message;
        }
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  },

  /**
   * Log in as Guest.
   */
  loginAsGuest: async (): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      isLoggedIn: true, // Guest is technically logged in for navigation purposes
      role: "GUEST",
      isGuest: true,
      username: undefined,
      lastLoginDate: new Date().toISOString(),
    };
    await AuthService.saveAuthConfig(newConfig);
    logger.info("User logged in as Guest");
  },

  /**
   * Impersonation « se connecter en tant que » (#545, admin). Sauvegarde la
   * session admin, échange le token contre celui de la cible (court, sans
   * refresh) et bascule la config. L'appelant refreshAuth() ensuite.
   */
  impersonate: async (
    targetUserId: string,
    targetName: string,
    reason?: string,
  ): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    // Sauvegarde la session admin (tokens inclus) pour pouvoir revenir.
    await AsyncStorage.setItem(
      IMPERSONATION_BACKUP_KEY,
      JSON.stringify(currentConfig),
    );

    const response = await api.post<{
      access_token: string;
      user: {
        role: UserRole;
        roles?: UserRole[];
        email: string;
        clubName?: string | null;
        firstName?: string;
        lastName?: string;
      };
    }>("/auth/impersonate", { targetUserId, reason });
    const { access_token, user } = response.data;

    // Bascule : on efface les tokens admin (dont le refresh, pour éviter un
    // refresh silencieux qui reviendrait admin) puis on pose le token court.
    await clearTokens();
    const impConfig: AuthConfig = {
      ...currentConfig,
      isLoggedIn: true,
      authToken: access_token,
      refreshToken: undefined,
      // An impersonation always opens on the target's main role.
      role: user.role,
      roles: rolesFrom(user),
      mainRole: user.role,
      clubName: user.clubName ?? undefined,
      username: user.email,
      isGuest: false,
      impersonating: true,
      impersonatedName: targetName,
    };
    await AuthService.saveAuthConfig(impConfig);
    logger.info(`Impersonation started → ${targetName}`);
  },

  /** Arrête l'impersonation et restaure la session admin d'origine. */
  stopImpersonation: async (): Promise<void> => {
    try {
      await api.post("/auth/impersonate/stop", {});
    } catch {
      // best-effort : on restaure la session quoi qu'il arrive
    }
    const backup = await AsyncStorage.getItem(IMPERSONATION_BACKUP_KEY);
    await clearTokens();
    if (backup) {
      try {
        const cfg = JSON.parse(backup) as AuthConfig;
        await AuthService.saveAuthConfig(cfg);
      } catch {
        /* backup illisible — l'utilisateur devra se reconnecter */
      }
      await AsyncStorage.removeItem(IMPERSONATION_BACKUP_KEY);
    }
    logger.info("Impersonation stopped");
  },

  /**
   * Log out the user.
   */
  logout: async (): Promise<void> => {
    try {
      const currentConfig = await AuthService.getAuthConfig();
      // Biometric quick-login re-uses the retained token (handleBiometricLogin →
      // getProfile). So when Face ID / Touch ID is enabled, logout LOCKS the app
      // (isLoggedIn=false) but keeps the tokens in the Keychain so the user can
      // unlock with biometrics. Without biometrics, logout fully wipes the tokens.
      const keepTokensForBiometrics = currentConfig.biometricsEnabled === true;
      const newConfig: AuthConfig = {
        ...currentConfig,
        isLoggedIn: false,
        authToken: keepTokensForBiometrics
          ? currentConfig.authToken
          : undefined,
        refreshToken: keepTokensForBiometrics
          ? currentConfig.refreshToken
          : undefined,
        role: "LICENSEE",
        roles: undefined,
        mainRole: undefined,
        isGuest: false,
        username: undefined,
        // Space memory: the next login of this account (password or
        // biometrics) reopens this space. A guest logout keeps the previous.
        lastUser: currentConfig.username ?? currentConfig.lastUser,
        lastSpace: currentConfig.username
          ? currentConfig.role
          : currentConfig.lastSpace,
      };
      if (!keepTokensForBiometrics) {
        // Before clearTokens(): the unregister call is authenticated, so it
        // has to go out while the JWT is still valid. Only on a full logout —
        // the biometric path merely LOCKS the app for the same user, and
        // dropping the token there would kill push for Face ID users, who are
        // precisely the ones reopening the app most often.
        await unregisterDeviceTokenForPush();
        // Explicit clear — setTokens never deletes on undefined.
        await clearTokens();
        // PII locale : le snapshot E-Licence hors-ligne (#416) part avec la
        // session. Conservé en mode biométrie (même utilisateur au déverrouillage).
        await clearLicenseSnapshot();
        // La file hors-ligne (#416) part avec les tokens : `clearTokens` la
        // purge, pour couvrir aussi les fins de session qui ne passent pas
        // par ici (refresh token expiré, bascules d'impersonation). Rien à
        // faire de plus ici — et le chemin biométrique, qui n'appelle pas
        // `clearTokens`, conserve donc la file : même utilisateur au
        // déverrouillage.
      }
      await AuthService.saveAuthConfig(newConfig);
      // Cache serveur (mémoire + AsyncStorage) : vidé à chaque déconnexion,
      // biométrie comprise — il se recharge au déverrouillage.
      await runSessionEndCleanups();
      logger.info(
        `User logged out (tokens ${keepTokensForBiometrics ? "kept for biometrics" : "cleared"})`,
      );
    } catch (error) {
      logger.error("Failed to logout", error);
    }
  },

  /** Switch the active space (display only; the server checks every role). */
  setActiveSpace: async (space: UserRole): Promise<void> => {
    const config = await AuthService.getAuthConfig();
    if (!(config.roles ?? [config.role]).includes(space)) return;
    await AuthService.saveAuthConfig({ ...config, role: space });
  },

  /**
   * Picks up a role change made in the back-office without a re-login, from a
   * `/users/me` profile the caller already fetched (no request of its own).
   * Keeps the active space if still held, else opens the main role. The
   * caller then refreshAuth(). No-op when logged out, as a guest, or when
   * nothing changed.
   */
  syncRolesFromProfile: async (
    profile: Pick<UserProfile, "email" | "role" | "roles">,
  ): Promise<AuthConfig> => {
    const config = await AuthService.getAuthConfig();
    if (!config.isLoggedIn || config.isGuest) return config;
    const roles = rolesFrom(profile);
    const role = resolveSpace({
      previousSpace: config.role,
      previousUser: config.username,
      user: profile.email,
      mainRole: profile.role,
      roles,
    });
    if (
      sameRoles(config.roles, roles) &&
      config.mainRole === profile.role &&
      config.role === role
    ) {
      return config;
    }
    const next: AuthConfig = { ...config, roles, mainRole: profile.role, role };
    await AuthService.saveAuthConfig(next);
    return next;
  },

  /**
   * Enable or disable biometrics.
   */
  setBiometricsEnabled: async (enabled: boolean): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      biometricsEnabled: enabled,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set the license photo URI.
   */
  setLicensePhoto: async (uri: string | null): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      licensePhotoUri: uri ?? undefined, // undefined to remove key if null
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set the default library filter.
   */
  setDefaultLibraryFilter: async (
    filter: "default" | "style" | "likes",
  ): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      defaultLibraryFilter: filter,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set the default competition scope.
   */
  setDefaultCompetitionScope: async (
    scope: "all" | "registrant",
  ): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      defaultCompetitionScope: scope,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set the default competition status.
   */
  setDefaultCompetitionStatus: async (
    status: "UPCOMING" | "LIVE" | "PAST" | "ALL",
  ): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      defaultCompetitionStatus: status,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  setAppTheme: async (theme: "light" | "dark" | "system"): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      appTheme: theme,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set animations enabled preference.
   */
  setAnimationsEnabled: async (enabled: boolean): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      animationsEnabled: enabled,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set dancer profile information.
   */
  setDancerProfile: async (profile: {
    ageGroup?: string;
    level?: string;
    category?: string;
  }): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      ...profile,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  setWdsfLicenseEnabled: async (enabled: boolean): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      hasWdsfLicense: enabled,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set Registration Policy for Club Organizer
   */
  setRegistrationPolicy: async (policy: RegistrationPolicy): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      registrationPolicy: policy,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Set the club logo image (for organizers). Same pattern as license photo.
   */
  setClubLogo: async (uri: string | null): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      clubLogoUri: uri ?? undefined,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  /**
   * Raw getter/setter for club dashboard config.
   * The client is responsible for serializing/deserializing the structure.
   */
  getClubDashboardConfig: async (): Promise<string | null> => {
    const currentConfig = await AuthService.getAuthConfig();
    return currentConfig.clubDashboardConfig ?? null;
  },

  setClubDashboardConfig: async (config: string): Promise<void> => {
    const currentConfig = await AuthService.getAuthConfig();
    const newConfig: AuthConfig = {
      ...currentConfig,
      clubDashboardConfig: config,
    };
    await AuthService.saveAuthConfig(newConfig);
  },

  getProfile: async (): Promise<UserProfile> => {
    try {
      const response = await api.get<UserProfile>("/users/me");
      return response.data;
    } catch (error) {
      logger.error("Failed to fetch profile", error);
      throw error;
    }
  },

  verifyWdsfLicense: async (min: string): Promise<WdsfVerifyResponse> => {
    try {
      const response = await api.get<WdsfVerifyResponse>(
        `/wdsf/athlete/${min}`,
      );
      return response.data;
    } catch (error: unknown) {
      logger.error("Failed to verify WDSF license", error);
      let message = "Numéro MIN invalide ou introuvable.";

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          message = "Connectez-vous pour ajouter une licence WDSF.";
        } else {
          const data = error.response?.data as ApiErrorData | undefined;
          message = data?.message ?? message;
        }
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  },

  /**
   * Enregistre la licence WDSF sur le profil backend (PATCH /users/me).
   * À appeler après une vérification WDSF réussie pour que la fiche membre l'affiche.
   */
  saveWdsfToBackend: async (
    wdsf: {
      min: string;
      nationality?: string | null;
      licenseType?: string | null;
      ageGroup?: string | null;
      expiresOn?: string | null;
    } | null,
  ): Promise<void> => {
    try {
      await api.patch("/users/me", { wdsf });
    } catch (error: unknown) {
      // Surface the server reason (e.g. WDSF_NAME_MISMATCH) instead of axios's
      // generic "Request failed with status code 400".
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as ApiErrorData | undefined;
        if (data?.message) throw new Error(data.message);
      }
      throw error;
    }
  },

  /**
   * Demande une réinitialisation de mot de passe
   */
  forgotPassword: async (email: string): Promise<void> => {
    try {
      await api.post("/auth/forgot-password", { email });
      logger.info(`Password reset requested for ${email}`);
    } catch (error: unknown) {
      logger.error("Failed to request password reset", error);
      let message = "Erreur lors de la demande de réinitialisation.";

      if (axios.isAxiosError(error)) {
        const data = error.response?.data as ApiErrorData | undefined;
        message = data?.message ?? message;
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  },

  /**
   * Réinitialise le mot de passe avec un token
   */
  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    try {
      await api.post("/auth/reset-password", {
        token,
        newPassword,
      });
      logger.info("Password reset successfully");
    } catch (error: unknown) {
      logger.error("Failed to reset password", error);
      let message = "Erreur lors de la réinitialisation du mot de passe.";

      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data as ApiErrorData | undefined;
        if (errorData?.errors && Array.isArray(errorData.errors)) {
          // Afficher les erreurs de validation du mot de passe
          message = errorData.errors.join("\n");
        } else {
          message = errorData?.message ?? message;
        }
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  },

  /**
   * Change le mot de passe (utilisateur authentifié)
   */
  changePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    try {
      await api.post("/auth/change-password", {
        currentPassword,
        newPassword,
      });
      logger.info("Password changed successfully");
    } catch (error: unknown) {
      logger.error("Failed to change password", error);
      let message = "Erreur lors du changement de mot de passe.";

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data as ApiErrorData | undefined;

        if (status === 401) {
          message = "Mot de passe actuel incorrect.";
        } else if (errorData?.errors && Array.isArray(errorData.errors)) {
          // Afficher les erreurs de validation du mot de passe
          message = errorData.errors.join("\n");
        } else {
          message = errorData?.message ?? message;
        }
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  },
};
