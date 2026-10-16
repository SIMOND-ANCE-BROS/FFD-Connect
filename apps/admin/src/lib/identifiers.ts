import type { AdminUserDetailDto, UpdateAdminUserIdentifiersDto } from '../api/generated/types.gen';

/** Same shape the backend accepts (LICENSE_NUMBER_PATTERN, 32 characters max). */
const LICENSE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;
const LICENSE_NUMBER_MAX_LENGTH = 32;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (v: string) => v.trim().toLowerCase();

/** Login email rule of #448: error message, or null when valid. */
export function validateEmail(value: string): string | null {
  return EMAIL_PATTERN.test(value.trim()) ? null : 'Adresse email invalide';
}

/** Licence number rule of #448: error message, or null when valid. */
export function validateLicenseNumber(value: string): string | null {
  const n = value.trim();
  if (!n) return 'Obligatoire';
  if (n.length > LICENSE_NUMBER_MAX_LENGTH) {
    return `${LICENSE_NUMBER_MAX_LENGTH} caractères au plus`;
  }
  return LICENSE_NUMBER_PATTERN.test(n)
    ? null
    : 'Lettres, chiffres, espaces, points, barres obliques ou tirets uniquement';
}

/** Body with only the identifiers that actually change (the email compared case-insensitively). */
export function identifiersChanges(
  user: Pick<AdminUserDetailDto, 'email' | 'licenseNumber'>,
  values: { email?: string; licenseNumber?: string },
): UpdateAdminUserIdentifiersDto {
  const email = values.email === undefined ? undefined : normalizeEmail(values.email);
  const licenseNumber = values.licenseNumber?.trim();
  return {
    ...(email !== undefined && email !== user.email.toLowerCase() && { email }),
    ...(user.licenseNumber !== null &&
      licenseNumber !== undefined &&
      licenseNumber !== user.licenseNumber && { licenseNumber }),
  };
}
