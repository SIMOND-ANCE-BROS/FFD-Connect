import type { AuthConfig } from "./AuthService";

/**
 * The account's own identity and profile fields in `auth_config`. Kept in a
 * module without runtime imports so sessionRefresh, which must not import
 * AuthService at runtime (import cycle), shares these helpers (#910).
 */
const ACCOUNT_DATA_FIELDS = [
  "username",
  "userId",
  "clubName",
  "ageGroup",
  "level",
  "category",
  "passportLevelLatin",
  "passportLevelStandard",
  "hasWdsfLicense",
  "licensePhotoUri",
  "registrationPolicy",
  "clubLogoUri",
  "clubDashboardConfig",
] as const satisfies readonly (keyof AuthConfig)[];

/**
 * The impersonated account's own data a session end must not leave on the
 * admin's device (#599, #910): identity and profile fields of a third party,
 * maybe a minor.
 */
export function withoutAccountData<T extends Partial<AuthConfig>>(
  config: T,
): T {
  const stripped = { ...config };
  for (const field of ACCOUNT_DATA_FIELDS) {
    stripped[field] = undefined;
  }
  return stripped;
}

/**
 * The device-level preferences that carry into a support access (#879) and
 * survive one ended without the admin's backup (#910): an allowlist, so a
 * profile field added to AuthConfig later never crosses an identity change
 * by default. Everything else (identity, roles, licence photo, dancer
 * profile, club settings, space memory…) belongs to an account.
 */
export function devicePreferencesOf(
  config: Partial<AuthConfig>,
): Partial<AuthConfig> {
  return {
    animationsEnabled: config.animationsEnabled,
    appTheme: config.appTheme,
    biometricsEnabled: config.biometricsEnabled,
    defaultLibraryFilter: config.defaultLibraryFilter,
    defaultCompetitionScope: config.defaultCompetitionScope,
    defaultCompetitionStatus: config.defaultCompetitionStatus,
  };
}

/**
 * What a session end leaves for an account that may still exist: logout()
 * and the session ends without it (refused refresh, unreadable token store)
 * share it, so neither keeps more of the account than the other (#935). No
 * identity nor roles; the e-mail survives only as the space memory of the
 * next login (`lastUser` / `lastSpace`). The account's local settings
 * (licence photo, club settings…) stay for its next login: a deleted
 * account's go through AuthService.endDeletedAccountSession instead.
 */
export function loggedOutConfigOf<T extends Partial<AuthConfig>>(config: T): T {
  return {
    ...config,
    isLoggedIn: false,
    role: "LICENSEE",
    roles: undefined,
    mainRole: undefined,
    isGuest: false,
    username: undefined,
    userId: undefined,
    impersonating: undefined,
    impersonatedName: undefined,
    // A guest session (no username) keeps the previous memory.
    lastUser: config.username ?? config.lastUser,
    lastSpace: config.username ? config.role : config.lastSpace,
  };
}
