import { vi } from 'vitest';
import { MOBILE_QUERY } from '../lib/useIsMobile';

/**
 * Makes `useIsMobile()` true for the next renders: jsdom's matchMedia stub
 * (vitest.setup.ts) matches nothing, i.e. a desktop. Undone by vi.restoreAllMocks().
 */
export function mockPhoneViewport() {
  const desktop = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...desktop(query),
    media: query,
    matches: query === MOBILE_QUERY,
  }));
}
