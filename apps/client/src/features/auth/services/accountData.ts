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
