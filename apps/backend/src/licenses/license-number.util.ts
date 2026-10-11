/** Longest licence number accepted (admin input or OCR reading). */
export const LICENSE_NUMBER_MAX_LENGTH = 32;

/**
 * Shape of a licence number: starts with a letter or digit, then letters,
 * digits, spaces, dots, slashes or dashes. Shared by the administrator's
 * input (ApproveLicenseRenewalDto) and the OCR reading, so a garbled OCR
 * result is never written onto a licence, its QR code or its Wallet pass.
 */
export const LICENSE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;

/**
 * Trimmed licence number, or null when it is absent, blank, too long or not
 * shaped like a licence number (treated as unknown, never repaired).
 */
export function normalizeLicenseNumber(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (
    trimmed === undefined ||
    trimmed === "" ||
    trimmed.length > LICENSE_NUMBER_MAX_LENGTH ||
    !LICENSE_NUMBER_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}
