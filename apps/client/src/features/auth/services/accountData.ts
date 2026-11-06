import type { AuthConfig } from "./AuthService";

/**
 * The account's own identity and profile fields in `auth_config`. Kept in a
 * module without runtime imports so sessionRefresh, which must not import
 * AuthService (import cycle), strips the same list (#910).
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
