import { useMediaQuery } from '@mantine/hooks';

/** Below Mantine's `sm` breakpoint (48em = 768 px): phones and small windows. */
export const MOBILE_QUERY = '(max-width: 47.99em)';

/**
 * True on a phone-sized viewport. Read synchronously on the first render so a
 * phone never flashes the desktop table before switching to cards.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY, false, { getInitialValueInEffect: false }) ?? false;
}
